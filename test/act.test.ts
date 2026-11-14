// POST /api/act (REQ-004 to REQ-010, PRD 8.6) end to end: gate server, real database, fake institution.
// Needs MONGODB_URI_GATE and AWP_ALLOW_TEST_AUTHENTICATOR=1. Tests that read DECISION events back or retry an
// idempotency key need the real ledger and skip while ledger.ts is the stub. The ledger is insert-only, so
// those tests leave their events behind; every other document they create is removed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Fastify from "fastify";
import type { ActAllow, ActDeny, ReasonCode, Terms, WarrantDoc } from "../src/shared/types.ts";
import { createSoftAuthenticator } from "./softAuthenticator.ts";

// ---- fake institution, started before the gate modules are imported ----

const calls: { aud: string; decisionId: string }[] = [];
let mode: "execute" | "reject" | "hang" = "execute";
let hangMs = 5500;
const institution = Fastify();
institution.post("/execute", async (req, reply) => {
  const { receipt } = req.body as { receipt: { aud: string; decisionId: string } };
  calls.push({ aud: receipt.aud, decisionId: receipt.decisionId });
  if (mode === "hang") {
    await new Promise((resolve) => setTimeout(resolve, hangMs));
    return reply.send({ executed: true, institutionRef: "too_late" });
  }
  if (mode === "reject") return reply.code(422).send({ rejected: true, reason: "refused by policy" });
  return { executed: true, institutionRef: `fake_${calls.length}` };
});
await institution.listen({ port: 0, host: "127.0.0.1" });
institution.server.unref();   // a skipped run must still exit
const fakeUrl = `http://127.0.0.1:${(institution.server.address() as { port: number }).port}`;
process.env.AWP_BANK_URL = fakeUrl;
process.env.AWP_FINTECH_URL = fakeUrl;

const { config } = await import("../src/shared/config.ts");
const { hashAgentKey } = await import("../src/gate/agents.ts");
const { issueOptions, verifyAndActivate } = await import("../src/gate/approval.ts");
const { agents, auditEvents, closeDb, credentials, users, warrants } = await import("../src/gate/db.ts");
const { buildServer } = await import("../src/gate/server.ts");
const { newId, newNonce } = await import("../src/shared/ids.ts");
const { termsHash } = await import("../src/shared/canonical.ts");
hangMs = config.executeTimeoutMs + 500;

const skip =
  (!config.mongoUri.gate && "MONGODB_URI_GATE is not set; act tests need a database") ||
  (!config.allowTestAuthenticator && "AWP_ALLOW_TEST_AUTHENTICATOR is not 1; act tests use the software test authenticator");
const stubLedger = readFileSync(new URL("../src/gate/ledger.ts", import.meta.url), "utf8").includes('prevHash: "stub"');
const needsLedger = { skip: stubLedger && "real ledger not merged yet" };

type Answer = ActAllow | ActDeny;

