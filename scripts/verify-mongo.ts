// Checks each MongoDB claim live against the cluster and prints a PASS/FAIL table.
// a-h run in a throwaway database (dropped at the end); i-j read the demo gate database.
//   npm run verify:mongo
import { MongoClient, type ClientSession } from "mongodb";
import { config, need } from "../src/shared/config.ts";
import { auditEvents, challenges, closeDb, db, meta, mongo, warrants } from "../src/gate/db.ts";
import { appendEvent, verifyChain, withLedgerLock, type NewEvent } from "../src/gate/ledger.ts";
import { addPolicy, lastTrace, policies, semanticCheck } from "../src/gate/policies.ts";
import { setupGate } from "./setup-db.ts";

const rows: { id: string; claim: string; ok: boolean; detail: string }[] = [];
async function check(id: string, claim: string, fn: () => Promise<string>): Promise<void> {
  try {
    rows.push({ id, claim, ok: true, detail: await fn() });
  } catch (e) {
    rows.push({ id, claim, ok: false, detail: (e as Error).message.slice(0, 160) });
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const code = async (p: Promise<unknown>): Promise<number | string> => p.then(() => "no error", (e: { code?: number }) => e.code ?? "error");

const demoDb = "awp_gate"; // the unprefixed demo database, whatever AWP_DB_PREFIX says
// ponytail: config is only `as const` at the type level; repointing it moves every gate helper to the throwaway db.
(config.dbName as { gate: string }).gate = `verify_${Date.now()}_awp_gate`;
await setupGate(db());

const now = Date.now();
const H = "x".repeat(43);
const warrant = (id: string, remainingCents = 10000) => ({
  _id: id,
  terms: {
    v: 1, warrantId: id, userId: "usr_verify", agentId: "agt_verify", parentWarrantId: null,
    scope: { actions: ["payment.create"], accounts: [], merchants: [], destinations: ["fintech"], fields: {} },
    currency: "CAD", perActionMaxCents: 1000, totalLimitCents: 10000,
    notBefore: new Date(now).toISOString(), expiresAt: new Date(now + 3600e3).toISOString(), nonce: "n",
  },
  termsHash: H, approval: null, state: { status: "active", remainingCents, actionCount: 0 }, ancestors: [],
  expiresAt: new Date(now + 3600e3), createdAt: new Date(),
}) as never;
let n = 0;
const event = (warrantId: string, extra: Partial<NewEvent> = {}): NewEvent =>
  ({ type: "DECISION", warrantId, termsHash: H, agentId: "agt_verify", runId: "run_verify", decisionId: `dec_v${++n}`, decision: "allow", summary: "verify", ...extra }) as NewEvent;
async function tx(work: (s: ClientSession) => Promise<void>): Promise<void> {
  const session = mongo().startSession();
  try {
    await withLedgerLock(() => session.withTransaction(work));
  } finally {
    await session.endSession();
  }
}
const decrement = (s: ClientSession | undefined, id: string) =>
  warrants().updateOne({ _id: id, "state.remainingCents": { $gte: 1000 } }, { $inc: { "state.remainingCents": -1000, "state.actionCount": 1 } }, { session: s });

await check("a", "transaction commits decrement + ledger event together; abort leaves neither", async () => {
  await warrants().insertOne(warrant("wrt_tx"));
  const ok = event("wrt_tx");
  await tx(async (s) => {
    await decrement(s, "wrt_tx");
    await appendEvent(s, ok);
  });
  const bad = event("wrt_tx");
  const aborted = await tx(async (s) => {
    await decrement(s, "wrt_tx");
    await appendEvent(s, bad);
    throw new Error("abort on purpose");
  }).then(() => false, () => true);
  const left = (await warrants().findOne({ _id: "wrt_tx" }))!.state.remainingCents;
  assert(left === 9000 && (await auditEvents().countDocuments({ decisionId: ok.decisionId })) === 1, `commit: remaining ${left}`);
  assert(aborted && (await auditEvents().countDocuments({ decisionId: bad.decisionId })) === 0, "aborted event persisted");
  return "commit 10000->9000 +1 event; abort: 9000, 0 events";
});

await check("b", "20 parallel $10 decrements on $100 -> exactly 10 succeed", async () => {
  await warrants().insertOne(warrant("wrt_race"));
  const res = await Promise.all(Array.from({ length: 20 }, () => decrement(undefined, "wrt_race")));
  const won = res.filter((r) => r.modifiedCount === 1).length;
  const left = (await warrants().findOne({ _id: "wrt_race" }))!.state.remainingCents;
  assert(won === 10 && left === 0, `${won} succeeded, remaining ${left}`);
  return `10/20 succeeded, remaining 0`;
});

await check("c", "$jsonSchema rejects malformed warrant and remainingCents < 0", async () => {
  const malformed = await code(warrants().insertOne({ _id: "wrt_bad", terms: { v: 2 } } as never));
  const negative = await code(warrants().updateOne({ _id: "wrt_race" }, { $set: { "state.remainingCents": -1 } }));
  assert(malformed === 121 && negative === 121, `malformed -> ${malformed}, negative -> ${negative}`);
  return "both rejected with code 121 (DocumentValidationFailure)";
});

await check("d", "partial unique index rejects a 2nd DECISION with same (warrantId, idempotencyKey)", async () => {
  await tx(async (s) => void (await appendEvent(s, event("wrt_tx", { idempotencyKey: "idem-1" }))));
  const second = await code(tx(async (s) => void (await appendEvent(s, event("wrt_tx", { idempotencyKey: "idem-1" })))));
  assert(second === 11000, `second insert -> ${second}`);
  return "second rejected with E11000";
});

await check("e", "TTL index on challenges.expiresAt", async () => {
  const ttl = (await challenges().indexes()).find((i) => i.key.expiresAt === 1 && i.expireAfterSeconds !== undefined);
  assert(ttl, "no TTL index");
  return `${ttl.name}, expireAfterSeconds ${ttl.expireAfterSeconds}`;
});

await check("f", "hash chain: 5 appends verify; an admin edit is reported at its seq", async () => {
  for (let i = 0; i < 5; i++) await tx(async (s) => void (await appendEvent(s, event("wrt_tx"))));
  const before = await verifyChain();
  assert(before.ok, `chain did not verify: ${before.reason}`);
  const head = (await meta().findOne({ _id: "ledger_head" })) as unknown as { seq: number };
  const target = head.seq - 2;
  const admin = new MongoClient(process.env.MONGODB_URI_ADMIN ?? need(config.mongoUri.gate, "MONGODB_URI_GATE"));
  try {
    await admin.db(db().databaseName).collection("audit_events").updateOne({ _id: target as never }, { $set: { summary: "edited" } });
  } finally {
    await admin.close();
  }
  const after = await verifyChain();
  assert(!after.ok && after.firstBrokenSeq === target, `edited seq ${target}, verifyChain said ${JSON.stringify(after)}`);
  return `ok over ${before.checked} events; edit at seq ${target} -> firstBrokenSeq ${after.firstBrokenSeq}`;
});

await check("g", "least privilege: MONGODB_URI_GATE user cannot update audit_events", async () => {
  const gate = new MongoClient(need(config.mongoUri.gate, "MONGODB_URI_GATE"));
  try {
    const c = await code(gate.db(db().databaseName).collection("audit_events").updateOne({ _id: -1 as never }, { $set: { x: 1 } }));
    assert(c === 13, c === "no error" ? "update was ALLOWED: MONGODB_URI_GATE is an admin-level user, not gate_app" : `got ${c}, wanted 13 Unauthorized`);
    return "update refused: 13 Unauthorized";
  } finally {
    await gate.close();
  }
});

await check("h", "change stream receives an audit_events insert within 5 s", async () => {
  const cs = auditEvents().watch([{ $match: { operationType: "insert" } }]);
  try {
    await cs.tryNext(); // opens the cursor before the insert
    const started = Date.now();
    const got = cs.next();
    await tx(async (s) => void (await appendEvent(s, event("wrt_tx"))));
    const change = await Promise.race([got, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
    assert(change, "nothing received in 5 s");
    return `received in ${Date.now() - started} ms`;
  } finally {
    await cs.close();
  }
});

await db().dropDatabase();
(config.dbName as { gate: string }).gate = demoDb;

const RULE = "Require Touch ID before any account statement leaves our network";
const PAYLOAD = "Account statement for Ram: SSN [redacted], account ending 4421, balance $12,400. Please summarize my portfolio.";
await check("i", "vector search matches the chapter-6 payload (path vector)", async () => {
  const added = (await policies().findOne({ rule: RULE })) ? null : await addPolicy(RULE, "REQUIRE_TOUCH_ID");
  try {
    const started = Date.now();
    for (;;) {
      const hit = (await semanticCheck(PAYLOAD)).find((m) => m.rule === RULE);
      const t = lastTrace()!;
      if (hit && t.path === "vector") return `score ${hit.score.toFixed(3)}, ${t.ms} ms${added ? `, picked up ${Date.now() - started} ms after insert` : ""}`;
      assert(Date.now() - started < 30000, `no vector match: ${JSON.stringify({ ...t, pipeline: undefined })}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    if (added) await policies().deleteOne({ _id: added._id }); // leave the rule for the presenter to type
  }
});

await check("j", "egress_policies documents carry no embedding written by us", async () => {
  const docs = await policies().find().toArray();
  const extra = docs.flatMap((d) => Object.keys(d).filter((k) => !["_id", "rule", "mode", "createdAt"].includes(k)));
  assert(extra.length === 0, `unexpected fields: ${[...new Set(extra)].join(", ")}`);
  return `${docs.length} docs, fields only _id/rule/mode/createdAt`;
});

await closeDb();
console.log("\n  #  result  claim");
for (const r of rows) console.log(`  ${r.id}  ${r.ok ? "PASS" : "FAIL"}    ${r.claim}\n           ${r.detail}`);
console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} passed`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);
