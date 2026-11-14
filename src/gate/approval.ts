// Passkey approval bound to the terms hash (REQ-003). Owner: Max, task 6. Called by routes/warrants.ts.
// Signatures are fixed by PRD Section 11. Errors carry a statusCode; Fastify answers with it.
import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { termsDigest, termsHash } from "../shared/canonical.ts";
import { config } from "../shared/config.ts";
import type { WarrantDoc } from "../shared/types.ts";
import { challenges, credentials, mongo, warrants } from "./db.ts";
import { appendEvent, withLedgerLock } from "./ledger.ts";

const fail = (statusCode: number, message: string): Error => Object.assign(new Error(message), { statusCode });

/** The warrant, if it is pending, unexpired, and its stored terms still hash to the stored termsHash. Throws 404 or 409. */
async function loadPending(warrantId: string): Promise<WarrantDoc> {
  const warrant = typeof warrantId === "string" ? await warrants().findOne({ _id: warrantId }) : null;
  if (!warrant) throw fail(404, "warrant not found");
  if (warrant.state.status !== "pending") throw fail(409, `warrant is ${warrant.state.status}, not pending`);
  if (termsHash(warrant.terms) !== warrant.termsHash) throw fail(409, "stored terms do not match the stored terms hash");
  // Written so an unparsable expiry fails closed.
  if (!(Date.now() < Date.parse(warrant.terms.expiresAt))) throw fail(409, "warrant has expired");
  return warrant;
}

/** Throws an error with statusCode 409 if the stored terms hash differs from displayedTermsHash. */
export async function issueOptions(warrantId: string, displayedTermsHash: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { terms, termsHash: hash } = await loadPending(warrantId);
  if (displayedTermsHash !== hash) throw fail(409, "displayed terms hash differs from the stored terms hash");

  const kinds: ("platform" | "software-test")[] = config.allowTestAuthenticator ? ["platform", "software-test"] : ["platform"];
  const allowed = await credentials().find({ userId: terms.userId, rpId: config.rpId, kind: { $in: kinds } }).toArray();
  if (allowed.length === 0) throw fail(409, "the user has no passkey that can approve this warrant");

  // The challenge is the raw terms digest, so options.challenge (base64url) equals termsHash.
  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    challenge: new Uint8Array(termsDigest(terms)),
    allowCredentials: allowed.map((credential) => ({ id: credential._id })),
    userVerification: "required",
  });
  await challenges().replaceOne(
    { _id: hash },
    { warrantId, expiresAt: new Date(Date.now() + config.challengeTtlMs) },
    { upsert: true },
  );
  return options;
}

export async function verifyAndActivate(warrantId: string, response: AuthenticationResponseJSON): Promise<{ status: "active" }> {
  const { terms, termsHash: hash } = await loadPending(warrantId);

  // Single use: consumed before verification, so a challenge is spent even when the assertion is bad.
  const challenge = await challenges().findOneAndDelete({ _id: hash, warrantId, expiresAt: { $gt: new Date() } });
  if (!challenge) throw fail(409, "challenge expired, already used, or never issued");

  const credential = typeof response?.id === "string" ? await credentials().findOne({ _id: response.id }) : null;
  if (!credential || credential.userId !== terms.userId) throw fail(403, "credential does not belong to the warrant's user");
  const softwareTest = credential.kind === "software-test";
  if (softwareTest && !config.allowTestAuthenticator) throw fail(403, "the software test authenticator is disabled");

  let newCounter: number;
  let verifiedOrigin: string;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: hash,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserVerification: true,
      credential: { id: credential._id, publicKey: new Uint8Array(credential.publicKey.value()), counter: credential.counter },
    });
    if (result.verified !== true) throw new Error("signature did not verify");
    newCounter = result.authenticationInfo.newCounter;
    verifiedOrigin = result.authenticationInfo.origin;
  } catch (error) {
    throw fail(403, `passkey assertion rejected: ${(error as Error).message}`);
  }

  const approval: WarrantDoc["approval"] = {
    kind: "passkey",
    credentialId: credential._id,
    response: JSON.parse(JSON.stringify(response)),   // plain JSON: drops undefined values
    origin: verifiedOrigin,
    rpId: config.rpId,
    approvedAt: new Date().toISOString(),
  };
  const session = mongo().startSession();
  try {
    await withLedgerLock(() => session.withTransaction(async () => {
      const updated = await warrants().updateOne(
        { _id: warrantId, "state.status": "pending", termsHash: hash },
        { $set: { "state.status": "active", approval } },
        { session },
      );
      if (updated.modifiedCount !== 1) throw fail(409, "warrant is no longer pending");
      await appendEvent(session, {
        type: "WARRANT_APPROVED",
        warrantId,
        termsHash: hash,
        agentId: terms.agentId,
        runId: null,
        summary: `Warrant ${warrantId} approved by user ${terms.userId} with a ${softwareTest ? "software test authenticator" : "passkey"}.`,
      });
   }));
  } finally {
    await session.endSession();
  }

  // $max: two approvals racing on one credential never move the counter backwards.
  await credentials().updateOne({ _id: credential._id }, { $max: { counter: newCounter } });
  return { status: "active" };
}
