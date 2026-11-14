// Gate server in fixtures mode: no database needed.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";

process.env.AWP_FIXTURES = "1";
process.env.REVIEWER_TOKEN = "test-reviewer-token";
const { buildServer } = await import("../src/gate/server.ts");

const auth = { authorization: "Bearer test-reviewer-token" };
let app: FastifyInstance;
before(async () => {
  app = await buildServer();
});
after(() => app.close());

test("GET /api/ledger serves the fixture events to a reviewer", async () => {
  const res = await app.inject({ url: "/api/ledger", headers: auth });
  assert.equal(res.statusCode, 200);
  const { events } = res.json();
  assert.ok(events.length >= 25);
  assert.equal(events[0].seq, 1);
  assert.equal(events[0].type, "WARRANT_CREATED");
});

test("ledger routes refuse callers without the reviewer token", async () => {
  assert.equal((await app.inject({ url: "/api/ledger" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/ledger", headers: { authorization: "Bearer wrong" } })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/ledger/verify" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/stream" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/ledger?token=test-reviewer-token" })).statusCode, 200);
});

test("ledger filters", async () => {
  const get = async (query: string) => (await app.inject({ url: `/api/ledger?${query}`, headers: auth })).json().events;
  const a9 = await get("account=A9&decision=deny");
  assert.equal(a9.length, 1);
  assert.equal(a9[0].reasonCode, "ACCOUNT_NOT_ALLOWED");
  assert.ok((await get("reasonCode=BUDGET_EXHAUSTED")).length === 1);
  assert.ok((await get("runId=run_injection_03")).every((e: { decision: string }) => e.decision === "deny"));
  assert.ok((await get("q=COLLECTOR.example")).length >= 2);
  assert.ok((await get("afterSeq=20")).every((e: { seq: number }) => e.seq > 20));
});

test("GET /api/ledger/verify answers in the contract shape", async () => {
  const body = (await app.inject({ url: "/api/ledger/verify", headers: auth })).json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.checked, "number");
  assert.deepEqual(Object.keys(body.anchors).sort(), ["bank", "fintech"]);
});

test("session routes refuse callers without a session cookie", async () => {
  assert.equal((await app.inject({ method: "POST", url: "/api/warrants", payload: {} })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/warrants", payload: {}, headers: { cookie: "awp_session=usr_forged" } })).statusCode, 401);
});

test("static pages and the WebAuthn browser bundle are served", async () => {
  for (const url of ["/", "/approve.html", "/reviewer.html", "/app.js"]) {
    assert.equal((await app.inject({ url })).statusCode, 200, url);
  }
  const bundle = await app.inject({ url: "/vendor/index.umd.min.js" });
  assert.equal(bundle.statusCode, 200);
  assert.match(bundle.body, /SimpleWebAuthnBrowser/);
});
