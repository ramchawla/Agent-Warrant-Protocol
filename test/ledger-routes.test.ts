// Revoke, ledger queries, chain verification and the live stream (PRD task 9). Owner: Pro.
// Runs against MONGODB_URI_GATE (needs a replica set: transactions and change streams) in a throwaway database
// named <random prefix>awp_gate, created with the real validators from scripts/setup-db.ts.
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, describe, it } from "node:test";
import { MongoClient, type Collection } from "mongodb";
import type { AuditEvent, Terms, WarrantDoc } from "../src/shared/types.ts";

try {
  process.loadEnvFile();
} catch {
  // no .env; rely on the process environment
}

const mongoUri = process.env.MONGODB_URI_GATE;
const prefix = `routetest${randomBytes(3).toString("hex")}_`;
const keys = generateKeyPairSync("ed25519");
Object.assign(process.env, {
  AWP_DB_PREFIX: prefix,
  AWP_FIXTURES: "0",
  REVIEWER_TOKEN: "pro-test-reviewer-token",
  SESSION_SECRET: "pro-test-session-secret",
  GATE_ED25519_PRIVATE_KEY: keys.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url"),
  GATE_ED25519_PUBLIC_KEY: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
});

const { buildServer } = await import("../src/gate/server.ts");
const dbm = await import("../src/gate/db.ts");
const ledger = await import("../src/gate/ledger.ts");
const { setupGate } = await import("../scripts/setup-db.ts");
const { newId, newNonce } = await import("../src/shared/ids.ts");
const { termsHash } = await import("../src/shared/canonical.ts");

const fixtures: AuditEvent[] = JSON.parse(readFileSync(new URL("./fixtures/events.json", import.meta.url), "utf8"));
const reviewer = { authorization: "Bearer pro-test-reviewer-token" };

function makeWarrant(userId: string, status: WarrantDoc["state"]["status"], parent?: WarrantDoc): WarrantDoc {
  const warrantId = newId("wrt");
  const terms: Terms = {
    v: 1,
    warrantId,
    userId,
    agentId: "agt_route_test",
    parentWarrantId: parent?._id ?? null,
    scope: {
      actions: ["kyc.refresh", "payment.create"],
      accounts: ["A1"],
      merchants: ["M1"],
      destinations: ["bank", "fintech"],
      fields: { "kyc.refresh": ["account", "fields"], "payment.create": ["fromAccount", "merchant", "amountCents", "currency", "memo"], "data.export": [] },
    },
    currency: "CAD",
    perActionMaxCents: 5000,
    totalLimitCents: 12000,
    notBefore: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    nonce: newNonce(),
  };
  return {
    _id: warrantId,
    terms,
    termsHash: termsHash(terms),
    approval: null,
    state: { status, remainingCents: terms.totalLimitCents, actionCount: 0 },
    ancestors: parent ? [...parent.ancestors, parent._id] : [],
    expiresAt: new Date(terms.expiresAt),
    createdAt: new Date(),
  };
}

// Reads a server-sent event stream; one pending read at a time so no chunk is ever dropped.
async function openStream(url: string, headers: Record<string, string>) {
  const abort = new AbortController();
  const res = await fetch(url, { headers, signal: abort.signal });
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let pending: ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]> | undefined;
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    async waitFor(done: (text: string) => boolean, ms = 15_000): Promise<string> {
      const deadline = Date.now() + ms;
      while (!done(text)) {
        if (!reader) throw new Error("no body");
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`timed out; received so far: ${JSON.stringify(text)}`);
        pending ??= reader.read();
        const got = await Promise.race([pending, sleep(left).then(() => null)]);
        if (got === null) continue;
        pending = undefined;
        if (got.done) throw new Error(`stream ended; received: ${JSON.stringify(text)}`);
        text += decoder.decode(got.value);
      }
      return text;
    },
    close: () => abort.abort(),
  };
}
const messages = (text: string, name: string): any[] =>
  [...text.matchAll(new RegExp(`(?:id: (\\d+)\\n)?event: ${name}\\ndata: (.*)\\n\\n`, "g"))].map((m) => JSON.parse(m[2]!));

