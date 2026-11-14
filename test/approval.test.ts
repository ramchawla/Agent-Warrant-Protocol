// Passkey approval (REQ-003) with the software test authenticator (REQ-013).
// Runs against the configured gate database after `npm run setup-db`; needs AWP_ALLOW_TEST_AUTHENTICATOR=1.
import assert from "node:assert/strict";
import { test } from "node:test";
import { issueOptions, verifyAndActivate } from "../src/gate/approval.ts";
import { challenges, closeDb, credentials, warrants } from "../src/gate/db.ts";
import { termsHash } from "../src/shared/canonical.ts";
import { config } from "../src/shared/config.ts";
import { newId, newNonce } from "../src/shared/ids.ts";
import type { Terms, WarrantDoc } from "../src/shared/types.ts";
import { createSoftAuthenticator } from "./softAuthenticator.ts";

const skip =
  (!config.mongoUri.gate && "MONGODB_URI_GATE is not set; approval tests need a database") ||
  (!config.allowTestAuthenticator && "AWP_ALLOW_TEST_AUTHENTICATOR is not 1; approval tests use the software test authenticator");

function makeWarrant(userId: string, expiresInMs = 3_600_000): WarrantDoc {
  const warrantId = newId("wrt");
  const terms: Terms = {
    v: 1,
    warrantId,
    userId,
    agentId: "agt_approval_test",
    parentWarrantId: null,
    scope: {
      actions: ["kyc.refresh", "payment.create"],
      accounts: ["A1"],
      merchants: ["M1"],
      destinations: ["bank", "fintech"],
      fields: { "kyc.refresh": ["account", "fields"], "payment.create": ["fromAccount", "merchant", "amountCents", "currency", "memo"], "data.export": [] },
    },
    currency: "CAD",
    perActionMaxCents: 5000,
    totalLimitCents: 12000,
    notBefore: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    nonce: newNonce(),
  };
  return {
    _id: warrantId,
    terms,
    termsHash: termsHash(terms),
    approval: null,
    state: { status: "pending", remainingCents: terms.totalLimitCents, actionCount: 0 },
    ancestors: [],
    expiresAt: new Date(terms.expiresAt),
    createdAt: new Date(),
  };
}

const status = (code: number) => (error: unknown): boolean => (error as { statusCode?: number }).statusCode === code;