test("act endpoint", { skip }, async (t) => {
  const app = await buildServer({ logger: !!process.env.ACT_LOG });
  const auth = createSoftAuthenticator();
  const userId = newId("usr");
  const keyA = `key-${newNonce()}`;
  const keyB = `key-${newNonce()}`;
  const keyOff = `key-${newNonce()}`;
  const agentA = newId("agt");
  const agentB = newId("agt");
  const agentOff = newId("agt");
  const warrantIds: string[] = [];
  // One hook, in order: remove test documents, then close the client so the process can exit.
  t.after(async () => {
    await warrants().deleteMany({ _id: { $in: warrantIds } });
    await agents().deleteMany({ _id: { $in: [agentA, agentB, agentOff] } });
    await credentials().deleteMany({ _id: auth.credentialId });
    await users().deleteMany({ _id: userId });
    await app.close();
    await institution.close();
    await closeDb();
  });
  await users().insertOne({ _id: userId, name: "act test" });
  await credentials().insertOne(auth.credentialDoc(userId));
  await agents().insertMany([
    { _id: agentA, name: "act test A", keyHash: hashAgentKey(keyA), status: "active" },
    { _id: agentB, name: "act test B", keyHash: hashAgentKey(keyB), status: "active" },
    { _id: agentOff, name: "act test off", keyHash: hashAgentKey(keyOff), status: "disabled" },
  ]);

  // W1 of PRD 8.9: KYC on A1 to A5 at the bank; payments from A1 to M1 up to $50 each and $120 in total, CAD.
  type Seed = { agentId?: string; total?: number; ttlMs?: number; activate?: boolean; status?: "active" };
  async function seed(o: Seed = {}): Promise<WarrantDoc> {
    const warrantId = newId("wrt");
    const terms: Terms = {
      v: 1,
      warrantId,
      userId,
      agentId: o.agentId ?? agentA,
      parentWarrantId: null,
      scope: {
        actions: ["kyc.refresh", "payment.create"],
        accounts: ["A1", "A2", "A3", "A4", "A5"],
        merchants: ["M1"],
        destinations: ["bank", "fintech"],
        fields: { "kyc.refresh": ["account", "fields"], "payment.create": ["fromAccount", "merchant", "amountCents", "currency", "memo"], "data.export": [] },
      },
      currency: "CAD",
      perActionMaxCents: 5000,
      totalLimitCents: o.total ?? 12000,
      notBefore: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + (o.ttlMs ?? 3_600_000)).toISOString(),
      nonce: newNonce(),
    };
    const doc: WarrantDoc = {
      _id: warrantId,
      terms,
      termsHash: termsHash(terms),
      approval: null,
      state: { status: o.status ?? "pending", remainingCents: terms.totalLimitCents, actionCount: 0 },
      ancestors: [],
      expiresAt: new Date((o.ttlMs ?? 1) > 0 ? terms.expiresAt : Date.now() + 3_600_000),   // the Date copy stays valid when only the terms are expired
      createdAt: new Date(),
    };
    warrantIds.push(warrantId);
    await warrants().insertOne(doc);
    if (o.activate !== false && o.status === undefined) {
      await verifyAndActivate(warrantId, auth.getAssertion(await issueOptions(warrantId, doc.termsHash)));
    }
    return (await warrants().findOne({ _id: warrantId }))!;
  }

  const state = async (id: string) => (await warrants().findOne({ _id: id }))!.state;
  const post = (key: string | undefined, payload: unknown) =>
    app.inject({ method: "POST", url: "/api/act", headers: key ? { authorization: `Bearer ${key}` } : {}, payload: payload as object });
  const act = async (key: string | undefined, payload: unknown): Promise<{ status: number; body: Answer; raw: string }> => {
    const res = await post(key, payload);
    return { status: res.statusCode, body: res.json() as Answer, raw: res.body };
  };
  type Params = Record<string, unknown>;
  const request = (warrantId: string, type: string, destination: string, params: Params, idempotencyKey = newId("run")) => ({
    warrantId, runId: "run_act_test", idempotencyKey, action: { type, destination, params },
  });
  const kyc = (w: string, account: string, key?: string) => request(w, "kyc.refresh", "bank", { account, fields: ["name", "address"] }, key);
  const pay = (w: string, amountCents: number, extra: Params = {}, key?: string) =>
    request(w, "payment.create", "fintech", { fromAccount: "A1", merchant: "M1", amountCents, currency: "CAD", ...extra }, key);
  const expectAllow = (r: { status: number; body: Answer }, outcome: string, remainingCents: number) => {
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.decision, "allow");
    const a = r.body as ActAllow;
    assert.equal(a.outcome, outcome);
    assert.equal(a.remainingCents, remainingCents);
    assert.match(a.decisionId, /^dec_[0-9a-f]{24}$/);
  };
  const expectDeny = (r: { status: number; body: Answer }, reasonCode: ReasonCode) => {
    assert.equal(r.status, 403);
    assert.deepEqual({ decision: r.body.decision, reasonCode: (r.body as ActDeny).reasonCode }, { decision: "deny", reasonCode });
  };

  await t.test("in-warrant actions execute, spend budget, and the agent never sees a receipt", async () => {
    const w = await seed();
    const before = calls.length;
    const steps: [unknown, number][] = [[kyc(w._id, "A1"), 12000], [kyc(w._id, "A3"), 12000], [pay(w._id, 3000), 9000], [pay(w._id, 5000), 4000]];
    for (const [body, remaining] of steps) {
      const r = await act(keyA, body);
      expectAllow(r, "executed", remaining);
      assert.ok(!/receipt|gateSig/i.test(r.raw), "response must not carry a receipt or signature");
      assert.equal((r.body as ActAllow).result !== undefined, true);
      assert.deepEqual(Object.keys(r.body).sort(), ["decision", "decisionId", "outcome", "remainingCents", "result", "seq"]);
    }
    assert.equal(calls.length - before, 4);
    assert.deepEqual(calls.slice(before).map((c) => c.aud), ["bank", "bank", "fintech", "fintech"]);
    assert.deepEqual(await state(w._id), { status: "active", remainingCents: 4000, actionCount: 4 });

    // $50 when $40 remains
    const r = await act(keyA, pay(w._id, 5000));
    expectDeny(r, "BUDGET_EXHAUSTED");
    assert.equal(calls.length - before, 4);
    assert.deepEqual(await state(w._id), { status: "active", remainingCents: 4000, actionCount: 4 });
  });

  await t.test("every out-of-warrant action is denied with its code, calls no institution, spends nothing", async () => {
    const w = await seed();
    const before = calls.length;
    const cases: [string, unknown, ReasonCode][] = [
      ["KYC on A9", kyc(w._id, "A9"), "ACCOUNT_NOT_ALLOWED"],
      ["pay $80", pay(w._id, 8000), "PER_ACTION_LIMIT"],
      ["pay M2", pay(w._id, 2000, { merchant: "M2" }), "MERCHANT_NOT_ALLOWED"],
      ["pay in USD", pay(w._id, 2000, { currency: "USD" }), "CURRENCY_MISMATCH"],
      ["pay -$10", pay(w._id, -1000), "AMOUNT_INVALID"],
      ["data.export", request(w._id, "data.export", "https://collector.example/c", { rows: 1 }), "ACTION_NOT_ALLOWED"],
      ["bad destination", request(w._id, "payment.create", "https://collector.example/c", { fromAccount: "A1", merchant: "M1", amountCents: 1000, currency: "CAD" }), "DESTINATION_NOT_ALLOWED"],
      ["extra clientList field", pay(w._id, 1000, { clientList: ["a", "b"] }), "FIELD_NOT_ALLOWED"],
      ["5,000-character memo", pay(w._id, 1000, { memo: "Z".repeat(5000) }), "FIELD_CONSTRAINT"],
    ];
    for (const [name, body, code] of cases) {
      const r = await act(keyA, body);
      expectDeny(r, code);
      assert.ok(!r.raw.includes("ZZZZZZZZ"), `${name}: response must not echo parameter values`);
    }
    assert.equal(calls.length, before);
    assert.deepEqual(await state(w._id), { status: "active", remainingCents: 12000, actionCount: 0 });
  });

  await t.test("warrant state: expired, revoked, pending, tampered, unknown", async () => {
    const before = calls.length;
    const check = async (w: WarrantDoc, code: ReasonCode, key = keyA) => {
      expectDeny(await act(key, pay(w._id, 1000)), code);
      assert.equal((await state(w._id)).remainingCents, 12000);
    };

    const expired = await seed();
    await warrants().updateOne({ _id: expired._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });   // the Date copy the atomic update filters on
    await check(expired, "WARRANT_EXPIRED");

    const expiredTerms = await seed({ ttlMs: -60_000, status: "active" });   // signed terms in the past, Date copy in the future
    await check(expiredTerms, "WARRANT_EXPIRED");

    const revoked = await seed();
    await warrants().updateOne({ _id: revoked._id }, { $set: { "state.status": "revoked" } });
    await check(revoked, "WARRANT_REVOKED");

    await check(await seed({ activate: false }), "WARRANT_NOT_ACTIVE");

    const tampered = await seed();
    await warrants().updateOne({ _id: tampered._id }, { $set: { "terms.totalLimitCents": 999_999 } });
    await check(tampered, "TERMS_TAMPERED");

    expectDeny(await act(keyA, pay(newId("wrt"), 1000)), "WARRANT_NOT_FOUND");
    assert.equal(calls.length, before);
  });

  await t.test("agent identity: wrong key, no key, another agent, disabled agent", async () => {
    const w = await seed();
    const before = calls.length;
    expectDeny(await act(keyB, pay(w._id, 1000)), "AGENT_MISMATCH");
    expectDeny(await act(undefined, pay(w._id, 1000)), "AGENT_UNAUTHENTICATED");
    expectDeny(await act("not-a-real-key", pay(w._id, 1000)), "AGENT_UNAUTHENTICATED");
    expectDeny(await act(keyOff, pay(w._id, 1000)), "AGENT_UNAUTHENTICATED");
    const basic = await app.inject({ method: "POST", url: "/api/act", headers: { authorization: `Basic ${keyA}` }, payload: pay(w._id, 1000) });
    assert.equal(basic.statusCode, 403);
    assert.equal(calls.length, before);
    assert.deepEqual(await state(w._id), { status: "active", remainingCents: 12000, actionCount: 0 });
  });

  await t.test("malformed bodies are denied MALFORMED_REQUEST; without a valid key they are AGENT_UNAUTHENTICATED first", async () => {
    const w = await seed();
    const before = calls.length;
    const good = pay(w._id, 1000);
    const bad: [string, unknown][] = [
      ["unknown top-level key", { ...good, extra: 1 }],
      ["unknown action key", { ...good, action: { ...good.action, extra: 1 } }],
      ["missing idempotencyKey", { warrantId: good.warrantId, runId: good.runId, action: good.action }],
      ["params is not an object", { ...good, action: { ...good.action, params: [1] } }],
      ["warrantId too long", { ...good, warrantId: "w".repeat(65) }],
      ["idempotencyKey too long", { ...good, idempotencyKey: "k".repeat(129) }],
      ["runId too long", { ...good, runId: "r".repeat(129) }],
      ["unknown action type", { ...good, action: { ...good.action, type: "wire.transfer" } }],
      ["array body", [good]],
    ];
    for (const [name, body] of bad) {
      assert.equal((await act(keyA, body)).body.decision, "deny", name);
      expectDeny(await act(keyA, body), "MALFORMED_REQUEST");
      expectDeny(await act(undefined, body), "AGENT_UNAUTHENTICATED");
    }
    for (const payload of ["not json", "", "null"]) {
      const res = await app.inject({ method: "POST", url: "/api/act", headers: { authorization: `Bearer ${keyA}`, "content-type": "text/plain" }, payload });
      assert.equal(res.statusCode, 403);
      assert.equal((res.json() as ActDeny).reasonCode, "MALFORMED_REQUEST");
    }
    assert.equal(calls.length, before);
    assert.equal((await state(w._id)).remainingCents, 12000);
  });

  await t.test("children route is still not implemented", async () => {
    const res = await app.inject({ method: "POST", url: "/api/warrants/wrt_x/children", payload: {} });
    assert.equal(res.statusCode, 501);
  });

  await t.test("a direct hit on the institution shows in its call count and never touches warrant budget", async () => {
    const w = await seed();
    const before = calls.length;
    const res = await fetch(`${fakeUrl}/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt: { aud: "bank", decisionId: "dec_direct" } }) });
    assert.equal(res.status, 200);
    assert.equal(calls.length, before + 1);
    assert.equal((await state(w._id)).remainingCents, 12000);
  });

  await t.test("an institution refusal restores the held amount exactly once", async () => {
    const w = await seed();
    mode = "reject";
    try {
      expectAllow(await act(keyA, pay(w._id, 3000)), "rejected", 12000);
      expectAllow(await act(keyA, kyc(w._id, "A2")), "rejected", 12000);
    } finally {
      mode = "execute";
    }
    assert.deepEqual(await state(w._id), { status: "active", remainingCents: 12000, actionCount: 0 });
    expectAllow(await act(keyA, pay(w._id, 3000)), "executed", 9000);
    assert.deepEqual(await state(w._id), { status: "active", remainingCents: 9000, actionCount: 1 });
  });

  await t.test("an institution that does not answer keeps the amount held and the outcome unknown", async () => {
    const w = await seed();
    mode = "hang";
    const started = Date.now();
    try {
      const r = await act(keyA, pay(w._id, 3000));
      expectAllow(r, "unknown", 9000);
      assert.ok(Date.now() - started >= config.executeTimeoutMs - 200, "waited for the execute timeout");
    } finally {
      mode = "execute";
    }
    assert.deepEqual(await state(w._id), { status: "active", remainingCents: 9000, actionCount: 1 });
  });

  await t.test("G3: 20 parallel $10 payments on a fresh $100 warrant give exactly 10 allows", async () => {
    const w = await seed({ total: 10000 });
    const before = calls.length;
    const results = await Promise.all(Array.from({ length: 20 }, () => act(keyA, pay(w._id, 1000))));
    const allowed = results.filter((r) => r.body.decision === "allow");
    const denied = results.filter((r) => r.body.decision === "deny");
    assert.equal(allowed.length, 10);
    assert.equal(denied.length, 10);
    assert.ok(denied.every((r) => r.status === 403 && (r.body as ActDeny).reasonCode === "BUDGET_EXHAUSTED"));
    assert.ok(allowed.every((r) => (r.body as ActAllow).outcome === "executed"));
    assert.deepEqual(await state(w._id), { status: "active", remainingCents: 0, actionCount: 10 });
    assert.equal(calls.length - before, 10);
  });

  await t.test("idempotency: the same key twice is one decision, one execution, one spend", needsLedger, async () => {
    const w = await seed();
    const before = calls.length;
    const body = pay(w._id, 3000, {}, "retry-1");
    const first = await act(keyA, body);
    const events = await auditEvents().countDocuments({ warrantId: w._id });
    const second = await act(keyA, body);
    expectAllow(first, "executed", 9000);
    expectAllow(second, "executed", 9000);
    assert.equal(second.body.decisionId, first.body.decisionId);
    assert.equal(second.body.seq, first.body.seq);
    assert.equal(calls.length - before, 1);
    assert.deepEqual(await state(w._id), { status: "active", remainingCents: 9000, actionCount: 1 });
    assert.equal(await auditEvents().countDocuments({ warrantId: w._id }), events);

    // a denial is returned unchanged too
    const denyBody = pay(w._id, 8000, {}, "retry-2");
    const d1 = await act(keyA, denyBody);
    const d2 = await act(keyA, denyBody);
    expectDeny(d2, "PER_ACTION_LIMIT");
    assert.deepEqual(d2.body, d1.body);
  });

  await t.test("idempotency: two identical requests at once decide once", needsLedger, async () => {
    const w = await seed();
    const before = calls.length;
    const body = pay(w._id, 3000, {}, "race-1");
    const [a, b] = await Promise.all([act(keyA, body), act(keyA, body)]);
    assert.equal(a.body.decisionId, b.body.decisionId);
    assert.equal(a.body.seq, b.body.seq);
    assert.equal(calls.length - before, 1);
    assert.deepEqual(await state(w._id), { status: "active", remainingCents: 9000, actionCount: 1 });
    assert.equal(await auditEvents().countDocuments({ warrantId: w._id, type: "DECISION" }), 1);
  });

  await t.test("another agent cannot claim an idempotency key of the warrant's owner", needsLedger, async () => {
    const w = await seed();
    expectDeny(await act(keyB, pay(w._id, 3000, {}, "claimed")), "AGENT_MISMATCH");
    expectAllow(await act(keyA, pay(w._id, 3000, {}, "claimed")), "executed", 9000);
  });

  await t.test("decisions are recorded before execution, with field names and sizes only", needsLedger, async () => {
    const w = await seed();
    const memo = "Z".repeat(5000);
    const ok = await act(keyA, pay(w._id, 3000, { memo: "lunch" }));
    const bad = await act(keyA, pay(w._id, 1000, { memo, clientList: ["secret-client"] }));
    expectDeny(bad, "FIELD_NOT_ALLOWED");
    const mismatch = await act(keyB, pay(w._id, 1000));
    expectDeny(mismatch, "AGENT_MISMATCH");
    const unauth = await act(undefined, { ...pay(w._id, 1000), extra: "secret-value" });
    expectDeny(unauth, "AGENT_UNAUTHENTICATED");
    const malformed = await act(keyA, { warrantId: w._id, runId: "run_m", secretField: "secret-value" });
    expectDeny(malformed, "MALFORMED_REQUEST");

    const events = await auditEvents().find({ warrantId: w._id }).sort({ seq: 1 }).toArray();
    const byDecision = (id: string) => events.filter((e) => e.decisionId === id);
    const [allow, execution] = byDecision(ok.body.decisionId);
    assert.equal(allow.type, "DECISION");
    assert.equal(allow.decision, "allow");
    assert.equal(allow.agentId, agentA);
    assert.equal(allow.termsHash, w.termsHash);
    assert.equal(allow.summary, "Allowed payment.create of $30.00 CAD from A1 to M1 at fintech.");
    assert.deepEqual(allow.action?.fieldNames, ["amountCents", "currency", "fromAccount", "memo", "merchant"]);
    assert.equal(execution.type, "EXECUTION");
    assert.equal(execution.outcome, "executed");
    assert.ok(allow.seq < execution.seq, "G1: DECISION precedes EXECUTION");
    assert.equal(allow.seq, ok.body.seq);

    const [denied] = byDecision(bad.body.decisionId);
    assert.equal(denied.reasonCode, "FIELD_NOT_ALLOWED");
    assert.equal(denied.action?.fieldSizes.memo, 5002);
    assert.deepEqual(denied.action?.fieldNames, ["amountCents", "clientList", "currency", "fromAccount", "memo", "merchant"]);
    assert.equal(denied.summary, "Denied payment.create of $10.00 CAD from A1 to M1 at fintech: FIELD_NOT_ALLOWED.");

    assert.equal(byDecision(mismatch.body.decisionId)[0].agentId, agentB);
    const [u] = await auditEvents().find({ decisionId: unauth.body.decisionId }).toArray();
    assert.equal(u.agentId, null);
    assert.equal(u.warrantId, w._id);
    const [m] = await auditEvents().find({ decisionId: malformed.body.decisionId }).toArray();
    assert.match(m.summary, /fields: runId \d+, secretField \d+, warrantId \d+/);

    const text = JSON.stringify(events);
    for (const value of ["ZZZZZZZZ", "secret-client", "secret-value"]) assert.ok(!text.includes(value), `ledger must not hold ${value}`);
    const seqs = events.map((e) => e.seq);
    assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y));
  });
});
