// REQ-013: with AWP_ALLOW_TEST_AUTHENTICATOR off, a software-test credential cannot approve anything.
// config is read once at import, so the flag is set before the modules load (node:test runs each file in its own process).
import assert from "node:assert/strict";
import { test } from "node:test";
import { termsHash } from "../src/shared/canonical.ts";
import { newId, newNonce } from "../src/shared/ids.ts";
import type { Terms } from "../src/shared/types.ts";

process.env.AWP_ALLOW_TEST_AUTHENTICATOR = "0";
const { config } = await import("../src/shared/config.ts");
const { issueOptions, verifyAndActivate } = await import("../src/gate/approval.ts");
const { challenges, closeDb, credentials, warrants } = await import("../src/gate/db.ts");
const { createSoftAuthenticator } = await import("./softAuthenticator.ts");

const skip = !config.mongoUri.gate && "MONGODB_URI_GATE is not set; approval tests need a database";
const status = (code: number) => (error: unknown): boolean => (error as { statusCode?: number }).statusCode === code;

test("flag off: a software-test credential cannot approve", { skip }, async (t) => {
  assert.equal(config.allowTestAuthenticator, false);
  const warrantId = newId("wrt");
  const userId = newId("usr");
  const auth = createSoftAuthenticator();
  const terms: Terms = {
    v: 1,
    warrantId,
    userId,
    agentId: "agt_approval_test",
    parentWarrantId: null,
    scope: { actions: ["kyc.refresh"], accounts: ["A1"], merchants: [], destinations: ["bank"], fields: { "kyc.refresh": ["account", "fields"], "payment.create": [], "data.export": [] } },
    currency: "CAD",
    perActionMaxCents: 0,
    totalLimitCents: 0,
    notBefore: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    nonce: newNonce(),
  };
  const hash = termsHash(terms);
  // One hook, in order: remove test documents, then close the client so the process can exit.
  t.after(async () => {
    await challenges().deleteMany({ warrantId });
    await warrants().deleteOne({ _id: warrantId });
    await credentials().deleteOne({ _id: auth.credentialId });
    await closeDb();
  });
  await credentials().insertOne(auth.credentialDoc(userId));
  await warrants().insertOne({
    _id: warrantId, terms, termsHash: hash, approval: null,
    state: { status: "pending", remainingCents: 0, actionCount: 0 },
    ancestors: [], expiresAt: new Date(terms.expiresAt), createdAt: new Date(),
  });

  // The user's only credential is software-test, so no options are issued.
  await assert.rejects(issueOptions(warrantId, hash), status(409));
  assert.equal(await challenges().countDocuments({ warrantId }), 0);

  // Even with a live challenge (placed here by hand), a valid assertion from it is refused.
  await challenges().insertOne({ _id: hash, warrantId, expiresAt: new Date(Date.now() + 60_000) });
  await assert.rejects(verifyAndActivate(warrantId, auth.getAssertion({ challenge: hash })), status(403));
  const stored = await warrants().findOne({ _id: warrantId });
  assert.equal(stored?.state.status, "pending");
  assert.equal(stored?.approval, null);
});
