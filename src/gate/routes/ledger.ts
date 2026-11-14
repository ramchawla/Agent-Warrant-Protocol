// Ledger queries and chain verification (REQ-012). Owner: Pro, task 9.
// Stub: serves test/fixtures/events.json when AWP_FIXTURES=1, otherwise answers 501.
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { config } from "../../shared/config.ts";
import type { AuditEvent } from "../../shared/types.ts";

type LedgerQuery = { runId?: string; warrantId?: string; account?: string; decision?: string; reasonCode?: string; q?: string; afterSeq?: string };

const loadFixtures = (): AuditEvent[] => JSON.parse(readFileSync(new URL("../../../test/fixtures/events.json", import.meta.url), "utf8"));

export default async function ledgerRoutes(app: FastifyInstance): Promise<void> {
  const fixtures = config.fixtures ? loadFixtures() : null;

  // ?runId&warrantId&account&decision&reasonCode&q&afterSeq -> {events: AuditEvent[]} in seq order.
  // q is a case-insensitive match on summary; afterSeq returns events with seq greater than it.
  app.get<{ Querystring: LedgerQuery }>("/api/ledger", { preHandler: app.requireReviewer }, async (req, reply) => {
    if (!fixtures) return reply.code(501).send({ error: "not implemented" });
    const { runId, warrantId, account, decision, reasonCode, q, afterSeq } = req.query;
    const events = fixtures.filter(
      (e) =>
        (!runId || e.runId === runId) &&
        (!warrantId || e.warrantId === warrantId) &&
        (!account || e.action?.account === account) &&
        (!decision || e.decision === decision) &&
        (!reasonCode || e.reasonCode === reasonCode) &&
        (!q || e.summary.toLowerCase().includes(q.toLowerCase())) &&
        (!afterSeq || e.seq > Number(afterSeq)),
    );
    return { events };
  });

  // -> {ok, checked, firstBrokenSeq?, anchors: {bank: {ok, checked}, fintech: {ok, checked}}}
  app.get("/api/ledger/verify", { preHandler: app.requireReviewer }, async (_req, reply) => {
    if (!fixtures) return reply.code(501).send({ error: "not implemented" });
    const checked = fixtures.length;
    return { ok: true, checked, anchors: { bank: { ok: true, checked: 0 }, fintech: { ok: true, checked: 0 } } };
  });
}
