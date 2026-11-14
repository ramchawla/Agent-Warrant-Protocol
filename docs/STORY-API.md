# Story API contract (frozen for the story build)

Companion to `docs/STORY-UI-PLAN.md`. The backend agent (B) implements these shapes exactly; the UI agents (S0 to S3) code and mock against them. Change only through Max.

All routes are on the gate (`:3000`); the story app reaches them through the Vite proxy (`/api`). Money is integer cents. Times are ISO 8601 strings. Long values (hashes, signatures) are returned in full; the UI shortens them for display.

## Demo world (created by `POST /api/demo/reset`)

- User `usr_demo` (name "Ram"). Agent `agt_demo` (its API key lives only in the gate process).
- Savings account `SAVINGS` holding $84,000.00 (`balanceCents: 8400000`), shown in chapter 1.
- Merchant (brokerage order book) `BROKERAGE-NVDA`; the other stock is `BROKERAGE-AAPL`.
- The NVDA warrant terms: actions `payment.create` and `data.export`; accounts `["SAVINGS"]`; merchants `["BROKERAGE-NVDA"]`; destinations `["fintech", "llm"]`; fields `payment.create: fromAccount, merchant, amountCents, currency, memo` and `data.export: payload`; `perActionMaxCents 50000`; `totalLimitCents 100000`; `notBefore` now; `expiresAt` today 17:00 local (or now + 2 h if that is past).
- The fintech plays "the brokerage". Its own per-action cap is above $500.

## Shared types

```ts
type ReasonCode = /* the 20 codes in PRD 8.5 */ string;

type Trace = {
  atomicUpdate: { filter: Record<string, unknown>; update: Record<string, unknown>; matched: 0 | 1 };
  minimize?: { before: Record<string, unknown>; after: Record<string, unknown>; removed: string[]; tokensBefore: number; tokensAfter: number };
  semantic?: { pipeline: Record<string, unknown>[]; path: "vector" | "keyword-fallback"; topScore: number; rule: string; policyId: string; action: "REQUIRE_FACEID" | "DENY" | "ALLOW" };
  approvalChallenge?: string;     // base64url
  gateMs: number;                 // gate decision time for this item
};

type InstitutionChecks = { institution: "bank" | "fintech"; gateSignature: boolean; customerPasskey: boolean; terms: boolean; institutionRef?: string; reason?: string };

type ReceiptView = { decisionId: string; aud: "bank" | "fintech"; iat: string; exp: string; actionHash: string; ledger: { seq: number; hash: string }; gateSig: string };

type DemoItem = {
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

type WarrantSummary = { warrantId: string; status: "pending" | "active" | "revoked" | "rejected"; remainingCents: number; totalLimitCents: number; perActionMaxCents: number; expiresAt: string };

type DemoStepResponse = {
  items: DemoItem[];
  warrant: WarrantSummary;
  pending?: { approvalId: string; challenge: string; minimizedPayload: Record<string, unknown>; reason: string };   // sensitive only
  counts?: { allowed: number; denied: number; remainingCents: number; elapsedMs: number };                          // burst only
};
```

## Routes

| Method and path | Request | Response |
|---|---|---|
| `POST /api/demo/reset` | `{}` | `{ ok: true, warrantId: null, user: { userId, name, hasPasskey: boolean }, savingsCents: 8400000 }`. Deletes demo warrants, approvals and fintech/bank demo rows, resets the ledger to genesis (dev database only), removes the chapter-6 policy, keeps the user's passkey |
| `POST /api/demo/compile` | `{ text }` | `{ terms, canonical: string, plain: string[], worstCase: { cents: number, sentence: string, severity: "red" \| "green" } }`. Deterministic parser, no database write. "Put my life savings into NVIDIA" gives the $84,000 red case; "okay, $500 at a time, $1,000 max" gives the green NVDA terms above |
| `POST /api/demo/warrant` | `{ text }` | `{ warrantId, termsHash, terms, canonical, plain, worstCase }` and a pending warrant for `usr_demo` (session not required) |
| `GET /api/demo/state` | | `{ warrant: WarrantSummary \| null, user: { userId, name, hasPasskey }, ledgerHead: { seq, hash } }` |
| `POST /api/passkey/register/options`, `/verify` | existing (Jackson) | existing; the story registers `usr_demo` once if `hasPasskey` is false |
| `POST /api/warrants/:id/approve/options`, `/verify` | existing | existing; needs the session cookie set by registration. If `hasPasskey` is true but there is no session, call `POST /api/demo/session` |
| `POST /api/demo/session` | `{}` | sets the session cookie for `usr_demo` (demo stand-in for "already signed in") `{ userId }` |
| `GET /api/warrants/:id/inspect` | | `{ warrantId, terms, canonical, termsHash, challenge, approval: { credentialId, clientDataJSON (decoded object), authenticatorData (base64url), signature (base64url), userVerified: boolean, approvedAt } \| null, status, document: <the stored warrant document as JSON> }` |
| `GET /api/warrants/:id/verify-approval` | | `{ valid: boolean, userVerified: boolean, approvedAt: string \| null, termsHash: string, recomputedHash: string, reason?: string }` |
| `POST /api/demo/work` | `{}` | `DemoStepResponse` with one item: pay $500 to `BROKERAGE-NVDA` from `SAVINGS`, executed at the fintech |
| `POST /api/demo/blocked` | `{}` | three items: $5,000 to NVDA (`PER_ACTION_LIMIT`), $500 to `BROKERAGE-AAPL` (`MERCHANT_NOT_ALLOWED`), `data.export` of the account list to `https://collector.example/c` (`DESTINATION_NOT_ALLOWED`) |
| `POST /api/policies` | `{ rule, action? }` | `{ policy: { _id, rule, action, createdAt }, embeddingWrittenByUs: false }` (Pro's lane; B ships a working version if Pro's is not merged) |
| `GET /api/policies` | | `{ policies: [...] }` |
| `GET /api/policies/index` | | `{ name, definition, status }` from `listSearchIndexes`, or the definition with `status: "absent"` |
| `POST /api/demo/sensitive` | `{}` | `DemoStepResponse` with one item (`data.export` of a portfolio summary to `llm`), `trace.minimize` and `trace.semantic` filled, and `pending` when a policy requires Touch ID |
| `POST /api/approvals/:id/options` | `{}` | WebAuthn authentication options; challenge = SHA-256 of the canonical minimized payload |
| `POST /api/approvals/:id/verify` | `{ response }` | `{ released: true, sentToLlm: Record<string, unknown>, llmReply: string, llmSource: "claude" \| "canned" }` |
| `POST /api/demo/burst` | `{}` | `DemoStepResponse` with 20 items ($50 each, fired in parallel) and `counts` |
| `POST /api/demo/revoke` | `{}` | `DemoStepResponse` with one item: the next claim after revoking, denied `WARRANT_REVOKED`; `warrant.status` is `revoked` |
| `POST /api/demo/tamper` | `{}` | `{ tampered: { seq, field, before, after } }`; edits the stored warrant's `terms.totalLimitCents` and one ledger event amount using the admin connection |
| `GET /api/ledger` | existing (Pro) | `{ events: AuditEvent[] }` |
| `GET /api/ledger/verify` | existing (Pro) | `{ ok, checked, firstBrokenSeq?, anchors }` |

The demo routes need no reviewer token or session (hackathon stand-in), except where noted. Reviewer routes accept the token; the story sends `Authorization: Bearer` with `VITE_REVIEWER_TOKEN` from `story/.env.local`.
