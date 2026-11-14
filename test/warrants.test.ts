// Task 3 routes over HTTP: passkey registration, warrant create/get, approval (REQ-001, REQ-002, REQ-003).
// Needs MONGODB_URI_GATE and `npm run setup-db`. Approval uses the software test authenticator, so this
// file turns AWP_ALLOW_TEST_AUTHENTICATOR on for its own process only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";

process.env.AWP_ALLOW_TEST_AUTHENTICATOR = "1";
process.env.REVIEWER_TOKEN = "test-reviewer-token";
const { config } = await import("../src/shared/config.ts");
const { buildServer } = await import("../src/gate/server.ts");
const { agents, auditEvents, challenges, closeDb, credentials, users, warrants } = await import("../src/gate/db.ts");
const { newId } = await import("../src/shared/ids.ts");
const { termsHash } = await import("../src/shared/canonical.ts");
const { createSoftAuthenticator } = await import("./softAuthenticator.ts");

const skip = !config.mongoUri.gate && "MONGODB_URI_GATE is not set; warrant route tests need a database";

let app: FastifyInstance;
const userId = newId("usr");
const otherUserId = newId("usr");
const agentId = `agt_test_${newId("agt").slice(4, 16)}`;
const auth = createSoftAuthenticator();
const created: string[] = [];

const cookieFor = (id: string) => ({ cookie: `awp_session=${encodeURIComponent(app.signCookie(id))}` });
const me = () => cookieFor(userId);
const reviewer = { authorization: "Bearer test-reviewer-token" };

/** The demo warrant W1 from PRD 8.9, as the page sends it. */
function w1(overrides: Record<string, unknown> = {}) {
  const in1h = new Date(Date.now() + 3_600_000).toISOString();
  return {
    v: 1,
    userId,
    agentId,
    scope: {
      actions: ["kyc.refresh", "payment.create"],
      accounts: ["A1", "A2", "A3", "A4", "A5"],
      merchants: ["M1"],
      destinations: ["bank", "fintech"],
      fields: { "kyc.refresh": ["account", "fields"], "payment.create": ["fromAccount", "merchant", "amountCents", "currency", "memo"] },
    },
    currency: "CAD",
    perActionMaxCents: 5000,
    totalLimitCents: 12000,
    notBefore: new Date().toISOString(),
    expiresAt: in1h,
    ...overrides,
  };
}

async function create(terms: unknown, headers = me()) {
  const res = await app.inject({ method: "POST", url: "/api/warrants", headers, payload: { terms } });
  if (res.statusCode === 200) created.push(res.json().warrantId);
  return res;
}

before(async () => {
  if (skip) return;
  app = await buildServer();
  await agents().insertOne({ _id: agentId, name: "test agent", keyHash: "x".repeat(43), status: "active" });
  await credentials().insertOne(auth.credentialDoc(userId));
});

after(async () => {
  if (skip) return;
  await challenges().deleteMany({ warrantId: { $in: created } });
  await warrants().deleteMany({ _id: { $in: created } });
  await credentials().deleteMany({ userId: { $in: [userId, otherUserId] } });
  await users().deleteMany({ _id: { $in: [userId, otherUserId] } });
  await agents().deleteOne({ _id: agentId });
  await app.close();
  await closeDb();
});

