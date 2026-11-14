// Receipt tamper set at library level (PRD 8.9, REQ-009). In memory: no database, no environment keys.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyReceipt, type VerifyContext } from "../src/verifier/verifyReceipt.ts";
import { b64url, ed25519Sign, hashJcs, jcs, termsHash } from "../src/shared/canonical.ts";
import { newId, newNonce } from "../src/shared/ids.ts";
import type { Action, Receipt, Terms, WarrantDoc } from "../src/shared/types.ts";
import { createSoftAuthenticator } from "./softAuthenticator.ts";

const RP_ID = "localhost";
const ORIGIN = "http://localhost:3000";
const NOW = new Date("2026-01-01T12:00:00.000Z");
const gate = generateKeyPairSync("ed25519");
const gatePrivate = b64url(gate.privateKey.export({ type: "pkcs8", format: "der" }));
const gatePublic = b64url(gate.publicKey.export({ type: "spki", format: "der" }));

const userId = newId("usr");
const auth = createSoftAuthenticator({ rpId: RP_ID, origin: ORIGIN });
const stranger = createSoftAuthenticator({ rpId: RP_ID, origin: ORIGIN });

const ctx = (over: Partial<VerifyContext> = {}): VerifyContext => ({
  institution: "fintech",
  gatePublicKey: gatePublic,
  rpId: RP_ID,
  origin: ORIGIN,
  now: NOW,
  credentialsFor: async (id) => (id === userId ? [{ id: auth.credentialId, publicKey: auth.publicKey }] : []),
  ...over,
});

const FIELDS = { "kyc.refresh": ["account", "fields"], "payment.create": ["fromAccount", "merchant", "amountCents", "currency", "memo"], "data.export": [] };
function makeTerms(over: Partial<Terms> = {}, scope: Partial<Terms["scope"]> = {}): Terms {
  const warrantId = newId("wrt");
  return {
    v: 1,
    warrantId,
    userId,
    agentId: "agt_receipt_test",
    parentWarrantId: null,
    scope: { actions: ["kyc.refresh", "payment.create"], accounts: ["A1", "A2"], merchants: ["M1"], destinations: ["bank", "fintech"], fields: FIELDS, ...scope },
    currency: "CAD",
    perActionMaxCents: 5000,
    totalLimitCents: 12000,
    notBefore: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T17:00:00.000Z",
    nonce: newNonce(),
    ...over,
  };
}

type Element = Receipt["chain"][number];
const approve = (terms: Terms, over?: Parameters<typeof auth.getAssertion>[1], signer = auth): Element => ({
  terms,
  approval: {
    kind: "passkey",
    credentialId: signer.credentialId,
    response: signer.getAssertion({ challenge: termsHash(terms) }, over),
    origin: ORIGIN,
    rpId: RP_ID,
    approvedAt: NOW.toISOString(),
  } satisfies NonNullable<WarrantDoc["approval"]>,
});
const delegate = (child: Terms, parent: Terms): Element => ({
  terms: child,
  approval: { kind: "delegation", parentWarrantId: parent.warrantId, issuedByAgentId: parent.agentId, issuedAt: NOW.toISOString() },
});

const pay = (amountCents = 3000, params: Record<string, unknown> = {}): Action => ({
  type: "payment.create",
  destination: "fintech",
  params: { fromAccount: "A1", merchant: "M1", amountCents, currency: "CAD", ...params },
});

/** A receipt as the gate would sign it. over lets a test sign something the honest gate would not. */
function signed(chain: Element[], action: Action = pay(), over: Partial<Receipt> = {}, key = gatePrivate) {
  const iat = new Date(NOW.getTime() - 1000);
  const receipt: Receipt = {
    v: 1,
    decisionId: newId("dec"),
    aud: "fintech",
    iat: iat.toISOString(),
    exp: new Date(iat.getTime() + 60_000).toISOString(),
    chain,
    action,
    actionHash: hashJcs(action),
    ledger: { seq: 7, hash: "h".repeat(43) },
    ...over,
  };
  return { receipt, gateSig: ed25519Sign(key, jcs(receipt)) };
}

