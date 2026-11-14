// Software test authenticator: a P-256 key producing WebAuthn-shaped assertions (REQ-013). Owner: Max, task 6.
// Its credentials are kind "software-test"; the gate accepts them only when AWP_ALLOW_TEST_AUTHENTICATOR=1.
// Also imported by scripts/seed.ts and scripts/eval.ts.
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { Binary } from "mongodb";
import { b64url, fromB64url, sha256 } from "../src/shared/canonical.ts";
import { config } from "../src/shared/config.ts";
import type { CredentialDoc } from "../src/shared/types.ts";

/** Deliberately wrong assertions for tests. Defaults: the authenticator's origin, user verified. */
export type AssertionOverrides = { origin?: string; userVerified?: boolean };

export type SoftAuthenticator = {
  credentialId: string;                              // base64url
  publicKey: Uint8Array;                             // COSE EC2 P-256 key, as simplewebauthn expects in credential.publicKey
  credentialDoc(userId: string): CredentialDoc;      // kind "software-test", counter 0; insert into `credentials`
  getAssertion(options: Pick<PublicKeyCredentialRequestOptionsJSON, "challenge">, overrides?: AssertionOverrides): AuthenticationResponseJSON;
};

/** A fresh key pair and credential ID. rpId and origin default to config.rpId and config.origin. */
export function createSoftAuthenticator(opts: { rpId?: string; origin?: string } = {}): SoftAuthenticator {
  const rpId = opts.rpId ?? config.rpId;
  const origin = opts.origin ?? config.origin;
  const { publicKey: publicKeyObject, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKeyObject.export({ format: "jwk" });
  // COSE_Key: kty EC2 (2), alg ES256 (-7), crv P-256 (1), x, y.
  const publicKey = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, fromB64url(jwk.x!)], [-3, fromB64url(jwk.y!)]]));
  const credentialId = b64url(randomBytes(32));

  return {
    credentialId,
    publicKey,
    credentialDoc: (userId) => ({ _id: credentialId, userId, publicKey: new Binary(publicKey), counter: 0, kind: "software-test", rpId }),
    getAssertion(options, overrides = {}) {
      // rpIdHash (32) | flags (1): user present 0x01, user verified 0x04 | signature counter (4).
      // The counter stays 0, as platform passkeys report, so one stored assertion re-verifies anywhere.
      const flags = 0x01 | (overrides.userVerified === false ? 0 : 0x04);
      const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([flags, 0, 0, 0, 0])]);
      const clientDataJSON = Buffer.from(
        JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: overrides.origin ?? origin, crossOrigin: false }),
      );
      // ECDSA P-256 with SHA-256, DER-encoded, over authenticatorData || SHA-256(clientDataJSON).
      const signature = sign("sha256", Buffer.concat([authenticatorData, sha256(clientDataJSON)]), privateKey);
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authenticatorData), signature: b64url(signature) },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
  };
}
