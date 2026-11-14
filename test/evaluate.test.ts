// evaluate (REQ-005, REQ-006): the labelled set of PRD 8.9 that evaluate decides, check order, determinism, hostile params.
import assert from "node:assert/strict";
import { test } from "node:test";
import { actionAmountCents, evaluate } from "../src/gate/evaluate.ts";
import type { Action, ActionType, ReasonCode, Terms } from "../src/shared/types.ts";

// Demo warrant W1 (PRD 8.9).
const W1: Terms = {
  v: 1,
  warrantId: "wrt_w10000000000000000000001",
  userId: "usr_demo",
  agentId: "agt_demo",
  parentWarrantId: null,
  scope: {
    actions: ["kyc.refresh", "payment.create"],
    accounts: ["A1", "A2", "A3", "A4", "A5"],
    merchants: ["M1"],
    destinations: ["bank", "fintech"],
    fields: {
      "kyc.refresh": ["account", "fields"],
      "payment.create": ["fromAccount", "merchant", "amountCents", "currency", "memo"],
      "data.export": [],
    },
  },
  currency: "CAD",
  perActionMaxCents: 5000,
  totalLimitCents: 12000,
  notBefore: "2026-01-10T14:00:00.000Z",
  expiresAt: "2026-01-10T22:00:00.000Z",
  nonce: "AAAAAAAAAAAAAAAAAAAAAA",
};
const NOW = new Date("2026-01-10T15:00:00.000Z");
const COLLECTOR = "https://collector.example/c";

const kyc = (params: Record<string, unknown> = {}, destination = "bank"): Action =>
  ({ type: "kyc.refresh", destination, params: { account: "A1", fields: ["name", "address"], ...params } });
const pay = (params: Record<string, unknown> = {}, destination = "fintech"): Action =>
  ({ type: "payment.create", destination, params: { fromAccount: "A1", merchant: "M1", amountCents: 3000, currency: "CAD", ...params } });
// Replaces params outright, for shapes the spread above would hide.
const withParams = (type: ActionType, destination: string, params: Record<string, unknown>): Action => ({ type, destination, params });

const allows = (action: Action, terms = W1, now = NOW) => assert.deepEqual(evaluate(terms, action, now), { decision: "allow" });
const denies = (code: ReasonCode, action: Action, terms = W1, now = NOW) =>
  assert.deepEqual(evaluate(terms, action, now), { decision: "deny", reasonCode: code });

test("in-warrant actions are allowed", () => {
  allows(kyc({ account: "A1" }));
  allows(kyc({ account: "A3" }));
  allows(pay({ amountCents: 3000 }));
  allows(pay({ amountCents: 5000 }));   // exactly at the per-action limit
  allows(pay({ memo: "invoice 42" }));
});

test("out-of-warrant actions are denied with the labelled reason code", () => {
  denies("ACCOUNT_NOT_ALLOWED", kyc({ account: "A9" }));
  denies("ACCOUNT_NOT_ALLOWED", pay({ fromAccount: "A9" }));
  denies("PER_ACTION_LIMIT", pay({ amountCents: 8000 }));
  denies("PER_ACTION_LIMIT", pay({ amountCents: 5001 }));
  denies("MERCHANT_NOT_ALLOWED", pay({ merchant: "M2" }));
  denies("CURRENCY_MISMATCH", pay({ currency: "USD" }));
  denies("AMOUNT_INVALID", pay({ amountCents: -1000 }));
  denies("ACTION_NOT_ALLOWED", withParams("data.export", COLLECTOR, {}));
  denies("DESTINATION_NOT_ALLOWED", pay({}, COLLECTOR));
  denies("FIELD_NOT_ALLOWED", pay({ clientList: ["Ada", "Grace"] }));
  denies("FIELD_CONSTRAINT", pay({ memo: "x".repeat(5000) }));
  denies("WARRANT_NOT_YET_VALID", kyc(), W1, new Date("2026-01-10T13:59:59.999Z"));
  denies("WARRANT_NOT_YET_VALID", pay(), W1, new Date("2026-01-10T13:59:59.999Z"));
});

