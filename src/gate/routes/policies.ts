// Egress policy routes (story chapter 6). Logic lives in ../policies.ts.
import type { FastifyInstance } from "fastify";
import { addPolicy, indexStatus, policies, type PolicyMode } from "../policies.ts";

export default async function policyRoutes(app: FastifyInstance): Promise<void> {
  // Only tightening modes can be added live; ALLOW_MINIMIZED would loosen policy.
  const LIVE_MODES: PolicyMode[] = ["REQUIRE_FACEID", "BLOCK"];
  // {rule, mode?} (alias: action) -> {policy, embeddingWrittenByUs: false}; needs the signed-in session.
  app.post("/api/policies", { preHandler: app.requireSession }, async (req, reply) => {
    const body = (req.body ?? {}) as { rule?: unknown; mode?: unknown; action?: unknown };
    const rule = typeof body.rule === "string" ? body.rule.trim() : "";
    const mode = (body.mode ?? body.action ?? "REQUIRE_FACEID") as PolicyMode;
    if (!rule || rule.length > 500 || !LIVE_MODES.includes(mode)) {
      return reply.code(400).send({ error: `body must be {rule, mode?: ${LIVE_MODES.join(" | ")}}` });
    }
    return { policy: await addPolicy(rule, mode), embeddingWrittenByUs: false };
  });

  app.get("/api/policies", async () => ({ policies: await policies().find().sort({ createdAt: 1 }).toArray() }));

  app.get("/api/policies/index", async () => {
    const { error, ...status } = await indexStatus();
    return error ? { ...status, error: "search index unavailable" } : status;
  });
}