test("passkey registration", { skip }, async (t) => {
  await t.test("options require a platform passkey with user verification", async () => {
    const res = await app.inject({ method: "POST", url: "/api/passkey/register/options", payload: { userId: otherUserId, name: "Test" } });
    assert.equal(res.statusCode, 200);
    const options = res.json();
    assert.equal(options.rp.id, config.rpId);
    assert.equal(options.authenticatorSelection.userVerification, "required");
    assert.equal(options.authenticatorSelection.authenticatorAttachment, "platform");
    assert.equal(options.attestation, "none");
    assert.ok(await users().findOne({ _id: otherUserId }));
  });

  await t.test("a bad response is rejected and uses up the challenge", async () => {
    const bogus = { id: "abc", rawId: "abc", type: "public-key", response: { clientDataJSON: "e30", attestationObject: "oA" }, clientExtensionResults: {} };
    const res = await app.inject({ method: "POST", url: "/api/passkey/register/verify", payload: { userId: otherUserId, response: bogus } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers["set-cookie"], undefined);
    const again = await app.inject({ method: "POST", url: "/api/passkey/register/verify", payload: { userId: otherUserId, response: bogus } });
    assert.equal(again.statusCode, 409);
  });

  await t.test("malformed user IDs are refused", async () => {
    for (const payload of [{}, { userId: "bob" }, { userId: "usr_$(rm)" }]) {
      const res = await app.inject({ method: "POST", url: "/api/passkey/register/options", payload });
      assert.equal(res.statusCode, 400, JSON.stringify(payload));
    }
  });

  await t.test("the session route reports the signed-in user", async () => {
    assert.equal((await app.inject({ url: "/api/passkey/session" })).statusCode, 401);
    const res = await app.inject({ url: "/api/passkey/session", headers: me() });
    assert.deepEqual(res.json(), { userId });
  });
});

test("warrant create and get", { skip }, async (t) => {
  await t.test("creates a pending warrant with plain-language terms", async () => {
    const res = await create(w1());
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.match(body.warrantId, /^wrt_[0-9a-f]{24}$/);
    assert.equal(body.status, "pending");
    assert.equal(body.termsHash.length, 43);
    assert.ok(body.plain.some((l: string) => l.startsWith("Worst case: at most $120.00 can leave accounts A1 to A5, to merchant M1, before")));

    const stored = await warrants().findOne({ _id: body.warrantId });
    assert.ok(stored);
    assert.equal(stored.termsHash, body.termsHash);
    assert.equal(termsHash(stored.terms), body.termsHash);
    assert.equal(stored.terms.userId, userId);
    assert.equal(stored.terms.warrantId, body.warrantId);
    assert.equal(stored.terms.nonce.length, 22);
    assert.deepEqual(stored.terms.scope.fields["data.export"], []);
    assert.equal(stored.state.remainingCents, 12000);
    assert.equal(stored.approval, null);
  });

  await t.test("refuses bad terms", async () => {
    const cases: [string, unknown, number][] = [
      ["no session", w1(), 401],
      ["a warrantId supplied by the page", { ...w1(), warrantId: "wrt_mine" }, 400],
      ["a nonce supplied by the page", { ...w1(), nonce: "x" }, 400],
      ["another user's ID", w1({ userId: otherUserId }), 403],
      ["USD", w1({ currency: "USD" }), 400],
      ["fractional cents", w1({ perActionMaxCents: 10.5 }), 400],
      ["negative total", w1({ totalLimitCents: -1 }), 400],
      ["per-action above total", w1({ perActionMaxCents: 20000 }), 422],
      ["already expired", w1({ expiresAt: new Date(Date.now() - 1000).toISOString() }), 422],
      ["unknown agent", w1({ agentId: "agt_nobody" }), 422],
      ["unknown action", w1({ scope: { ...w1().scope, actions: ["wire.transfer"] } }), 400],
    ];
    for (const [name, terms, code] of cases) {
      const res = await create(terms, name === "no session" ? ({} as ReturnType<typeof me>) : me());
      assert.equal(res.statusCode, code, `${name}: ${res.body}`);
    }
  });

  await t.test("only the owner or a reviewer can read a warrant", async () => {
    const { warrantId } = (await create(w1())).json();
    const mine = await app.inject({ url: `/api/warrants/${warrantId}`, headers: me() });
    assert.equal(mine.statusCode, 200);
    assert.equal(mine.json().state.status, "pending");
    assert.ok(Array.isArray(mine.json().plain));
    assert.equal((await app.inject({ url: `/api/warrants/${warrantId}`, headers: cookieFor(otherUserId) })).statusCode, 404);
    assert.equal((await app.inject({ url: `/api/warrants/${warrantId}`, headers: reviewer })).statusCode, 200);
    assert.equal((await app.inject({ url: `/api/warrants/${warrantId}` })).statusCode, 401);
  });
});

test("warrant approval", { skip }, async (t) => {
  const options = async (id: string, hash: string, headers = me()) =>
    app.inject({ method: "POST", url: `/api/warrants/${id}/approve/options`, headers, payload: { termsHash: hash } });
  const verify = async (id: string, response: unknown, headers = me()) =>
    app.inject({ method: "POST", url: `/api/warrants/${id}/approve/verify`, headers, payload: { response } });

  await t.test("a passkey assertion over the displayed terms activates the warrant", async () => {
    const { warrantId, termsHash: hash } = (await create(w1())).json();
    const opts = await options(warrantId, hash);
    assert.equal(opts.statusCode, 200, opts.body);
    assert.equal(opts.json().challenge, hash);
    const res = await verify(warrantId, auth.getAssertion(opts.json()));
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { status: "active" });
    assert.equal((await warrants().findOne({ _id: warrantId }))?.state.status, "active");
  });

  await t.test("a page showing different terms gets 409", async () => {
    const { warrantId } = (await create(w1())).json();
    assert.equal((await options(warrantId, "A".repeat(43))).statusCode, 409);
  });

  await t.test("terms edited after the prompt cannot be approved", async () => {
    const { warrantId, termsHash: hash } = (await create(w1())).json();
    const assertion = auth.getAssertion((await options(warrantId, hash)).json());
    await warrants().updateOne({ _id: warrantId }, { $set: { "terms.totalLimitCents": 999_999 } });
    assert.equal((await verify(warrantId, assertion)).statusCode, 409);
    assert.equal((await warrants().findOne({ _id: warrantId }))?.state.status, "pending");
  });

  await t.test("a reused challenge fails", async () => {
    const { warrantId, termsHash: hash } = (await create(w1())).json();
    const assertion = auth.getAssertion((await options(warrantId, hash)).json());
    const bad = auth.getAssertion({ challenge: hash }, { origin: "https://evil.example" });
    assert.equal((await verify(warrantId, bad)).statusCode, 403);
    assert.equal((await verify(warrantId, assertion)).statusCode, 409);   // challenge already spent
    assert.equal((await warrants().findOne({ _id: warrantId }))?.state.status, "pending");
  });

  await t.test("another user cannot approve or even see the warrant", async () => {
    const { warrantId, termsHash: hash } = (await create(w1())).json();
    assert.equal((await options(warrantId, hash, cookieFor(otherUserId))).statusCode, 404);
    assert.equal((await options(warrantId, hash, {} as ReturnType<typeof me>)).statusCode, 401);
  });
});

