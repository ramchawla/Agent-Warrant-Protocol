import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { b64url, chainHash, ed25519Sign, ed25519Verify, fromB64url, GENESIS_HASH, hashJcs, jcs, termsDigest, termsHash } from "../src/shared/canonical.ts";
import { newId, newNonce } from "../src/shared/ids.ts";
import type { Terms } from "../src/shared/types.ts";

const terms: Terms = {
  v: 1,
  warrantId: "wrt_test0000000000000000001",
  userId: "usr_test",
  agentId: "agt_test",
  parentWarrantId: null,
  scope: {
    actions: ["kyc.refresh", "payment.create"],
    accounts: ["A1", "A2"],
    merchants: ["M1"],
    destinations: ["bank", "fintech"],
    fields: {
      "kyc.refresh": ["account", "fields"],
      "payment.create": ["fromAccount", "merchant", "amountCents", "currency", "memo"],
      "data.export": [],
    },
  },
  currency: "CAD",
  perActionMaxCents: 5000,
  totalLimitCents: 12000,
  notBefore: "2026-11-14T19:00:00.000Z",
  expiresAt: "2026-11-14T22:00:00.000Z",
  nonce: "AAECAwQFBgcICQoLDA0ODw",
};
// Expected values were computed independently (Python hashlib over sorted-key compact JSON).
const TERMS_HASH = "H8grrMW9FVaza0ruo1q0gI1DxOA4XEfPQo8PGqDT2wM";

test("RFC 8785 section 3.2.3 example canonicalizes to the published form", () => {
  const input = JSON.parse(
    '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
  );
  assert.equal(jcs(input), '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}');
});

test("hash vectors", () => {
  assert.equal(termsHash(terms), TERMS_HASH);
  assert.equal(termsHash(terms).length, 43);
  assert.equal(GENESIS_HASH, "upMf0kLVD1gca1grgCjclOX4BGMIzpvFgqaiIcxTu6M");
  assert.equal(hashJcs({}), "RBNvo1WzZ4oRRq0W9-hknpT7T8If536DEMBg9hyq_4o");
  assert.equal(chainHash(GENESIS_HASH, { b: [true, null], a: 1 }), "5KsKKtiz0Za79IfnymTZgAcKsXv6Pup-u2HBYcx7wFM");
});

test("termsDigest is the 32 raw bytes behind termsHash", () => {
  assert.equal(termsDigest(terms).length, 32);
  assert.equal(b64url(termsDigest(terms)), TERMS_HASH);
  assert.deepEqual(fromB64url(TERMS_HASH), termsDigest(terms));
});

test("key order does not change the hash", () => {
  const reversed = (value: unknown): unknown =>
    Array.isArray(value) || value === null || typeof value !== "object"
      ? value
      : Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)]));
  assert.notEqual(JSON.stringify(reversed(terms)), JSON.stringify(terms));
  assert.equal(termsHash(reversed(terms) as Terms), TERMS_HASH);
});

test("number form does not change the hash", () => {
  const forms = ['{"perActionMaxCents":5000}', '{"perActionMaxCents":5000.0}', '{"perActionMaxCents":5e3}', '{"perActionMaxCents":0.5E4}', '{ "perActionMaxCents" : 5000 }'];
  const hashes = new Set(forms.map((text) => hashJcs(JSON.parse(text))));
  assert.equal(hashes.size, 1);
  assert.equal(jcs(JSON.parse(forms[2]!)), '{"perActionMaxCents":5000}');
});

test("changing any field changes the hash", () => {
  assert.notEqual(termsHash({ ...terms, totalLimitCents: 12001 }), TERMS_HASH);
  assert.notEqual(termsHash({ ...terms, nonce: "AAECAwQFBgcICQoLDA0ODg" }), TERMS_HASH);
  assert.notEqual(termsHash({ ...terms, scope: { ...terms.scope, accounts: ["A1", "A2", "A9"] } }), TERMS_HASH);
});

test("values with no JSON form are refused", () => {
  assert.throws(() => jcs(undefined));
});

test("Ed25519 sign and verify with base64url DER keys", () => {
  const pair = generateKeyPairSync("ed25519");
  const privateKey = b64url(pair.privateKey.export({ format: "der", type: "pkcs8" }));
  const publicKey = b64url(pair.publicKey.export({ format: "der", type: "spki" }));
  const sig = ed25519Sign(privateKey, TERMS_HASH);
  assert.equal(ed25519Verify(publicKey, TERMS_HASH, sig), true);
  assert.equal(ed25519Verify(publicKey, GENESIS_HASH, sig), false);
  assert.equal(ed25519Verify(publicKey, TERMS_HASH, "not-a-signature"), false);
  assert.equal(ed25519Verify("not-a-key", TERMS_HASH, sig), false);
});

test("ids and nonces", () => {
  assert.match(newId("wrt"), /^wrt_[0-9a-f]{24}$/);
  assert.notEqual(newId("dec"), newId("dec"));
  assert.equal(fromB64url(newNonce()).length, 16);
});
