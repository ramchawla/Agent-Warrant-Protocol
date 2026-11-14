// buildReceipt and forwardReceipt (REQ-009, REQ-010). No database. buildReceipt needs the gate key pair from .env.
import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { buildReceipt, forwardReceipt } from "../src/gate/receipts.ts";
import { ed25519Verify, hashJcs, jcs, termsHash } from "../src/shared/canonical.ts";
import { config } from "../src/shared/config.ts";
import { newId, newNonce } from "../src/shared/ids.ts";
import type { Action, Terms } from "../src/shared/types.ts";
import { verifyReceipt } from "../src/verifier/verifyReceipt.ts";
import { createSoftAuthenticator } from "./softAuthenticator.ts";

const skipKeys = (!config.gatePrivateKey || !config.gatePublicKey) && "GATE_ED25519_PRIVATE_KEY / GATE_ED25519_PUBLIC_KEY are not set; run `npm run keys`";

const userId = newId("usr");
const auth = createSoftAuthenticator();
const terms: Terms = {
  v: 1,
  warrantId: newId("wrt"),
  userId,
  agentId: "agt_receipt_test",
  parentWarrantId: null,
  scope: {
    actions: ["payment.create"],
    accounts: ["A1"],
    merchants: ["M1"],
    destinations: ["fintech"],
    fields: { "kyc.refresh": [], "payment.create": ["fromAccount", "merchant", "amountCents", "currency"], "data.export": [] },
  },
  currency: "CAD",
  perActionMaxCents: 5000,
  totalLimitCents: 12000,
  notBefore: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  nonce: newNonce(),
};
const action: Action = { type: "payment.create", destination: "fintech", params: { fromAccount: "A1", merchant: "M1", amountCents: 3000, currency: "CAD" } };
const chain = [{
  terms,
  approval: {
    kind: "passkey" as const,
    credentialId: auth.credentialId,
    response: auth.getAssertion({ challenge: termsHash(terms) }),
    origin: config.origin,
    rpId: config.rpId,
    approvedAt: new Date().toISOString(),
  },
}];
const build = (now?: Date) => buildReceipt({ decisionId: newId("dec"), aud: "fintech", action, chain, ledger: { seq: 3, hash: "h".repeat(43) }, ...(now && { now }) });

test("buildReceipt signs a receipt the verifier accepts", { skip: skipKeys }, async () => {
  const now = new Date();
  const { receipt, gateSig } = build(now);
  assert.equal(receipt.v, 1);
  assert.equal(receipt.aud, "fintech");
  assert.equal(receipt.iat, now.toISOString());
  assert.equal(Date.parse(receipt.exp) - Date.parse(receipt.iat), config.receiptTtlMs);
  assert.equal(receipt.actionHash, hashJcs(action));
  assert.ok(ed25519Verify(config.gatePublicKey!, jcs(receipt), gateSig));

  const ctx = {
    institution: "fintech" as const,
    gatePublicKey: config.gatePublicKey!,
    rpId: config.rpId,
    origin: config.origin,
    now,
    credentialsFor: async () => [{ id: auth.credentialId, publicKey: auth.publicKey }],
  };
  assert.equal((await verifyReceipt({ receipt, gateSig }, ctx)).ok, true);
  // Past its 60 seconds (plus skew) the same receipt is refused.
  const late = await verifyReceipt({ receipt, gateSig }, { ...ctx, now: new Date(now.getTime() + config.receiptTtlMs + config.receiptSkewMs + 1) });
  assert.deepEqual(late, { ok: false, reason: "EXPIRED" });
});

test("buildReceipt defaults iat to now", { skip: skipKeys }, () => {
  const before = Date.now();
  const { receipt } = build();
  assert.ok(Date.parse(receipt.iat) >= before && Date.parse(receipt.iat) <= Date.now());
});

// ---- forwardReceipt against a local stub institution ----

type Handler = (body: unknown) => { status: number; body?: unknown; raw?: string; hang?: boolean };

