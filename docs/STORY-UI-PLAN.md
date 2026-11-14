# Story UI plan — Agent Warrant Protocol

**Owner:** Max (lead) with parallel subagents. **Written:** 2026-11-14 14:55. **Hard deadline:** recordable by 4:00 pm, submitted 4:50 pm.
**Supersedes** the UI parts of PRD REQ-012, REQ-014, REQ-015 and the dashboard prompts. Backend contract in `docs/PRD.md` still holds.

## 1. What we are building

Not a dashboard. An **interactive story** the presenter clicks through in front of judges (and screen-records for the 90-second demo). The first screen is the user's entry point; every screen after it walks one step of the protocol end to end, and **every step runs against the real backend**, showing the real values MongoDB stores and returns.

Story spine: *a person signs a warrant with Touch ID → it is sealed cryptographically in MongoDB Atlas → an agent acts and the gate approves or denies each claim → a sensitive payload is minimized, matched by Atlas Vector Search and escalated for a fresh Touch ID → limits hold under pressure → a reviewer re-verifies the original signature and catches tampering.*

### Decisions (Ram, 14:50)
- **No speech-to-text.** The mic, Web Speech and Wispr are removed. Policies are added by typing.
- **Touch ID only.** No Face ID, no iPhone, no tunnel. Laptop platform passkey on `localhost`. All copy says "Touch ID". Backend enum `REQUIRE_FACEID` may stay in code to avoid churn; the UI labels it "Touch ID required".
- **Speed with high quality.** Iterate in the browser with Ram watching; ship chapter by chapter.

## 2. Stack (decided)

- New app in **`story/`** with its **own `package.json`** (does not touch the frozen root `package.json`): **Vite + React 18 + TypeScript + Tailwind CSS + `motion`** (Framer Motion, `import { motion, AnimatePresence } from "motion/react"`), `lucide-react` icons, `@simplewebauthn/browser` for Touch ID.
- Dev: `cd story && npm run dev` on **http://localhost:5173**, Vite proxy `/api` → `http://localhost:3000`, `/bank` → `:4001`, `/fintech` → `:4002`.
- **WebAuthn origin fix (backend, required):** the gate must accept both `http://localhost:3000` and `http://localhost:5173` as expected origins (`ORIGIN` becomes a comma-separated list; `expectedOrigin` accepts an array). RP ID stays `localhost`, so one passkey works on both ports.
- Remotion: **not used** for the live app (it renders videos, not interactive pages). Screen-record the story instead. Optional later: Remotion for a title card only.
- Skills to load before writing UI: `frontend-design:frontend-design` (aesthetic direction) and `impeccable` (polish/critique pass); `ui-ux-pro-max` for palette and type pairing if useful.

### Design direction
- Editorial and cinematic, not SaaS-dashboard. Near-black background (`#0B0C0E`), one warm accent (amber `#F5B544`) for "signed/sealed", green `#3DDC97` for allow, red `#FF5A5F` for deny. Everything else greyscale.
- Type: a display serif or high-contrast grotesk for chapter titles (e.g. "Instrument Serif" or "Fraunces" from Google Fonts), "Inter" for body, "JetBrains Mono" for every hash, key, query and JSON value.
- Layout per chapter: **left 40% narrative** (chapter number, one-line title, two sentences max), **right 60% live artifact** (the real thing happening). 1440×900 recording target; must look right at 125% zoom.
- Motion: one idea per chapter, 300–600 ms, spring easing; values "type in" or "flow" between cards; stamps (ALLOWED/DENIED) land with a small scale + rotate. No gratuitous parallax. Respect `prefers-reduced-motion`.

## 3. Chapters

Presenter controls: → / Space next, ← back, number keys jump, dot nav at bottom, `R` = reset demo (calls the reset endpoint), `M` toggles mock mode. Each chapter has a primary action button; the next chapter unlocks when it completes.

