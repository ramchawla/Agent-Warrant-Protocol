// Shared institution verifier (PRD 8.7 steps 1, 2, 4, 5, 6). Owner: Max, task 6.
// May import only src/shared/canonical.ts, @simplewebauthn/server and node:crypto (types are erased).
// Replay (step 3), the institution's own policy and execution (steps 7 and 8) belong to the institution.
// Never throws: any unexpected input or exception is a rejection.
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { ed25519Verify, hashJcs, jcs, termsHash } from "../shared/canonical.ts";
import type { Action, Receipt, Terms } from "../shared/types.ts";

export type VerifierCredential = { id: string; publicKey: Uint8Array };   // COSE key bytes

export type VerifyContext = {
  institution: "bank" | "fintech";
  gatePublicKey: string;            // base64url SPKI DER
  rpId: string;
  origin: string;
  now: Date;
  // the institution's OWN enrolled credentials for this user (never the gate's)
  credentialsFor(userId: string): Promise<VerifierCredential[]>;
};

export type VerifiedReceipt = { receipt: Receipt; terms: Terms /* last chain element */; rootTerms: Terms };
export type VerifyResult = { ok: true; verified: VerifiedReceipt } | { ok: false; reason: string };

// Mirrors config.receiptSkewMs; this file cannot import config.
const SKEW_MS = 5_000;

class Reject extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}
function reject(reason: string): never {
  throw new Reject(reason);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const subset = (a: string[], b: string[]): boolean => a.every((x) => b.includes(x));

function strings(v: unknown): string[] {
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) reject("MALFORMED");
  return v as string[];
}

/** Runtime shape check for terms taken from the receipt; everything below relies on it. */
function checkTerms(value: unknown): Terms {
  if (!isObj(value) || !isObj(value.scope) || !isObj(value.scope.fields)) return reject("MALFORMED");
  for (const k of ["warrantId", "userId", "agentId", "currency", "notBefore", "expiresAt", "nonce"]) {
    if (typeof value[k] !== "string") reject("MALFORMED");
  }
  if (value.parentWarrantId !== null && typeof value.parentWarrantId !== "string") reject("MALFORMED");
  for (const k of ["perActionMaxCents", "totalLimitCents"]) {
    if (!Number.isSafeInteger(value[k])) reject("MALFORMED");
  }
  for (const k of ["actions", "accounts", "merchants", "destinations"]) strings(value.scope[k]);
  for (const list of Object.values(value.scope.fields)) strings(list);
  return value as unknown as Terms;
}

function checkAction(value: unknown): Action {
  if (!isObj(value) || typeof value.type !== "string" || typeof value.destination !== "string" || !isObj(value.params)) return reject("MALFORMED");
  return value as unknown as Action;
}

/** Step 4: the root element holds the customer's passkey assertion over the hash of its terms. */
async function checkRoot(element: Receipt["chain"][number], terms: Terms, ctx: VerifyContext): Promise<void> {
  if (terms.parentWarrantId !== null) reject("MALFORMED");
  const approval = element.approval;
  if (!isObj(approval) || approval.kind !== "passkey" || typeof approval.credentialId !== "string" || !isObj(approval.response)) {
    return reject("BAD_PASSKEY_ASSERTION");
  }
  const response = approval.response as unknown as AuthenticationResponseJSON;
  if (response.id !== approval.credentialId || !isObj(response.response)) reject("BAD_PASSKEY_ASSERTION");

  // Name the common failure: the assertion was made over other terms.
  const hash = termsHash(terms);
  let challenge: unknown;
  try {
    challenge = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8")).challenge;
  } catch {
    return reject("BAD_PASSKEY_ASSERTION");
  }
  if (challenge !== hash) reject("TERMS_HASH_MISMATCH");

  const credential = (await ctx.credentialsFor(terms.userId)).find((c) => c.id === approval.credentialId);
  if (!credential) return reject("UNKNOWN_CREDENTIAL");
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: hash,
      expectedOrigin: ctx.origin,
      expectedRPID: ctx.rpId,
      requireUserVerification: true,
      // counter 0: re-verifying a stored assertion against an advanced counter would throw.
      credential: { id: credential.id, publicKey: new Uint8Array(credential.publicKey), counter: 0 },
    });
    if (result.verified !== true) reject("BAD_PASSKEY_ASSERTION");
  } catch (error) {
    if (error instanceof Reject) throw error;
    reject("BAD_PASSKEY_ASSERTION");
  }
}

