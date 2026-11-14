// Ledger tests (PRD task 5). Owner: Pro.
// Part 1 needs no database. Part 2 needs MONGODB_URI_GATE and a replica set (transactions); it runs against a throwaway
// database named <random prefix>awp_gate, so it never touches the demo or per-instance databases.
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { MongoClient, type Collection } from "mongodb";
import type { AuditEvent } from "../src/shared/types.ts";

try {
  process.loadEnvFile();
} catch {
  // no .env; rely on the process environment
}

const keys = generateKeyPairSync("ed25519");
const PRIVATE = keys.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url");
const PUBLIC = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
const OTHER_PUBLIC = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64url");

const mongoUri = process.env.MONGODB_URI_GATE;
const prefix = `ledgertest${randomBytes(3).toString("hex")}_`;
process.env.GATE_ED25519_PRIVATE_KEY = PRIVATE;
process.env.GATE_ED25519_PUBLIC_KEY = PUBLIC;
process.env.AWP_DB_PREFIX = prefix;

const { GENESIS_HASH } = await import("../src/shared/canonical.ts");
const ledger = await import("../src/gate/ledger.ts");
type NewEvent = import("../src/gate/ledger.ts").NewEvent;

const sample = (i: number): NewEvent => ({
  type: "DECISION",
  warrantId: "wrt_a",
  termsHash: "terms-hash",
  agentId: "agt_a",
  runId: "run_a",
  decisionId: `dec_${i}`,
  idempotencyKey: `key_${i}`,
  decision: "allow",
  action: { type: "payment.create", destination: "fintech", account: "A1", merchant: "M1", amountCents: 1000, fieldNames: ["fromAccount"], fieldSizes: { fromAccount: 2 } },
  summary: `Allowed payment ${i} of $10.00 to M1 from A1.`,
});

function makeChain(n: number): AuditEvent[] {
  const events: AuditEvent[] = [];
  let head = { seq: 0, hash: GENESIS_HASH };
  for (let i = 1; i <= n; i++) {
    const ev = ledger.buildEvent(head, sample(i), { ts: new Date(1_700_000_000_000 + i * 1000).toISOString(), privateKey: PRIVATE });
    events.push(ev);
    head = { seq: ev.seq, hash: ev.hash };
  }
  return events;
}
const headOf = (events: AuditEvent[]) => ({ seq: events.at(-1)!.seq, hash: events.at(-1)!.hash });
const check = (events: AuditEvent[], head?: { seq: number; hash: string } | null) => ledger.verifyEvents(events, { publicKey: PUBLIC, head });
const clone = (events: AuditEvent[]): AuditEvent[] => structuredClone(events);

