// Passkey approval bound to the terms hash (REQ-003). Owner: Max, task 6. Called by routes/warrants.ts.
// Stub: both functions throw. Signatures are fixed by PRD Section 11.
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";

/** Throws an error with statusCode 409 if the stored terms hash differs from displayedTermsHash. */
export async function issueOptions(warrantId: string, displayedTermsHash: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
  throw new Error("not implemented");
}

export async function verifyAndActivate(warrantId: string, response: AuthenticationResponseJSON): Promise<{ status: "active" }> {
  throw new Error("not implemented");
}
