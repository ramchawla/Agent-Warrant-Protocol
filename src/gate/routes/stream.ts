// Live feed over server-sent events (REQ-012). Owner: Pro, task 9.
// Two SSE message names: "event" (data: one AuditEvent as JSON, id: its seq) and "warrant" (data: one WarrantDoc as JSON).
// Driven by MongoDB change streams on audit_events and warrants. A reconnecting EventSource sends Last-Event-ID, and
// the events it missed are replayed first (?afterSeq=N does the same for a first connection).
// With AWP_FIXTURES=1 it replays test/fixtures/events.json as "event" messages instead.
import { readFileSync } from "node:fs";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ChangeStream, Timestamp } from "mongodb";
import { config } from "../../shared/config.ts";
import type { AuditEvent, WarrantDoc } from "../../shared/types.ts";
import { auditEvents, mongo, warrants } from "../db.ts";

const REPLAY_INTERVAL_MS = 400;
const HEARTBEAT_MS = 15_000;
const BACKFILL_LIMIT = 5000;
const HEADERS = { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" };

const frame = (name: string, data: unknown, id?: number): string => `${id === undefined ? "" : `id: ${id}\n`}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

function startFixtureReplay(reply: FastifyReply, signal: { onClose: (fn: () => void) => void }): void {
  const events: AuditEvent[] = JSON.parse(readFileSync(new URL("../../../test/fixtures/events.json", import.meta.url), "utf8"));
  reply.hijack();
  reply.raw.writeHead(200, HEADERS);
  let next = 0;
  // After the last fixture event the timer sends comment lines to keep the connection open.
  const timer = setInterval(() => {
    const event = events[next++];
    reply.raw.write(event ? frame("event", event, event.seq) : ": keep-alive\n\n");
  }, REPLAY_INTERVAL_MS);
  signal.onClose(() => clearInterval(timer));
}

export default async function streamRoutes(app: FastifyInstance): Promise<void> {
  const open = new Set<() => void>();
  // Closing the server ends every open feed, so shutdown does not wait for browsers to disconnect.
  app.addHook("onClose", async () => {
    for (const end of [...open]) end();
  });

  app.get<{ Querystring: { afterSeq?: string } }>("/api/stream", { preHandler: app.requireReviewer }, async (req, reply) => {
    let ended = false;
    const cleanups: Array<() => void> = [];
    const end = () => {
      if (ended) return;
      ended = true;
      open.delete(end);
      for (const fn of cleanups) fn();
      reply.raw.end();
    };
    open.add(end);
    req.raw.on("close", end);
    const signal = { onClose: (fn: () => void) => cleanups.push(fn) };

    if (config.fixtures) return startFixtureReplay(reply, signal);

    const header = req.headers["last-event-id"];
    const resumeFrom = Number(Array.isArray(header) ? header[0] : (header ?? req.query.afterSeq));
    const backfill = Number.isInteger(resumeFrom) && resumeFrom >= 0;

    // Both change streams start at a bookmarked cluster time taken before anything is replayed, so nothing committed
    // in between is missed. Live events are held back until the replay is done, then deduplicated by seq.
    let startAtOperationTime: Timestamp;
    try {
      startAtOperationTime = (await mongo().db("admin").command({ ping: 1 })).operationTime as Timestamp;
    } catch {
      open.delete(end);
      return reply.code(503).send({ error: "the ledger database is unavailable" });
    }
    const eventsCs: ChangeStream = auditEvents().watch([{ $match: { operationType: "insert" } }], { startAtOperationTime });
    const warrantsCs: ChangeStream = warrants().watch([{ $match: { operationType: { $in: ["insert", "update", "replace"] } } }], { fullDocument: "updateLookup", startAtOperationTime });
    cleanups.push(() => void eventsCs.close().catch(() => undefined), () => void warrantsCs.close().catch(() => undefined));

    let sentSeq = backfill ? resumeFrom : -1;
    let live = !backfill;
    const held: AuditEvent[] = [];
    const send = (event: AuditEvent) => {
      if (event.seq <= sentSeq) return;
      sentSeq = event.seq;
      reply.raw.write(frame("event", event, event.seq));
    };
    eventsCs.on("change", (change) => {
      const event = (change as unknown as { fullDocument?: AuditEvent }).fullDocument;
      if (!event || ended) return;
      if (live) send(event);
      else held.push(event);
    });
    warrantsCs.on("change", (change) => {
      const warrant = (change as unknown as { fullDocument?: WarrantDoc }).fullDocument;
      if (warrant && !ended) reply.raw.write(frame("warrant", warrant));
    });
    // A broken cursor ends the feed; EventSource reconnects on its own and Last-Event-ID fills the gap.
    eventsCs.on("error", end);
    warrantsCs.on("error", end);

    reply.hijack();
    reply.raw.writeHead(200, HEADERS);
    reply.raw.write("retry: 2000\n: connected\n\n");
    try {
      if (backfill) {
        for (const event of await auditEvents().find({ _id: { $gt: resumeFrom } }).sort({ _id: 1 }).limit(BACKFILL_LIMIT).toArray()) send(event);
        live = true;
        for (const event of held.splice(0).sort((a, b) => a.seq - b.seq)) send(event);
      }
    } catch {
      return end();
    }
    if (ended) return;
    const heartbeat = setInterval(() => reply.raw.write(": keep-alive\n\n"), HEARTBEAT_MS);
    cleanups.push(() => clearInterval(heartbeat));
  });
}