describe("chain verification (no database)", () => {
  it("accepts an intact chain and an empty ledger", async () => {
    const events = makeChain(6);
    assert.deepEqual(await check(events, headOf(events)), { ok: true, checked: 6 });
    assert.deepEqual(await check([], { seq: 0, hash: GENESIS_HASH }), { ok: true, checked: 0 });
  });

  it("links the first event to the genesis hash and numbers events from 1", () => {
    const [first] = makeChain(1);
    assert.equal(first!.seq, 1);
    assert.equal(first!._id, 1);
    assert.equal(first!.prevHash, GENESIS_HASH);
    assert.equal(first!.policyVersion, "awp-policy-1");
  });

  it("omits absent keys and lets the ledger own seq, ts, prevHash and policyVersion", () => {
    const forged = { ...sample(1), reasonCode: undefined, seq: 99, prevHash: "x", policyVersion: "y", hash: "z", gateSig: "z" } as unknown as NewEvent;
    const ev = ledger.buildEvent({ seq: 0, hash: GENESIS_HASH }, forged, { ts: "2026-11-14T12:00:00.000Z", privateKey: PRIVATE });
    assert.equal("reasonCode" in ev, false);
    assert.equal(ev.seq, 1);
    assert.equal(ev.prevHash, GENESIS_HASH);
    assert.equal(ev.policyVersion, "awp-policy-1");
  });

  it("detects an edited event and reports its sequence number", async () => {
    const events = clone(makeChain(6));
    events[2]!.action!.amountCents = 1;
    const r = await check(events, headOf(makeChain(6)));
    assert.equal(r.ok, false);
    assert.equal(r.firstBrokenSeq, 3);
  });

  it("detects an edited event even when its hash is recomputed without the gate key", async () => {
    const original = makeChain(6);
    const events = clone(original);
    const forged = ledger.buildEvent({ seq: 2, hash: events[1]!.hash }, { ...sample(3), summary: "Allowed nothing happened." }, {
      ts: events[2]!.ts,
      privateKey: Buffer.from(generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "der" })).toString("base64url"),
    });
    events[2] = forged;
    const r = await check(events, headOf(original));
    assert.equal(r.firstBrokenSeq, 3);
    assert.match(r.reason ?? "", /signature/);
  });

  it("detects a deleted event", async () => {
    const original = makeChain(6);
    const events = original.filter((e) => e.seq !== 4);
    const r = await check(events, headOf(original));
    assert.equal(r.ok, false);
    assert.equal(r.firstBrokenSeq, 4);
  });

  it("detects deleted tail events through the ledger head", async () => {
    const original = makeChain(6);
    const r = await check(original.slice(0, 4), headOf(original));
    assert.equal(r.ok, false);
    assert.equal(r.firstBrokenSeq, 5);
  });

  it("detects reordered events, a wrong public key, and an added field", async () => {
    const original = makeChain(5);
    const swapped = clone(original);
    [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
    assert.equal((await check(swapped)).firstBrokenSeq, 2);
    assert.equal((await ledger.verifyEvents(original, { publicKey: OTHER_PUBLIC })).firstBrokenSeq, 1);
    const extra = clone(original);
    (extra[3] as Record<string, unknown>).note = "added later";
    assert.equal((await check(extra)).firstBrokenSeq, 4);
  });

  it("accepts a seq 0 genesis document only with the genesis hash", async () => {
    const events = makeChain(2);
    const genesis = { _id: 0, seq: 0, hash: GENESIS_HASH } as unknown as AuditEvent;
    assert.equal((await check([genesis, ...events])).ok, true);
    assert.equal((await check([{ ...genesis, hash: "other" } as AuditEvent, ...events])).firstBrokenSeq, 0);
  });

  it("verifies anchors against held checkpoints (fake institution)", async () => {
    // covered with a database in the second part; here only the unreachable case, which needs no database
    const down = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const r = await ledger.verifyAnchors("bank", down);
    assert.deepEqual({ ok: r.ok, reachable: r.reachable, checked: r.checked }, { ok: false, reachable: false, checked: 0 });
  });
});

