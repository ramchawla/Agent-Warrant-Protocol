// Hash-chained, gate-signed ledger (REQ-008). Owner: Pro, task 5. Called by routes/act.ts and the warrant routes.
// Signatures of appendEvent and verifyChain are fixed by PRD Section 11; everything else here is additive.
import { AsyncLocalStorage } from "node:async_hooks";
import { MongoRuntimeError, type ClientSession } from "mongodb";
import { z } from "zod";
import { GENESIS_HASH, chainHash, ed25519Sign, ed25519Verify } from "../shared/canonical.ts";
import { config, need, type InstitutionId } from "../shared/config.ts";
import type { AuditEvent, LedgerHeadDoc } from "../shared/types.ts";
import { auditEvents, meta } from "./db.ts";

export type NewEvent = Omit<AuditEvent, "_id" | "seq" | "ts" | "prevHash" | "hash" | "gateSig" | "policyVersion">;
export type LedgerHead = { seq: number; hash: string };
export type ChainResult = { ok: boolean; checked: number; firstBrokenSeq?: number; reason?: string };

// ---- in-process mutex ----
// Appends from this process are serialized so concurrent callers rarely collide. Correctness does not depend on it:
// the conditional head update below is what stops a fork, including between processes.
// The lock is reentrant along one async call chain, so a caller can hold it across a whole transaction with
// withLedgerLock(() => session.withTransaction(...)) and appendEvent inside will not deadlock.
const heldHere = new AsyncLocalStorage<true>();
let queueTail: Promise<unknown> = Promise.resolve();

export function withLedgerLock<T>(fn: () => Promise<T>): Promise<T> {
  if (heldHere.getStore()) return fn();
  const run = queueTail.then(() => heldHere.run(true, fn));
  queueTail = run.catch(() => undefined);
  return run;
}

// ---- building an event (pure) ----

function omitUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(omitUndefined) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, omitUndefined(v)]),
    ) as T;
  }
  return value;
}

/**
 * The full stored event for the next sequence number. The hashed body is every field except _id, hash and gateSig.
 * Fields the ledger owns (seq, ts, prevHash, policyVersion) override anything the caller passed.
 */
export function buildEvent(head: LedgerHead, event: NewEvent, opts: { ts: string; privateKey: string }): AuditEvent {
  const { _id: _a, hash: _b, gateSig: _c, ...given } = event as Record<string, unknown>;
  const body = omitUndefined({ ...given, seq: head.seq + 1, ts: opts.ts, policyVersion: config.policyVersion, prevHash: head.hash });
  const hash = chainHash(head.hash, body);
  return { _id: head.seq + 1, ...body, hash, gateSig: ed25519Sign(opts.privateKey, hash) } as AuditEvent;
}

/** Retryable by session.withTransaction: the error carries the TransientTransactionError label. */
function headMoved(): Error {
  const err = new MongoRuntimeError("ledger head moved");
  err.addErrorLabel("TransientTransactionError");
  return err;
}

/** Must be called inside the caller's transaction. */
export async function appendEvent(session: ClientSession, event: NewEvent): Promise<AuditEvent> {
  return withLedgerLock(async () => {
    const head = (await meta().findOne({ _id: "ledger_head" }, { session })) as LedgerHeadDoc | null;
    if (!head) throw new Error("ledger head is missing; run setup-db");
    const doc = buildEvent(head, event, { ts: new Date().toISOString(), privateKey: need(config.gatePrivateKey, "GATE_ED25519_PRIVATE_KEY") });
    // Move the head first: a concurrent writer then conflicts here, before it can insert a second event at this seq.
    const moved = await meta().updateOne({ _id: "ledger_head", seq: head.seq }, { $set: { seq: doc.seq, hash: doc.hash } }, { session });
    if (moved.modifiedCount !== 1) throw headMoved();
    await auditEvents().insertOne(doc, { session });
    return doc;
  });
}

// ---- verifying (pure core) ----

/**
 * Walks events in seq order and returns the first sequence number that does not verify.
 * Checks: contiguous seq (a gap means a deleted event), prevHash link, hash over the body, gate signature,
 * and, when head is given, that the last event is the head (a shorter ledger means deleted tail events).
 */