async function reasonOf(input: { receipt: Receipt; gateSig: string }, c = ctx()): Promise<string> {
  const result = await verifyReceipt(input, c);
  return result.ok ? "ok" : result.reason;
}

test("a valid receipt is accepted", async () => {
  const root = makeTerms();
  const result = await verifyReceipt(signed([approve(root)]), ctx());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.verified.terms, root);
    assert.deepEqual(result.verified.rootTerms, root);
  }
  // kyc.refresh at the bank
  const kyc: Action = { type: "kyc.refresh", destination: "bank", params: { account: "A2", fields: ["name"] } };
  assert.equal(await reasonOf(signed([approve(root)], kyc, { aud: "bank" }), ctx({ institution: "bank" })), "ok");
});

test("altered amount", async () => {
  const root = makeTerms();
  const tampered = signed([approve(root)]);
  (tampered.receipt.action.params as Record<string, unknown>).amountCents = 4999;
  assert.equal(await reasonOf(tampered), "BAD_GATE_SIGNATURE");
  // Even a signature over an amount above the cap is refused on its own terms.
  assert.equal(await reasonOf(signed([approve(root)], pay(5001))), "AMOUNT_OVER_LIMIT");
  for (const bad of [-1, 10.5, "30", null]) assert.equal(await reasonOf(signed([approve(root)], pay(bad as number))), "AMOUNT_OVER_LIMIT");
});

test("altered terms", async () => {
  const root = makeTerms();
  const tampered = signed([approve(root)]);
  tampered.receipt.chain[0]!.terms.totalLimitCents = 999_999;
  assert.equal(await reasonOf(tampered), "BAD_GATE_SIGNATURE");
  // A gate that signed edited terms still cannot carry the customer's assertion over them.
  const edited = { ...root, perActionMaxCents: 999_999 };
  assert.equal(await reasonOf(signed([{ terms: edited, approval: approve(root).approval }], pay(90_000))), "TERMS_HASH_MISMATCH");
});

test("wrong audience", async () => {
  const root = makeTerms();
  assert.equal(await reasonOf(signed([approve(root)], pay(), { aud: "bank" })), "WRONG_AUDIENCE");
});

test("expired and not-yet-valid receipts", async () => {
  const root = makeTerms();
  const iat = (ms: number) => ({ iat: new Date(NOW.getTime() + ms).toISOString(), exp: new Date(NOW.getTime() + ms + 60_000).toISOString() });
  assert.equal(await reasonOf(signed([approve(root)], pay(), iat(-120_000))), "EXPIRED");
  assert.equal(await reasonOf(signed([approve(root)], pay(), iat(60_000))), "NOT_YET_VALID");
  // Inside the 5 second skew on both sides.
  assert.equal(await reasonOf(signed([approve(root)], pay(), iat(-63_000))), "ok");
  assert.equal(await reasonOf(signed([approve(root)], pay(), iat(3000))), "ok");
});

test("invalid gate signature", async () => {
  const root = makeTerms();
  const other = generateKeyPairSync("ed25519");
  const otherKey = b64url(other.privateKey.export({ type: "pkcs8", format: "der" }));
  assert.equal(await reasonOf(signed([approve(root)], pay(), {}, otherKey)), "BAD_GATE_SIGNATURE");
  assert.equal(await reasonOf({ ...signed([approve(root)]), gateSig: "AAAA" }), "BAD_GATE_SIGNATURE");
});