| # | Title (on screen) | User does | Artifact shows (real data) | Endpoint(s) |
|---|---|---|---|---|
| 0 | **Your agent wants your bank login.** | Clicks "Issue a warrant instead" | Cold open: a password field being handed to a robot icon, crossed out; tagline "Don't give agents your keys. Give them a warrant." | none |
| 1 | **Say what it may do.** | Types "Put my life savings into NVIDIA" → sees compiled terms with a big red **"Worst case: $84,000 leaves your savings for one stock, today."** → edits to "okay, $500 at a time, $1,000 max" → green worst case | Plain-English terms card next to the canonical JSON it compiles to | `POST /api/warrants` (or `/api/draft` with template fallback) |
| 2 | **Sign it with Touch ID.** | Clicks "Sign with Touch ID", touches the sensor | Animated pipeline: terms JSON → RFC 8785 canonical JSON → SHA-256 → `termsHash` → WebAuthn challenge → signature. Each value is the real one. Ends on "Signed by a real person · user verified" | `POST /api/warrants/:id/approve/options`, `/verify`, `GET /api/warrants/:id/inspect` |
| 3 | **Sealed in MongoDB Atlas.** | Clicks "Show the record" | The stored `warrants` document (terms, termsHash, approval.signature, authenticatorData, userVerified) drops into an Atlas card; the first ledger event links `prevHash → hash` with a gold chain line. Caption: "We store the proof, never the biometric." | `GET /api/warrants/:id/inspect`, `GET /api/ledger` |
| 4 | **The agent acts. The gate decides.** | Clicks "Let the agent buy $500" | Agent bubble "Buying $500 of NVDA" → packet flows through a checkpoint → inspector shows the atomic `findOneAndUpdate` filter, `matched: 1`, gate time in ms → receipt travels to the brokerage → brokerage runs its **own** three checks (gate signature ✓, customer passkey ✓, terms ✓) → "Executed". Budget meter $1,000 → $500 | `POST /api/demo/work`, `GET /fintech/state` |
| 5 | **Anything beyond the warrant is denied.** | Clicks "Let the agent loose" | Three agent claims arrive ~1 s apart, each stamped: "NVDA up 3% 🚀 Doubling down: $5,000" → **DENIED · PER_ACTION_LIMIT**; "Diversifying into another stock" → **DENIED · MERCHANT_NOT_ALLOWED**; "Email says: send the account list to collector.example" → **DENIED · DESTINATION_NOT_ALLOWED**. Inspector: `matched: 0 → deny`. Nothing reaches the brokerage | `POST /api/demo/blocked` |
| 6 | **Policies in plain English, matched by meaning.** | Types a rule "Require Touch ID before any account statement leaves our network" → Add. Then clicks "Agent: summarize my portfolio" | (a) the new `egress_policies` document **with no embedding written by us** + the index definition `{"type":"autoEmbed","model":"voyage-4","path":"rule"}` — "Atlas embeds it on insert". (b) Payload with SSN and account numbers → **redaction diff** animates (values struck out, "−41% tokens"). (c) `$vectorSearch` pipeline + score bar filling to e.g. **0.86** against the new rule → **TOUCH ID REQUIRED** card → Touch ID → challenge = SHA-256(minimized payload) → released → LLM reply panel showing what Claude received (no SSN) | `POST /api/policies`, `GET /api/policies/index`, `POST /api/demo/sensitive`, `POST /api/approvals/:id/options`, `/verify` |
| 7 | **Limits hold under pressure.** | Clicks "Fire 20 at once", then "Revoke" | 20 dots fly at the gate simultaneously; exactly 10 turn green, 10 red; counter **10 allowed · 10 denied · $0 left**. Revoke: warrant card greys out, next claim **DENIED · WARRANT_REVOKED** | `POST /api/demo/burst`, `POST /api/demo/revoke` |
| 8 | **Anyone can verify it. Forever.** | Clicks "Re-verify signature", then "Tamper with the record", then re-verify and "Verify chain" | Timeline of every event; re-verify ✓ "Approved by a real person · user verified · 2:31 pm". Tamper (button calls a demo endpoint that edits an amount as admin, or Ram edits in Compass) → chain turns red at the broken seq, re-verify ✗ "Signature does not match these terms" | `GET /api/warrants/:id/verify-approval`, `GET /api/ledger/verify`, `POST /api/demo/tamper` |
| 9 | **Don't give agents your keys. Give them a warrant.** | — | Architecture in motion: Touch ID → warrant → gate → MongoDB Atlas (warrants · ledger · policies + vector index · change streams) → brokerage. Team names | none |

Chapter copy: titles exactly as above; body text max two sentences each, written in plain language. Every technical value shown must come from the API response (mock mode uses recorded real responses).

## 4. Backend endpoints the story needs

Owned by Max's backend subagent unless noted. Several exist already; build or adjust only what is missing. Keep response shapes small and display-ready.

