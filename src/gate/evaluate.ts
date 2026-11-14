// Deterministic evaluation (REQ-005, REQ-006; check order in PRD 8.6 step 4). Owner: Max, task 4.
// Pure: no LLM, no network, no database, no clock read. Returns the code of the first failing check.
// Expiry, status, budget, agent identity and tampering are decided by the gate, not here.
import type { Action, ActionType, ReasonCode, Terms } from "../shared/types.ts";

export type Evaluation = { decision: "allow" } | { decision: "deny"; reasonCode: ReasonCode };

const deny = (reasonCode: ReasonCode): Evaluation => ({ decision: "deny", reasonCode });
const isString = (v: unknown): v is string => typeof v === "string";
const listed = (list: string[], v: unknown): boolean => isString(v) && list.includes(v);
// params are attacker-controlled: read own properties only, never through the prototype.
const own = (params: Record<string, unknown>, key: string): unknown => (Object.hasOwn(params, key) ? params[key] : undefined);

// Field constraints fixed by policy version awp-policy-1. A rule with `type` applies to that action type only.
// memo and currency are optional here (currency is required by the currency check); kyc.refresh needs `fields`.
const FIELD_CONSTRAINTS: { type?: ActionType; field: string; ok: (v: unknown) => boolean }[] = [
  { field: "memo", ok: (v) => v === undefined || (isString(v) && v.length <= 140) },
  { field: "currency", ok: (v) => v === undefined || isString(v) },
  { type: "kyc.refresh", field: "fields", ok: (v) => Array.isArray(v) && v.length <= 20 && v.every((f) => isString(f) && f.length >= 1 && f.length <= 64) },
];

export function evaluate(terms: Terms, action: Action, now: Date): Evaluation {
  const { type, destination, params } = action;
  const { scope } = terms;
  const kyc = type === "kyc.refresh";
  const payment = type === "payment.create";

  if (!scope.actions.includes(type)) return deny("ACTION_NOT_ALLOWED");

  // Listed in the warrant and, for kyc and payments, the one institution that executes that action type.
  const institution = kyc ? "bank" : payment ? "fintech" : undefined;
  if (!scope.destinations.includes(destination) || (institution !== undefined && destination !== institution)) return deny("DESTINATION_NOT_ALLOWED");

  if (kyc && !listed(scope.accounts, own(params, "account"))) return deny("ACCOUNT_NOT_ALLOWED");
  if (payment && !listed(scope.accounts, own(params, "fromAccount"))) return deny("ACCOUNT_NOT_ALLOWED");
  if (payment && !listed(scope.merchants, own(params, "merchant"))) return deny("MERCHANT_NOT_ALLOWED");

  const allowed = Object.hasOwn(scope.fields, type) ? scope.fields[type] : [];
  if (!Object.keys(params).every((k) => allowed.includes(k))) return deny("FIELD_NOT_ALLOWED");

  if (FIELD_CONSTRAINTS.some((c) => (c.type === undefined || c.type === type) && !c.ok(own(params, c.field)))) return deny("FIELD_CONSTRAINT");

  if (payment) {
    if (own(params, "currency") !== terms.currency) return deny("CURRENCY_MISMATCH");
    const amount = own(params, "amountCents");
    if (!(typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0)) return deny("AMOUNT_INVALID");
    if (!(amount <= terms.perActionMaxCents)) return deny("PER_ACTION_LIMIT");
  }

  // Written so an unparseable date denies.
  if (!(now.getTime() >= Date.parse(terms.notBefore))) return deny("WARRANT_NOT_YET_VALID");
  return { decision: "allow" };
}

// The amount the gate holds for an allowed action. Only meaningful after evaluate allowed the action.
export function actionAmountCents(action: Action): number {
  return action.type === "payment.create" ? (own(action.params, "amountCents") as number) : 0;
}