test("unknown credential", async () => {
  const root = makeTerms();
  // The institution never enrolled this key for the user.
  assert.equal(await reasonOf(signed([approve(root, undefined, stranger)])), "UNKNOWN_CREDENTIAL");
  assert.equal(await reasonOf(signed([approve(root)]), ctx({ credentialsFor: async () => [] })), "UNKNOWN_CREDENTIAL");
  // Same credential ID enrolled with a different key: the signature does not verify.
  const swapped = ctx({ credentialsFor: async () => [{ id: auth.credentialId, publicKey: stranger.publicKey }] });
  assert.equal(await reasonOf(signed([approve(root)]), swapped), "BAD_PASSKEY_ASSERTION");
});

test("assertion from a different warrant", async () => {
  const x = makeTerms();
  const y = makeTerms();
  assert.equal(await reasonOf(signed([{ terms: y, approval: approve(x).approval }])), "TERMS_HASH_MISMATCH");
});

test("assertion without user verification, with the wrong origin, or tampered", async () => {
  const root = makeTerms();
  assert.equal(await reasonOf(signed([approve(root, { userVerified: false })])), "BAD_PASSKEY_ASSERTION");
  assert.equal(await reasonOf(signed([approve(root, { origin: "https://evil.example" })])), "BAD_PASSKEY_ASSERTION");
  assert.equal(await reasonOf(signed([approve(root)]), ctx({ origin: "https://other.example" })), "BAD_PASSKEY_ASSERTION");
  assert.equal(await reasonOf(signed([approve(root)]), ctx({ rpId: "other.example" })), "BAD_PASSKEY_ASSERTION");
});

test("root element without a passkey approval", async () => {
  const root = makeTerms();
  assert.equal(await reasonOf(signed([{ terms: root, approval: null }])), "BAD_PASSKEY_ASSERTION");
  const parent = makeTerms();
  assert.equal(await reasonOf(signed([delegate(root, parent)])), "BAD_PASSKEY_ASSERTION");
});

test("gate-allowed action outside the warrant", async () => {
  const root = makeTerms();
  const cases: [string, Action][] = [
    ["unlisted merchant", pay(3000, { merchant: "M2" })],
    ["unlisted account", pay(3000, { fromAccount: "A9" })],
    ["wrong currency", pay(3000, { currency: "USD" })],
    ["extra field", pay(3000, { clientList: "x" })],
    ["unlisted action type", { type: "data.export", destination: "fintech", params: {} }],
    ["unlisted destination", { ...pay(), destination: "https://collector.example/c" }],
    ["destination is not this institution", { type: "payment.create", destination: "bank", params: pay().params }],
  ];
  for (const [name, action] of cases) assert.equal(await reasonOf(signed([approve(root)], action)), "ACTION_OUT_OF_SCOPE", name);
  assert.equal(await reasonOf(signed([approve(root)], pay(), { actionHash: hashJcs(pay(10)) })), "ACTION_HASH_MISMATCH");
});

test("warrant expired at verification time", async () => {
  const root = makeTerms({ expiresAt: "2026-01-01T11:00:00.000Z" });
  assert.equal(await reasonOf(signed([approve(root)])), "WARRANT_EXPIRED");
  const garbage = makeTerms({ expiresAt: "not a date" });
  assert.equal(await reasonOf(signed([approve(garbage)])), "WARRANT_EXPIRED");
});