/** Step 5: a child warrant can only narrow its parent. No signature is checked on a delegation. */
function checkDelegation(element: Receipt["chain"][number], parent: Terms, child: Terms): void {
  const approval = element.approval;
  if (!isObj(approval) || approval.kind !== "delegation") return reject("MALFORMED");
  if (approval.parentWarrantId !== parent.warrantId || child.parentWarrantId !== parent.warrantId || child.userId !== parent.userId) {
    reject("CHAIN_NOT_SUBSET");
  }
  const p = parent.scope;
  const c = child.scope;
  const fieldsNarrower = Object.entries(c.fields).every(([type, names]) => subset(names, (p.fields as Record<string, string[]>)[type] ?? []));
  const narrower =
    subset(c.actions, p.actions) && subset(c.accounts, p.accounts) && subset(c.merchants, p.merchants) &&
    subset(c.destinations, p.destinations) && fieldsNarrower &&
    child.currency === parent.currency &&
    child.perActionMaxCents <= parent.perActionMaxCents && child.totalLimitCents <= parent.totalLimitCents &&
    Date.parse(child.expiresAt) <= Date.parse(parent.expiresAt) &&
    Date.parse(child.notBefore) >= Date.parse(parent.notBefore);   // an unparsable date compares false and fails closed
  if (!narrower) reject("CHAIN_NOT_SUBSET");
}

/** Step 6: the action sits inside the last warrant. Mirrors the scope rules of evaluate(). */
function checkLast(terms: Terms, action: Action, actionHash: unknown, institution: string, now: number): void {
  if (!(now < Date.parse(terms.expiresAt))) reject("WARRANT_EXPIRED");   // an unparsable date fails closed
  if (!(now >= Date.parse(terms.notBefore) - SKEW_MS)) reject("WARRANT_NOT_YET_VALID");
  const { scope } = terms;
  const { params } = action;
  if (!scope.actions.includes(action.type)) reject("ACTION_OUT_OF_SCOPE");
  if (!scope.destinations.includes(action.destination) || action.destination !== institution) reject("ACTION_OUT_OF_SCOPE");
  const allowedFields = (scope.fields as Record<string, unknown>)[action.type];
  if (!Array.isArray(allowedFields) || !Object.keys(params).every((name) => allowedFields.includes(name))) reject("ACTION_OUT_OF_SCOPE");

  if (action.type === "kyc.refresh") {
    if (typeof params.account !== "string" || !scope.accounts.includes(params.account)) reject("ACTION_OUT_OF_SCOPE");
  } else if (action.type === "payment.create") {
    if (typeof params.fromAccount !== "string" || !scope.accounts.includes(params.fromAccount)) reject("ACTION_OUT_OF_SCOPE");
    if (typeof params.merchant !== "string" || !scope.merchants.includes(params.merchant)) reject("ACTION_OUT_OF_SCOPE");
    if (params.currency !== terms.currency) reject("ACTION_OUT_OF_SCOPE");
    const amount = params.amountCents;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0 || amount > terms.perActionMaxCents) reject("AMOUNT_OVER_LIMIT");
  }
  if (actionHash !== hashJcs(action)) reject("ACTION_HASH_MISMATCH");
}

async function verify(input: { receipt: Receipt; gateSig: string }, ctx: VerifyContext): Promise<VerifiedReceipt> {
  const { receipt, gateSig } = input ?? ({} as Partial<typeof input>);
  if (!isObj(receipt) || typeof gateSig !== "string" || receipt.v !== 1) return reject("MALFORMED");

  // Step 1: the gate signed JCS(receipt).
  if (!ed25519Verify(ctx.gatePublicKey, jcs(receipt), gateSig)) reject("BAD_GATE_SIGNATURE");

  // Step 2: audience and lifetime, with skew.
  if (receipt.aud !== ctx.institution) reject("WRONG_AUDIENCE");
  const iat = Date.parse(receipt.iat);
  const exp = Date.parse(receipt.exp);
  if (Number.isNaN(iat) || Number.isNaN(exp)) reject("MALFORMED");
  const now = ctx.now.getTime();
  if (now < iat - SKEW_MS) reject("NOT_YET_VALID");
  if (now > exp + SKEW_MS) reject("EXPIRED");

  if (!Array.isArray(receipt.chain) || receipt.chain.length === 0 || !isObj(receipt.ledger)) reject("MALFORMED");
  const chainTerms = receipt.chain.map((element) => (isObj(element) ? checkTerms(element.terms) : reject("MALFORMED")));
  const action = checkAction(receipt.action);

  await checkRoot(receipt.chain[0]!, chainTerms[0]!, ctx);
  for (let i = 1; i < receipt.chain.length; i++) checkDelegation(receipt.chain[i]!, chainTerms[i - 1]!, chainTerms[i]!);
  const last = chainTerms[chainTerms.length - 1]!;
  checkLast(last, action, receipt.actionHash, ctx.institution, now);
  return { receipt, terms: last, rootTerms: chainTerms[0]! };
}

export async function verifyReceipt(input: { receipt: Receipt; gateSig: string }, ctx: VerifyContext): Promise<VerifyResult> {
  try {
    return { ok: true, verified: await verify(input, ctx) };
  } catch (error) {
    return { ok: false, reason: error instanceof Reject ? error.reason : "MALFORMED" };
  }
}
