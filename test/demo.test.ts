// Story backend end to end (docs/STORY-API.md): reset -> warrant -> approve -> work -> blocked -> sensitive -> burst
// -> revoke -> tamper -> verify-approval. Runs in throwaway <prefix>awp_* databases so it never races other test files.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { MongoClient } from "mongodb";

try {
  process.loadEnvFile();
} catch {
  // no .env
}
const prefix = `demotest${randomBytes(3).toString("hex")}_`;
Object.assign(process.env, { AWP_DB_PREFIX: prefix, AWP_ALLOW_TEST_AUTHENTICATOR: "1", AWP_FIXTURES: "0", REVIEWER_TOKEN: "demo-test-reviewer" });

const { config } = await import("../src/shared/config.ts");
const skip = !(config.mongoUri.gate && config.mongoUri.bank && config.mongoUri.fintech && config.gatePrivateKey) && "database URIs or gate keys not set";

let app: FastifyInstance;
let institutions: FastifyInstance[] = [];
let auth: Awaited<typeof import("./softAuthenticator.ts")>["createSoftAuthenticator"] extends (...a: never[]) => infer R ? R : never;

before(async () => {
  if (skip) return;
  const { setupGate, setupInstitution } = await import("../scripts/setup-db.ts");
  const { buildInstitution } = await import("../src/institutions/server.ts");
  for (const i of ["bank", "fintech"] as const) {
    const client = new MongoClient(config.mongoUri[i]!);
    await setupInstitution(client.db(config.dbName[i]), i);
    await client.close();
    const inst = await buildInstitution(i);
    await inst.listen({ port: 0, host: "127.0.0.1" });
    const { port } = inst.server.address() as { port: number };
    process.env[i === "bank" ? "AWP_BANK_URL" : "AWP_FINTECH_URL"] = `http://127.0.0.1:${port}`;
    institutions.push(inst);
  }
  const dbm = await import("../src/gate/db.ts");
  await setupGate(dbm.db());
  const { createSoftAuthenticator } = await import("./softAuthenticator.ts");
  auth = createSoftAuthenticator();
  await dbm.credentials().insertOne(auth.credentialDoc("usr_demo"));
  const { buildServer } = await import("../src/gate/server.ts");
  app = await buildServer();
});

after(async () => {
  if (skip) return;
  await app?.close();
  await Promise.all(institutions.map((i) => i.close()));
  const { mongo, closeDb } = await import("../src/gate/db.ts");
  await mongo().db(config.dbName.gate).dropDatabase();
  await closeDb();
  for (const i of ["bank", "fintech"] as const) {
    const client = new MongoClient(config.mongoUri[i]!);
    await client.db(config.dbName[i]).dropDatabase();
    await client.close();
  }
});

const post = async (url: string, payload: object = {}, headers: Record<string, string> = {}) => {
  const res = await app.inject({ method: "POST", url, payload, headers });
  assert.ok(res.statusCode < 300, `${url}: ${res.statusCode} ${res.body}`);
  return res.json();
};
const get = async (url: string, headers: Record<string, string> = {}) => {
  const res = await app.inject({ url, headers });
  assert.ok(res.statusCode < 300, `${url}: ${res.statusCode} ${res.body}`);
  return res.json();
};