test("delegation chain", async () => {
  const root = makeTerms();
  const narrower = (over: Partial<Terms> = {}, scope: Partial<Terms["scope"]> = {}) =>
    makeTerms({ parentWarrantId: root.warrantId, perActionMaxCents: 2000, totalLimitCents: 4000, expiresAt: "2026-01-01T16:00:00.000Z", ...over }, { accounts: ["A1"], actions: ["payment.create"], ...scope });

  const child = narrower();
  const ok = await verifyReceipt(signed([approve(root), delegate(child, root)], pay(1500)), ctx());
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.verified.terms.warrantId, child.warrantId);
    assert.equal(ok.verified.rootTerms.warrantId, root.warrantId);
  }

  const broken: [string, Terms][] = [
    ["broader accounts", narrower({}, { accounts: ["A1", "A3"] })],
    ["broader merchants", narrower({}, { merchants: ["M1", "M2"] })],
    ["broader actions", narrower({}, { actions: ["payment.create", "data.export"] })],
    ["broader fields", narrower({}, { fields: { ...FIELDS, "payment.create": [...FIELDS["payment.create"], "clientList"] } })],
    ["higher per-action limit", narrower({ perActionMaxCents: 5001 })],
    ["higher total limit", narrower({ totalLimitCents: 12001 })],
    ["later expiry", narrower({ expiresAt: "2026-01-01T18:00:00.000Z" })],
    ["different user", narrower({ userId: newId("usr") })],
    ["different parent", narrower({ parentWarrantId: newId("wrt") })],
  ];
  for (const [name, bad] of broken) {
    assert.equal(await reasonOf(signed([approve(root), delegate(bad, root)], pay(1500))), "CHAIN_NOT_SUBSET", name);
  }
  // The action is judged against the LAST warrant: inside the root's scope but outside the child's.
  assert.equal(await reasonOf(signed([approve(root), delegate(child, root)], pay(3000))), "AMOUNT_OVER_LIMIT");
  assert.equal(await reasonOf(signed([approve(root), delegate(child, root)], pay(1500, { fromAccount: "A2" }))), "ACTION_OUT_OF_SCOPE");
  // A non-root element must be a delegation, not a passkey approval.
  assert.equal(await reasonOf(signed([approve(root), approve(child)], pay(1500))), "MALFORMED");
  // A delegation that names a different parent.
  const wrongParent: Element = { terms: child, approval: { kind: "delegation", parentWarrantId: newId("wrt"), issuedByAgentId: "agt_x", issuedAt: NOW.toISOString() } };
  assert.equal(await reasonOf(signed([approve(root), wrongParent], pay(1500))), "CHAIN_NOT_SUBSET");
  // The root is still verified when a child follows.
  assert.equal(await reasonOf(signed([approve(root, { userVerified: false }), delegate(child, root)], pay(1500))), "BAD_PASSKEY_ASSERTION");
});

test("malformed input is rejected, never thrown", async () => {
  const root = makeTerms();
  const good = signed([approve(root)]);
  const junk: unknown[] = [undefined, null, {}, { receipt: null, gateSig: "x" }, { receipt: good.receipt }, { receipt: [], gateSig: "x" }, { receipt: { ...good.receipt, v: 2 }, gateSig: good.gateSig }];
  for (const input of junk) assert.equal(await reasonOf(input as never), "MALFORMED");
  // Signed but structurally broken receipts.
  for (const over of [{ chain: [] }, { chain: [null] }, { chain: [{ terms: { v: 1 }, approval: null }] }, { action: null }, { iat: "never" }] as Partial<Receipt>[]) {
    assert.equal(await reasonOf(signed([approve(root)], pay(), over)), "MALFORMED", JSON.stringify(over).slice(0, 40));
  }
  // A throwing credential lookup is a rejection too.
  const boom = ctx({ credentialsFor: async () => { throw new Error("db down"); } });
  assert.equal(await reasonOf(good, boom), "MALFORMED");
});

test("the verifier imports only the allowed modules", () => {
  const source = readFileSync(new URL("../src/verifier/verifyReceipt.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gms)].map((m) => ({ typeOnly: Boolean(m[1]), from: m[2]! }));
  assert.ok(imports.length >= 3);
  for (const { typeOnly, from } of imports) {
    if (from === "../shared/types.ts") assert.ok(typeOnly, "types.ts may be imported for types only");
    else assert.ok(["../shared/canonical.ts", "@simplewebauthn/server", "node:crypto"].includes(from), `unexpected import ${from}`);
  }
  assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/);
  assert.doesNotMatch(source, /from\s+"[^"]*(gate\/|mongodb|config\.ts)/);
});