test("destination must be listed and be the institution for the action type", () => {
  denies("DESTINATION_NOT_ALLOWED", kyc({}, "fintech"));   // listed, wrong institution
  denies("DESTINATION_NOT_ALLOWED", pay({}, "bank"));
  denies("DESTINATION_NOT_ALLOWED", kyc({}, COLLECTOR));
  const fintechOnly: Terms = { ...W1, scope: { ...W1.scope, destinations: ["fintech"] } };
  denies("DESTINATION_NOT_ALLOWED", kyc(), fintechOnly);   // right institution, not listed
  // A URL in the list still cannot stand in for the fixed institution.
  const withUrl: Terms = { ...W1, scope: { ...W1.scope, destinations: ["bank", "fintech", COLLECTOR] } };
  denies("DESTINATION_NOT_ALLOWED", pay({}, COLLECTOR), withUrl);
});

test("data.export has only the destination list check", () => {
  const exporting: Terms = { ...W1, scope: { ...W1.scope, actions: ["data.export"], destinations: [COLLECTOR], fields: { ...W1.scope.fields, "data.export": ["memo"] } } };
  allows(withParams("data.export", COLLECTOR, {}), exporting);
  allows(withParams("data.export", COLLECTOR, { memo: "ok" }), exporting);
  denies("DESTINATION_NOT_ALLOWED", withParams("data.export", "https://other.example/", {}), exporting);
  denies("FIELD_NOT_ALLOWED", withParams("data.export", COLLECTOR, { clientList: [] }), exporting);
  denies("FIELD_CONSTRAINT", withParams("data.export", COLLECTOR, { memo: "x".repeat(141) }), exporting);
});

test("an action failing several checks gets the earliest code", () => {
  const early = new Date("2026-01-10T13:00:00.000Z");
  // Each case fails the named check and at least one later check.
  denies("ACTION_NOT_ALLOWED", withParams("data.export", COLLECTOR, { clientList: ["Ada"] }), W1, early);
  denies("DESTINATION_NOT_ALLOWED", pay({ fromAccount: "A9", merchant: "M2" }, COLLECTOR));
  denies("ACCOUNT_NOT_ALLOWED", pay({ fromAccount: "A9", merchant: "M2", clientList: [] }));
  denies("MERCHANT_NOT_ALLOWED", pay({ merchant: "M2", clientList: [], currency: "USD" }));
  denies("FIELD_NOT_ALLOWED", pay({ clientList: [], memo: "x".repeat(5000), currency: "USD" }));
  denies("FIELD_CONSTRAINT", pay({ memo: "x".repeat(5000), currency: "USD", amountCents: -1000 }));
  denies("CURRENCY_MISMATCH", pay({ currency: "USD", amountCents: -1000 }));
  denies("AMOUNT_INVALID", pay({ amountCents: 8000.5 }), W1, early);
  denies("PER_ACTION_LIMIT", pay({ amountCents: 8000 }), W1, early);
  denies("ACCOUNT_NOT_ALLOWED", kyc({ account: "A9", clientList: [], fields: "all" }), W1, early);
});

test("boundaries", () => {
  allows(pay({ amountCents: 5000 }));
  allows(pay({ amountCents: 1 }));
  denies("AMOUNT_INVALID", pay({ amountCents: 0 }));
  allows(pay({ memo: "x".repeat(140) }));
  denies("FIELD_CONSTRAINT", pay({ memo: "x".repeat(141) }));
  allows(kyc(), W1, new Date(W1.notBefore));   // now equal to notBefore
  allows(kyc({ fields: [] }));
  allows(kyc({ fields: Array.from({ length: 20 }, (_, i) => `f${i}`) }));
  denies("FIELD_CONSTRAINT", kyc({ fields: Array.from({ length: 21 }, (_, i) => `f${i}`) }));
  allows(kyc({ fields: ["x".repeat(64)] }));
  denies("FIELD_CONSTRAINT", kyc({ fields: ["x".repeat(65)] }));
  denies("FIELD_CONSTRAINT", kyc({ fields: [""] }));
});

