// Ledger queries and chain verification (REQ-012). Owner: Pro, task 9.
// With AWP_FIXTURES=1 the routes serve test/fixtures/events.json so the reviewer page can be built without a gate.
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { Document } from "mongodb";
import { z } from "zod";
import { config } from "../../shared/config.ts";
import type { AuditEvent } from "../../shared/types.ts";
import { auditEvents } from "../db.ts";
import { verifyAnchors, verifyChain } from "../ledger.ts";

const MAX_EVENTS = 5000;

// An empty value (a blank filter box on the reviewer page) means "no filter".
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
const Query = z.object({
  runId: optional(z.string().max(100)),
  warrantId: optional(z.string().max(100)),
  account: optional(z.string().max(100)),
  decision: optional(z.enum(["allow", "deny"])),
  reasonCode: optional(z.string().max(60)),
  q: optional(z.string().max(200)),
  afterSeq: optional(z.coerce.number().int().min(0)),
});

const loadFixtures = (): AuditEvent[] => JSON.parse(readFileSync(new URL("../../../test/fixtures/events.json", import.meta.url), "utf8"));
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default async function ledgerRoutes(app: FastifyInstance): Promise<void> {
  const fixtures = config.fixtures ? loadFixtures() : null;

  // ?runId&warrantId&account&decision&reasonCode&q&afterSeq -> {events: AuditEvent[]} in seq order.
  // q is a case-insensitive match on summary (ledger search, REQ-018, extends this later);
  // afterSeq returns events with seq greater than it. At most 5000 events are returned.
  app.get("/api/ledger", { preHandler: app.requireReviewer }, async (req, reply) => {
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid query", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    const { runId, warrantId, account, decision, reasonCode, q, afterSeq } = parsed.data;

    if (fixtures) {
      const events = fixtures.filter(
        (e) =>
          (!runId || e.runId === runId) &&
          (!warrantId || e.warrantId === warrantId) &&
          (!account || e.action?.account === account) &&
          (!decision || e.decision === decision) &&
          (!reasonCode || e.reasonCode === reasonCode) &&
          (!q || e.summary.toLowerCase().includes(q.toLowerCase())) &&
          (afterSeq === undefined || e.seq > afterSeq),
      );
      return { events };
    }

    const filter: Document = {};
    if (runId) filter.runId = runId;
    if (warrantId) filter.warrantId = warrantId;
    if (account) filter["action.account"] = account;
    if (decision) filter.decision = decision;
    if (reasonCode) filter.reasonCode = reasonCode;
    if (q) filter.summary = { $regex: escapeRegex(q), $options: "i" };
    if (afterSeq !== undefined) filter._id = { $gt: afterSeq };
    const events = await auditEvents().find(filter).sort({ _id: 1 }).limit(MAX_EVENTS).toArray();
    return { events };
  });

  // -> {ok, checked, firstBrokenSeq?, anchors: {bank: {ok, checked}, fintech: {ok, checked}}}
  // ok, checked and firstBrokenSeq describe the chain itself. Each anchors entry compares the checkpoints that
  // institution holds with the ledger; reachable:false means the institution is not running (ok is then false),
  // and mismatchSeq names the first checkpoint that disagrees. reason says why the chain is broken.
  app.get("/api/ledger/verify", { preHandler: app.requireReviewer }, async (_req, reply) => {
    if (fixtures) {
      return { ok: true, checked: fixtures.length, anchors: { bank: { ok: true, checked: 0 }, fintech: { ok: true, checked: 0 } } };
    }
    try {
      const [chain, bank, fintech] = await Promise.all([verifyChain(), verifyAnchors("bank"), verifyAnchors("fintech")]);
      return { ...chain, anchors: { bank, fintech } };
    } catch (err) {
      return reply.code(503).send({ ok: false, error: err instanceof Error ? err.message : "ledger unavailable" });
    }
  });
}