test("passkey approval", { skip }, async (t) => {
  const userId = newId("usr");
  const otherUserId = newId("usr");
  const auth = createSoftAuthenticator();
  const otherAuth = createSoftAuthenticator();
  const warrantIds: string[] = [];
  // One hook, in order: remove test documents, then close the client so the process can exit.
  t.after(async () => {
    await challenges().deleteMany({ warrantId: { $in: warrantIds } });
    await warrants().deleteMany({ _id: { $in: warrantIds } });
    await credentials().deleteMany({ _id: { $in: [auth.credentialId, otherAuth.credentialId] } });
    await closeDb();
  });
  await credentials().insertMany([auth.credentialDoc(userId), otherAuth.credentialDoc(otherUserId)]);

  async function pending(expiresInMs?: number): Promise<WarrantDoc> {
    const doc = makeWarrant(userId, expiresInMs);
    warrantIds.push(doc._id);
    await warrants().insertOne(doc);
    return doc;
  }
  const statusOf = async (id: string) => (await warrants().findOne({ _id: id }))?.state.status;

  await t.test("the software authenticator activates a pending warrant", async () => {
    const doc = await pending();
    const options = await issueOptions(doc._id, doc.termsHash);
    assert.equal(options.challenge, doc.termsHash);
    assert.equal(options.userVerification, "required");
    assert.equal(options.rpId, config.rpId);
    assert.deepEqual(options.allowCredentials?.map((c) => c.id), [auth.credentialId]);

    const assertion = auth.getAssertion(options);
    assert.deepEqual(await verifyAndActivate(doc._id, assertion), { status: "active" });

    const stored = await warrants().findOne({ _id: doc._id });
    assert.equal(stored?.state.status, "active");
    assert.equal(stored?.approval?.kind, "passkey");
    assert.deepEqual(stored?.approval, {
      kind: "passkey",
      credentialId: auth.credentialId,
      response: assertion,
      origin: config.origin,
      rpId: config.rpId,
      approvedAt: (stored?.approval as { approvedAt: string }).approvedAt,
    });
    assert.deepEqual(stored?.terms, doc.terms);
    assert.equal(stored?.termsHash, doc.termsHash);
    assert.equal(await challenges().countDocuments({ _id: doc.termsHash }), 0);

    // Already active: neither step works again.
    await assert.rejects(issueOptions(doc._id, doc.termsHash), status(409));
    await assert.rejects(verifyAndActivate(doc._id, assertion), status(409));
  });

  await t.test("issueOptions refuses an unknown warrant, a wrong displayed hash, and an expired warrant", async () => {
    await assert.rejects(issueOptions(newId("wrt"), "x".repeat(43)), status(404));
    const doc = await pending();
    await assert.rejects(issueOptions(doc._id, termsHash({ ...doc.terms, nonce: newNonce() })), status(409));
    assert.equal(await challenges().countDocuments({ warrantId: doc._id }), 0);
    const expired = await pending(-1000);
    await assert.rejects(issueOptions(expired._id, expired.termsHash), status(409));
  });

  await t.test("terms edited in the database after insert cannot be approved", async () => {
    const doc = await pending();
    const edited: Terms = { ...doc.terms, totalLimitCents: 999_999 };
    const options = await issueOptions(doc._id, doc.termsHash);   // issued before the edit
    await warrants().updateOne({ _id: doc._id }, { $set: { "terms.totalLimitCents": edited.totalLimitCents } });

    await assert.rejects(issueOptions(doc._id, doc.termsHash), status(409));
    await assert.rejects(issueOptions(doc._id, termsHash(edited)), status(409));
    await assert.rejects(verifyAndActivate(doc._id, auth.getAssertion(options)), status(409));
    assert.equal(await statusOf(doc._id), "pending");
  });

  await t.test("an assertion for warrant X cannot activate warrant Y", async () => {
    const x = await pending();
    const y = await pending();   // same user, same credential, different nonce
    assert.notEqual(x.termsHash, y.termsHash);
    const assertionX = auth.getAssertion(await issueOptions(x._id, x.termsHash));
    await issueOptions(y._id, y.termsHash);

    await assert.rejects(verifyAndActivate(y._id, assertionX), status(403));
    assert.equal(await statusOf(y._id), "pending");
    // The same assertion is good for the warrant it was made for.
    assert.deepEqual(await verifyAndActivate(x._id, assertionX), { status: "active" });
  });

  await t.test("a challenge is single use, even after a failed attempt", async () => {
    const doc = await pending();
    const options = await issueOptions(doc._id, doc.termsHash);
    await assert.rejects(verifyAndActivate(doc._id, auth.getAssertion(options, { origin: "https://evil.example" })), status(403));
    assert.equal(await challenges().countDocuments({ _id: doc.termsHash }), 0);
    await assert.rejects(verifyAndActivate(doc._id, auth.getAssertion(options)), status(409));
    assert.equal(await statusOf(doc._id), "pending");
  });

  await t.test("an expired challenge fails", async () => {
    const doc = await pending();
    const options = await issueOptions(doc._id, doc.termsHash);
    await challenges().updateOne({ _id: doc.termsHash }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await assert.rejects(verifyAndActivate(doc._id, auth.getAssertion(options)), status(409));
    assert.equal(await statusOf(doc._id), "pending");
  });

  await t.test("a warrant with no issued challenge cannot be activated", async () => {
    const doc = await pending();
    await assert.rejects(verifyAndActivate(doc._id, auth.getAssertion({ challenge: doc.termsHash })), status(409));
    assert.equal(await statusOf(doc._id), "pending");
  });

  const rejected: [string, (options: { challenge: string }) => ReturnType<typeof auth.getAssertion>][] = [
    ["an assertion without user verification", (o) => auth.getAssertion(o, { userVerified: false })],
    ["an assertion with the wrong origin", (o) => auth.getAssertion(o, { origin: "https://evil.example" })],
    ["a credential belonging to another user", (o) => otherAuth.getAssertion(o)],
    ["a tampered signature", (o) => {
      const a = auth.getAssertion(o);
      const sig = Buffer.from(a.response.signature, "base64url");
      sig[sig.length - 1] ^= 1;
      return { ...a, response: { ...a.response, signature: sig.toString("base64url") } };
    }],
  ];
  for (const [name, makeAssertion] of rejected) {
    await t.test(`${name} fails`, async () => {
      const doc = await pending();
      const options = await issueOptions(doc._id, doc.termsHash);
      await assert.rejects(verifyAndActivate(doc._id, makeAssertion(options)), status(403));
      const stored = await warrants().findOne({ _id: doc._id });
      assert.equal(stored?.state.status, "pending");
      assert.equal(stored?.approval, null);
    });
  }
});
