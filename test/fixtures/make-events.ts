// Generates test/fixtures/events.json: a valid hash chain signed by a fixed fixture key.
//   npx tsx test/fixtures/make-events.ts
import { createPrivateKey, createPublicKey } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { b64url, chainHash, ed25519Sign, GENESIS_HASH, hashJcs, jcs, sha256, termsHash } from "../../src/shared/canonical.ts";
import type { Action, AuditEvent, ReasonCode, Terms } from "../../src/shared/types.ts";

// Deterministic Ed25519 key: PKCS#8 header + 32-byte seed. For fixtures only.
const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), sha256("awp-fixture-gate-key")]);
const FIXTURE_PRIVATE_KEY = b64url(pkcs8);
export const FIXTURE_GATE_PUBLIC_KEY = b64url(
  createPublicKey(createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }),
);

const AGENT = "agt_5d1f0c9a7b3e4f6a8c2d1e0b";
const OTHER_AGENT = "agt_e7a94c1b20d85f3a6b9c4d2e";
const SUB_AGENT = "agt_0b6c8e2f4a1d3975c0e8f6a4";
const USER = "usr_3a9f1c5e7b2d4f6a8c0e1b3d";

const scopeFields = {
  "kyc.refresh": ["account", "fields"],
  "payment.create": ["fromAccount", "merchant", "amountCents", "currency", "memo"],
  "data.export": [],
};
const w1: Terms = {
  v: 1,
  warrantId: "wrt_8c4e2a6f0b1d3957e9a7c5f3",
  userId: USER,
  agentId: AGENT,
  parentWarrantId: null,
  scope: { actions: ["kyc.refresh", "payment.create"], accounts: ["A1", "A2", "A3", "A4", "A5"], merchants: ["M1"], destinations: ["bank", "fintech"], fields: scopeFields },
  currency: "CAD",
  perActionMaxCents: 5000,
  totalLimitCents: 12000,
  notBefore: "2026-11-14T19:00:00.000Z",
  expiresAt: "2026-11-14T22:00:00.000Z",
  nonce: "q83vEjRWeJASNFZ4kKvN7w",
};
const w2: Terms = {
  ...w1,
  warrantId: "wrt_1f7b9d3c5e0a2468b6d4f2a0",
  agentId: SUB_AGENT,
  parentWarrantId: w1.warrantId,
  scope: { actions: ["kyc.refresh"], accounts: ["A4", "A5"], merchants: [], destinations: ["bank"], fields: scopeFields },
  perActionMaxCents: 0,
  totalLimitCents: 0,
  nonce: "ASNFZ4mrze_ty6mHZUMhAA",
};

const dollars = (amountCents: number): string => `$${(amountCents / 100).toFixed(2)}`;
const kyc = (account: string): Action => ({ type: "kyc.refresh", destination: "bank", params: { account, fields: ["address", "occupation"] } });
const pay = (amountCents: number, extra: Record<string, unknown> = {}): Action => ({
  type: "payment.create",
  destination: "fintech",
  params: { fromAccount: "A1", merchant: "M1", amountCents, currency: "CAD", ...extra },
});

const describe = (a: Action): string => {
  const p = a.params;
  if (a.type === "kyc.refresh") return `kyc.refresh on account ${p.account} at ${a.destination}`;
  if (a.type === "payment.create") return `payment.create of ${dollars(Number(p.amountCents))} ${p.currency} from ${p.fromAccount} to ${p.merchant} at ${a.destination}`;
  return `data.export to ${a.destination}`;
};