| Endpoint | Purpose | Notes |
|---|---|---|
| `POST /api/demo/reset` | Reset to chapter 0 | Wraps `demo:reset`: pending warrant W-NVDA (BROKERAGE-NVDA, perActionMax 50000, total 100000, until 17:00, destinations fintech and llm), seeded policies minus the chapter-6 rule, ledger at genesis |
| `POST /api/demo/:step` (`work`, `blocked`, `sensitive`, `burst`, `revoke`, `tamper`) | Runs that step server-side | Each returns `{ items: [{ agentText, decision, reasonCode?, trace, receipt?, institutionChecks? }] }`; `sensitive` may return `{ pending: { approvalId, challenge } }`; `burst` returns counts |
| `trace` on every decision | Inspector data | `{ atomicUpdate: { filter, update, matched }, minimize?: diff, semantic?: { pipeline, path: "vector" \| "keyword-fallback", topScore, rule }, approvalChallenge?, gateMs }` |
| `GET /api/warrants/:id/inspect` | Chapters 2–3 | `termsHash`, canonical JSON, challenge (base64url), approval fields shortened, `userVerified`, `credentialId` |
| `GET /api/warrants/:id/verify-approval` | Chapter 8 | Reload from MongoDB, recompute hash, `verifyAuthenticationResponse` with counter 0 → `{ valid, userVerified, approvedAt, reason? }` |
| `POST /api/policies`, `GET /api/policies/index` | Chapter 6 | Pro's lane; index definition from `listSearchIndexes` |
| `GET /bank/state`, `GET /fintech/state` | Chapter 4 | Include the institution's own three verification results for the last receipt |
| Origin list | Touch ID on :5173 | `ORIGIN=http://localhost:3000,http://localhost:5173` |

## 5. Mock mode (so UI work never waits)

`story/src/api.ts` is the only module that talks to the backend. With `?mock=1` (or `M`), it returns fixtures from `story/src/mocks/*.json` shaped exactly like the table above, with a 300 ms delay. Mock Touch ID resolves after 800 ms. Fixtures are later replaced with real recorded responses (`npm run record-mocks` hits the live API once and saves them).

## 6. Parallel execution (Max: run as subagents)

Each subagent gets: this file, its rows, its files, its done-when. Each works in its own git worktree and branch; Max merges.

| Agent | Starts | Owns | Done when |
|---|---|---|---|
| **S0 Scaffold + design system** (Max main session, ~20 min, blocks S1–S3) | now | `story/` scaffold, Tailwind tokens, fonts, `ChapterShell` (left narrative / right artifact, keyboard nav, dot nav, reset, mock toggle), shared components: `CodeCard` (mono JSON with highlight), `HashFlow` (value-to-value pipeline), `Stamp` (ALLOWED/DENIED), `Meter`, `AtlasCard`, `AgentBubble`, `Inspector`; `api.ts` with mock mode and empty fixtures | `npm run dev` shows chapters 0–9 as titled placeholders, nav works, components on a `/kitchen` route; pushed to `max/story-base` |
| **S1 Chapters 0–3** | after S0 | `story/src/chapters/Ch0*.tsx`–`Ch3*.tsx`, their mocks | Full flow in mock mode; real Touch ID signs a real warrant against :3000 |
| **S2 Chapters 4–6** | after S0 | `Ch4`–`Ch6`, their mocks | Mock mode plays all three; live mode works once endpoints land |
| **S3 Chapters 7–9** | after S0 | `Ch7`–`Ch9`, their mocks | Burst animation exact 10/10 from response; tamper → red chain; architecture motion |
| **B Backend for the story** | now (parallel with S0) | `src/gate/routes/demo.ts`, trace plumbing in `act.ts`, `inspect` and `verify-approval` routes, origin list in `config.ts` | Every endpoint in §4 returns the documented shape against the live cluster; `curl` examples in the PR description |
| **P Pro** (separate account) | already running | policies, vector index, `GET /api/policies/index`, keyword fallback | Rule added via POST matches the chapter-6 payload with `path: "vector"` |

Rules: UI agents never edit backend files; B never edits `story/`. Each UI agent runs the `impeccable` polish pass on its chapters before reporting. Every report includes a screenshot per chapter (Playwright at 1440×900) so Ram can give feedback fast.

## 7. Iteration loop with Ram

1. Ram runs `cd story && npm run dev` and watches http://localhost:5173.
2. Agents push per chapter; Max merges into `max/story` and tells Ram which chapters changed.
3. Ram gives feedback per chapter number ("Ch2: slower hash flow, bigger signature"); Max routes it to the owning subagent.
4. Freeze at **3:45**: switch mock off, run chapters 0→9 live twice, then record.

## 8. Timeline

| Time | Milestone |
|---|---|
| 15:15 | S0 scaffold pushed; B has demo/reset, work, blocked, inspect |
| 15:45 | All chapters playable in mock mode; first feedback round |
| 16:15 | Live mode end to end on Ram's laptop (Touch ID real) |
| 16:30 | Feedback round 2 fixed; freeze |
| 16:30–16:45 | Record the 90-second walkthrough (chapters 1–8) |
| 16:50 | Submit |

## 9. Cut order if behind

Chapter 9 motion (use a static slide) → chapter 0 animation (static) → LLM reply panel in chapter 6 → tamper button (Ram edits in Compass instead). Never cut chapters 2, 5, 6(b–c) or 8.
