// Egress policies in plain English, matched by meaning (story chapter 6). Self-contained: Pro may replace this file.
// Atlas embeds `rule` itself (autoEmbed index egress_rule_vec); nothing here writes an embedding.
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { db } from "../db.ts";

export type EgressAction = "REQUIRE_FACEID" | "DENY" | "ALLOW";
export type PolicyDoc = { _id: string; rule: string; action: EgressAction; createdAt: Date };

export const INDEX_NAME = "egress_rule_vec";
export const INDEX_DEFINITION = {
  fields: [
    { type: "autoEmbed", modality: "text", path: "rule", model: "voyage-4" },
    { type: "filter", path: "action" },
  ],
};

/** Baseline policies seeded by the demo reset (the chapter-6 rule is added live). */
export const POLICIES: { _id: string; rule: string; action: EgressAction }[] = [
  { _id: "pol_baseline_domains", rule: "Never send customer data to unapproved domains", action: "DENY" },
  { _id: "pol_baseline_brokerage", rule: "Trading confirmations may go to the brokerage", action: "ALLOW" },
];

const policies = () => db().collection<PolicyDoc>("egress_policies");
const ACTIONS = new Set<EgressAction>(["REQUIRE_FACEID", "DENY", "ALLOW"]);

/** Makes sure the baseline policies exist; with reset, removes every other policy first. */
export async function ensurePolicies(reset = false): Promise<void> {
  if (reset) await policies().deleteMany({ _id: { $nin: POLICIES.map((p) => p._id) } });
  for (const p of POLICIES) {
    await policies().updateOne({ _id: p._id }, { $setOnInsert: { rule: p.rule, action: p.action, createdAt: new Date() } }, { upsert: true });
  }
}

async function indexState(create: boolean) {
  try {
    const found = (await policies().listSearchIndexes(INDEX_NAME).toArray())[0] as
      | { name: string; latestDefinition?: unknown; status?: string; queryable?: boolean }
      | undefined;
    if (found) return { name: found.name, definition: found.latestDefinition ?? INDEX_DEFINITION, status: found.status ?? "unknown", queryable: found.queryable ?? false };
  } catch {
    // collection missing or search unsupported: report absent below
  }
  if (!create) return { name: INDEX_NAME, definition: INDEX_DEFINITION, status: "absent" };
  try {
    await ensurePolicies();   // createSearchIndex needs the collection to exist
    await policies().createSearchIndex({ name: INDEX_NAME, type: "vectorSearch", definition: INDEX_DEFINITION });
    return { name: INDEX_NAME, definition: INDEX_DEFINITION, status: "creating" };
  } catch (error) {
    return { name: INDEX_NAME, definition: INDEX_DEFINITION, status: "absent", error: (error as Error).message };
  }
}

export default async function policyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/policies", async (req, reply) => {
    const body = (req.body ?? {}) as { rule?: unknown; action?: unknown };
    const rule = typeof body.rule === "string" ? body.rule.trim() : "";
    const action = (body.action ?? "REQUIRE_FACEID") as EgressAction;
    if (!rule || rule.length > 500 || !ACTIONS.has(action)) return reply.code(400).send({ error: "body must be {rule, action?: REQUIRE_FACEID | DENY | ALLOW}" });
    const policy: PolicyDoc = { _id: `pol_${randomBytes(12).toString("hex")}`, rule, action, createdAt: new Date() };
    await policies().insertOne(policy);
    return { policy, embeddingWrittenByUs: false };
  });

  app.get("/api/policies", async () => ({ policies: await policies().find().sort({ createdAt: 1 }).toArray() }));

  // ?create=1 creates the index when it is absent (script-free setup); Atlas may refuse autoEmbed on some tiers.
  app.get("/api/policies/index", async (req) => indexState((req.query as { create?: string }).create === "1"));
}
