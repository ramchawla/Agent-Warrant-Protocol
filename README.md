# Agent Warrant Protocol

Don't give agents your keys. Give them a warrant.

A reference implementation of signed, enforceable authority for AI agents: a customer approves bounded terms with a passkey, a deterministic gate checks every agent action against those terms and records it in a hash-chained ledger, and institutions verify the customer's authority themselves. The full specification is [docs/PRD.md](docs/PRD.md).

Synthetic data only. No real accounts, customers, or money.

## Setup

Needs Node 22 or later and a MongoDB Atlas cluster.

```sh
npm install
cp .env.example .env            # then fill in the database URIs and secrets
npm run --silent keys >> .env   # appends the gate's Ed25519 key pair
npm run setup-db                # collections, validators, indexes, ledger genesis
```

`setup-db` is safe to re-run. It needs `createCollection`, `collMod` and `createIndex`, so for the demo databases run it with the admin user's URIs in `MONGODB_URI_GATE`, `MONGODB_URI_BANK` and `MONGODB_URI_FINTECH`; the `gate_app` user must never hold `collMod`. Database names are `awp_gate`, `awp_bank` and `awp_fintech`, each prefixed with `AWP_DB_PREFIX` (`max_`, `pro_`, `jackson_`; empty for the demo).

## Commands

| Command | What it does |
|---|---|
| `npm run dev:gate` | Gate on http://localhost:3000 (API, pages, `/vendor/`) |
| `npm run dev:bank` | Mock bank on http://localhost:4001 |
| `npm run dev:fintech` | Mock fintech on http://localhost:4002 |
| `npm test` | Type check, then every `test/**/*.test.ts` with `node:test` |
| `npm run setup-db` | Create collections, validators, indexes and the ledger genesis |
| `npm run keys` | Print a new gate key pair as `.env` lines |
| `npm run seed` | Seed demo users, agents and accounts (task 11) |
| `npm run agent` | Run the scripted agent (task 11) |
| `npm run eval` | Run the labelled evaluation set and print the numbers (task 11) |
| `npm run verify-chain` | Verify the ledger chain and institution anchors (task 5) |
| `npm run setup-search` | Create the ledger search indexes (task 16) |

Database tests skip with a message when `MONGODB_URI_GATE` is not set.

### Working on pages without a database

```sh
AWP_FIXTURES=1 REVIEWER_TOKEN=dev npm run dev:gate
curl -H "Authorization: Bearer dev" "http://localhost:3000/api/ledger?decision=deny"
curl -N "http://localhost:3000/api/stream?token=dev"
```

With `AWP_FIXTURES=1` the ledger routes serve `test/fixtures/events.json` (28 events, a valid signed chain), `/api/ledger/verify` answers a fixed result, and `/api/stream` replays the fixture events. Regenerate the file with `npx tsx test/fixtures/make-events.ts`.

## Contract notes

`src/shared/*`, `package.json` and `src/gate/server.ts` are frozen. These points are fixed there and are not spelled out in the PRD:

- **Imports** use the `.ts` extension: `import { jcs } from "../shared/canonical.ts"`.
- **Route modules** default-export `async function (app: FastifyInstance)`. `server.ts` registers all eight.
- **Auth hooks** are on the Fastify instance: `app.requireSession`, `app.requireReviewer`, `app.requireSessionOrReviewer`. Use them as `preHandler`. They set `req.userId` and `req.reviewer`.
- **Session:** after a verified passkey registration call `reply.startSession(userId)`. It sets the signed cookie `awp_session`.
- **Reviewer token:** `Authorization: Bearer <REVIEWER_TOKEN>`, or `?token=` for `EventSource`, which cannot set headers. With `REVIEWER_TOKEN` unset every reviewer route answers 401.
- **Errors:** throw an error with a `statusCode` property (for example 409 from `issueOptions`); Fastify answers with that status.
- **Database:** `src/gate/db.ts` exports `mongo()` and one typed accessor per collection (`warrants()`, `auditEvents()`, `meta()` and so on). The client connects on first use.
- **Hashes:** `hashJcs(value)` is `base64url(SHA-256(JCS(value)))`; `termsHash`, `actionHash` and `chainHash(prevHash, body)` build on it. `termsDigest(terms)` is the raw 32-byte WebAuthn challenge.
- **Signatures:** `ed25519Sign` and `ed25519Verify` take keys as base64url DER (PKCS#8 private, SPKI public) and sign the UTF-8 bytes of the message string: the event `hash` string for `gateSig` on events, `JCS(receipt)` for receipts.
- **Genesis:** the ledger head starts as `{_id: "ledger_head", seq: 0, hash: GENESIS_HASH}` in `meta`. There is no seq 0 document in `audit_events`; the first event is seq 1 with `prevHash = GENESIS_HASH`.
- **Idempotency index:** unique on `(warrantId, idempotencyKey)` for `DECISION` events that carry an `idempotencyKey`. A denial recorded before the key is trusted omits the key.
- **IDs:** `newId("wrt")` gives the prefix plus 24 hex characters. Prefixes: `usr`, `agt`, `wrt`, `dec`, `run`.
- **Enrollment:** `POST /enroll` carries `ENROLL_SECRET` in the `x-enroll-secret` header (`config.enrollHeader`); `credential.publicKey` is the base64url COSE public key.
- **Server-sent events:** message name `event` carries one `AuditEvent` as JSON; `warrant` carries one `WarrantDoc`.
- **Agent key hash:** `agents.keyHash` is `base64url(SHA-256(api key))`.

## Layout

File ownership is in PRD 8.3. Each stub file names its owner and task in its first line.
