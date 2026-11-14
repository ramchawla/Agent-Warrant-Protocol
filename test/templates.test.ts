// Fixed templates (Story 1, REQ-015): plain terms, the worst-case line, and the spoken text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { buildActivity, money, nameList, plainTerms, spokenTerms, termsWarnings, when, worstCaseLine } from "../src/gate/templates.ts";
import type { AuditEvent, Terms } from "../src/shared/types.ts";

function at(h: number, m = 0): string {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

const W1: Terms = {
  v: 1,
  warrantId: "wrt_000000000000000000000001",
  userId: "usr_demo",
  agentId: "agt_kyc",
  parentWarrantId: null,
  scope: {
    actions: ["kyc.refresh", "payment.create"],
    accounts: ["A1", "A2", "A3", "A4", "A5"],
    merchants: ["M1"],
    destinations: ["bank", "fintech"],
    fields: { "kyc.refresh": ["account", "fields"], "payment.create": ["fromAccount", "merchant", "amountCents", "currency", "memo"], "data.export": [] },
  },
  currency: "CAD",
  perActionMaxCents: 5000,
  totalLimitCents: 12000,
  notBefore: at(9),
  expiresAt: at(17),
  nonce: "AAAAAAAAAAAAAAAAAAAAAA",
};

test("money is exact integer cents", () => {
  assert.equal(money(12000), "$120.00");
  assert.equal(money(5), "$0.05");
  assert.equal(money(123456789), "$1,234,567.89");
  assert.equal(money(-1000), "-$10.00");
});

test("name lists collapse runs", () => {
  assert.equal(nameList(["A1", "A2", "A3", "A4", "A5"]), "A1 to A5");
  assert.equal(nameList(["A1", "A2"]), "A1 and A2");
  assert.equal(nameList(["A1", "A3", "A4", "A5", "M9"]), "A1, A3 to A5 and M9");
  assert.equal(nameList(["M1"]), "M1");
});

test("times are local and short on the same day", () => {
  assert.equal(when(at(17)), "5:00 pm");
  assert.match(when(new Date(Date.now() + 3 * 86_400_000).toISOString()), / on /);
});

test("the worst-case line for the demo warrant matches Story 1", () => {
  assert.equal(worstCaseLine(W1), "Worst case: at most $120.00 can leave accounts A1 to A5, to merchant M1, before 5:00 pm.");
  const kycOnly: Terms = { ...W1, scope: { ...W1.scope, actions: ["kyc.refresh"] } };
  assert.equal(worstCaseLine(kycOnly), "Worst case: no money can leave your accounts under this warrant, and it ends at 5:00 pm.");
});

test("plain terms list every allowed action, the limits and the worst case last", () => {
  const lines = plainTerms(W1);
  assert.equal(lines[0], "Agent agt_kyc may act for you from 9:00 am until 5:00 pm.");
  assert.ok(lines.some((l) => l.includes("up to $50.00 each and $120.00 in total, in CAD")));
  assert.ok(lines.some((l) => l.startsWith("Refresh know-your-customer records for accounts A1 to A5 at the bank.")));
  assert.equal(lines.at(-1), worstCaseLine(W1));
});

test("the spoken text is the screen text, word for word", () => {
  assert.equal(spokenTerms(W1), plainTerms(W1).join(" "));
});

test("the same terms always give the same words", () => {
  assert.deepEqual(plainTerms(structuredClone(W1)), plainTerms(W1));
});

test("warnings flag terms that can never work or that allow export", () => {
  assert.deepEqual(termsWarnings(W1), []);
  const noBank: Terms = { ...W1, scope: { ...W1.scope, destinations: ["fintech"] } };
  assert.equal(termsWarnings(noBank).length, 1);
  const exporting: Terms = { ...W1, scope: { ...W1.scope, actions: ["data.export"] } };
  assert.ok(termsWarnings(exporting).some((w) => w.includes("data export")));
});

// ---- activity and the "How AWP handled this" trace (REQ-012), on the fixture ledger ----
const FIXTURE: AuditEvent[] = JSON.parse(readFileSync(new URL("./fixtures/events.json", import.meta.url), "utf8"));
const activity = buildActivity(12000, FIXTURE.filter((e) => e.warrantId === "wrt_8c4e2a6f0b1d3957e9a7c5f3"));
const item = (seq: number) => {
  const found = activity.find((i) => i.seq === seq);
  assert.ok(found, `no activity item for #${seq}`);
  return found;
};
const statuses = (seq: number) => item(seq).steps.map((s) => s.status);

test("activity has one item per agent decision and warrant event, not per execution", () => {
  const decisions = FIXTURE.filter((e) => e.type === "DECISION" && e.warrantId === "wrt_8c4e2a6f0b1d3957e9a7c5f3").length;
  assert.equal(activity.filter((i) => i.kind === "allowed" || i.kind === "blocked").length, decisions);
  assert.ok(!activity.some((i) => FIXTURE.find((e) => e.seq === i.seq)?.type === "EXECUTION"));
  assert.deepEqual(activity.map((i) => i.seq), [...activity.map((i) => i.seq)].sort((a, b) => a - b));
});

test("an executed payment shows every step passing and the money left", () => {
  const paid = item(7);
  assert.equal(paid.headline, "Paid M1 $30.00 from A1");
  assert.equal(paid.outcome, "executed");
  assert.equal(paid.remainingAfterCents, 9000);
  assert.ok(statuses(7).every((s) => s === "ok"));
  assert.match(paid.steps.find((s) => s.label.startsWith("Budget"))!.detail, /\$120\.00 → \$90\.00 left/);
  assert.match(paid.steps.at(-1)!.detail, /fin_pay_000201/);
});

test("a blocked action stops at the failing rule and nothing is sent", () => {
  const a9 = item(9);
  assert.equal(a9.kind, "blocked");
  assert.match(a9.headline, /account A9 is not in your warrant/);
  assert.deepEqual(statuses(9), ["ok", "ok", "failed", "not-reached", "ok", "not-reached"]);
  assert.match(a9.steps[2].detail, /action type ✓, destination ✓, account ✗/);
  assert.equal(a9.steps.at(-1)!.detail, "Nothing was sent to any bank or fintech.");
});

test("each denial reason fails at the right step", () => {
  assert.equal(item(17).steps[1].status, "failed");                       // AGENT_MISMATCH: warrant step
  assert.equal(item(25).steps[3].status, "failed");                       // BUDGET_EXHAUSTED: budget step
  assert.equal(item(28).steps[3].status, "failed");                       // WARRANT_REVOKED: budget step
  assert.match(item(13).headline, /export data to collector\.example: blocked/);
  assert.match(item(15).headline, /clientList/);
  assert.match(item(16).headline, /memo field was too long/);
});

test("a rejected execution releases the money; an unknown one keeps it held", () => {
  assert.equal(item(19).outcome, "rejected");
  assert.equal(item(19).remainingAfterCents, 9000);                      // released back
  assert.equal(item(21).remainingAfterCents, 4000);
  assert.equal(item(23).outcome, "unknown");
  assert.equal(item(23).remainingAfterCents, 3000);                      // held
  assert.equal(item(23).steps.at(-1)!.status, "flag");
});

test("an allowed action with no execution record is flagged", () => {
  assert.equal(item(26).outcome, "none");
  assert.match(item(26).headline, /no execution record/);
  assert.equal(item(26).steps.at(-1)!.status, "flag");
});

test("the trace is deterministic", () => {
  assert.deepEqual(buildActivity(12000, structuredClone(FIXTURE)), buildActivity(12000, FIXTURE));
});