export async function verifyEvents(
  events: AsyncIterable<AuditEvent> | Iterable<AuditEvent>,
  opts: { publicKey: string; head?: LedgerHead | null },
): Promise<ChainResult> {
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  let checked = 0;
  let first = true;
  const broken = (seq: number, reason: string): ChainResult => ({ ok: false, checked, firstBrokenSeq: seq, reason });

  for await (const ev of events) {
    // setup-db may store the genesis marker as a seq 0 document; accept it only with the genesis hash.
    if (first && ev.seq === 0) {
      first = false;
      if (ev.hash !== GENESIS_HASH) return broken(0, "genesis does not match");
      continue;
    }
    first = false;
    if (ev.seq !== expectedSeq || ev._id !== expectedSeq) return broken(expectedSeq, "event missing or out of order");
    if (ev.prevHash !== prevHash) return broken(ev.seq, "prevHash does not match the previous event");
    const { _id, hash, gateSig, ...body } = ev;
    let recomputed: string;
    try {
      recomputed = chainHash(prevHash, body);
    } catch {
      return broken(ev.seq, "event body cannot be canonicalized");
    }
    if (recomputed !== hash) return broken(ev.seq, "event contents do not match its hash");
    if (!ed25519Verify(opts.publicKey, hash, gateSig)) return broken(ev.seq, "gate signature is invalid");
    prevHash = hash;
    expectedSeq += 1;
    checked += 1;
  }

  const lastSeq = expectedSeq - 1;
  if (opts.head !== undefined) {
    if (!opts.head) return broken(0, "ledger head is missing");
    if (opts.head.seq !== lastSeq || opts.head.hash !== prevHash) return broken(Math.min(opts.head.seq, lastSeq) + 1, "ledger ends before the recorded head");
  }
  return { ok: true, checked };
}

/** Verifies the whole stored chain against the gate public key. */
export async function verifyChain(opts: { publicKey?: string } = {}): Promise<{ ok: boolean; checked: number; firstBrokenSeq?: number; reason?: string }> {
  const publicKey = opts.publicKey ?? need(config.gatePublicKey, "GATE_ED25519_PUBLIC_KEY");
  // Head first, then only events up to it: events and head commit together, so this is consistent under live appends.
  const head = (await meta().findOne({ _id: "ledger_head" })) as LedgerHeadDoc | null;
  if (!head) return { ok: false, checked: 0, firstBrokenSeq: 0, reason: "ledger head is missing" };
  const cursor = auditEvents().find({ _id: { $lte: head.seq } }, { sort: { _id: 1 } });
  try {
    return await verifyEvents(cursor, { publicKey, head });
  } finally {
    await cursor.close();
  }
}

// ---- institution anchors (REQ-012) ----

export type AnchorResult = { ok: boolean; checked: number; reachable: boolean; mismatchSeq?: number; error?: string };
const AnchorList = z.array(z.object({ seq: z.number().int(), hash: z.string() }));

/** Compares the {seq, hash} checkpoints an institution holds with this ledger. Unreachable gives reachable:false and ok:false. */
export async function verifyAnchors(institution: InstitutionId, fetchImpl: typeof fetch = fetch): Promise<AnchorResult> {
  let anchors: z.infer<typeof AnchorList>;
  try {
    const res = await fetchImpl(`${config.institutionUrl[institution]}/anchors`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    anchors = AnchorList.parse(await res.json());
  } catch (err) {
    return { ok: false, checked: 0, reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
  const stored = await auditEvents()
    .find({ _id: { $in: anchors.map((a) => a.seq) } }, { projection: { _id: 1, hash: 1 } })
    .toArray();
  const bySeq = new Map(stored.map((e) => [e._id, e.hash]));
  const bad = anchors.filter((a) => bySeq.get(a.seq) !== a.hash).map((a) => a.seq);
  return bad.length ? { ok: false, checked: anchors.length, reachable: true, mismatchSeq: Math.min(...bad) } : { ok: true, checked: anchors.length, reachable: true };
}