test("story backend: every chapter against the real gate", { skip, timeout: 300_000 }, async () => {
  const reset = await post("/api/demo/reset");
  assert.deepEqual(reset, { ok: true, warrantId: null, user: { userId: "usr_demo", name: "Ram", hasPasskey: true }, savingsCents: 8_400_000 });

  // Chapter 1: compile.
  const red = await post("/api/demo/compile", { text: "Put my life savings into NVIDIA" });
  assert.equal(red.worstCase.severity, "red");
  assert.equal(red.worstCase.cents, 8_400_000);
  assert.equal(red.terms.scope.merchants[0], "BROKERAGE-NVDA");
  const green = await post("/api/demo/compile", { text: "okay, $500 at a time, $1,000 max" });
  assert.equal(green.worstCase.severity, "green");
  assert.equal(green.terms.perActionMaxCents, 50_000);
  assert.equal(green.terms.totalLimitCents, 100_000);
  assert.equal(green.canonical, JSON.stringify(JSON.parse(green.canonical)));
  assert.ok(green.plain.length > 0);

  // Chapter 2: a pending warrant, signed with the (software) passkey through the real approval routes.
  const w = await post("/api/demo/warrant", { text: "okay, $500 at a time, $1,000 max" });
  assert.match(w.warrantId, /^wrt_/);
  assert.equal((await get("/api/demo/state")).warrant.status, "pending");
  const session = { cookie: `awp_session=${encodeURIComponent(app.signCookie("usr_demo"))}` };
  assert.deepEqual(await post("/api/demo/session"), { userId: "usr_demo" });
  const options = await post(`/api/warrants/${w.warrantId}/approve/options`, { termsHash: w.termsHash }, session);
  assert.equal(options.challenge, w.termsHash);
  assert.deepEqual(await post(`/api/warrants/${w.warrantId}/approve/verify`, { response: auth.getAssertion(options) }, session), { status: "active" });

  const inspect = await get(`/api/warrants/${w.warrantId}/inspect`);
  assert.equal(inspect.challenge, inspect.termsHash);
  assert.equal(inspect.approval.userVerified, true);
  assert.equal(inspect.approval.clientDataJSON.challenge, w.termsHash);
  assert.equal(inspect.document._id, w.warrantId);
  assert.equal((await get(`/api/warrants/${w.warrantId}/verify-approval`)).valid, true);

  // Chapter 4: one real purchase, executed at the fintech after its own three checks.
  const work = await post("/api/demo/work");
  assert.equal(work.items.length, 1);
  const [buy] = work.items;
  assert.equal(buy.decision, "allow");
  assert.equal(buy.outcome, "executed");
  assert.equal(buy.remainingCents, 50_000);
  assert.equal(buy.trace.atomicUpdate.matched, 1);
  assert.equal(typeof buy.trace.gateMs, "number");
  assert.equal(buy.receipt.ledger.seq, buy.seq);
  assert.deepEqual(
    { g: buy.institutionChecks.gateSignature, p: buy.institutionChecks.customerPasskey, t: buy.institutionChecks.terms },
    { g: true, p: true, t: true },
  );

  // Chapter 5: three denials.
  const blocked = await post("/api/demo/blocked");
  assert.deepEqual(blocked.items.map((i: { reasonCode: string }) => i.reasonCode), ["PER_ACTION_LIMIT", "MERCHANT_NOT_ALLOWED", "DESTINATION_NOT_ALLOWED"]);
  assert.ok(blocked.items.every((i: { trace: { atomicUpdate: { matched: number } } }) => i.trace.atomicUpdate.matched === 0));
  assert.equal(blocked.warrant.remainingCents, 50_000);

  // Chapter 6: policy, minimize, match, Touch ID, release.
  const added = await post("/api/policies", { rule: "Require Touch ID before any account statement leaves our network" });
  assert.equal(added.embeddingWrittenByUs, false);
  assert.equal(added.policy.action, "REQUIRE_TOUCH_ID");
  assert.ok((await get("/api/policies")).policies.length >= 3);
  assert.equal((await get("/api/policies/index")).name, "egress_rule_vec");
  const sensitive = await post("/api/demo/sensitive");
  const [ex] = sensitive.items;
  assert.equal(ex.decision, "allow");
  assert.ok(ex.trace.minimize.removed.some((r: string) => r.includes("SSN")));
  assert.ok(ex.trace.minimize.tokensAfter < ex.trace.minimize.tokensBefore);
  assert.ok(!JSON.stringify(ex.trace.minimize.after).includes("123-45-6789"));
  assert.equal(ex.trace.semantic.policyId, added.policy._id);
  assert.ok(sensitive.pending, "a Touch ID policy matched");
  assert.equal(ex.trace.approvalChallenge, sensitive.pending.challenge);
  const aOptions = await post(`/api/approvals/${sensitive.pending.approvalId}/options`);
  assert.equal(aOptions.challenge, sensitive.pending.challenge);
  const releasedRes = await post(`/api/approvals/${sensitive.pending.approvalId}/verify`, { response: auth.getAssertion(aOptions) });
  assert.equal(releasedRes.released, true);
  assert.ok(!JSON.stringify(releasedRes.sentToLlm).match(/123-45-6789|4520-1188|ram@example/));
  assert.ok(["claude", "canned"].includes(releasedRes.llmSource));

  // Chapter 7: 20 at once, exactly 10 fit in the $500 left; then revoke.
  const burst = await post("/api/demo/burst");
  assert.equal(burst.items.length, 20);
  assert.equal(burst.counts.allowed, 10);
  assert.equal(burst.counts.denied, 10);
  assert.equal(burst.counts.remainingCents, 0);
  assert.ok(burst.items.filter((i: { decision: string }) => i.decision === "deny").every((i: { reasonCode: string }) => i.reasonCode === "BUDGET_EXHAUSTED"));
  console.log(`burst elapsedMs ${burst.counts.elapsedMs}`);
  const revoke = await post("/api/demo/revoke");
  assert.equal(revoke.items[0].reasonCode, "WARRANT_REVOKED");
  assert.equal(revoke.warrant.status, "revoked");

  // Chapter 8: the chain verifies, then tampering breaks both the chain and the signature.
  const reviewer = { authorization: "Bearer demo-test-reviewer" };
  assert.equal((await get("/api/ledger/verify", reviewer)).ok, true);
  const tamper = await post("/api/demo/tamper");
  assert.equal(tamper.tampered.field, "action.amountCents");
  assert.equal(tamper.tampered.seq, buy.seq);
  const chain = await get("/api/ledger/verify", reviewer);
  assert.equal(chain.ok, false);
  assert.equal(chain.firstBrokenSeq, tamper.tampered.seq);
  const reverify = await get(`/api/warrants/${w.warrantId}/verify-approval`);
  assert.equal(reverify.valid, false);
  assert.notEqual(reverify.recomputedHash, reverify.termsHash);
  assert.ok(reverify.reason);
  const state = await get("/api/demo/state");
  assert.equal(state.warrant.warrantId, w.warrantId);
  assert.ok(state.ledgerHead.seq > 0);
});
