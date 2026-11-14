# Agent Warrant: the story app

The interactive story a presenter clicks through for judges (plan: `docs/STORY-UI-PLAN.md`, backend contract: `docs/STORY-API.md`).

## Run

```sh
cd story
npm install
cp .env.example .env.local   # set VITE_REVIEWER_TOKEN for ledger / inspect / policies routes
npm run dev                  # http://localhost:5173
npm run build                # tsc + vite build
```

Vite proxies `/api` → `http://localhost:3000` (prefix kept), `/bank` → `http://localhost:4001` and `/fintech` → `http://localhost:4002` (prefix stripped).

`http://localhost:5173/#/kitchen` shows every shared component with sample data.

## Presenter keys

| Key | Does |
|---|---|
| → / Space | Next chapter (only once the current chapter is complete) |
| ← | Previous chapter |
| 0–9 | Jump to a chapter (always works, for rehearsals) |
| R | Reset the demo (`POST /api/demo/reset`) and return to chapter 0 |
| M | Toggle mock mode (a MOCK badge shows top right) |

Keys are ignored while typing in an input.

## Mock mode

`?mock=1` in the URL (`?mock=0` to turn off) or the `M` key; the choice persists in `localStorage`. In mock mode every function in `src/api.ts` returns `src/mocks/<functionName>.json` after 300 ms, and the Touch ID calls (`registerPasskey`, `approveWarrant`, `approvalOptionsAndVerify`) after 800 ms. The fixtures are placeholders in the contract shape; replace them with real recorded responses.

## Layout

- `src/api.ts`: the only module that talks to the backend. One typed function per route; errors are `ApiError { status, message }`.
- `src/types.ts`: the contract types.
- `src/store.tsx`: shared story state (`useStory`, `useResult`): warrant id, termsHash, latest `WarrantSummary`, results by chapter.
- `src/ChapterShell.tsx`: frame, keys, dot nav. **The chapter module shape is documented at the top of this file.**
- `src/components/`: `CodeCard`, `HashFlow`, `Stamp`, `Meter`, `AtlasCard`, `AgentBubble`, `Inspector`, `PrimaryButton`, `Shorten`, `util` (spring, `usd`, `useElapsed`, `typed`).
- `src/chapters/Ch0.tsx` … `Ch9.tsx`: one file per chapter; `index.ts` sets the order.

## Who owns what

| Owner | Files |
|---|---|
| S1 | `src/chapters/Ch0.tsx`–`Ch3.tsx` and their mocks |
| S2 | `src/chapters/Ch4.tsx`–`Ch6.tsx` and their mocks |
| S3 | `src/chapters/Ch7.tsx`–`Ch9.tsx` and their mocks |
| Max | everything else: shell, store, api, types, shared components |

Nobody edits the shared components, shell, store, `api.ts` or `types.ts` without telling Max first. Put chapter-only components in your chapter file (or `src/chapters/ChN.*.tsx`).