describe("ledger routes, revoke and stream against MongoDB", { skip: mongoUri ? false : "MONGODB_URI_GATE is not set" }, () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let admin: MongoClient;
  let audit: Collection<AuditEvent>;

  const appendInTxn = async (event: Parameters<typeof ledger.appendEvent>[1]) => {
    const session = dbm.mongo().startSession();
    try {
      return await session.withTransaction(() => ledger.appendEvent(session, event));
    } finally {
      await session.endSession();
    }
  };
  const get = async (query: string) => (await app.inject({ url: `/api/ledger?${query}`, headers: reviewer })).json();

  before(async () => {
    admin = new MongoClient(mongoUri!);
    const db = admin.db(`${prefix}awp_gate`);
    audit = db.collection("audit_events");
    await setupGate(db);
    // Seed the ledger with the fixture events (valid, realistic shapes) through the real appendEvent.
    for (const fixture of fixtures) {
      const { _id, seq, ts, prevHash, hash, gateSig, policyVersion, ...event } = fixture;
      await appendInTxn(event);
    }
    app = await buildServer();
    await app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  });

  after(async () => {
    await app?.close();
    try {
      await admin.db(`${prefix}awp_gate`).dropDatabase();
    } catch {
      // the random prefix keeps leftovers out of the way
    }
    await admin.close();
    await dbm.closeDb();
  });

  describe("GET /api/ledger", () => {
    it("requires the reviewer token", async () => {
      assert.equal((await app.inject({ url: "/api/ledger" })).statusCode, 401);
      assert.equal((await app.inject({ url: "/api/ledger", headers: { authorization: "Bearer nope" } })).statusCode, 401);
      assert.equal((await app.inject({ url: "/api/ledger?token=pro-test-reviewer-token" })).statusCode, 200);
    });

    it("returns every event in seq order, matching what was appended", async () => {
      const { events } = await get("");
      assert.deepEqual(events.map((e: AuditEvent) => e.seq), fixtures.map((e) => e.seq));
      assert.deepEqual(events.map((e: AuditEvent) => e.summary), fixtures.map((e) => e.summary));
    });

    it("each filter returns the same events as filtering the fixtures", async () => {
      const queries: Array<[string, (e: AuditEvent) => boolean]> = [
        ["account=A9&decision=deny", (e) => e.action?.account === "A9" && e.decision === "deny"],
        ["decision=deny", (e) => e.decision === "deny"],
        ["decision=allow", (e) => e.decision === "allow"],
        ["reasonCode=BUDGET_EXHAUSTED", (e) => e.reasonCode === "BUDGET_EXHAUSTED"],
        ["runId=run_injection_03", (e) => e.runId === "run_injection_03"],
        [`warrantId=${fixtures[0]!.warrantId}`, (e) => e.warrantId === fixtures[0]!.warrantId],
        ["q=COLLECTOR.example", (e) => e.summary.toLowerCase().includes("collector.example")],
        ["afterSeq=20", (e) => e.seq > 20],
        ["runId=run_injection_03&decision=deny&afterSeq=10", (e) => e.runId === "run_injection_03" && e.decision === "deny" && e.seq > 10],
        ["runId=&decision=&q=", () => true],
      ];
      for (const [query, predicate] of queries) {
        const { events } = await get(query);
        const expected = fixtures.filter(predicate).map((e) => e.seq);
        assert.ok(expected.length > 0 || query.includes("afterSeq=10"), `fixture query ${query} should match something`);
        assert.deepEqual(events.map((e: AuditEvent) => e.seq), expected, query);
      }
    });

    it("treats the search text literally, not as a pattern or an operator", async () => {
      assert.deepEqual((await get("q=.*")).events, []);
      assert.deepEqual((await get("q=[a-z]%2B")).events, []);
      const paren = await app.inject({ url: "/api/ledger?q=(", headers: reviewer });
      assert.equal(paren.statusCode, 200, "an unbalanced bracket must not become a regex error");
      assert.deepEqual(paren.json().events.map((e: AuditEvent) => e.seq), fixtures.filter((e) => e.summary.includes("(")).map((e) => e.seq));
      // Bracket syntax is not parsed into an object, so an operator cannot be smuggled in: the key is just ignored.
      const smuggled = await app.inject({ url: "/api/ledger?q[$ne]=x", headers: reviewer });
      assert.equal(smuggled.statusCode, 200);
      assert.equal(smuggled.json().events.length, (await get("")).events.length);
    });

    it("rejects bad parameters", async () => {
      for (const query of ["decision=maybe", "afterSeq=-1", "afterSeq=abc", "afterSeq=1.5", `q=${"x".repeat(201)}`, "runId=a&runId=b"]) {
        assert.equal((await app.inject({ url: `/api/ledger?${query}`, headers: reviewer })).statusCode, 400, query);
      }
    });
  });

  describe("POST /api/warrants/:id/revoke", () => {
    const owner = newId("usr");
    const post = (id: string, headers: Record<string, string> = reviewer) => app.inject({ method: "POST", url: `/api/warrants/${id}/revoke`, headers, payload: {} });

    it("revokes the warrant and its children with one REVOKED event, and leaves other warrants alone", async () => {
      const parent = makeWarrant(owner, "active");
      const child = makeWarrant(owner, "active", parent);
      const grandchild = makeWarrant(owner, "pending", child);
      const other = makeWarrant(owner, "active");
      await dbm.warrants().insertMany([parent, child, grandchild, other]);
      const before = await audit.countDocuments();

      const res = await post(parent._id);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { revoked: 3 });

      const states = await dbm.warrants().find({ _id: { $in: [parent._id, child._id, grandchild._id, other._id] } }).toArray();
      const byId = new Map(states.map((w) => [w._id, w]));
      for (const w of [parent, child, grandchild]) {
        assert.equal(byId.get(w._id)!.state.status, "revoked");
        assert.equal(byId.get(w._id)!.state.revokedBy, "reviewer");
        assert.ok(byId.get(w._id)!.state.revokedAt);
      }
      assert.equal(byId.get(other._id)!.state.status, "active");
      assert.equal(byId.get(child._id)!.terms.userId, owner, "terms are never touched");

      assert.equal(await audit.countDocuments(), before + 1);
      const event = (await audit.find({}).sort({ _id: -1 }).limit(1).next())!;
      assert.equal(event.type, "REVOKED");
      assert.equal(event.warrantId, parent._id);
      assert.equal(event.termsHash, parent.termsHash);
      assert.equal(event.summary, `Warrant ${parent._id} revoked by the reviewer; 3 warrants stopped.`);

      // The gate's atomic update (PRD 8.6) no longer matches, so the next action is denied.
      const spend = await dbm.warrants().findOneAndUpdate(
        { _id: child._id, "state.status": "active", expiresAt: { $gt: new Date() }, "state.remainingCents": { $gte: 1000 } },
        { $inc: { "state.remainingCents": -1000 } },
      );
      assert.equal(spend, null);
    });

    it("is idempotent: a second revoke changes nothing and adds no event", async () => {
      const w = makeWarrant(owner, "active");
      await dbm.warrants().insertOne(w);
      assert.deepEqual((await post(w._id)).json(), { revoked: 1 });
      const count = await audit.countDocuments();
      assert.deepEqual((await post(w._id)).json(), { revoked: 0 });
      assert.equal(await audit.countDocuments(), count);
    });

    it("lets the owner revoke with a session, and records the user", async () => {
      const w = makeWarrant(owner, "active");
      await dbm.warrants().insertOne(w);
      const cookie = `awp_session=${app.signCookie(owner)}`;
      const res = await post(w._id, { cookie });
      assert.deepEqual(res.json(), { revoked: 1 });
      assert.equal((await dbm.warrants().findOne({ _id: w._id }))!.state.revokedBy, owner);
      assert.match((await audit.find({}).sort({ _id: -1 }).limit(1).next())!.summary, new RegExp(`revoked by user ${owner}; 1 warrant stopped\\.$`));
    });

    it("refuses another user, an anonymous caller, an unknown warrant and a malformed id", async () => {
      const w = makeWarrant(owner, "active");
      await dbm.warrants().insertOne(w);
      const stranger = `awp_session=${app.signCookie(newId("usr"))}`;
      assert.equal((await post(w._id, { cookie: stranger })).statusCode, 403);
      assert.equal((await post(w._id, {})).statusCode, 401);
      assert.equal((await post(newId("wrt"))).statusCode, 404);
      assert.equal((await post("not-a-warrant")).statusCode, 400);
      assert.equal((await dbm.warrants().findOne({ _id: w._id }))!.state.status, "active");
    });

    it("racing revokes on one warrant produce exactly one change and one event", async () => {
      const w = makeWarrant(owner, "active");
      await dbm.warrants().insertOne(w);
      const count = await audit.countDocuments();
      const results = await Promise.all(Array.from({ length: 5 }, () => post(w._id)));
      assert.deepEqual(results.map((r) => r.json().revoked).sort(), [0, 0, 0, 0, 1]);
      assert.equal(await audit.countDocuments(), count + 1);
    });
  });

  describe("GET /api/ledger/verify", () => {
    it("verifies the chain, including the events revoke appended, in the contract shape", async () => {
      const res = await app.inject({ url: "/api/ledger/verify", headers: reviewer });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.ok, true);
      assert.equal(body.checked, await audit.countDocuments());
      assert.deepEqual(Object.keys(body.anchors).sort(), ["bank", "fintech"]);
      for (const a of Object.values<any>(body.anchors)) assert.equal(typeof a.ok, "boolean");
      assert.equal((await app.inject({ url: "/api/ledger/verify" })).statusCode, 401);
    });

    it("reports the first broken sequence number after an edit", async () => {
      await audit.updateOne({ _id: 7 }, { $set: { summary: "edited in Compass" } });
      const body = (await app.inject({ url: "/api/ledger/verify", headers: reviewer })).json();
      assert.equal(body.ok, false);
      assert.equal(body.firstBrokenSeq, 7);
      assert.ok(body.reason);
    });
  });

  describe("GET /api/stream", () => {
    it("requires the reviewer token", async () => {
      assert.equal((await app.inject({ url: "/api/stream" })).statusCode, 401);
    });

    it("pushes a new ledger event and a warrant change to a connected client", async () => {
      const stream = await openStream(`${baseUrl}/api/stream`, reviewer);
      try {
        assert.equal(stream.status, 200);
        assert.match(stream.contentType ?? "", /text\/event-stream/);
        await stream.waitFor((t) => t.includes(": connected"));

        const appended = await appendInTxn({ type: "DECISION", warrantId: "wrt_stream", termsHash: "t", agentId: "agt_s", runId: "run_stream", decision: "deny", reasonCode: "ACCOUNT_NOT_ALLOWED", decisionId: newId("dec"), idempotencyKey: "stream-1", action: { type: "kyc.refresh", destination: "bank", account: "A9", fieldNames: ["account"], fieldSizes: { account: 2 } }, actionHash: "A".repeat(43), summary: "Denied kyc.refresh on account A9 at bank (ACCOUNT_NOT_ALLOWED)." });
        const w = makeWarrant(newId("usr"), "pending");
        await dbm.warrants().insertOne(w);
        await dbm.warrants().updateOne({ _id: w._id }, { $set: { "state.status": "active" } });

        const text = await stream.waitFor((t) => messages(t, "event").some((e) => e.seq === appended.seq) && messages(t, "warrant").some((x) => x._id === w._id && x.state.status === "active"));
        const received = messages(text, "event").find((e) => e.seq === appended.seq);
        assert.equal(received.summary, appended.summary);
        assert.match(text, new RegExp(`id: ${appended.seq}\\nevent: event\\n`));
      } finally {
        stream.close();
      }
    });

    it("replays the events a reconnecting client missed, once, in order, then continues live", async () => {
      const last = (await audit.find({}).sort({ _id: -1 }).limit(1).next())!.seq;
      const missed = [await appendInTxn({ type: "REVOKED", warrantId: null, termsHash: null, agentId: null, runId: null, summary: "missed one" }), await appendInTxn({ type: "REVOKED", warrantId: null, termsHash: null, agentId: null, runId: null, summary: "missed two" })];
      const stream = await openStream(`${baseUrl}/api/stream`, { ...reviewer, "last-event-id": String(last) });
      try {
        await stream.waitFor((t) => t.includes(": connected"));
        const live = await appendInTxn({ type: "REVOKED", warrantId: null, termsHash: null, agentId: null, runId: null, summary: "live one" });
        const text = await stream.waitFor((t) => messages(t, "event").some((e) => e.seq === live.seq));
        assert.deepEqual(messages(text, "event").map((e) => e.seq), [missed[0]!.seq, missed[1]!.seq, live.seq]);
      } finally {
        stream.close();
      }
    });

    it("lets the server shut down while a client is still connected", async () => {
      const stream = await openStream(`${baseUrl}/api/stream`, reviewer);
      await stream.waitFor((t) => t.includes(": connected"));
      // app.close() runs in the after hook; reaching it with this stream open is the check.
      stream.close();
    });
  });
});
