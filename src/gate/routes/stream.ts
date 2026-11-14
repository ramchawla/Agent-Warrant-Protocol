// Live feed over server-sent events (REQ-012). Owner: Pro, task 9.
// Two SSE message names: "event" (data: one AuditEvent as JSON) and "warrant" (data: one WarrantDoc as JSON).
// Stub: replays test/fixtures/events.json as "event" messages when AWP_FIXTURES=1, otherwise answers 501.
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { config } from "../../shared/config.ts";
import type { AuditEvent } from "../../shared/types.ts";

const REPLAY_INTERVAL_MS = 400;

export default async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/stream", { preHandler: app.requireReviewer }, async (req, reply) => {
    if (!config.fixtures) return reply.code(501).send({ error: "not implemented" });
    const events: AuditEvent[] = JSON.parse(readFileSync(new URL("../../../test/fixtures/events.json", import.meta.url), "utf8"));
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    let next = 0;
    // After the last fixture event the timer sends comment lines to keep the connection open.
    const timer = setInterval(() => {
      const event = events[next++];
      reply.raw.write(event ? `event: event\ndata: ${JSON.stringify(event)}\n\n` : ": keep-alive\n\n");
    }, REPLAY_INTERVAL_MS);
    req.raw.on("close", () => clearInterval(timer));
  });
}
