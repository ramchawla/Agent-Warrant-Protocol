// Deterministic evaluation (REQ-005, REQ-006; check order in PRD 8.6 step 4). Owner: Max, task 4.
// Pure: no LLM, no network, no database. Stub: throws.
import type { Action, ReasonCode, Terms } from "../shared/types.ts";

export type Evaluation = { decision: "allow" } | { decision: "deny"; reasonCode: ReasonCode };

export function evaluate(terms: Terms, action: Action, now: Date): Evaluation {
  throw new Error("not implemented");
}