export function buildFixtureEvents(): AuditEvent[] {
  const events: AuditEvent[] = [];
  let prevHash = GENESIS_HASH;
  let clock = Date.parse("2026-11-14T19:02:11.000Z");

  type Fields = Omit<AuditEvent, "_id" | "seq" | "ts" | "policyVersion" | "prevHash" | "hash" | "gateSig" | "warrantId" | "termsHash" | "agentId"> &
    Partial<Pick<AuditEvent, "warrantId" | "termsHash" | "agentId">>;
  const append = (fields: Fields): AuditEvent => {
    const seq = events.length + 1;
    clock += 1500 + ((seq * 937) % 4000);
    const body = { seq, ts: new Date(clock).toISOString(), warrantId: w1.warrantId, termsHash: termsHash(w1), agentId: AGENT, ...fields, policyVersion: "awp-policy-1", prevHash };
    const hash = chainHash(prevHash, body);
    const event: AuditEvent = { _id: seq, ...body, hash, gateSig: ed25519Sign(FIXTURE_PRIVATE_KEY, hash) };
    events.push(event);
    prevHash = hash;
    return event;
  };

  const decide = (runId: string, action: Action, reasonCode?: ReasonCode, agentId: string = AGENT): AuditEvent => {
    const seq = events.length + 1;
    const p = action.params;
    const account = p.account ?? p.fromAccount;
    return append({
      type: "DECISION",
      agentId,
      runId,
      decisionId: `dec_${sha256(`fixture-decision-${seq}`).toString("hex").slice(0, 24)}`,
      idempotencyKey: `${runId}-step-${seq}`,
      decision: reasonCode ? "deny" : "allow",
      ...(reasonCode && { reasonCode }),
      action: {
        type: action.type,
        destination: action.destination,
        ...(typeof account === "string" && { account }),
        ...(typeof p.merchant === "string" && { merchant: p.merchant }),
        ...(typeof p.amountCents === "number" && { amountCents: p.amountCents }),
        fieldNames: Object.keys(p),
        fieldSizes: Object.fromEntries(Object.entries(p).map(([name, value]) => [name, jcs(value).length])),
      },
      actionHash: hashJcs(action),
      summary: reasonCode ? `Denied ${describe(action)}: ${reasonCode}.` : `Allowed ${describe(action)}.`,
    });
  };

  const executed = (decision: AuditEvent, outcome: "executed" | "rejected" | "unknown", institutionRef?: string): AuditEvent => {
    const where = decision.action!.destination;
    const what = `${decision.action!.type} for decision ${decision.decisionId}`;
    const summary =
      outcome === "executed" ? `Executed ${what} at ${where} (${institutionRef}).`
      : outcome === "rejected" ? `Rejected ${what} by ${where}; held amount released.`
      : `Unknown outcome of ${what} at ${where}: no answer within 5 seconds; amount stays held.`;
    return append({ type: "EXECUTION", runId: decision.runId, decisionId: decision.decisionId, outcome, ...(institutionRef && { institutionRef }), summary });
  };

  append({ type: "WARRANT_CREATED", runId: null, summary: `Warrant ${w1.warrantId} created for agent ${AGENT} by user ${USER}: up to $50.00 per action and $120.00 in total.` });
  append({ type: "WARRANT_APPROVED", runId: null, summary: `Warrant ${w1.warrantId} approved by user ${USER} with a passkey.` });

  // In-warrant work.
  executed(decide("run_kyc_refresh_01", kyc("A1")), "executed", "bank_kyc_000101");
  executed(decide("run_kyc_refresh_01", kyc("A2")), "executed", "bank_kyc_000102");
  executed(decide("run_kyc_refresh_01", pay(3000, { memo: "Q4 filing fee" })), "executed", "fin_pay_000201");

  // Out-of-warrant attempts.
  decide("run_out_of_scope_02", kyc("A9"), "ACCOUNT_NOT_ALLOWED");
  decide("run_out_of_scope_02", pay(8000), "PER_ACTION_LIMIT");
  decide("run_out_of_scope_02", pay(2000, { merchant: "M2" }), "MERCHANT_NOT_ALLOWED");
  decide("run_out_of_scope_02", pay(2000, { currency: "USD" }), "CURRENCY_MISMATCH");

  // Injected exfiltration.
  decide("run_injection_03", { type: "data.export", destination: "https://collector.example/c", params: { clientList: "x".repeat(1840) } }, "ACTION_NOT_ALLOWED");
  decide("run_injection_03", { ...pay(1000), destination: "https://collector.example/c" }, "DESTINATION_NOT_ALLOWED");
  decide("run_injection_03", pay(1000, { clientList: "x".repeat(1840) }), "FIELD_NOT_ALLOWED");
  decide("run_injection_03", pay(1000, { memo: "x".repeat(5000) }), "FIELD_CONSTRAINT");

  // Another agent presents its own key against this warrant.
  decide("run_other_agent_04", pay(1000), "AGENT_MISMATCH", OTHER_AGENT);

  append({
    type: "CHILD_ISSUED",
    warrantId: w2.warrantId,
    termsHash: termsHash(w2),
    runId: null,
    summary: `Child warrant ${w2.warrantId} issued to agent ${SUB_AGENT} under ${w1.warrantId}: kyc.refresh on A4 and A5, no spending.`,
  });

  // Institution refusal, timeout, exhausted budget, and a decision with no execution record.
  executed(decide("run_payments_05", pay(5000)), "rejected");
  executed(decide("run_payments_05", pay(5000)), "executed", "fin_pay_000202");
  executed(decide("run_payments_05", pay(1000)), "unknown");
  decide("run_payments_05", pay(5000), "BUDGET_EXHAUSTED");
  decide("run_payments_05", kyc("A3"));

  append({ type: "REVOKED", runId: null, summary: `Warrant ${w1.warrantId} revoked by user ${USER}; 2 warrants stopped.` });
  decide("run_payments_05", kyc("A4"), "WARRANT_REVOKED");

  return events;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const events = buildFixtureEvents();
  writeFileSync(new URL("./events.json", import.meta.url), JSON.stringify(events, null, 2) + "\n");
  console.log(`wrote ${events.length} events`);
}
