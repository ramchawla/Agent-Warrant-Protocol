# PRD: Agent Warrant Protocol (AWP) — signed, enforceable authority for AI agents

**Author:** Hackathon team | **Date:** 2026-11-14 | **Status:** v3.1 proposed during the build (needs Ram's and Jackson's agreement) | **Version:** 3.1
**Event:** MongoDB hackathon, Toronto. Track: "Agents You Can Audit".
**Supersedes:** PRD v3.0. What changed is listed in "Appendix: Changes from v3.0" at the end.
**Purpose of this document:** single source of truth for dispatching implementation agents. An agent given one task from Section 11 plus this document can build its part without asking questions. Where this document and an agent's own judgment disagree on an interface, name, or value, this document wins; raise the conflict instead of deviating.

**Hackathon constraints (from the organisers' rules; they override anything below):**
- Finalists must build on the **MongoDB Atlas Sandbox provided for the hackathon**. AWP uses the sandbox project's cluster (`Cluster0`, M10, AWS us-west-1). No other cluster.
- The repository **must be public** by submission.
- The demo may show **only what the team built during the event**, and must make that clear.
- Banned: "any project where a dashboard is the main feature". AWP's main feature is the enforcement point; the demo shows it through the **customer's** and the **bank's** own views, with the gate explained by architecture and a per-action trace (REQ-012), never as a monitoring dashboard.

Evidence labels used below: **[opened]** means the source page was read during research on 2026-11-14; **[snippet]** means only a search summary was seen, so open it before it goes on a slide; **[unverified]** means do not present it.

---

## Executive Summary

**One line:** Don't give agents your keys. Give them a warrant.

Letting an AI agent act on your money today means giving it your login, which hands over everything you can do, with no limit and no record. AWP replaces the password with a **warrant**: bounded, time-limited, revocable terms that a customer approves with a **passkey** (Touch ID, Face ID, Windows Hello). The passkey signature covers the hash of the exact terms.

Before every agent action, a **deterministic gate** (no LLM in the decision) authenticates the agent, checks the action against the signed terms, and spends budget with **one atomic MongoDB operation**, so limits hold under concurrency. The decision is written to a **hash-chained, gate-signed ledger in MongoDB Atlas** before anything is executed. Allowed actions go to the institution with a **signed receipt** that the institution verifies on its own: the customer's passkey signature, the terms, the gate's signature. Revoking a warrant makes the next action fail.

**Demo:** a KYC-refresh and payment agent acts against a mock bank and a mock fintech. Both verify the same warrant independently. The agent is then driven outside its warrant (wrong account, over limit, injected exfiltration, 20 parallel payments) and every attempt is stopped and recorded. The audience watches two screens side by side: **the customer's view** (what my agent did, what it was stopped from, money left, one-tap revoke) and **the bank's view** (what reached the bank and how the bank checked it itself). The gate in the middle is explained with the architecture diagram and with a **"How AWP handled this"** trace under each action, built from the real ledger record.

**Positioning:** credential standards such as AP2 define signed mandates. AWP is a runnable **enforcement, revocation, and audit layer** around such a mandate, and it covers non-payment actions.

## Problem Statement

### Current Situation

Institutions cannot tell who authorized an agent, cannot bound what it does, and cannot prove afterward what happened. Reported context:

- JPMorgan's Jamie Dimon, Q3 earnings call, 13 Oct 2026: "we're not going to allow just any outside agent to come in"; "You don't want rogue agents, and there could be thousands of them"; "There's a liability transfer." This is not a total ban. Source: Banking Dive, 13 Oct 2026 **[opened]**. Do not cite Fortune **[unverified]**.
- Axios, 22 Oct 2026: major US banks are "detecting unauthorized third-party AI agents operating inside customer accounts", mostly through customers' own credentials. Unnamed sources; read via Decrypt and SecureWorld **[opened via secondary]**. Do not say banks confirmed no funds were drained; only Morgan Stanley said it had not observed "rogue AI agents accessing our platforms".
- A coding agent deleted a production database and its backups "in 9 seconds", according to the founder of PocketOS (April 2026) **[snippet]**. Attribute it to the founder. It is a coding-agent incident, not a banking one.
- Cloud Security Alliance survey, April 2026 (445 respondents, vendor-funded): 53% of organizations report agents operating beyond authorized access; 47% had an agent security incident in the past year **[opened]**.

### User Impact

Who is affected, how often, and what it costs. These are the five questions the pitch must answer.

| Question | Answer | Evidence |
|---|---|---|
| **Who is affected (customers)** | Anyone who gives a third party or an agent their banking login. | "About nine million Canadians currently share their financial data by providing their confidential banking credentials" (Finance Canada, Nov 2025; the estimate dates from 2023) **[opened]**. US: "at least 100 million consumers" had authorized third-party access as of 2022 (CFPB rule, Nov 2024) **[snippet]**. |
| **Who is affected (institutions)** | Fraud, compliance, and digital teams at banks and fintechs that receive agent traffic they cannot attribute. | Dimon and Axios items above. |
| **How often** | Every agent session run on shared credentials carries the customer's full authority, every time. There is no partial grant. Demand is rising: 38% of US consumers are comfortable with an AI completing a purchase on its own (Visa / Morning Consult, 2,000 consumers, early 2026) **[opened via The Paypers]**. | A competing survey found 55% not comfortable (Riskified) **[opened via Digital Transactions]**. Present both. |
| **Cost and time lost** | Compliance work that agents could do is expensive and manual: 54% of corporate banks spend $1,500 to $3,000 per KYC client review and 52% take 61 to 150 days (Fenergo, 1,000+ executives) **[opened]**. Financial-crime compliance costs US and Canadian institutions US$61B a year (LexisNexis / Forrester, Feb 2024) **[snippet]**. Reported fraud losses: US $15.9B in 2025 (FTC) **[opened]**; Canada over $704M in 2025, with only 5% to 10% reported (CAFC) **[opened]**. | These numbers size the surrounding problem. They are not losses caused by agents. |
| **What we cannot claim** | No public figure exists for money lost to agents acting on delegated authority, and research found no confirmed real-world unauthorized agent purchase. Do not invent one, and do not claim AWP saves a dollar amount. | Say "we found none". |

**Pain point in one sentence per persona:** the customer cannot delegate part of their authority; the institution cannot attribute or bound agent actions, or reconstruct afterward who allowed what.

### Business Impact

Institutions face a two-sided cost. Blocking agents forfeits the automation of work like KYC refresh (thousands of dollars and months per review). Allowing agents on shared credentials accepts unbounded, unattributable liability. In Canada the sanctioned alternative is not available for actions: consumer-driven banking legislation received royal assent in March 2026, draft regulations were published in June 2026, phase 1 covers read-only data sharing, and write access is a later phase with no published launch date **[opened: Canada Gazette, Advisor.ca]**. Until then, an agent that needs to act uses the customer's password.

### Current Solutions and Their Gaps

| Approach | What it does | Gap (verified wording) |
|---|---|---|
| Shared passwords, screen scraping | Agent logs in as the customer | Full authority, no limits, no attribution; banks cannot tell an authorized agent from a rogue one |
| Open-banking consents | Scoped, revocable API access | Data consents are read-only. UK variable recurring payments do carry per-payment and per-period caps, so do not claim "no limits". Nothing covers non-payment actions; Canada has no write access yet |
| Virtual cards (Stripe Issuing, Privacy.com) | Per-authorization and per-interval spend limits | Card payments only. Stripe documents aggregation as "best-effort… delay of up to 30 seconds" **[opened]**, so concurrent spends can pass a limit |
| AP2 v0.2 (Google, contributed to FIDO, Apr 2026) | Signed Checkout and Payment Mandates; has a cumulative `payment.budget` constraint | No revocation mechanism (short expiry only); record retention is "outside the scope of this specification"; payments and checkout only; constraints are checked by transaction parties **[opened]** |
| Visa Trusted Agent Protocol, Mastercard Agent Pay | Identify and tokenize registered agents on card rails | Identity, not spend limits or audit; card rails only |
| DAAP draft (draft-mishra-oauth-agent-grants, Grantex) | Specifies delegation with revocation, budget controls, and a hash-chained audit trail | Closest prior art. An individual IETF draft with no standing; a specification, not a demonstrated enforcement point with human passkey approval |
| Tenuo (open source) | Task-scoped "warrant" tokens enforced at runtime | Per-action caps on its homepage; no cumulative limits or revocation stated **[opened]** |
| Bank-side bot detection | Detects and blocks automation | Blocks legitimate agents along with rogue ones |

### How AWP Improves on This

1. **Human approval bound to exact terms.** The passkey challenge is the SHA-256 of the canonical terms. Changing one field breaks verification at the gate and at every institution.
2. **Enforcement outside the agent, with limits that hold under concurrency.** One conditional atomic update per action, shown live with 20 parallel payments. Contrast with documented best-effort aggregation.
3. **Institutions verify for themselves.** Each holds the customer's public key from its own enrollment, checks the passkey signature and the terms, and keeps its own copy of ledger checkpoints, so the gate cannot quietly rewrite history.
4. **Revocation that takes effect on the next action.**
5. **Beyond payments.** The same warrant governs KYC refresh and outbound data fields.
6. **Every party sees its own side, including blocked attempts.** The customer sees what the agent did and was stopped from; the bank sees what reached it and checks the gate's ledger against its own checkpoints; each action carries a step-by-step trace of how the protocol handled it.

Do **not** claim novelty for the hash-chained ledger or for budgets on their own; DAAP and AP2 specify those. The claim is the working combination with passkey-bound approval and independent verification.

### Why Solve This Now?

Agents are gaining real account access faster than authorization infrastructure is maturing. FIDO formed its Agentic Authentication working group in April 2026 **[opened]**, AP2 is at v0.2, and Canada's write-access phase has no date. Institutions need an enforcement and audit layer that works with whichever credential format settles.

## Goals & Success Metrics

Targets are for the demo data set. They are not production claims.

| Goal | Metric | Target | Measurement |
|---|---|---|---|
| G1. Authority is checked before every action | % of executed actions whose DECISION event has a lower sequence number than its EXECUTION event | 100% | Ledger query in `eval` |
| G2. Out-of-warrant actions are stopped | Block rate on the labelled set (Section 8.9), and false blocks on in-warrant actions | 100% blocked, 0 false blocks | `npm run eval` |
| G3. Limits hold under concurrency | 20 parallel $10 payments against a fresh $100 warrant | Exactly 10 allowed, 10 denied `BUDGET_EXHAUSTED`, remaining = 0 | `eval`, and live on stage |
| G4. Authority is provable by others | Valid receipts accepted and tampered receipts rejected by each institution's own verification | 100% on the receipt tamper set | `eval` |
| G5. History is tamper-evident | Chain verification detects an edited event, a deleted event, and a mismatch with institution-held checkpoints | Detected, with the first broken sequence number reported | `npm run verify-chain`, and live |
| G6. Latency is measured, not assumed | Median and p95 gate decision time on the sandbox cluster from the venue | Measured round trip from Toronto to the sandbox cluster (us-west-1) is about 90 ms, so expect a median of roughly 400 to 500 ms for about five round trips. Report the measured value on the slide; do not promise 300 ms | Timing log in `eval` |
| G7. Reconstruction | Time to show, from the customer's or the bank's view, who authorized an action and every step the protocol took for it | Under 30 seconds | Rehearsal stopwatch |

The v2.0 target of 100 ms was dropped, and v3.1 drops the 300 ms goal: the hackathon requires the provided sandbox cluster, which is in us-west-1. Measure and report.

## User Stories

Personas: **Customer** (grants authority, watches and stops the agent), **Agent operator** (runs the agent), **Institution** (bank or fintech receiving actions; also the party that audits them). v3.0's separate **Reviewer** persona is folded into the customer and the institution: each reconstructs what concerns them from their own view.

### Story 1: Grant a warrant
As a customer, I want to approve exactly what my agent may do with my passkey, so that no one can claim I authorized more.
- [ ] The approval screen shows the compiled terms in plain language, including a worst-case line ("at most $120.00 can leave accounts A1 to A5, to merchant M1, before 5:00 pm").
- [ ] The warrant becomes `active` only after a passkey assertion with user verification whose challenge equals the terms hash.
- [ ] Changing any field of the terms after signing makes the gate and both institutions reject it.
- [ ] A previously captured assertion cannot activate a new warrant.

### Story 2: Work inside the warrant
As an agent operator, I want in-scope actions to pass without human involvement, so that the agent is useful.
- [ ] An in-scope action returns `allow`, is executed by the institution, and its result is returned to the agent.
- [ ] Retrying the same action with the same idempotency key does not spend budget twice or execute twice.
- [ ] The agent never holds a receipt or an institution credential.

### Story 3: Stopped outside the warrant
As an institution, I want out-of-scope and injected actions stopped before they reach me.
- [ ] Every case in the labelled set is denied with its specific reason code.
- [ ] Denied actions produce no call to any institution.
- [ ] A direct call to an institution without a valid receipt is refused.

### Story 4: Verify independently
As an institution, I want to verify the customer's authority myself, instead of trusting the agent or the gate.
- [ ] Each institution verifies the passkey signature against a public key it stored at its own enrollment.
- [ ] Each institution rejects an altered amount, a wrong terms hash, an expired receipt, a receipt addressed to another institution, and a second presentation of the same receipt.
- [ ] Each institution applies its own policy and can refuse an action the gate allowed.

### Story 5: See and reconstruct from your own side
As a customer, I want to see what my agent did and what it was stopped from, in plain words, with the money left. As a bank, I want to see every agent request that reached me, how I verified it, and whether the gate's history still matches my own checkpoints.
- [ ] The customer's view lists the signed warrant (plain terms and worst-case line), every action the agent took or attempted, blocked ones included, and the budget left.
- [ ] Every action in either view expands into a "How AWP handled this" trace (REQ-012): agent identified, warrant and terms hash checked, rules in the fixed order with the first failing one marked, budget reserved, ledger entry, receipt, the institution's own checks, outcome.
- [ ] The bank's view lists each executed request with the bank's own verification results (gate signature, audience and expiry, passkey signature against its own enrolled key, terms hash, scope, own policy), refused requests with their reason, and replayed receipts that executed once.
- [ ] The blocked attempt on account A9 appears in the customer's view as blocked with `ACCOUNT_NOT_ALLOWED`, and does not appear in the bank's view at all, because it never reached the bank. That contrast is the point.
- [ ] The bank's "Check the gate's ledger" reports the first mismatching sequence number after an event is edited in Compass.

### Story 6: Revoke mid-run
As a customer, I want to revoke a warrant with one tap so that the agent stops.
- [ ] The first action after revocation is denied with `WARRANT_REVOKED`, and the customer's view shows it as blocked.
- [ ] Revoking a parent warrant also stops every child warrant (when delegation is built).
- [ ] The customer's view lists what completed before revocation.

## Functional Requirements

### Must Have (P0) — the working core and the demo

**REQ-001 Passkey enrollment with institution-held keys.**
The customer registers a platform passkey at the gate (SimpleWebAuthn, user verification required). The credential ID and public key are stored in the gate's `credentials` collection and are also enrolled at each institution through that institution's own `/enroll` endpoint, which stores them in the institution's own database.
Acceptance: after enrollment, the gate database and each institution database hold the same public key under separate database users; an institution with no enrolled key for the user rejects every receipt for that user.
Demo stand-in, to be stated on stage: `/enroll` is protected by a shared enrollment secret that represents the customer's existing authenticated banking session.

**REQ-002 Warrant model: signed terms, separate mutable state.**
A warrant document has immutable `terms` (what the customer signs), `termsHash`, `approval` (the stored assertion), and mutable `state` (status, remaining budget, counters). `termsHash = base64url(SHA-256(JCS(terms)))` using RFC 8785 canonical JSON. All money is integer cents. A `$jsonSchema` validator enforces shape and `state.remainingCents >= 0`.
Acceptance: MongoDB rejects a malformed warrant and rejects any update that would make `remainingCents` negative; no code path updates `terms` after insert.

**REQ-003 Passkey approval bound to the terms hash.**
The authentication challenge is the raw 32-byte terms digest passed as a `Uint8Array`. The approval page sends the hash it displayed; the server refuses to issue options if the stored terms hash differs. Verification requires user verification, consumes a single-use challenge record, stores the full assertion response, and sets `state.status = "active"`.
Acceptance: a warrant is `active` only after a verified assertion; an assertion for warrant X cannot activate warrant Y (each terms object carries a random nonce); an expired or already-used challenge fails.

**REQ-004 Agent identity on every request.**
Each agent has an ID and an API key; only the SHA-256 of the key is stored in `agents`. The gate authenticates the caller before anything else and requires `caller agentId == terms.agentId`.
Acceptance: a request with no key, a wrong key, or another agent's key is denied with `AGENT_UNAUTHENTICATED` or `AGENT_MISMATCH` and recorded.

**REQ-005 Deterministic evaluation.**
A pure function `evaluate(terms, action, now)` returns `allow` or `deny` with exactly one reason code. No LLM, no network, no database inside it. Check order is fixed (Section 8.6).
Acceptance: unit tests cover every reason code; the same inputs always return the same output.

**REQ-006 Egress and field controls.**
`evaluate` also checks the destination against `terms.scope.destinations`, rejects any parameter not listed for that action type in `terms.scope.fields`, and applies fixed field constraints from the policy version (for example `memo` at most 140 characters).
Acceptance: an export to an unlisted URL is denied `DESTINATION_NOT_ALLOWED`; an extra `clientList` field is denied `FIELD_NOT_ALLOWED`; a 5,000-character memo is denied `FIELD_CONSTRAINT`; the ledger stores field names and sizes for denied payloads, not their values.

**REQ-007 Atomic limits, idempotency, and record-before-act.**
For an allowed action the gate runs one transaction: a conditional `findOneAndUpdate` on the warrant (status active, not expired, remaining at or above the amount) that decrements the budget, and the append of a `DECISION` ledger event. Denials append a `DECISION` event with no decrement. A unique index on `(warrantId, idempotencyKey)` for `DECISION` events makes a retry return the original decision. Nothing is forwarded until the transaction commits. If the database is unreachable or the transaction fails, the answer is deny.
Acceptance: G3 passes; killing the gate between decision and forwarding leaves a `DECISION` event with no `EXECUTION` event, which the customer's view and the trace flag ("allowed, no execution record"); a repeated idempotency key changes neither budget nor ledger length.

**REQ-008 Hash-chained, gate-signed, insert-only ledger.**
Each event has a sequence number, `prevHash`, `hash = base64url(SHA-256(prevHash + "\n" + JCS(body)))`, and an Ed25519 signature by the gate over `hash`. Appends read and conditionally update a single ledger-head document inside the transaction, so concurrent writers cannot fork the chain. The gate's database user has `find` and `insert` on `audit_events` and no `update` or `remove`.
Acceptance: `verify-chain` detects an edited event and a deleted event and prints the first broken sequence number; an update attempted with the gate's database user is refused by MongoDB.

**REQ-009 Signed receipts verified by two institutions.**
An allowed action is forwarded by the gate with a receipt containing the full terms, the customer's assertion, the action, the decision ID, an audience, an expiry 60 seconds after issue, and the ledger sequence and hash of the decision, signed by the gate. Each institution verifies in its own process (Section 8.7), records the decision ID so a second presentation does not execute again, applies its own policy, and stores the ledger checkpoint.
Acceptance: the receipt tamper set (Section 8.9) is rejected by each institution; a receipt for the bank is rejected by the fintech; presenting the same receipt twice executes once.

**REQ-010 Execution outcome and budget release.**
After forwarding, the gate appends an `EXECUTION` event: `executed`, `rejected` (the institution refused; the held amount is released in the same transaction), or `unknown` (timeout; the amount stays held and the customer's view and trace flag it).
Acceptance: an institution refusal restores `remainingCents` exactly once; a timeout does not restore it.

**REQ-011 Revocation.**
`POST /api/warrants/:id/revoke` sets `state.status = "revoked"` for the warrant and every descendant in one `updateMany`, and appends a `REVOKED` event. Enforcement needs no notification: every action reads status inside its atomic update.
Acceptance: the first action after the revoke call returns `WARRANT_REVOKED`.

**REQ-012 Customer view, institution view, and the per-action trace.** (Replaces v3.0's reviewer timeline.)
Two views, each showing one party's own side; no standalone monitoring dashboard is part of the demo.
- **Customer view, "My agent"** (`src/web/index.html`, gate :3000, session): the customer's warrants with plain terms, worst-case line, status and money left; an activity list of every action the agent took or attempted on each warrant, in plain sentences ("Paid M1 $30.00", "Tried to export data to collector.example: blocked"); one-tap **Revoke**. Data from `GET /api/warrants` and `GET /api/warrants/:id/activity`, refreshed every 2 seconds.
- **Institution view, "Incoming agent requests"** (`src/web/institution.html`, served by each institution at `GET /` on :4001 and :4002, so it reads the institution's own data): each request with the institution's own verification results from Section 8.7, refused requests with their reason, duplicates that executed once, and a **"Check the gate's ledger"** button that compares the institution's own checkpoints with the gate's ledger (`GET /check`). Data from `GET /log`, refreshed every 2 seconds.
- **"How AWP handled this" trace** under each action in both views, built only from recorded data (no animation, no invented steps): (1) agent identified; (2) warrant active and terms hash recomputed; (3) rule checks in the fixed order of Section 8.6 step 4, all passed or the first failing one marked with its reason code (checks after it are shown as not reached); (4) budget reserved atomically, with remaining before and after; (5) recorded before acting, ledger `seq` and hash; (6) receipt signed by the gate, audience and 60-second expiry; (7) the institution's own checks (from `GET /log` in the institution view; in the customer view, an `executed` outcome implies Section 8.7 passed, since institutions execute only after it); (8) outcome. Denied actions stop after step 3, with "Nothing was sent to any bank" and their ledger entry. Trace text comes from fixed templates (`templates.ts`), never from an LLM.
- **Presenter mode** (`?present=1` on either view): the newest action's trace opens automatically and reveals one step at a time, for narration on stage.
Acceptance: G7; Story 5 and Story 6 criteria; new actions appear within 2 seconds without a reload; after an edit in Compass, the institution view's ledger check shows the first mismatching sequence number; denied actions show no institution step.
The reviewer routes (`GET /api/ledger`, `/api/ledger/verify`, `/api/stream`) and `src/web/reviewer.html` remain as an internal tool for development and `eval`; they are not shown in the demo.

**REQ-013 Scripted agent, test authenticator, and evaluation script.**
A scripted agent replays named scenarios (in-warrant work, out-of-warrant attempts, injected exfiltration, concurrency burst). A software test authenticator (a P-256 key that produces WebAuthn-shaped assertions) lets tests and `eval` activate warrants without a human tap. It works only when `AWP_ALLOW_TEST_AUTHENTICATOR=1`, its credentials are flagged `kind: "software-test"`, and the customer's view and the trace label warrants it approved.
Acceptance: `npm run eval` prints block rate, false blocks, concurrency result, receipt tamper results, and latency; with the flag off, a software-test credential cannot approve anything.

### Should Have (P1) — makes it stand out

**REQ-014 Say it in English, sign it in code.**
The customer types or dictates a request. An LLM returns a draft through schema-constrained output; the server validates it with the same schema as hand-written terms and renders the compiled, deterministic view with the worst-case line. The customer signs the compiled terms. The LLM never sees keys and takes no part in enforcement. Dictation uses the browser speech recognition API in Chrome.
Acceptance: a valid draft produces a pending warrant; an invalid draft is rejected before any signing prompt; with the LLM unavailable, three pre-written templates still work.

**REQ-015 Spoken read-back and alerts.**
ElevenLabs text-to-speech (`eleven_flash_v2_5`) reads the compiled terms aloud before signing and announces blocked actions in the customer's view. The spoken text is produced by a fixed template from the compiled terms, not by an LLM.
Acceptance: the read-back matches the on-screen terms word for word; with no API key the feature is hidden and nothing else changes.

**REQ-016 Shrinking delegation chains.**
An authenticated agent can request a child warrant for a sub-agent. The gate requires the child's scope to be a subset of the parent's, per-action limit no higher, expiry no later, and carves the child's total out of the parent's remaining budget atomically. Children store `ancestors`. Receipts for child warrants carry the chain of terms so an institution can re-check the subset rules.
Acceptance: an over-broad child is rejected; revoking the root blocks the sub-agent's next action; the customer's view shows the chain.

**REQ-017 Live LLM agent with a poisoned document.**
A Claude tool-use loop whose only tool is the gate's `act` call reads a document containing an injected instruction. Whatever it attempts goes through the gate.
Acceptance: if the model follows the injection the attempt is denied and logged; if it refuses, the run shows only in-warrant actions. The stage demo does not depend on this; the scripted agent is the reliable path.

**REQ-018 Semantic and keyword search over the ledger.**
An Atlas Vector Search index with automated embedding on the event `summary` field, an Atlas Search index on the same field, and a `$rankFusion` query, so the customer (in "My agent") can ask "anything that looked like my data leaving". Search never influences a decision.
Acceptance: that query returns the denied exfiltration events in the top results; the page still works when the search indexes are absent.

### Nice to Have (P2)

**REQ-019 Phone approval** over a stable HTTPS host (cross-device passkey). Requires registering a new passkey under that host's RP ID.
**REQ-020 Quorum approval:** two passkey assertions for actions above a threshold.
**REQ-021 Compensation records** for reversible actions, listed after revocation.
**REQ-022 AP2 import:** convert an AP2 v0.2 open Payment Mandate's constraints into draft terms (`payment.budget` to `totalLimitCents`, `payment.amount_range` to `perActionMaxCents`, `payment.allowed_payees` to `scope.merchants`, `exp` to `expiresAt`). Verify field names against the specification before demonstrating.

**Cut order if behind (first to go first):** REQ-022, REQ-021, REQ-020, REQ-019, REQ-018, REQ-017, REQ-016, REQ-015, REQ-014. P0 is never cut; if P0 is at risk, cut inside REQ-012 in this order: presenter mode, then the institution view's own data (show the gate's `GET /api/ledger/verify` result instead of `GET /check`, labelled as the gate's check), then step 7 of the trace in the institution view.

## Non-Functional Requirements

- **Trust model:** an institution trusts the customer's signature, its own enrolled key, and its own verification. It does not trust the agent. It trusts the gate only for two things it cannot see itself: cumulative budget across institutions and revocation status at decision time, bounded by the 60 seconds receipt lifetime.
- **Fail closed:** any error in authentication, evaluation, the transaction, or receipt signing results in deny and no forwarding. 0% of actions execute without a committed `DECISION` event.
- **Latency:** measured and reported, not promised (G6): the sandbox cluster is about 90 ms away per round trip. Receipt lifetime 60 seconds; challenge lifetime 5 minutes.
- **Biometrics:** no biometric data is stored or sent. The server sees only passkey signatures. The user-verification flag proves the device verified the user by biometric or device passcode; the server cannot tell which. Say "passkey with user verification", not "proof of Face ID". Consumer iPhone passkeys provide no hardware attestation, so make no hardware-enclave claims.
- **Secrets:** gate signing key, agent API keys, enrollment secret, and third-party API keys live in environment variables and never reach the browser or the agent.
- **Data:** synthetic data only. No real accounts, customers, or money. The ledger stores summaries and hashes of action parameters, never the values of denied payloads.
- **Portability:** Chrome with a laptop fingerprint sensor is the reference setup: macOS Touch ID, or Windows Hello fingerprint (verified on Jackson's laptop, 2026-11-14). Node 22 or later. A Windows Hello PIN is not biometric; say so if used. Chrome offers to save new passkeys in Google Password Manager; for the demo passkey choose the device's own authenticator (Windows Hello or iCloud Keychain/Touch ID) every time, or approval shows an empty prompt.
- **Reliability:** laptop passkey is the primary path; a recorded backup take of the full demo exists before rehearsal; search, voice, and LLM features degrade to hidden, never to broken.
- **Claims:** AWP is a reference implementation and a proposed layer. No claim of regulatory compliance, institutional adoption, or dollar savings.

## Technical Considerations

### 8.1 System architecture

Four local Node processes and one Atlas cluster. Component boundaries are also trust boundaries.

```
 Browser: customer view (:3000)               Agent process (scripted or LLM)
   | passkey ceremonies, approve, revoke         | POST /api/act  (Bearer agent key)
   | activity and traces                         |
   v                                             v
 +--------------------------- GATE  :3000 ---------------------------+
 | passkey routes | evaluate() | atomic limit + ledger txn | receipts |
 +----------+-----------------------------+--------------------------+
            | db: awp_gate                | POST /execute {receipt, gateSig}
            v                             v
     MongoDB Atlas            BANK :4001            FINTECH :4002
     (sandbox cluster,        db: awp_bank          db: awp_fintech
      three databases,        own enrolled keys, own policy, own seen-receipt
      three db users)         list, own ledger checkpoints, shared verifier lib
                              GET / = institution view (browser), GET /log, GET /check
```

- The agent's only capability is `POST /api/act`. It has no database user, no institution credential, and never receives a receipt.
- The human approval path (browser to gate) never passes through the agent.
- Institutions are separate processes with separate databases and database users. They share one open verifier library, as two real institutions would share an SDK; that library imports nothing from the gate.
- Assumption to state on stage: the agent has no network route to institutions or the internet except through the gate. In production that is a network policy; in the demo it is how the agent process is written.

### 8.2 Technology stack (decided)

TypeScript, Node 22+, ES modules. Fastify for the three servers. Zod for request validation. `@simplewebauthn/server` and `/browser` 14.x. `canonicalize` 5.x (RFC 8785; ESM-only). Node `crypto` for SHA-256 and Ed25519. MongoDB Node driver. Plain HTML and browser JavaScript for the pages, with no front-end framework and no bundler: the gate serves `src/web/` (customer pages and the internal reviewer page); each institution serves `src/web/institution.html` at its own `GET /` plus `src/web/app.js` and `src/web/style.css`. `node:test` with `tsx` for tests. One `package.json`.

Optional integrations and their place:

| Integration | Used for | Priority | Notes |
|---|---|---|---|
| Anthropic API | Draft terms (REQ-014), live agent (REQ-017) | P1 | Model from `AWP_LLM_MODEL`, default `claude-sonnet-5-5`. Structured output via `client.messages.parse` with `zodOutputFormat`. Output schemas reject `minimum`, `maxLength`, and open `additionalProperties`; validate ranges with Zod afterward. API billing is separate from a chat subscription: a Max plan includes a monthly API credit that must be claimed in the Console, reportedly only after 7 days on the plan. Confirm at kickoff. |
| ElevenLabs | Read-back and alerts (REQ-015); pitch voiceover | P1 | Free tier reported as 10,000 credits a month, 1 credit per character. Confirm the promised hackathon credits. |
| Browser speech recognition | Dictating the request (REQ-014) | P1 | Chrome; audio is sent to the browser vendor's servers. |
| Atlas Vector Search with automated embedding | Ledger search (REQ-018) | P1, last | Index JSON in 8.8. The 3-requests-a-minute embedding limit applied to free clusters without a payment method; confirm the limit on the sandbox M10, and cache the demo query either way. |
| Wispr Flow | Not a product feature | n/a | Its API is by approved access only. Use it for dictating prompts to Claude Code. |
| Higgsfield | Pitch opener video | Pitch | Unlimited trial generations are refused from Claude Code and work in claude.ai chat. Trial started 2026-11-14 and lasts 72 hours. |
| MongoDB Compass | Live tamper beat and schema display | Demo | Uses the admin user. |

### 8.3 Repository layout and file ownership

```
package.json  tsconfig.json  .env.example  README.md
src/shared/        types.ts  canonical.ts  config.ts  ids.ts        (contract; frozen after Task 2)
src/gate/          server.ts  db.ts  agents.ts  evaluate.ts  ledger.ts  approval.ts  receipts.ts  templates.ts
src/gate/routes/   passkey.ts  warrants.ts  act.ts  revoke.ts  ledger.ts  stream.ts  draft.ts  tts.ts
src/verifier/      verifyReceipt.ts      (imports only src/shared/canonical.ts, simplewebauthn, node:crypto)
src/institutions/  server.ts  policy.bank.json  policy.fintech.json   (one server, INSTITUTION=bank|fintech)
src/agent/         run.ts  llm.ts  scenarios/*.json  fixtures/poisoned.txt
src/web/           index.html  approve.html  institution.html  reviewer.html (internal)  app.js  style.css
scripts/           setup-db.ts  seed.ts  keys.ts  eval.ts  verify-chain.ts  setup-search.ts
test/              *.test.ts  softAuthenticator.ts  fixtures/events.json
```

Two agents must never edit the same file. Ownership follows the task list in Section 11. Jackson owns `routes/passkey.ts`, `routes/warrants.ts`, `routes/draft.ts`, `routes/tts.ts`, `templates.ts`, and `src/web/*` (including the new `institution.html`; Max's `src/institutions/server.ts` only serves it). Pro owns `ledger.ts`, `routes/revoke.ts`, `routes/ledger.ts`, `routes/stream.ts`, `scripts/verify-chain.ts`, and `scripts/setup-search.ts`. Max owns everything else.

### 8.4 Database schema

Database `awp_gate`:

| Collection | Key fields | Indexes and rules |
|---|---|---|
| `users` | `_id` (`usr_…`), `name` | |
| `credentials` | `_id` (credential ID), `userId`, `publicKey` (binary), `counter`, `kind` (`platform` or `software-test`), `rpId` | `userId` |
| `agents` | `_id` (`agt_…`), `name`, `keyHash`, `status` | unique `keyHash` |
| `warrants` | see below | `expiresAt`; `ancestors`; `terms.userId`; validator |
| `challenges` | `_id` (termsHash), `warrantId`, `expiresAt` | TTL index on `expiresAt`; consumed with `findOneAndDelete` |
| `audit_events` | see below | `_id` is `seq`; `runId`; `warrantId`; partial unique `(warrantId, idempotencyKey)` where `type == "DECISION"`; validator; insert-only for the gate user |
| `meta` | `{_id: "ledger_head", seq, hash}`, `{_id: "policy", version}` | |

Databases `awp_bank` and `awp_fintech`, each: `enrolled_credentials` (`userId`, credential ID, public key), `seen_receipts` (`_id` is decision ID, stored result), `anchors` (`seq`, `hash`), `requests` (v3.1: one `InstitutionLogEntry` per `/execute` call, Section 8.5), and `accounts` or `payments` for the mock execution.

Database users (created 2026-11-14 in the sandbox project with the Atlas CLI, which uses the Admin API; custom roles cannot be created with the `createRole` command; allow 30 seconds to propagate; the admin user is `awp_admin`, its URI is `MONGODB_URI_ADMIN`; the dev prefixes `jackson_`, `max_`, `pro_` get plain read/write so only the demo databases carry the insert-only role): `gate_app` (read and write on `awp_gate` except `audit_events`, where only `find` and `insert`; never `collMod` or bypass-validation), `bank_app`, `fintech_app` (read and write on their own database only), `reviewer_ro` (read on `awp_gate`), and an admin user for setup and the Compass tamper beat. Atlas admins can always modify data; the insert-only claim covers the application user, and the institution-held anchors cover the rest.

Warrant document:

```ts
type Terms = {
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

type WarrantDoc = {
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
```

Validator notes: `$jsonSchema` is draft 4; use `bsonType: "int"` or `"long"` (the `integer` type and `format` are unsupported); `additionalProperties: false` at the top level and inside `terms` and `state`; `state.remainingCents` has `minimum: 0`; `state.status` is an enum. Expired is derived from `expiresAt`, not stored. Warrants are never deleted by TTL.

Ledger event:

```ts
type AuditEvent = {
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
```

The hashed body is every field except `_id`, `hash`, and `gateSig`. Never store `undefined`; omit absent keys. Genesis: `seq 0`, `hash = base64url(SHA-256("awp-genesis"))`, written by `setup-db`.

### 8.5 API specification (contract)

Gate, `http://localhost:3000`. RP ID `localhost`, expected origin `http://localhost:3000`, both from environment variables so a hosted run can change them (passkeys registered under one RP ID do not work under another).

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/passkey/register/options` | none (demo) | `{userId}` | registration options JSON |
| `POST /api/passkey/register/verify` | none (demo) | `{userId, response}` | `{credentialId, enrolled: {bank, fintech}}`; sets a signed session cookie; enrolls at both institutions (a down institution is reported as `false`, not an error) |
| `POST /api/passkey/enroll` (v3.1) | session | `{}` | `{enrolled: {bank, fintech}}`: re-sends the user's passkeys to both institutions |
| `GET /api/passkey/session` (v3.1) | session | | `{userId}` or 401 |
| `POST /api/warrants` | session | `{terms}` without `warrantId` and `nonce` | `{warrantId, termsHash, status: "pending", plain: string[], warnings: string[]}`; 422 if the agent is unknown or the limits are inconsistent |
| `GET /api/warrants` (v3.1) | session | | `{warrants: (WarrantDoc & {plain})[]}`: the session user's warrants, newest first |
| `GET /api/warrants/:id` | session (owner) or reviewer | | `WarrantDoc` plus `plain` and `warnings`; 404 for anyone else |
| `GET /api/warrants/:id/activity` (v3.1) | session (owner) or reviewer | `?afterSeq` | `{warrant: {status, remainingCents, totalLimitCents}, items: ActivityItem[]}` (below) |
| `POST /api/warrants/:id/approve/options` | session | `{termsHash}` (what the page displayed) | authentication options; 409 if the hash differs |
| `POST /api/warrants/:id/approve/verify` | session | `{response}` | `{status: "active"}` |
| `POST /api/warrants/:id/revoke` | session or reviewer | `{}` | `{revoked: number}` |
| `POST /api/warrants/:id/children` (P1) | agent key | `{terms}` | `{warrantId, status: "active"}` or 422 with a reason |
| `POST /api/act` | agent key | `ActRequest` | 200 `ActAllow`, or 403 `ActDeny` |
| `GET /api/ledger` | reviewer | `?runId&warrantId&account&decision&reasonCode&q&afterSeq` | `{events: AuditEvent[]}` |
| `GET /api/ledger/verify` | reviewer | | `{ok, checked, firstBrokenSeq?, anchors: {bank: {ok, checked}, fintech: {ok, checked}}}` |
| `GET /api/stream` | reviewer | | server-sent events: `event` and `warrant` messages |
| `POST /api/draft` (P1) | session | `{text}` | `{terms, plain, warnings}` or 422 |
| `POST /api/tts` (P1) | session or reviewer | `{kind, id}` | audio stream; text built server-side from a template |

```ts
type ActionType = "kyc.refresh" | "payment.create" | "data.export";
type Action = { type: ActionType; destination: string; params: Record<string, unknown> };
// kyc.refresh    -> destination "bank";    params { account, fields: string[] }
// payment.create -> destination "fintech"; params { fromAccount, merchant, amountCents, currency, memo? }
// data.export    -> exists so exfiltration attempts have a name; no demo warrant allows it
type ActRequest = { warrantId: string; runId: string; idempotencyKey: string; action: Action };
type ActAllow = { decision: "allow"; decisionId: string; seq: number; outcome: "executed" | "rejected" | "unknown"; result?: unknown; remainingCents: number };
type ActDeny  = { decision: "deny"; decisionId: string; seq: number; reasonCode: ReasonCode };

// v3.1: one entry per agent action (a DECISION and its EXECUTION, if any) or per warrant event, oldest first.
// Built by templates.ts from ledger events only; owned by Jackson (routes/warrants.ts, templates.ts).
type TraceStep = { label: string; status: "ok" | "failed" | "not-reached" | "flag"; detail: string };
type ActivityItem = {
  seq: number;                       // seq of the DECISION (or of the warrant event)
  ts: string;
  kind: "created" | "approved" | "allowed" | "blocked" | "revoked" | "child";
  headline: string;                  // "Paid M1 $30.00 from A1", "Tried to export data to collector.example: blocked"
  outcome?: "executed" | "rejected" | "unknown" | "none";   // "none": allowed but no EXECUTION recorded
  remainingAfterCents?: number;
  steps: TraceStep[];                // the "How AWP handled this" trace (REQ-012)
};
```

Institutions, `http://localhost:4001` (bank) and `:4002` (fintech):

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /enroll` | enrollment secret header | `{userId, credential: {id, publicKey}}` | `{enrolled: true}` |
| `POST /execute` | the receipt itself | `{receipt, gateSig}` | 200 `{executed: true, institutionRef, duplicate?: true}` or 4xx `{rejected: true, reason}` |
| `GET /state` | none (demo) | | accounts or payments, for display |
| `GET /anchors` | none (demo) | | `[{seq, hash}]` |
| `GET /` (v3.1) | none (demo) | | `src/web/institution.html`; also serves `/app.js` and `/style.css` from `src/web/` |
| `GET /log` (v3.1) | none (demo) | `?afterTs` | `{institution: "bank" \| "fintech", entries: InstitutionLogEntry[]}`, newest first |
| `GET /check` (v3.1) | none (demo) | | `{ok, checked, firstMismatchSeq?}`: the institution compares each of its own anchors with the gate's ledger event at that `seq` (hash equal and `gateSig` valid under its pinned gate key). It reads the gate's events with `GET /api/ledger` using `REVIEWER_TOKEN`, a demo stand-in like the enrollment secret |

```ts
// v3.1: one entry per POST /execute the institution received, valid or not. Stored in the institution's own
// database (collection `requests`), so the institution view shows the institution's record, not the gate's.
type InstitutionLogEntry = {
  ts: string;
  decisionId?: string;               // absent when the body was not a parsable receipt
  action?: { type: ActionType; account?: string; merchant?: string; amountCents?: number };
  checks: { name: "gate signature" | "audience and expiry" | "first time seen" | "passkey signature" | "delegation chain" | "scope and limits" | "action hash" | "own policy"; ok: boolean; detail?: string }[];   // in Section 8.7 order, up to the first failure
  result: "executed" | "rejected" | "duplicate";
  reason?: string;                   // first failed check, for rejected
  institutionRef?: string;
  ledger?: { seq: number; hash: string };
};
```

```ts
type Receipt = {
  v: 1; decisionId: string; aud: "bank" | "fintech"; iat: string; exp: string;   // exp = iat + 60 s
  chain: { terms: Terms; approval: WarrantDoc["approval"] }[];                    // root first; one element for a root warrant
  action: Action; actionHash: string;
  ledger: { seq: number; hash: string };
};
// gateSig = base64url(Ed25519(JCS(receipt)))
```

Reason codes (one per denial): `MALFORMED_REQUEST`, `AGENT_UNAUTHENTICATED`, `AGENT_MISMATCH`, `WARRANT_NOT_FOUND`, `TERMS_TAMPERED`, `WARRANT_NOT_ACTIVE`, `WARRANT_REVOKED`, `WARRANT_NOT_YET_VALID`, `WARRANT_EXPIRED`, `ACTION_NOT_ALLOWED`, `DESTINATION_NOT_ALLOWED`, `ACCOUNT_NOT_ALLOWED`, `MERCHANT_NOT_ALLOWED`, `FIELD_NOT_ALLOWED`, `FIELD_CONSTRAINT`, `CURRENCY_MISMATCH`, `AMOUNT_INVALID`, `PER_ACTION_LIMIT`, `BUDGET_EXHAUSTED`, `LEDGER_UNAVAILABLE`.

### 8.6 Gate algorithm

1. Parse with Zod. Authenticate the agent key (hash, constant-time compare).
2. Load the warrant. Recompute `termsHash` from stored `terms`; mismatch is `TERMS_TAMPERED`. Check `agentId`.
3. If a `DECISION` with this `(warrantId, idempotencyKey)` exists, return it unchanged.
4. `evaluate(terms, action, now)` in this order: action type, destination, account, merchant, field names, field constraints, currency, amount validity (non-negative integer; payments above zero), per-action limit, `notBefore`.
5. Transaction (`session.withTransaction`, every operation given the session, no `Promise.all`, serialized by an in-process mutex to keep conflicts rare; the conditional head update is what guarantees correctness):

```ts
// allow path; amountCents is 0 for kyc.refresh
const w = await warrants.findOneAndUpdate(
  { _id: warrantId, "state.status": "active", expiresAt: { $gt: now }, "state.remainingCents": { $gte: amountCents } },
  { $inc: { "state.remainingCents": -amountCents, "state.actionCount": 1 } },
  { session, returnDocument: "after" }
);
// null => read the warrant in the session to pick WARRANT_REVOKED, WARRANT_NOT_ACTIVE, WARRANT_EXPIRED or BUDGET_EXHAUSTED, then append a deny DECISION instead

const head = await meta.findOne({ _id: "ledger_head" }, { session });
const body = { seq: head.seq + 1, prevHash: head.hash, /* event fields */ };
const hash = b64url(sha256(head.hash + "\n" + jcs(body)));
await auditEvents.insertOne({ _id: body.seq, ...body, hash, gateSig: sign(hash) }, { session });
const r = await meta.updateOne({ _id: "ledger_head", seq: head.seq }, { $set: { seq: body.seq, hash } }, { session });
if (r.modifiedCount !== 1) throw new Error("ledger head moved");   // aborts; withTransaction retries
```

6. After commit, on allow: build and sign the receipt, `POST /execute` with a 5 second timeout, then append the `EXECUTION` event (releasing budget in the same transaction when the outcome is `rejected`).
7. Any thrown error before step 6 returns deny `LEDGER_UNAVAILABLE` and forwards nothing.

Revocation semantics: a decision that committed before the revoke commit still executes. State this if asked.

### 8.7 Institution verification order

1. `gateSig` verifies over `JCS(receipt)` with the gate public key pinned in the institution's own configuration.
2. `aud` is this institution; `iat <= now <= exp` (5 seconds of skew allowed).
3. Insert `decisionId` into `seen_receipts`. On a duplicate-key error return the stored result with `duplicate: true` and execute nothing.
4. For the root element of `chain`: recompute the terms hash; call `verifyAuthenticationResponse` with `expectedChallenge` set to that hash, the configured origin and RP ID, `requireUserVerification: true`, and the credential from this institution's own `enrolled_credentials` with `counter: 0` (re-verifying a stored assertion against an advanced counter would throw).
5. For each later element: scope is a subset of the previous element's, limits no higher, expiry no later.
6. For the last element: `now < expiresAt`; the action is inside scope; amount at or under `perActionMaxCents`; `actionHash` matches.
7. Own policy from `policy.<institution>.json`: accepted action types, own per-action cap, currency.
8. Execute against the mock store, save the result in `seen_receipts`, save `{seq, hash}` in `anchors`.
9. (v3.1) Whatever the result, append an `InstitutionLogEntry` (8.5) to its own `requests` collection with each check above as it ran. A request that fails at check 1 or 2 is logged too; that is how the institution view shows "a direct call without a valid receipt was refused".

An institution cannot check cumulative spend across institutions or current revocation status. Those are the two things it takes from the gate's signature, bounded by the 60 second lifetime. Say this plainly; it is the honest boundary of "independent".

### 8.8 Search index definitions (REQ-018)

Automated-embedding vector index on `audit_events` (verify the model name in the Atlas UI at build time):

```json
{ "fields": [
  { "type": "autoEmbed", "modality": "text", "path": "summary", "model": "voyage-4" },
  { "type": "filter", "path": "decision" }
] }
```

Query: `{ "$vectorSearch": { "index": "audit_summary_vec", "path": "summary", "query": "<text>", "numCandidates": 100, "limit": 10 } }`. Confirm `numCandidates` and `limit` against the `$vectorSearch` stage page. This design uses two search and vector indexes (the free-tier limit was three; the sandbox M10 allows more). `$rankFusion` needs MongoDB 8.0 and takes only `$search`, `$vectorSearch`, `$match`, `$sort`, `$geoNear`, `$skip`, `$limit`, `$sample` in its sub-pipelines. `$scoreFusion` and `$rerank` are not available on the free cluster. Embeddings are held by the index, so the insert-only rule on the collection is unaffected (confirm when building).

### 8.9 Testing strategy and the labelled evaluation set

Unit: `evaluate` (every reason code), canonical hashing (key order and number forms do not change the hash), ledger append and verify, receipt verification with the software authenticator. Integration: `eval` against the real cluster.

Labelled set (expected result in brackets), against a demo warrant W1: KYC refresh on A1 to A5 at the bank; payments to M1 from A1, up to $50 each and $120 total, CAD; fields `account, fields` and `fromAccount, merchant, amountCents, currency, memo`; expires 17:00 local.

In-warrant (allow): KYC A1; KYC A3; pay $30 to M1; pay $50 to M1.
Out-of-warrant (deny): KYC A9 [`ACCOUNT_NOT_ALLOWED`]; pay $80 [`PER_ACTION_LIMIT`]; pay M2 [`MERCHANT_NOT_ALLOWED`]; pay in USD [`CURRENCY_MISMATCH`]; pay -$10 [`AMOUNT_INVALID`]; pay $50 when $40 remains [`BUDGET_EXHAUSTED`]; `data.export` to `https://collector.example/c` [`ACTION_NOT_ALLOWED`]; payment with destination `https://collector.example/c` [`DESTINATION_NOT_ALLOWED`]; payment with extra `clientList` field [`FIELD_NOT_ALLOWED`]; payment with a 5,000-character memo [`FIELD_CONSTRAINT`]; any action on an expired warrant [`WARRANT_EXPIRED`]; on a revoked warrant [`WARRANT_REVOKED`]; on a pending warrant [`WARRANT_NOT_ACTIVE`]; with another agent's key [`AGENT_MISMATCH`]; with no key [`AGENT_UNAUTHENTICATED`]; on a warrant whose stored terms were edited [`TERMS_TAMPERED`].
Behavioural: same idempotency key twice (one decision, one execution); 20 parallel $10 on a fresh $100 warrant (exactly 10 allowed).
Receipt tamper set, run against each institution directly: altered amount; altered terms; wrong audience; expired receipt; invalid gate signature; unknown credential; assertion from a different warrant; same receipt twice (executes once); gate-allowed action outside the institution's own policy.

## 9. Holes Found in v2.0 and How They Are Closed

| # | Hole | Closed by |
|---|---|---|
| 1 | No agent authentication; anyone with a warrant ID could spend | REQ-004 |
| 2 | Hash covered a document containing mutable and self-referential fields | REQ-002 terms and state split |
| 3 | A sequence counter does not stop chain forks, because writer N needs the hash of N-1 | REQ-008 ledger-head compare-and-set in a transaction |
| 4 | Budget decrement and audit write were separate operations | REQ-007 single transaction |
| 5 | Receipts could be replayed, or used at the other institution | REQ-009 decision ID, audience, 60 second expiry |
| 6 | Institutions received the customer's public key from the gate | REQ-001 institution-side enrollment |
| 7 | A database admin could rewrite the chain and recompute hashes | Gate signature per event; institution-held anchors compared by `verify-chain` |
| 8 | Agent retries double-spent inside the budget | REQ-007 idempotency key |
| 9 | Institution failure after decrement lost budget with nothing executed | REQ-010 |
| 10 | "Change stream notifies the gate" implied cached warrant state | REQ-011; status is read in the atomic update; the change stream only drives the UI |
| 11 | The injection beat relied on a live LLM taking the bait | REQ-013 scripted agent is primary; REQ-017 is optional |
| 12 | Field allowlist could be bypassed by stuffing a free-text field, and nothing stopped a direct call | REQ-006 constraints and destination list; institutions refuse calls without a receipt; network assumption stated |
| 13 | Demo arithmetic disagreed with the concurrency goal | Section 12 numbers; G3 uses a fresh $100 warrant |
| 14 | "Face ID" overclaim | NFR wording |
| 15 | Terms could be swapped between display and signing | REQ-003 displayed-hash check; terms immutable; nonce per warrant |
| 16 | Tests and `eval` would need a human passkey tap per warrant | REQ-013 flagged software authenticator |
| 17 | The 100 ms latency target was not achievable on the free cluster | G6 |
| 18 | The agent's database role could insert ledger events | The agent has no database access; only the gate writes |
| 19 | Related-work claims were partly wrong (AP2 mandate names, AP2 budgets, warrant.dev, Writ) | Section 10 |
| 20 | Wispr API, phone approval on `localhost`, and LLM API credits were assumed available | Section 8.2 and open questions |

Residual risks to name if asked: who operates and attests the gate; loss allocation for a harmful in-warrant action; device loss and key recovery; privacy of the ledger; revocation freshness of 60 seconds at institutions; delegation links are attested by the gate, not signed by the parent agent; demo enrollment and sessions are stand-ins.

## 10. Related Work and Positioning

| Work | Status (as researched 2026-11-14) | Relation to AWP |
|---|---|---|
| AP2 v0.2 (28 Apr 2026) | Google "has contributed" it to FIDO. Checkout and Payment Mandates, open and closed, as SD-JWTs. Constraints include `payment.budget`, `payment.amount_range`, `payment.allowed_payees`. No revocation; retention out of scope **[opened]** | AWP can take such a mandate as input (REQ-022) and adds revocation, a stateful enforcement point, and a ledger. The names "Intent Mandate" and "Cart Mandate" are from v0.1; do not use them |
| FIDO Agentic Authentication working group (Apr 2026) | Formed; standards in development **[opened]** | AWP uses passkeys today and should follow this work |
| Visa Trusted Agent Protocol; Mastercard Agent Pay | Agent identification with HTTP message signatures; agentic tokens **[opened / snippet]** | Complementary; AWP is rail-agnostic |
| DAAP (draft-mishra-oauth-agent-grants-01) | Individual draft: revocation, budgets, hash-chained audit **[opened]** | Closest prior art. AWP is a runnable implementation with passkey-bound approval and independent institution verification. Name it before a judge does |
| Agent Authorization Profile; Delegation Receipt Protocol | Individual IETF drafts **[snippet]** | Related; cite only after opening |
| Tenuo | Open source; task-scoped warrants, per-action caps **[opened]** | Shares the word "warrant"; AWP adds human passkey approval, cumulative limits in the database, and the reviewer ledger |
| `@countersign/mcp` | Spend pre-flight and freeze; testnet **[snippet]** | Overlaps on pre-flight checks |
| Liceat | "scoped, spend-capped, revocable grants" by its own description **[snippet]** | Unverified; mention only if opened |

Removed from v2.0: warrant.dev (a general authorization service, not agent warrants) and the claim that Writ is revocable (roadmap only).

**Name:** no project called "Agent Warrant Protocol" was found. The acronym "AWP" is already used by Agentic Web Protocol and Agent Workflow Protocol. Use the full name on slides.

## 11. Implementation Roadmap

Sized for a 6 hour build by three Claude Code instances with unequal budgets:

- **Max** (Ram's Max plan): the lead. Highest usage limit; runs several agents in parallel in git worktrees and merges everything.
- **Pro** (Ram's Pro plan, same laptop, its own worktree and login): one session, one bounded lane.
- **Jackson** (Jackson's Pro plan, his laptop): one session, plus the hands-on work.

If the event gives 12 hours, use the extension block. Each task lists what it depends on.

### Workstreams

The seams are the HTTP contract in 8.5 and the two module interfaces fixed below. No file has two owners.

- **Max, enforcement lane:** contract and stubs, evaluation, approval logic, verifier and receipts, action endpoint, institutions, scripted agent, evaluation, review; then delegation and the live agent if ahead.
- **Pro, ledger lane:** ledger and chain verification, then revoke, ledger queries and the live stream, then ledger search if ahead.
- **Jackson, human-facing lane:** Atlas setup, passkey registration and approval pages, the customer view and institution view with the per-action trace (REQ-012), English-to-warrant, voice, deck, opener video, backup recording.

No lane waits on another before the 3:45 integration. Task 2 ships stub routes that serve fixture events from `test/fixtures/events.json` and a stub `appendEvent`, so pages and the action endpoint are built before the real ledger and gate exist. The software test authenticator activates warrants, so the gate is tested before the pages exist.

### Collaboration rules

1. One **public** repository (hackathon rule), `ramchawla/Agent-Warrant-Protocol`. `.env` files never go into git. `main` always runs. Max merges; Pro and Jackson push branches and never push to `main`.
2. Branches are `max/<task>-<name>`, `pro/<task>-<name>`, and `jackson/<task>-<name>`. Max's agents each work in their own worktree. Pro works in a separate worktree on the same laptop (`git worktree add ../awp-pro -b pro/5-ledger`), never in Max's directory.
3. Each instance edits only the files it owns (8.3 and the task table). A needed change elsewhere is a message to the owner, not an edit.
4. `src/shared/*`, `package.json`, and `src/gate/server.ts` are frozen when task 2 merges. Every dependency is installed and every route module is registered as a stub in task 2, so no later task touches those files. A change needs Ram and Jackson to agree; Max makes it and announces it.
5. Each instance sets its own `AWP_DB_PREFIX` (`max_`, `pro_`, `jackson_`) so seeding and resets never touch another's data. The demo databases have no prefix and are the only ones with the insert-only role.
6. Passkeys are bound to one laptop and to `localhost`. The demo runs on Ram's laptop; the demo passkey is registered there at 3:45. Jackson's Windows laptop (Windows Hello fingerprint, verified) is the fallback demo laptop. On Windows, run `npm config set script-shell "C:\Program Files\Git\bin\bash.exe"` once, because `dev:bank` and `dev:fintech` use Unix-style environment prefixes.
7. Sync for five minutes at 0:45, 2:15, 3:45, 4:30, and 5:15: Max merges ready branches, everyone rebases on `main` and runs `npm test`, states the next task, names blockers. Anyone blocked for more than 10 minutes says so at once.
8. Usage-limit fallback: a Pro instance that runs out pushes its branch as it stands with a three-line note (what works, what does not, next step). Max hands the task to one of its agents. Jackson then moves to work that needs no tokens: device testing, the Compass tamper rehearsal, deck, evidence, timing, backup recording.
9. Max runs one fresh-context review of `act.ts`, `ledger.ts`, `approval.ts`, and `verifyReceipt.ts` before the freeze.

### Task list (dependencies and done-when)

| # | Task | Owner | Depends on | Size | Done when |
|---|---|---|---|---|---|
| 1 | Kickoff checks (Section 16). Jackson, by hand: Atlas cluster, three demo databases plus prefixed dev databases, database users and custom roles, Compass, shared `.env`. Max: repository, `scripts/keys.ts` | Jackson and Max | none | ~0.5h | `gate_app` update on `audit_events` is refused; keys generated |
| 2 | `src/shared/*`: types from 8.4 and 8.5 verbatim, `canonical.ts`, `ids.ts`, `config.ts`; `scripts/setup-db.ts` with validators, indexes, genesis; `package.json` with every dependency; `src/gate/server.ts` registering every route module as a stub; `src/gate/db.ts`; stub `approval.ts` (throws) and stub `ledger.ts` (`appendEvent` writes nothing and returns a placeholder event) exporting the fixed signatures; static serving of `src/web/` and of the `@simplewebauthn/browser` bundle at `/vendor/`; `test/fixtures/events.json`, served by the ledger routes whenever `AWP_FIXTURES=1` | Max, reviewed by Ram and Jackson | 1 | ~0.75h | Hash test vectors pass; malformed warrant insert is refused; stub routes return fixtures; `npm test` passes. **Contract frozen** |
| 3 | `routes/passkey.ts` (registration, enrollment calls, session cookie), `routes/warrants.ts` (create, get, approve; calls `approval.ts`), `templates.ts`, `index.html`, `approve.html` | Jackson | 2; 6 for the real `approval.ts` | ~1.5h | Touch ID activates a warrant; edited terms fail; reused challenge fails |
| 4 | `evaluate.ts` and its tests | Max, agent 1 | 2 | ~1h | Every reason code in 8.9 covered |
| 5 | `ledger.ts` (real `appendEvent`, `verifyChain`) and `scripts/verify-chain.ts` | Pro | 2 | ~1h | 50 concurrent appends give an unbroken chain; an edit is detected |
| 6 | `src/gate/approval.ts` (real implementation, delivered first, by 1:30), `test/softAuthenticator.ts`, `src/verifier/verifyReceipt.ts`, `receipts.ts` | Max, agent 2 | 2 | ~1.25h | The software authenticator activates a warrant through `approval.ts`; receipt tamper set passes at the library level |
| 7 | `routes/act.ts`, `agents.ts`: authentication, idempotency, transaction, forwarding, execution event and release | Max, main session | 4, 5, 6 | ~1.5h | Concurrency test passes; kill between decision and forward leaves a flagged record |
| 8 | `src/institutions/server.ts`, policies, `/enroll`, `/execute`, `/state`, `/anchors`; v3.1: the `requests` log (8.7 step 9), `GET /log`, `GET /check`, and static serving of `institution.html`, `app.js`, `style.css` from `src/web/` | Max, agent | 6 | ~1.25h | Tamper set passes over HTTP; duplicate executes once; every `/execute` call, valid or not, appears in `GET /log` with its checks; `GET /check` reports the first mismatch after a Compass edit |
| 9 | `routes/revoke.ts`, `routes/ledger.ts`, `routes/stream.ts` (change stream to server-sent events) | Pro | 5 | ~0.75h | Next action after revoke is denied; events arrive live |
| 10 | REQ-012: `GET /api/warrants` and `GET /api/warrants/:id/activity` with the trace builder in `templates.ts`; customer view in `index.html` (warrants, activity, traces, revoke, presenter mode); `institution.html` (requests with the institution's checks, ledger check, traces). Built on fixtures (ledger fixtures for the customer view, a fixture log for the institution view), then switched to the real routes. `reviewer.html` stays as an internal tool | Jackson | 2 (fixtures); 7, 8, 9 (real data) | ~1.75h | G7 in rehearsal; Story 5 and Story 6 criteria |
| 11 | `src/agent/run.ts`, scenarios, `scripts/seed.ts`, `scripts/eval.ts` | Max | 7, 8 | ~1h | `npm run eval` prints all G1 to G6 numbers |
| 12 | REQ-014 `routes/draft.ts`, templates fallback, dictation button | Jackson | 3 | ~1h | Draft to signed warrant works; invalid draft refused |
| 13 | REQ-016 delegation | Max | 7 | ~1h | Over-broad child refused; root revoke cascades |
| 14 | REQ-015 `routes/tts.ts` voice read-back and alerts | Jackson | 3, 10 | ~0.5h | Read-back matches screen |
| 15 | REQ-017 live LLM agent | Max | 11 | ~0.5h | Runs through the gate only |
| 16 | REQ-018 ledger search: `scripts/setup-search.ts`, search branch in `routes/ledger.ts` | Pro | 9 | ~1h | Query returns the exfiltration denials |
| 17 | Pitch: evidence slide, deck, opener video, backup take, two rehearsals | Jackson leads; all rehearse | 11 | ~1.5h | Section 14 checkpoint 6 |

Parallel sets: after task 2, tasks 3, 4, 5, 6 run at once (Jackson on 3, Pro on 5, two of Max's agents on 4 and 6). Then 7, 8, 9, 10. Then 11. Critical path: 1, 2, 4 and 5 and 6, 7, 11.

Two module interfaces cross lanes, so their signatures are fixed here and stubbed in task 2:

```ts
// src/gate/approval.ts (owned by Max; called by Jackson's routes/warrants.ts)
issueOptions(warrantId: string, displayedTermsHash: string): Promise<PublicKeyCredentialRequestOptionsJSON>; // throws a 409 error if the stored hash differs
verifyAndActivate(warrantId: string, response: AuthenticationResponseJSON): Promise<{ status: "active" }>;

// src/gate/ledger.ts (owned by Pro; called by Max's routes/act.ts and Jackson's routes through the gate)
type NewEvent = Omit<AuditEvent, "_id" | "seq" | "ts" | "prevHash" | "hash" | "gateSig" | "policyVersion">;
appendEvent(session: ClientSession, event: NewEvent): Promise<AuditEvent>;   // must be called inside the caller's transaction
verifyChain(): Promise<{ ok: boolean; checked: number; firstBrokenSeq?: number }>;
```

### Phases (6 hour build)

| Phase | Time | Max | Pro | Jackson | Checkpoint |
|---|---|---|---|---|---|
| 0. Foundation | 0:00 to 0:45 | Repository, task 2 | Set up the worktree and login; wait for the freeze | Task 1 in the Atlas UI, then review the contract | Contract frozen; validators and roles proven |
| 1. Pieces | 0:45 to 2:15 | Tasks 4 and 6 in two agents | Task 5 | Task 3 | Passkey approval works on a laptop; chain verifies; verifier rejects tampering |
| 2. The path | 2:15 to 3:45 | Task 7 in the main session; task 8 in an agent | Task 9 | Task 10 on fixtures | One allowed action executes at both institutions with receipts; concurrency test passes |
| 3. Integrate | 3:45 to 4:30 | Task 11; first full run on Ram's laptop | Fixes from the first full run | Task 10 on real routes (customer view and institution view); register the demo passkey | Full P0 demo path runs on two screens; `eval` prints numbers |
| 4. Standout | 4:30 to 5:15 | Code review, then task 13 or 15 | Task 16 | Task 12, then 14 | English-to-warrant works |
| 5. Freeze | 5:15 to 6:00 | Evaluation numbers, rehearse | Stop | Task 17: slide, backup take, rehearse | Demo runs twice in a row |

**If the WebAuthn spike in task 3 is not passing by 2:00, everyone stops and fixes it.** It is the one part that cannot be faked.

**If the day is 12 hours:** hours 6 to 8 for tasks 13 to 16; hour 8 to 9 feature freeze and backup take; hours 9 to 11 video and deck; hour 11 to 12 rehearse and submit.

## 12. Demo Script (about 3.5 minutes; trim to the organisers' limit)

1. **Hook (15 s).** "About nine million Canadians hand their banking password to third parties. Now they're handing it to AI agents, and banks can't tell who authorized what."
Screen layout: **customer view on the left, bank view on the right**, both in presenter mode (`?present=1`). The gate is never shown as a dashboard; it is the architecture slide plus the trace under each action.

2. **Grant (30 s).** The customer says or types the request. AWP shows the compiled terms and the worst-case line, reads them aloud, and the customer approves with a fingerprint: KYC refresh on A1 to A5, payments to M1 up to $50 each and $120 in total, until 5 pm.
3. **How it works (20 s).** The architecture slide (8.1): the agent's only door is the gate; the gate checks, records, then signs a receipt the bank verifies itself.
4. **Work (25 s).** The agent refreshes A1, A2, A3 at the bank and pays $30 at the fintech. Left: "Paid M1 $30.00, $90.00 left", and its trace opens step by step. Right: the same request with the bank's own ticks (gate signature, passkey signature with the key the bank enrolled, terms, own policy).
5. **Blocked (20 s).** Account A9, an $80 payment, merchant M2. Left: each blocked, its trace stopping at the failing rule. Right: nothing arrives, because nothing was sent.
6. **Attack (25 s).** A poisoned document tells the agent to send the client list to an outside address, then to hide it in a payment memo. Both blocked on the left. A direct call to the bank without a receipt appears on the right as refused at "gate signature".
7. **Concurrency (15 s).** 20 parallel $10 payments against the $90 that remains. Exactly 9 go through; the money left reaches $0.00.
8. **Revoke (10 s).** One tap on the left. The next action shows blocked with `WARRANT_REVOKED`.
9. **Tamper (20 s).** Edit an amount in Compass. On the right, "Check the gate's ledger" turns red at that sequence number: the bank's own checkpoint disagrees.
10. **Vision (20 s).** Section 13, labelled as vision, with the evaluation numbers from `eval`.

Things to say honestly if asked: the passkey proves user verification, not specifically a face scan; institutions rely on the gate for cumulative budget and revocation at decision time; DAAP specifies similar ideas on paper; enrollment and sessions are demo stand-ins.

Pitch assets: opener video (script in the conversation of 2026-11-14; generate in claude.ai chat while the Higgsfield trial is active, at 720p); voiceover line 4 may change to the verified Dimon quote; evidence slide built only from **[opened]** items in the Problem Statement; one architecture slide from 8.1 (the "How it works" beat); evaluation slide from `eval` output. Say once on stage which parts were built during the event (hackathon rule).

## Out of Scope

Real banks, payments, or customer data. Production key management and key rotation. Customer login beyond a demo session cookie. Cross-institution federation and a shared revocation network. Agent-signed delegation links. Regulatory certification. Storing or matching biometrics. Guaranteed undo of irreversible actions. Network isolation of the agent process. A hosted deployment (unless the organisers require one). Any LLM or search result in the decision path.

## 13. Vision: the trust layer for the agent economy

Labelled as vision on every slide; none of this is built.

- **Power of attorney for software.** Agents carry a warrant instead of a password, and any institution verifies it in milliseconds.
- **One button to revoke everywhere.** A shared revocation feed that institutions subscribe to.
- **Delegation that only shrinks.** Agents hire agents and authority narrows at every hop.
- **Agent track records.** Clean ledger history earns higher limits; insurers price agent access on evidence.
- **Quorum for serious money.** Customer plus banker.
- **Regulator window.** Supervisors verify authorization trails through hashes and selective disclosure.
- **Staged path:** hackathon mocks, then a fintech sandbox pilot, then an enforcement point inside a bank's own environment starting with read-only actions, then interoperable receipts as FIDO and AP2 settle.

## 14. Open Questions & Risks

### Open questions

| # | Question | Owner | Needed by |
|---|---|---|---|
| Q1 | Is the build window 6 hours or 12? The v2.0 draft and earlier planning disagree | User | Before kickoff |
| Q2 | Event date and start time (the Higgsfield trial ends 72 hours after 2026-11-14) | User | Now |
| Q3 | Organisers' rubric, demo length, submission format, and whether a hosted URL or video is required | User | Kickoff |
| Q4 | **Answered 2026-11-14:** passkey approval works in Chrome on `localhost` with a Windows Hello fingerprint on Jackson's laptop (choose Windows Hello, not Google Password Manager). Still to confirm: Ram's laptop as the demo laptop | Ram | 3:45 |
| Q5 | Is an Anthropic API key with credit available (Max plan credit claim, or hackathon credits)? | User | Task 12 |
| Q6 | **Answered:** Jackson has an ElevenLabs API key (in his `.env`). Credit amount still to confirm | Jackson | Task 14 |
| Q7 | Does the sandbox M10 have the automated-embedding rate limit of free clusters? | Pro | Task 16 |
| Q9 | (v3.1) Does Ram agree to replace the reviewer timeline with the customer and institution views (REQ-012) and to the institution additions in task 8? | Ram | Now |
| Q8 | Final name, and whether the domain, npm name, and GitHub organisation are free | Team | Deck |

### Risks

| Risk | Likelihood | Impact | Mitigation | Contingency |
|---|---|---|---|---|
| Passkey flow fails on stage | Medium | High | Spike first; laptop authenticator primary; fixed RP ID | Backup take |
| Scope exceeds the window | High | High | P0 is the demo; cut order fixed; freeze at 5:15 | Ship P0 |
| Judges read the project as "a dashboard is the main feature" (banned) | Medium | High | Two product views (customer, bank), no monitoring dashboard on stage; open on enforcement moments; architecture slide carries the middle | Cut the institution view to the gate's check (REQ-012 cut order) rather than show a dashboard |
| Sandbox cluster latency (about 90 ms per round trip, us-west-1) makes the burst slow | Medium | Medium | In-process mutex; 20 requests only; rehearse on venue network | Reduce to 10 parallel |
| Venue Wi-Fi blocks Atlas or is unstable | Medium | High | Phone hotspot tested in advance; nearest region | Backup take |
| A judge knows DAAP or AP2 well | Medium | Medium | Name them first; claim the combination, not the parts | Honest answer from Section 10 |
| LLM drafts an over-broad warrant | Medium | Medium | Schema validation, compiled view, worst-case line | Templates |
| A quoted fact is wrong | Medium | Medium | Only **[opened]** items on slides; reopen each on the day | Drop the claim |
| Two instances edit the same file | Medium | Medium | File ownership in 8.3; contract frozen after task 2; only Max merges | Worktrees and manual merge |
| The teammate's usage limit runs out mid-task | Medium | Medium | Hand-over rule in Section 11; one task per session | Lead's agents take the task |
| Trial or free-tier limits run out (Higgsfield, ElevenLabs, embeddings) | Medium | Low | Generate the video early; cache the search query | Text captions; skip search |

## Validation Checkpoints

1. **End of phase 0:** MongoDB rejects a malformed warrant; `gate_app` cannot update or delete a ledger event; canonical hash test vectors pass.
2. **End of phase 1:** a laptop passkey activates a warrant and any edit to the terms breaks it; 50 concurrent appends leave a valid chain; the verifier library rejects the tamper set.
3. **End of phase 2:** one KYC action and one payment execute with receipts; 20 parallel payments on a $100 warrant give exactly 10.
4. **End of phase 3:** `npm run eval` reports 100% blocks, 0 false blocks, and measured latency; revoke stops the next action; the Compass edit is detected.
5. **End of phase 4:** a typed request becomes a signed warrant; with the LLM key removed, templates still work.
6. **End of phase 5:** the full demo script runs twice in a row without intervention, and a backup take is saved.

## 15. Decisions Made in This Version (check these)

1. Terms and state are separate; the signature covers terms only.
2. `steps`, `runs`, and `counters` collections are dropped; the ledger is the record, grouped by `runId`.
3. Everything runs locally on `localhost` with RP ID `localhost`; no hosted deployment; phone approval is P2.
4. Institutions are one parameterised server run twice, with separate databases and a shared verifier library.
5. Agent identity is a hashed API key, not signed requests.
6. Egress controls moved from P1 into P0 because the demo depends on them.
7. The scripted agent is the stage path; the live LLM agent is P1.
8. Front end is plain HTML with no framework.
9. Latency target changed from 100 ms to a measured value with a 300 ms goal.
10. Lead claims changed to the passkey-bound, independently verified combination; "static credentials cannot enforce totals" was removed.
11. Wispr Flow is not a product integration.
12. Default LLM for drafting is `claude-sonnet-5-5` for response time on stage; change `AWP_LLM_MODEL` to use a larger model.
13. Work is split into three lanes with no shared files: Max (Ram's Max plan, parallel agents) owns the contract, enforcement, institutions, and evaluation; Pro (Ram's Pro plan) owns the ledger and its routes; Jackson (his Pro plan) owns pages, passkey ceremonies, voice, and pitch assets.
14. Stubs, fixture events, fixed module signatures, and per-instance database prefixes exist so no lane waits on another.
15. (v3.1) The demo shows the customer's view and the bank's view side by side; the gate is explained by the architecture slide and a per-action trace built from the ledger. The reviewer timeline is an internal tool only. Reason: the hackathon bans projects where a dashboard is the main feature, and two parties' own views tell the audit story more directly.
16. (v3.1) The institution view is served by the institution itself and reads the institution's own `requests` log, so "what the bank saw" is the bank's record, not the gate's.
17. (v3.1) The trace is derived only from recorded data; rule checks after the failing one are shown as "not reached", which is exact because the check order is fixed (8.6).
18. (v3.1) Pages poll every 2 seconds instead of using the reviewer-only stream; simpler, and within the G7 budget.

## 16. Kickoff Checklist (no code before this)

- Confirm rules on pre-written material; this PRD is planning only.
- Node 22 or later installed. **Done 2026-11-14:** the hackathon Atlas sandbox cluster (M10, us-west-1), network access `0.0.0.0/0`, custom role `awp_gate_app`, five users; `gate_app` update on `audit_events` refused (checked).
- `.env`: `MONGODB_URI_GATE`, `MONGODB_URI_BANK`, `MONGODB_URI_FINTECH`, `MONGODB_URI_REVIEWER`, `MONGODB_URI_ADMIN` (setup-db and Compass only), `RP_ID=localhost`, `ORIGIN=http://localhost:3000`, `GATE_ED25519_PRIVATE_KEY`, `GATE_ED25519_PUBLIC_KEY`, `SESSION_SECRET`, `REVIEWER_TOKEN`, `ENROLL_SECRET`, `AWP_ALLOW_TEST_AUTHENTICATOR`, `AWP_DB_PREFIX`, `AWP_FIXTURES`, `ANTHROPIC_API_KEY`, `AWP_LLM_MODEL`, `ELEVENLABS_API_KEY`.
- Touch ID test in Chrome on `localhost` before anything else in task 3.
- Hotspot tested against Atlas. Compass connected with the admin user.
- Higgsfield: cancel auto-renewal; generate the opener in claude.ai chat before the trial ends.

## Appendix: Task Breakdown Hints

Task breakdown for a task runner: one task per row of the table in Section 11, with the "Depends on" column as dependencies and "Done when" as the test strategy. Tasks 1 to 11 are P0 and map to REQ-001 through REQ-013; tasks 12 to 16 map to REQ-014 through REQ-018; task 17 is the pitch. Insert a user test after tasks 3 (passkey on the real laptop), 7 (concurrency live), 11 (full demo path), and 17 (rehearsal). Each implementation agent receives: this document, its row, the files it owns from 8.3, and the instruction not to change `src/shared/*`, `package.json`, or `src/gate/server.ts` after task 2 without Ram and Jackson agreeing.

## Appendix: Changes from v3.0

| Area | v3.0 | v3.1 |
|---|---|---|
| Demo surface | Reviewer timeline page | Customer view and institution (bank) view side by side, architecture slide, per-action "How AWP handled this" trace (REQ-012) |
| Personas | Customer, operator, institution, reviewer | Reviewer folded into customer and institution |
| Stories 5 and 6 | Reviewer reconstructs; reviewer revokes | Each party sees its own side; customer revokes with one tap |
| API (gate) | 8.5 table | Adds `GET /api/warrants`, `GET /api/warrants/:id/activity`, `POST /api/passkey/enroll`, `GET /api/passkey/session`; `warnings` on warrant responses; `enrolled` on registration |
| API (institutions) | `/enroll`, `/execute`, `/state`, `/anchors` | Adds `GET /` (institution view), `GET /log`, `GET /check`; `requests` collection; 8.7 step 9 |
| Task 8 / task 10 | Institutions; reviewer page | Task 8 adds log, check, static page; task 10 builds both views and the trace |
| Cluster | Free cluster, nearest region | Hackathon sandbox M10 in us-west-1 (required); latency target is measured, not promised |
| Repository | Private | Public (required) |
| Constraints | none listed | Hackathon rules at the top of the document |
| Laptop | Touch ID reference | Windows Hello fingerprint verified; Google Password Manager pitfall noted; Windows npm shell note |

## Appendix: Changes from v2.0

| v2.0 | v3.0 |
|---|---|
| REQ-001 passkey approval | REQ-001 enrollment, REQ-003 approval |
| REQ-002 schema | REQ-002, reshaped |
| REQ-003 gate with atomic limits | REQ-005 evaluation, REQ-007 transaction |
| REQ-004 write before acting | REQ-007, REQ-010 |
| REQ-005 ledger | REQ-008, plus gate signature and anchors |
| REQ-006 receipts | REQ-009, plus replay, audience, expiry |
| REQ-007 revocation via change stream | REQ-011; change stream moved to REQ-012 |
| REQ-008 reviewer | REQ-012 |
| REQ-009 English to warrant | REQ-014, plus dictation |
| REQ-010 egress | REQ-006 (now P0) |
| REQ-011 delegation | REQ-016, with budget carve-out |
| REQ-012 evaluation | REQ-013, plus test authenticator and scripted agent |
| REQ-013 phone approval | REQ-019 |
| REQ-014 preview | Folded into the approval screen (Story 1) |
| REQ-015 hybrid search | REQ-018 |
| REQ-016 quorum, REQ-017 compensation | REQ-020, REQ-021 |
| not present | REQ-004 agent identity, REQ-015 voice, REQ-017 live agent, REQ-022 AP2 import |
