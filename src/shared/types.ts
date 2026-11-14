// Contract types from PRD 8.4 and 8.5. Frozen after task 2.
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { Binary } from "mongodb";

// ---- 8.5 actions ----

export type ActionType = "kyc.refresh" | "payment.create" | "data.export";
export type Action = { type: ActionType; destination: string; params: Record<string, unknown> };
// kyc.refresh    -> destination "bank";    params { account, fields: string[] }
// payment.create -> destination "fintech"; params { fromAccount, merchant, amountCents, currency, memo? }
// data.export    -> exists so exfiltration attempts have a name; no demo warrant allows it

export type ReasonCode =
  | "MALFORMED_REQUEST"
  | "AGENT_UNAUTHENTICATED"
  | "AGENT_MISMATCH"
  | "WARRANT_NOT_FOUND"
  | "TERMS_TAMPERED"
  | "WARRANT_NOT_ACTIVE"
  | "WARRANT_REVOKED"
  | "WARRANT_NOT_YET_VALID"
  | "WARRANT_EXPIRED"
  | "ACTION_NOT_ALLOWED"
  | "DESTINATION_NOT_ALLOWED"
  | "ACCOUNT_NOT_ALLOWED"
  | "MERCHANT_NOT_ALLOWED"
  | "FIELD_NOT_ALLOWED"
  | "FIELD_CONSTRAINT"
  | "CURRENCY_MISMATCH"
  | "AMOUNT_INVALID"
  | "PER_ACTION_LIMIT"
  | "BUDGET_EXHAUSTED"
  | "LEDGER_UNAVAILABLE";

export type ActRequest = { warrantId: string; runId: string; idempotencyKey: string; action: Action };
export type ActAllow = { decision: "allow"; decisionId: string; seq: number; outcome: "executed" | "rejected" | "unknown"; result?: unknown; remainingCents: number };
export type ActDeny = { decision: "deny"; decisionId: string; seq: number; reasonCode: ReasonCode };

// ---- 8.4 warrant document ----

export type Terms = {
  v: 1;
  warrantId: string;            // "wrt_…", same as _id
  userId: string;
  agentId: string;
  parentWarrantId: string | null;
  scope: {
    actions: ActionType[];                       // "kyc.refresh" | "payment.create" | "data.export"
    accounts: string[];
    merchants: string[];
    destinations: string[];                      // "bank" | "fintech" (institution IDs)
    fields: Record<ActionType, string[]>;        // allowed parameter names per action type
  };
  currency: "CAD";
  perActionMaxCents: number;
  totalLimitCents: number;
  notBefore: string;            // ISO 8601 UTC
  expiresAt: string;            // ISO 8601 UTC
  nonce: string;                // base64url, 16 random bytes
};

export type WarrantDoc = {
  _id: string;
  terms: Terms;                 // never updated after insert
  termsHash: string;            // base64url(SHA-256(JCS(terms))), 43 chars
  approval: null
    | { kind: "passkey"; credentialId: string; response: AuthenticationResponseJSON; origin: string; rpId: string; approvedAt: string }
    | { kind: "delegation"; parentWarrantId: string; issuedByAgentId: string; issuedAt: string };
  state: { status: "pending" | "active" | "revoked" | "rejected"; remainingCents: number; actionCount: number; revokedAt?: string; revokedBy?: string };
  ancestors: string[];          // root first; empty for a root warrant
  expiresAt: Date;              // copy of terms.expiresAt for range queries
  createdAt: Date;
};

// ---- 8.4 ledger event ----

export type AuditEvent = {
  _id: number;                  // seq
  seq: number;
  ts: string;                   // ISO 8601 UTC
  type: "WARRANT_CREATED" | "WARRANT_APPROVED" | "DECISION" | "EXECUTION" | "REVOKED" | "CHILD_ISSUED";
  warrantId: string | null;
  termsHash: string | null;
  agentId: string | null;
  runId: string | null;
  decisionId?: string;          // "dec_…" on DECISION and EXECUTION
  idempotencyKey?: string;      // DECISION only
  decision?: "allow" | "deny";
  reasonCode?: ReasonCode;
  action?: { type: ActionType; destination: string; account?: string; merchant?: string; amountCents?: number; fieldNames: string[]; fieldSizes: Record<string, number> };
  actionHash?: string;          // base64url(SHA-256(JCS(full action)))
  outcome?: "executed" | "rejected" | "unknown";   // EXECUTION only
  institutionRef?: string;
  summary: string;              // one fixed-template English sentence; also the search field
  policyVersion: string;        // "awp-policy-1"
  prevHash: string;
  hash: string;
  gateSig: string;              // Ed25519 over hash
};
// The hashed body is every field except _id, hash, and gateSig. Never store undefined; omit absent keys.

// ---- 8.5 receipt ----

export type Receipt = {
  v: 1; decisionId: string; aud: "bank" | "fintech"; iat: string; exp: string;   // exp = iat + 60 s
  chain: { terms: Terms; approval: WarrantDoc["approval"] }[];                    // root first; one element for a root warrant
  action: Action; actionHash: string;
  ledger: { seq: number; hash: string };
};
// gateSig = base64url(Ed25519(JCS(receipt)))

// ---- 8.4 collection table (key fields only in the PRD; shapes fixed here) ----

export type UserDoc = { _id: string; name: string };                                   // "usr_…"
export type CredentialDoc = { _id: string; userId: string; publicKey: Binary; counter: number; kind: "platform" | "software-test"; rpId: string };   // _id is the credential ID
export type AgentDoc = { _id: string; name: string; keyHash: string; status: "active" | "disabled" };   // "agt_…"; keyHash = base64url(SHA-256(api key))
export type ChallengeDoc = { _id: string; warrantId: string; expiresAt: Date };       // _id is the termsHash
export type LedgerHeadDoc = { _id: "ledger_head"; seq: number; hash: string };
export type PolicyDoc = { _id: "policy"; version: string };
export type MetaDoc = LedgerHeadDoc | PolicyDoc;
