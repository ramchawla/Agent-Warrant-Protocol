// Fixed templates (Story 1, REQ-015): plain terms, the worst-case line, and the spoken text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { money, nameList, plainTerms, spokenTerms, termsWarnings, when, worstCaseLine } from "../src/gate/templates.ts";
import type { Terms } from "../src/shared/types.ts";

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