test("deterministic: same inputs give the same output, inputs are not mutated, the clock is not read", () => {
  for (const action of [kyc(), pay(), pay({ amountCents: 8000 }), pay({ clientList: [] }), withParams("data.export", COLLECTOR, {})]) {
    const terms = structuredClone(W1);
    const before = structuredClone(action);
    const now = new Date(NOW);
    const first = evaluate(terms, action, now);
    assert.deepEqual(evaluate(terms, action, now), first);
    assert.deepEqual(evaluate(structuredClone(terms), structuredClone(action), new Date(now)), first);
    assert.deepEqual(action, before);
    assert.deepEqual(terms, W1);
    assert.equal(now.getTime(), NOW.getTime());
  }
  // Only the `now` argument decides notBefore, whatever the real date is.
  const future: Terms = { ...W1, notBefore: "2099-01-01T00:00:00.000Z" };
  allows(kyc(), future, new Date("2099-01-01T00:00:01.000Z"));
  denies("WARRANT_NOT_YET_VALID", kyc(), future, new Date("2098-12-31T23:59:59.000Z"));
  denies("WARRANT_NOT_YET_VALID", kyc(), W1, new Date("1999-01-01T00:00:00.000Z"));
  // Unparseable dates deny.
  denies("WARRANT_NOT_YET_VALID", kyc(), { ...W1, notBefore: "not a date" });
  denies("WARRANT_NOT_YET_VALID", kyc(), W1, new Date(NaN));
});