async function withStub(handler: Handler, run: (url: string, seen: unknown[]) => Promise<void>): Promise<void> {
  const app: FastifyInstance = Fastify();
  const seen: unknown[] = [];
  app.post("/execute", async (req, reply) => {
    seen.push(req.body);
    const out = handler(req.body);
    if (out.hang) return new Promise(() => {});
    reply.code(out.status);
    return out.raw !== undefined ? reply.type("text/plain").send(out.raw) : out.body;
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  try {
    await run(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, seen);
  } finally {
    delete process.env.AWP_BANK_URL;
    delete process.env.AWP_FINTECH_URL;
    app.server.closeAllConnections();
    await app.close();
  }
}

const sample = { receipt: { v: 1 } as never, gateSig: "sig" };

test("forwardReceipt: executed", async () => {
  await withStub(() => ({ status: 200, body: { executed: true, institutionRef: "ref_1" } }), async (url, seen) => {
    process.env.AWP_BANK_URL = url + "/";
    const out = await forwardReceipt("bank", sample.receipt, sample.gateSig);
    assert.deepEqual(out, { outcome: "executed", institutionRef: "ref_1", result: { executed: true, institutionRef: "ref_1" } });
    assert.deepEqual(seen, [{ receipt: { v: 1 }, gateSig: "sig" }]);
  });
  // A duplicate presentation is still an execution that happened.
  await withStub(() => ({ status: 200, body: { executed: true, institutionRef: "ref_1", duplicate: true } }), async (url) => {
    process.env.AWP_FINTECH_URL = url;
    assert.equal((await forwardReceipt("fintech", sample.receipt, sample.gateSig)).outcome, "executed");
  });
});

test("forwardReceipt reads the base URL for its own institution at call time", async () => {
  await withStub(() => ({ status: 200, body: { executed: true } }), async (url) => {
    process.env.AWP_FINTECH_URL = url;
    process.env.AWP_BANK_URL = "http://127.0.0.1:1";
    assert.equal((await forwardReceipt("fintech", sample.receipt, sample.gateSig)).outcome, "executed");
    assert.equal((await forwardReceipt("bank", sample.receipt, sample.gateSig)).outcome, "unknown");
  });
});

test("forwardReceipt: rejected", async () => {
  for (const status of [403, 422, 500]) {
    await withStub(() => ({ status, body: { rejected: true, reason: "POLICY_CAP" } }), async (url) => {
      process.env.AWP_BANK_URL = url;
      assert.deepEqual(await forwardReceipt("bank", sample.receipt, sample.gateSig), { outcome: "rejected", reason: "POLICY_CAP" });
    });
  }
});

test("forwardReceipt: anything unclear is unknown", async () => {
  const cases: [string, Handler][] = [
    ["unparsable reply", () => ({ status: 200, raw: "<html>oops</html>" })],
    ["empty 200", () => ({ status: 200, body: {} })],
    ["200 that says rejected", () => ({ status: 200, body: { rejected: true } })],
    ["error without a rejected flag", () => ({ status: 500, body: { error: "boom" } })],
    ["4xx not from the institution", () => ({ status: 404, raw: "Not Found" })],
    ["executed flag on a 4xx", () => ({ status: 400, body: { executed: true } })],
    ["a JSON string", () => ({ status: 200, body: "executed" })],
  ];
  for (const [name, handler] of cases) {
    await withStub(handler, async (url) => {
      process.env.AWP_BANK_URL = url;
      assert.deepEqual(await forwardReceipt("bank", sample.receipt, sample.gateSig), { outcome: "unknown" }, name);
    });
  }
  // Nothing listening.
  process.env.AWP_BANK_URL = "http://127.0.0.1:1";
  assert.deepEqual(await forwardReceipt("bank", sample.receipt, sample.gateSig), { outcome: "unknown" });
  delete process.env.AWP_BANK_URL;
});

test("forwardReceipt: a silent institution is unknown after the timeout", async () => {
  await withStub(() => ({ status: 200, hang: true }), async (url) => {
    process.env.AWP_BANK_URL = url;
    const started = Date.now();
    assert.deepEqual(await forwardReceipt("bank", sample.receipt, sample.gateSig), { outcome: "unknown" });
    const took = Date.now() - started;
    assert.ok(took >= config.executeTimeoutMs - 200 && took < config.executeTimeoutMs + 2000, `took ${took} ms`);
  });
});
