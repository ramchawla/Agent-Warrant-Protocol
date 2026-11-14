// Egress policies in plain English, matched by meaning (story chapter 6).
// Atlas embeds `rule` itself (autoEmbed vector index); nothing here writes an embedding field.
import { randomBytes } from "node:crypto";
import type { Document } from "mongodb";
import { db } from "./db.ts";

export type PolicyMode = "ALLOW_MINIMIZED" | "REQUIRE_FACEID" | "BLOCK";
export const POLICY_MODES: PolicyMode[] = ["ALLOW_MINIMIZED", "REQUIRE_FACEID", "BLOCK"];
export type PolicyDoc = { _id: string; rule: string; mode: PolicyMode; createdAt: Date };
export type PolicyMatch = { _id: string; rule: string; mode: PolicyMode; score: number };
export type SemanticTrace = { pipeline: Document[]; path: "vector" | "keyword-fallback"; topScore: number; rule: string | null; ms: number; error?: string };

export const INDEX_NAME = "egress_policy_vec";
export const INDEX_DEFINITION = {
  fields: [
    { type: "autoEmbed", modality: "text", path: "rule", model: "voyage-4" },
    { type: "filter", path: "mode" },
  ],
};

// Calibrated on the demo cluster (voyage-4 scores are compressed): the chapter-6 payload scores 0.609 against the
// "account statement" rule and 0.591 against the best seed rule; unrelated text scores 0.51-0.59. Thin margin:
// tune with AWP_POLICY_THRESHOLD. Rows below it are dropped; lastTrace() still reports the top score.
export const VECTOR_THRESHOLD = Number(process.env.AWP_POLICY_THRESHOLD ?? 0.6);
// ponytail: word-overlap fallback so the demo never breaks when search is down; not a real matcher.
export const KEYWORD_THRESHOLD = 0.3;

export const SEED_POLICIES: { _id: string; rule: string; mode: PolicyMode }[] = [
  { _id: "pol_seed_client_lists", rule: "Never send client lists or account numbers to outside services", mode: "BLOCK" },
  { _id: "pol_seed_payment_touchid", rule: "Require Touch ID before any payment above $1,000", mode: "REQUIRE_FACEID" },
  { _id: "pol_seed_strip_pii", rule: "Strip personal identifiers before calling external AI models", mode: "ALLOW_MINIMIZED" },
];

export const policies = () => db().collection<PolicyDoc>("egress_policies");

export async function addPolicy(rule: string, mode: PolicyMode): Promise<PolicyDoc> {
  const doc: PolicyDoc = { _id: `pol_${randomBytes(12).toString("hex")}`, rule, mode, createdAt: new Date() };
  await policies().insertOne(doc);
  return doc;
}

/** Upserts the three seed rules and removes every other policy (so it doubles as the demo reset). */
export async function seedPolicies(): Promise<void> {
  await policies().deleteMany({ _id: { $nin: SEED_POLICIES.map((p) => p._id) } });
  for (const p of SEED_POLICIES) {
    await policies().updateOne({ _id: p._id }, { $set: { rule: p.rule, mode: p.mode }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  }
}

/** {name, definition, status, queryable} from listSearchIndexes, or the definition with status "absent". */
export async function indexStatus(): Promise<{ name: string; definition: unknown; status: string; queryable: boolean; error?: string }> {
  try {
    const found = (await policies().listSearchIndexes(INDEX_NAME).toArray())[0] as Document | undefined;
    if (found) return { name: INDEX_NAME, definition: found.latestDefinition ?? INDEX_DEFINITION, status: found.status ?? "unknown", queryable: found.queryable === true };
    return { name: INDEX_NAME, definition: INDEX_DEFINITION, status: "absent", queryable: false };
  } catch (e) {
    return { name: INDEX_NAME, definition: INDEX_DEFINITION, status: "absent", queryable: false, error: (e as Error).message };
  }
}

let trace: SemanticTrace | null = null;
/** Details of the most recent semanticCheck, for the inspector. */
export const lastTrace = (): SemanticTrace | null => trace;

const STOP = new Set("a an the any our to of for and or in on with before after may be is are it its this that from by at as my me please".split(" "));
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => w.replace(/(ing|es|s)$/, "")));

/** Policies whose meaning matches `text`, best first. Vector search, falling back to keyword overlap. */
export async function semanticCheck(text: string): Promise<PolicyMatch[]> {
  const started = Date.now();
  const pipeline: Document[] = [
    { $vectorSearch: { index: INDEX_NAME, path: "rule", query: text, numCandidates: 50, limit: 3 } },
    { $project: { rule: 1, mode: 1, score: { $meta: "vectorSearchScore" } } },
  ];
  let error: string | undefined;
  try {
    const rows = await policies().aggregate<PolicyMatch>(pipeline).toArray();
    if (rows.length) {
      trace = { pipeline, path: "vector", topScore: rows[0]!.score, rule: rows[0]!.rule, ms: Date.now() - started };
      return rows.filter((r) => r.score >= VECTOR_THRESHOLD);
    }
    error = "vector search returned no rows (index building or empty)";
  } catch (e) {
    error = (e as Error).message;
  }
  const q = words(text);
  const scored = (await policies().find().toArray())
    .map((p) => {
      const r = words(p.rule);
      return { _id: p._id, rule: p.rule, mode: p.mode, score: r.size ? Math.round(([...r].filter((w) => q.has(w)).length / r.size) * 100) / 100 : 0 };
    })
    .sort((a, b) => b.score - a.score);
  trace = { pipeline: [{ $match: {} }, { $project: { rule: 1, mode: 1 } }], path: "keyword-fallback", topScore: scored[0]?.score ?? 0, rule: scored[0]?.rule ?? null, ms: Date.now() - started, error };
  return scored.filter((r) => r.score >= KEYWORD_THRESHOLD).slice(0, 3);
}