test("hostile params never throw and are denied", () => {
  const big = "x".repeat(1_000_000);
  const cases: [ReasonCode, Action][] = [
    // missing fields
    ["ACCOUNT_NOT_ALLOWED", withParams("kyc.refresh", "bank", {})],
    ["ACCOUNT_NOT_ALLOWED", withParams("payment.create", "fintech", {})],
    ["MERCHANT_NOT_ALLOWED", withParams("payment.create", "fintech", { fromAccount: "A1" })],
    ["FIELD_CONSTRAINT", withParams("kyc.refresh", "bank", { account: "A1" })],
    ["CURRENCY_MISMATCH", withParams("payment.create", "fintech", { fromAccount: "A1", merchant: "M1", amountCents: 3000 })],
    ["AMOUNT_INVALID", withParams("payment.create", "fintech", { fromAccount: "A1", merchant: "M1", currency: "CAD" })],
    // wrong types
    ["ACCOUNT_NOT_ALLOWED", kyc({ account: 1 })],
    ["ACCOUNT_NOT_ALLOWED", kyc({ account: ["A1"] })],
    ["ACCOUNT_NOT_ALLOWED", kyc({ account: null })],
    ["ACCOUNT_NOT_ALLOWED", pay({ fromAccount: { toString: () => "A1" } })],
    ["MERCHANT_NOT_ALLOWED", pay({ merchant: ["M1"] })],
    ["MERCHANT_NOT_ALLOWED", pay({ merchant: null })],
    ["FIELD_CONSTRAINT", kyc({ fields: "name" })],
    ["FIELD_CONSTRAINT", kyc({ fields: [1, 2] })],
    ["FIELD_CONSTRAINT", kyc({ fields: [["name"]] })],
    ["FIELD_CONSTRAINT", kyc({ fields: null })],
    ["FIELD_CONSTRAINT", kyc({ fields: { length: 0 } })],
    ["FIELD_CONSTRAINT", kyc({ fields: [big] })],
    ["FIELD_CONSTRAINT", pay({ memo: 42 })],
    ["FIELD_CONSTRAINT", pay({ memo: null })],
    ["FIELD_CONSTRAINT", pay({ memo: ["short"] })],
    ["FIELD_CONSTRAINT", pay({ memo: big })],
    ["FIELD_CONSTRAINT", pay({ currency: 124 })],
    ["FIELD_CONSTRAINT", pay({ currency: ["CAD"] })],
    ["CURRENCY_MISMATCH", pay({ currency: "cad" })],
    // amounts that are not a positive safe integer
    ["AMOUNT_INVALID", pay({ amountCents: "3000" })],
    ["AMOUNT_INVALID", pay({ amountCents: 30.5 })],
    ["AMOUNT_INVALID", pay({ amountCents: NaN })],
    ["AMOUNT_INVALID", pay({ amountCents: Infinity })],
    ["AMOUNT_INVALID", pay({ amountCents: -Infinity })],
    ["AMOUNT_INVALID", pay({ amountCents: -0 })],
    ["AMOUNT_INVALID", pay({ amountCents: 2 ** 53 })],
    ["AMOUNT_INVALID", pay({ amountCents: null })],
    ["AMOUNT_INVALID", pay({ amountCents: [3000] })],
    ["AMOUNT_INVALID", pay({ amountCents: { valueOf: () => 3000 } })],
    ["AMOUNT_INVALID", pay({ amountCents: 3000n })],
    // prototype keys: JSON.parse makes __proto__ an own key
    ["FIELD_NOT_ALLOWED", { type: "kyc.refresh", destination: "bank", params: JSON.parse('{"account":"A1","fields":["name"],"__proto__":{"x":1}}') }],
    ["ACCOUNT_NOT_ALLOWED", { type: "kyc.refresh", destination: "bank", params: JSON.parse('{"__proto__":{"account":"A1","fields":["name"]}}') }],
    ["FIELD_NOT_ALLOWED", kyc({ constructor: "x" })],
    ["FIELD_NOT_ALLOWED", pay({ constructor: { prototype: {} } })],
    ["FIELD_NOT_ALLOWED", pay({ toString: "x", hasOwnProperty: "y" })],
    // values reachable only through the prototype do not count
    ["ACCOUNT_NOT_ALLOWED", withParams("kyc.refresh", "bank", Object.create({ account: "A1", fields: ["name"] }))],
    ["ACCOUNT_NOT_ALLOWED", withParams("payment.create", "fintech", Object.create({ fromAccount: "A1", merchant: "M1", amountCents: 3000, currency: "CAD" }))],
    ["ACCOUNT_NOT_ALLOWED", withParams("kyc.refresh", "bank", Object.create(null))],
    // action types and destinations that name prototype members
    ["ACTION_NOT_ALLOWED", withParams("constructor" as ActionType, "bank", {})],
    ["ACTION_NOT_ALLOWED", withParams("__proto__" as ActionType, "bank", {})],
    ["DESTINATION_NOT_ALLOWED", kyc({}, "constructor")],
    ["DESTINATION_NOT_ALLOWED", { ...kyc(), destination: 7 as unknown as string }],
  ];
  for (const [code, action] of cases) {
    let result;
    assert.doesNotThrow(() => { result = evaluate(W1, action, NOW); });
    assert.deepEqual(result, { decision: "deny", reasonCode: code });
  }
});

test("a missing field list allows no fields", () => {
  const noKycList = { ...W1, scope: { ...W1.scope, fields: { "payment.create": W1.scope.fields["payment.create"] } } } as unknown as Terms;
  denies("FIELD_NOT_ALLOWED", kyc(), noKycList);
  allows(pay(), noKycList);
  // An action type that only exists on Object.prototype finds no list either.
  const odd = { ...W1, scope: { ...W1.scope, actions: ["constructor"], destinations: ["bank"] } } as unknown as Terms;
  denies("FIELD_NOT_ALLOWED", withParams("constructor" as ActionType, "bank", { name: "x" }), odd);
});

test("actionAmountCents is the payment amount, and zero for other action types", () => {
  assert.equal(actionAmountCents(pay({ amountCents: 3000 })), 3000);
  assert.equal(actionAmountCents(pay({ amountCents: 5000 })), 5000);
  assert.equal(actionAmountCents(kyc()), 0);
  assert.equal(actionAmountCents(kyc({ amountCents: 9999 })), 0);
  assert.equal(actionAmountCents(withParams("data.export", COLLECTOR, { amountCents: 9999 })), 0);
});