test("customer view routes (v3.1)", { skip }, async (t) => {
  await t.test("GET /api/warrants lists only the session user's warrants, newest first", async () => {
    const a = (await create(w1())).json().warrantId;
    const b = (await create(w1())).json().warrantId;
    const res = await app.inject({ url: "/api/warrants", headers: me() });
    assert.equal(res.statusCode, 200);
    const ids = res.json().warrants.map((w: { _id: string }) => w._id);
    assert.ok(ids.indexOf(b) < ids.indexOf(a) && ids.indexOf(a) >= 0);
    assert.ok(res.json().warrants.every((w: { terms: { userId: string }; plain: string[] }) => w.terms.userId === userId && w.plain.length > 0));
    const other = await app.inject({ url: "/api/warrants", headers: cookieFor(otherUserId) });
    assert.ok(!other.json().warrants.some((w: { _id: string }) => w._id === a));
    assert.equal((await app.inject({ url: "/api/warrants" })).statusCode, 401);
  });

  await t.test("GET /api/warrants/:id/activity builds the trace from the warrant's ledger events", async () => {
    const { warrantId, termsHash: hash } = (await create(w1())).json();
    const base = { warrantId, termsHash: hash, agentId, policyVersion: "awp-policy-1", prevHash: "p".repeat(43), hash: "h".repeat(43), gateSig: "s" };
    const seq0 = 900_000_000 + Math.floor(Math.random() * 1_000_000);
    const events = [
      { ...base, _id: seq0, seq: seq0, ts: new Date().toISOString(), type: "DECISION", runId: "run_t", decisionId: "dec_t1", decision: "allow",
        action: { type: "payment.create", destination: "fintech", account: "A1", merchant: "M1", amountCents: 3000, fieldNames: [], fieldSizes: {} }, summary: "t" },
      { ...base, _id: seq0 + 1, seq: seq0 + 1, ts: new Date().toISOString(), type: "EXECUTION", runId: "run_t", decisionId: "dec_t1", outcome: "executed", summary: "t" },
      { ...base, _id: seq0 + 2, seq: seq0 + 2, ts: new Date().toISOString(), type: "DECISION", runId: "run_t", decisionId: "dec_t2", decision: "deny", reasonCode: "ACCOUNT_NOT_ALLOWED",
        action: { type: "kyc.refresh", destination: "bank", account: "A9", fieldNames: [], fieldSizes: {} }, summary: "t" },
    ];
    // Written directly (the dev database has no validator-free shortcut in the gate); removed afterwards.
    await auditEvents().insertMany(events as never[]);
    try {
      const res = await app.inject({ url: `/api/warrants/${warrantId}/activity`, headers: me() });
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      // The real ledger also records WARRANT_CREATED for this warrant; this test is about decisions.
      body.items = body.items.filter((i: { kind: string }) => i.kind !== "created");
      assert.equal(body.warrant.totalLimitCents, 12000);
      // The real ledger also records WARRANT_CREATED when the warrant is made; it comes first.
      assert.equal(body.items[0].kind, "created");
      body.items = body.items.filter((i: { seq: number }) => i.seq >= seq0);
      assert.deepEqual(body.items.map((i: { kind: string }) => i.kind), ["allowed", "blocked"]);
      assert.equal(body.items[0].headline, "Paid M1 $30.00 from A1");
      assert.equal(body.items[0].remainingAfterCents, 9000);
      assert.equal(body.items[1].steps[2].status, "failed");
      const after = await app.inject({ url: `/api/warrants/${warrantId}/activity?afterSeq=${seq0}`, headers: me() });
      assert.deepEqual(after.json().items.map((i: { seq: number }) => i.seq), [seq0 + 2]);
      assert.equal((await app.inject({ url: `/api/warrants/${warrantId}/activity`, headers: cookieFor(otherUserId) })).statusCode, 404);
      assert.equal((await app.inject({ url: `/api/warrants/${warrantId}/activity`, headers: reviewer })).statusCode, 200);
    } finally {
      await auditEvents().deleteMany({ _id: { $in: events.map((e) => e._id) } });
    }
  });
});