describe("ledger against MongoDB", { skip: mongoUri ? false : "MONGODB_URI_GATE is not set" }, () => {
  let admin: MongoClient;
  let audit: Collection<AuditEvent>;
  let metaColl: Collection<{ _id: string; seq?: number; hash?: string }>;
  let dbm: typeof import("../src/gate/db.ts");

  const appendInTxn = async (i: number, viaLock = false) => {
    const run = async () => {
      const session = dbm.mongo().startSession();
      try {
        return await session.withTransaction(() => ledger.appendEvent(session, sample(i)));
      } finally {
        await session.endSession();
      }
    };
    return viaLock ? ledger.withLedgerLock(run) : run();
  };

  const fresh = async (n: number) => {
    await audit.deleteMany({});
    await metaColl.deleteMany({});
    await metaColl.insertOne({ _id: "ledger_head", seq: 0, hash: GENESIS_HASH });
    for (let i = 1; i <= n; i++) await appendInTxn(i);
  };

  const assertUnbroken = async (n: number) => {
    const seqs = (await audit.find({}, { projection: { _id: 1 } }).sort({ _id: 1 }).toArray()).map((e) => e._id);
    assert.deepEqual(seqs, Array.from({ length: n }, (_, i) => i + 1));
    assert.deepEqual(await ledger.verifyChain(), { ok: true, checked: n });
    assert.equal((await metaColl.findOne({ _id: "ledger_head" }))?.seq, n);
  };

  before(async () => {
    dbm = await import("../src/gate/db.ts");
    admin = new MongoClient(mongoUri!);
    const db = admin.db(`${prefix}awp_gate`);
    audit = db.collection("audit_events");
    metaColl = db.collection("meta");
    await db.createCollection("audit_events");
    await db.createCollection("meta");
  });

  after(async () => {
    try {
      await admin.db(`${prefix}awp_gate`).dropDatabase();
    } catch {
      // dev users may lack dropDatabase; the random prefix keeps the leftovers out of the way
    }
    await admin.close();
    await dbm.closeDb();
  });

  it("50 concurrent appends leave an unbroken chain", async () => {
    await fresh(0);
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => appendInTxn(i + 1)));
    assert.equal(new Set(results.map((e) => e.seq)).size, 50);
    await assertUnbroken(50);
  });

  it("50 concurrent appends with the lock held across each transaction also leave an unbroken chain", async () => {
    await fresh(0);
    await Promise.all(Array.from({ length: 50 }, (_, i) => appendInTxn(i + 1, true)));
    await assertUnbroken(50);
  });

  it("an aborted transaction leaves no event and does not move the head", async () => {
    await fresh(2);
    const session = dbm.mongo().startSession();
    session.startTransaction();
    const ev = await ledger.appendEvent(session, sample(3));
    assert.equal(ev.seq, 3);
    await session.abortTransaction();
    await session.endSession();
    await assertUnbroken(2);
    assert.equal((await appendInTxn(3)).seq, 3);
    await assertUnbroken(3);
  });

  it("fails closed when the head is missing", async () => {
    await metaColl.deleteMany({});
    await assert.rejects(appendInTxn(1), /ledger head is missing/);
    assert.equal((await ledger.verifyChain()).ok, false);
  });

  it("an edited event is detected and its sequence number reported", async () => {
    await fresh(5);
    await audit.updateOne({ _id: 3 }, { $set: { "action.amountCents": 1 } });
    const r = await ledger.verifyChain();
    assert.equal(r.ok, false);
    assert.equal(r.firstBrokenSeq, 3);
  });

  it("an event edited with its hash recomputed is still detected (gate signature)", async () => {
    await fresh(5);
    const { chainHash } = await import("../src/shared/canonical.ts");
    const stored = (await audit.findOne({ _id: 3 }))!;
    const { _id, hash, gateSig, ...body } = stored;
    const edited = { ...body, summary: "Allowed nothing happened." };
    await audit.updateOne({ _id: 3 }, { $set: { summary: edited.summary, hash: chainHash(edited.prevHash, edited) } });
    const r = await ledger.verifyChain();
    assert.equal(r.firstBrokenSeq, 3);
  });

  it("a deleted event, and deleted tail events, are detected", async () => {
    await fresh(5);
    await audit.deleteOne({ _id: 3 });
    assert.equal((await ledger.verifyChain()).firstBrokenSeq, 3);
    await fresh(5);
    await audit.deleteOne({ _id: 5 });
    assert.equal((await ledger.verifyChain()).firstBrokenSeq, 5);
  });

  it("compares institution anchors with the ledger", async () => {
    await fresh(4);
    const events = await audit.find({}).sort({ _id: 1 }).toArray();
    const serve = (body: unknown, ok = true) => (async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch;
    const good = [{ seq: 2, hash: events[1]!.hash }, { seq: 4, hash: events[3]!.hash }];
    assert.deepEqual(await ledger.verifyAnchors("bank", serve(good)), { ok: true, checked: 2, reachable: true });
    const tampered = [{ seq: 2, hash: events[1]!.hash }, { seq: 4, hash: "not-the-hash" }];
    assert.deepEqual(await ledger.verifyAnchors("bank", serve(tampered)), { ok: false, checked: 2, reachable: true, mismatchSeq: 4 });
    await audit.deleteOne({ _id: 2 });
    assert.equal((await ledger.verifyAnchors("fintech", serve(good))).mismatchSeq, 2);
    assert.equal((await ledger.verifyAnchors("bank", serve({}, false))).reachable, false);
  });
});
