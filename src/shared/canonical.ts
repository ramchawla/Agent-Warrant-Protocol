// Canonical JSON (RFC 8785), hashing and signature helpers. Frozen after task 2.
// The verifier imports this file, so it must not import anything from src/gate.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import canonicalize from "canonicalize";
import type { Terms } from "./types.ts";

/** RFC 8785 canonical JSON. Throws on values with no JSON form (undefined, functions). */
export function jcs(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new Error("value has no canonical JSON form");
  return out;
}

export const sha256 = (data: string | Uint8Array): Buffer => createHash("sha256").update(data).digest();
export const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
export const fromB64url = (text: string): Buffer => Buffer.from(text, "base64url");

/** base64url(SHA-256(JCS(value))). Used for termsHash and actionHash. */
export const hashJcs = (value: unknown): string => b64url(sha256(jcs(value)));
export const termsHash = (terms: Terms): string => hashJcs(terms);

/** The raw 32-byte terms digest: the WebAuthn challenge for approval (REQ-003). */
export const termsDigest = (terms: Terms): Buffer => sha256(jcs(terms));

/** Ledger head before any event: seq 0. The first real event has seq 1 and this as prevHash. */
export const GENESIS_HASH = b64url(sha256("awp-genesis"));

/** Ledger event hash (REQ-008). body is the event without _id, hash and gateSig. */
export const chainHash = (prevHash: string, body: unknown): string => b64url(sha256(prevHash + "\n" + jcs(body)));

// Ed25519 keys travel as base64url DER (PKCS#8 private, SPKI public), as printed by `npm run keys`.
// Signatures are over the UTF-8 bytes of the message string: the event hash string, or JCS(receipt).

export function ed25519Sign(privateKeyB64url: string, message: string): string {
  const key = createPrivateKey({ key: fromB64url(privateKeyB64url), format: "der", type: "pkcs8" });
  return b64url(sign(null, Buffer.from(message, "utf8"), key));
}

/** False on a bad signature or an unparsable key or signature; never throws. */
export function ed25519Verify(publicKeyB64url: string, message: string, signature: string): boolean {
  try {
    const key = createPublicKey({ key: fromB64url(publicKeyB64url), format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), key, fromB64url(signature));
  } catch {
    return false;
  }
}
