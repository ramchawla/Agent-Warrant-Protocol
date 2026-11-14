// Types from docs/STORY-API.md (frozen contract). Shared types are verbatim; route responses follow the routes table.
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

export type ReasonCode =
  | "MALFORMED_REQUEST" | "AGENT_UNAUTHENTICATED" | "AGENT_MISMATCH" | "WARRANT_NOT_FOUND" | "TERMS_TAMPERED"
  | "WARRANT_NOT_ACTIVE" | "WARRANT_REVOKED" | "PER_ACTION_LIMIT" | "MERCHANT_NOT_ALLOWED" | "DESTINATION_NOT_ALLOWED"
  // ponytail: the 20 codes in PRD 8.5 live in src/shared/types.ts; open string so new codes never break the UI
  | (string & {});

export type Trace = {
  atomicUpdate: { filter: Record<string, unknown>; update: Record<string, unknown>; matched: 0 | 1 };
  minimize?: { before: Record<string, unknown>; after: Record<string, unknown>; removed: string[]; tokensBefore: number; tokensAfter: number };
  semantic?: { pipeline: Record<string, unknown>[]; path: "vector" | "keyword-fallback"; topScore: number; rule: string; policyId: string; action: "REQUIRE_TOUCH_ID" | "DENY" | "ALLOW" };
  approvalChallenge?: string;     // base64url
  gateMs: number;                 // gate decision time for this item
};

export type InstitutionChecks = { institution: "bank" | "fintech"; gateSignature: boolean; customerPasskey: boolean; terms: boolean; institutionRef?: string; reason?: string };

export type ReceiptView = { decisionId: string; aud: "bank" | "fintech"; iat: string; exp: string; actionHash: string; ledger: { seq: number; hash: string }; gateSig: string };

export type DemoItem = {
  agentText: string;              // what the agent "says", e.g. "Buying $500 of NVDA"
  action: { type: string; destination: string; params: Record<string, unknown> };
  decision: "allow" | "deny";
  reasonCode?: ReasonCode;
  decisionId: string;
  seq: number;                    // ledger seq of the DECISION event
  outcome?: "executed" | "rejected" | "unknown";
  remainingCents: number;         // warrant budget after this item
  trace: Trace;
  receipt?: ReceiptView;          // allow only
  institutionChecks?: InstitutionChecks;   // allow only, from the institution's own verification
};

export type WarrantSummary = { warrantId: string; status: "pending" | "active" | "revoked" | "rejected"; remainingCents: number; totalLimitCents: number; perActionMaxCents: number; expiresAt: string };

export type DemoStepResponse = {
  items: DemoItem[];
  warrant: WarrantSummary;
  pending?: { approvalId: string; challenge: string; minimizedPayload: Record<string, unknown>; reason: string };   // sensitive only
  blocked?: { reason: string };                                                                                     // sensitive only: a DENY policy matched best
  counts?: { allowed: number; denied: number; remainingCents: number; elapsedMs: number };                          // burst only
};

// ---- route responses ----

export type DemoUser = { userId: string; name: string; hasPasskey: boolean };

export type ResetResponse = { ok: true; warrantId: null; user: DemoUser; savingsCents: number };

export type Terms = Record<string, unknown>;

export type WorstCase = { cents: number; sentence: string; severity: "red" | "green" };

export type CompileResponse = { terms: Terms; canonical: string; plain: string[]; worstCase: WorstCase };

export type CreateWarrantResponse = { warrantId: string; termsHash: string; terms: Terms; canonical: string; plain: string[]; worstCase: WorstCase };

export type Databases = { gate: string; bank: string; fintech: string };

/** savingsCents is not sent by the gate yet (only by reset); read it when it is. */
export type DemoStateResponse = { warrant: WarrantSummary | null; user: DemoUser; ledgerHead: { seq: number; hash: string }; databases: Databases; savingsCents?: number };

export type SessionResponse = { userId: string };

export type RegisterOptionsResponse = PublicKeyCredentialCreationOptionsJSON;
export type AuthOptionsResponse = PublicKeyCredentialRequestOptionsJSON;
/** Shape of the existing /verify routes is backend-owned; we only rely on it being JSON. */
export type VerifyResponse = Record<string, unknown>;

export type InspectResponse = {
  warrantId: string;
  terms: Terms;
  canonical: string;
  termsHash: string;
  challenge: string;
  approval: {
    credentialId: string;
    clientDataJSON: Record<string, unknown>;   // decoded object
    authenticatorData: string;                 // base64url
    signature: string;                         // base64url
    userVerified: boolean;
    approvedAt: string;
  } | null;
  status: WarrantSummary["status"];
  document: Record<string, unknown>;           // the stored warrant document
};

export type VerifyApprovalResponse = { valid: boolean; userVerified: boolean; approvedAt: string | null; termsHash: string; recomputedHash: string; reason?: string };

export type Policy = { _id: string; rule: string; action: string; createdAt: string };
export type AddPolicyResponse = { policy: Policy; embeddingWrittenByUs: false };
export type PoliciesResponse = { policies: Policy[] };
export type PolicyIndexResponse = { name: string; definition: Record<string, unknown>; status: string };

export type ApprovalVerifyResponse = { released: true; sentToLlm: Record<string, unknown>; llmReply: string; llmSource: "claude" | "canned" };

export type TamperResponse = {
  tampered: { seq: number; field: string; before: unknown; after: unknown };
  warrant?: { warrantId: string; field: string; before: unknown; after: unknown };
};

export type AuditEvent = {
  _id: number;
  seq: number;
  ts: string;
  type: "WARRANT_CREATED" | "WARRANT_APPROVED" | "DECISION" | "EXECUTION" | "REVOKED" | "CHILD_ISSUED";
  warrantId: string | null;
  termsHash: string | null;
  agentId: string | null;
  runId: string | null;
  decisionId?: string;
  idempotencyKey?: string;
  decision?: "allow" | "deny";
  reasonCode?: ReasonCode;
  action?: { type: string; destination: string; account?: string; merchant?: string; amountCents?: number; fieldNames: string[]; fieldSizes: Record<string, number> };
  actionHash?: string;
  outcome?: "executed" | "rejected" | "unknown";
  institutionRef?: string;
  summary: string;
  policyVersion: string;
  prevHash: string;
  hash: string;
  gateSig: string;
};
export type LedgerResponse = { events: AuditEvent[] };
export type LedgerVerifyResponse = { ok: boolean; checked: number; firstBrokenSeq?: number; anchors: Record<string, { ok: boolean; checked: number }> };

/** GET /bank/state, GET /fintech/state: institution-owned; plan §4 says it includes the three checks for the last receipt. */
export type InstitutionStateResponse = { lastChecks?: InstitutionChecks | null } & Record<string, unknown>;
