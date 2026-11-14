// The scripted agent's scenario files, their parameter expansion, and the demo agent key hashing (REQ-013). No database needed.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { loadScenario, resolveParams } from "../src/agent/run.ts";
import { hashAgentKey } from "../src/gate/agents.ts";

const REASONS = new Set([
  "allow", "refused", "MALFORMED_REQUEST", "AGENT_UNAUTHENTICATED", "AGENT_MISMATCH", "WARRANT_NOT_FOUND", "TERMS_TAMPERED", "WARRANT_NOT_ACTIVE",
  "WARRANT_REVOKED", "WARRANT_NOT_YET_VALID", "WARRANT_EXPIRED", "ACTION_NOT_ALLOWED", "DESTINATION_NOT_ALLOWED", "ACCOUNT_NOT_ALLOWED",
  "MERCHANT_NOT_ALLOWED", "FIELD_NOT_ALLOWED", "FIELD_CONSTRAINT", "CURRENCY_MISMATCH", "AMOUNT_INVALID", "PER_ACTION_LIMIT", "BUDGET_EXHAUSTED",
]);

test("the four demo scenarios parse and expect known outcomes", () => {
  for (const name of ["in-warrant", "out-of-warrant", "injection", "burst"]) {
    const steps = loadScenario(name);
    assert.ok(steps.length > 0, name);
    for (const step of steps) {
      assert.ok(step.action || step.read, `${name}: ${step.label} needs an action or a file to read`);
      if (step.expect) assert.ok(REASONS.has(step.expect), `${name}: unknown expectation ${step.expect}`);
      if (step.read) assert.ok(existsSync(new URL(`../src/agent/${step.read}`, import.meta.url)), `${name}: missing ${step.read}`);
    }
  }
  const burst = loadScenario("burst")[0]!;
  assert.equal(burst.count, 20);
  assert.equal(burst.parallel, true);
  assert.equal(burst.action?.params.amountCents, 1000);
});

test("the injection scenario sends a 5,000 character memo and a direct bank call", () => {
  const steps = loadScenario("injection");
  const memo = resolveParams(steps.find((s) => s.expect === "FIELD_CONSTRAINT")!.action!).params.memo;
  assert.equal(typeof memo, "string");
  assert.equal((memo as string).length, 5000);
  assert.equal(steps.filter((s) => s.direct === "bank").length, 1);
});

test("agent keys are stored only as base64url SHA-256", () => {
  const hash = hashAgentKey("awp_demo_example");
  assert.match(hash, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hash, hashAgentKey("awp_demo_example"));
  assert.notEqual(hash, hashAgentKey("awp_demo_example2"));
});
