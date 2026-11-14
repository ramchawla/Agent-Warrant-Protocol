// Fixed templates: plain-language terms, worst-case line, spoken text (Story 1, REQ-015). Owner: Jackson, task 3.
// Deterministic: the same terms always give the same words. No LLM. The spoken text is the screen text,
// so the read-back matches what the customer sees word for word.
import type { ActionType, Terms } from "../shared/types.ts";

/** Which institution each action type is sent to (PRD 8.5). */
const ACTION_DESTINATION: Record<ActionType, string | null> = {
  "kyc.refresh": "bank",
  "payment.create": "fintech",
  "data.export": null,
};

/** 12345 -> "$123.45". Integer cents only. */
export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-CA");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** ISO time -> "5:00 pm" in the gate's local time zone, with the date when it is not today. */
export function when(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/\s+/g, " ");
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;
  const date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${time} on ${date}`;
}

/** "A and B", "A, B and C". */
function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Collapses runs like A1, A2, A3, A4, A5 into "A1 to A5"; leaves other names alone. */
export function nameList(names: string[]): string {
  const parsed = names.map((n) => {
    const m = /^(.*?)(\d+)$/.exec(n);
    return m ? { name: n, prefix: m[1], num: Number(m[2]) } : { name: n, prefix: null, num: NaN };
  });
  const parts: string[] = [];
  for (let i = 0; i < parsed.length; ) {
    let j = i;
    while (
      j + 1 < parsed.length &&
      parsed[i].prefix !== null &&
      parsed[j + 1].prefix === parsed[i].prefix &&
      parsed[j + 1].num === parsed[j].num + 1
    ) j++;
    if (j - i >= 2) parts.push(`${parsed[i].name} to ${parsed[j].name}`);
    else for (let k = i; k <= j; k++) parts.push(parsed[k].name);
    i = j + 1;
  }
  return andList(parts);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The worst case in one sentence: the most money that can leave, from where, to whom, and until when. */
export function worstCaseLine(terms: Terms): string {
  const until = when(terms.expiresAt);
  if (!terms.scope.actions.includes("payment.create") || terms.scope.merchants.length === 0 || terms.totalLimitCents === 0) {
    return `Worst case: no money can leave your accounts under this warrant, and it ends at ${until}.`;
  }
  const accounts = terms.scope.accounts;
  const merchants = terms.scope.merchants;
  return (
    `Worst case: at most ${money(terms.totalLimitCents)} can leave ${plural(accounts.length, "account", "accounts")} ${nameList(accounts)}, ` +
    `to ${plural(merchants.length, "merchant", "merchants")} ${nameList(merchants)}, before ${until}.`
  );
}

/** One line per thing the agent may do, then the limits, then the worst-case line. */
export function plainTerms(terms: Terms): string[] {
  const { scope } = terms;
  const lines: string[] = [];
  lines.push(`Agent ${terms.agentId} may act for you from ${when(terms.notBefore)} until ${when(terms.expiresAt)}.`);

  for (const action of scope.actions) {
    const fields = scope.fields[action] ?? [];
    const fieldText = fields.length ? ` It may send only these fields: ${andList(fields)}.` : " It may send no fields.";
    const accounts = scope.accounts.length ? nameList(scope.accounts) : "no accounts";
    if (action === "kyc.refresh") {
      lines.push(`Refresh know-your-customer records for ${plural(scope.accounts.length, "account", "accounts")} ${accounts} at the bank.${fieldText}`);
    } else if (action === "payment.create") {
      const merchants = scope.merchants.length ? nameList(scope.merchants) : "no merchants";
      lines.push(
        `Make payments from ${plural(scope.accounts.length, "account", "accounts")} ${accounts} to ${plural(scope.merchants.length, "merchant", "merchants")} ${merchants} at the fintech, ` +
          `up to ${money(terms.perActionMaxCents)} each and ${money(terms.totalLimitCents)} in total, in ${terms.currency}.${fieldText}`,
      );
    } else if (action === "data.export") {
      lines.push(`Export data to ${andList(scope.destinations)}.${fieldText}`);
    }
  }

  const reachable = scope.destinations.map((d) => (d === "bank" || d === "fintech" ? `the ${d}` : d));
  lines.push(`It may contact only ${reachable.length ? andList(reachable) : "no one"}. Anything else is blocked and recorded.`);
  lines.push(worstCaseLine(terms));
  return lines;
}

/** Text read aloud before signing (REQ-015): exactly the on-screen lines, in order. */
export function spokenTerms(terms: Terms): string {
  return plainTerms(terms).join(" ");
}

/** Problems a customer should see before signing. Empty when the terms are consistent. */
export function termsWarnings(terms: Terms): string[] {
  const warnings: string[] = [];
  for (const action of terms.scope.actions) {
    const dest = ACTION_DESTINATION[action];
    if (dest && !terms.scope.destinations.includes(dest)) {
      warnings.push(`${action} goes to the ${dest}, which is not in the allowed destinations, so it will always be blocked.`);
    }
  }
  if (terms.scope.actions.includes("data.export")) warnings.push("This warrant allows data export. The demo warrants never do.");
  if (terms.perActionMaxCents > terms.totalLimitCents) warnings.push("The per-payment limit is higher than the total limit.");
  return warnings;
}
