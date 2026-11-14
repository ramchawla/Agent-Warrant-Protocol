// Fixed templates: plain-language terms, worst-case line, spoken text (Story 1, REQ-015). Owner: Jackson, task 3.
// Deterministic: the same terms always give the same words. No LLM. The spoken text is the screen text,
// so the read-back matches what the customer sees word for word.
import type { ActionType, AuditEvent, ReasonCode, Terms } from "../shared/types.ts";

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

// ---------------------------------------------------------------------------------------------
// Activity and the "How AWP handled this" trace (REQ-012, PRD 8.5 ActivityItem / TraceStep).
// Built only from ledger events: nothing here is invented or animated. Checks after the failing
// one are "not-reached", which is exact because the gate's check order is fixed (PRD 8.6).

export type TraceStep = { label: string; status: "ok" | "failed" | "not-reached" | "flag"; detail: string };
export type ActivityItem = {
  seq: number;
  ts: string;
  kind: "created" | "approved" | "allowed" | "blocked" | "revoked" | "child";
  headline: string;
  outcome?: "executed" | "rejected" | "unknown" | "none";
  remainingAfterCents?: number;
  steps: TraceStep[];
};

/** Rule checks in the order evaluate() runs them (PRD 8.6 step 4), with the reason code each one gives. */
const RULES: { name: string; code: ReasonCode }[] = [
  { name: "action type", code: "ACTION_NOT_ALLOWED" },
  { name: "destination", code: "DESTINATION_NOT_ALLOWED" },
  { name: "account", code: "ACCOUNT_NOT_ALLOWED" },
  { name: "merchant", code: "MERCHANT_NOT_ALLOWED" },
  { name: "field names", code: "FIELD_NOT_ALLOWED" },
  { name: "field limits", code: "FIELD_CONSTRAINT" },
  { name: "currency", code: "CURRENCY_MISMATCH" },
  { name: "amount", code: "AMOUNT_INVALID" },
  { name: "per-payment limit", code: "PER_ACTION_LIMIT" },
  { name: "start time", code: "WARRANT_NOT_YET_VALID" },
];
const IDENTITY_CODES: ReasonCode[] = ["MALFORMED_REQUEST", "AGENT_UNAUTHENTICATED"];
const WARRANT_CODES: ReasonCode[] = ["WARRANT_NOT_FOUND", "TERMS_TAMPERED", "AGENT_MISMATCH"];
const BUDGET_CODES: ReasonCode[] = ["WARRANT_NOT_ACTIVE", "WARRANT_REVOKED", "WARRANT_EXPIRED", "BUDGET_EXHAUSTED"];
const KNOWN_FIELDS = ["account", "fields", "fromAccount", "merchant", "amountCents", "currency", "memo"];

type EventAction = NonNullable<AuditEvent["action"]>;

/** "https://collector.example/c" -> "collector.example"; "bank" -> "the bank". */
function place(destination: string): string {
  if (destination === "bank" || destination === "fintech") return `the ${destination}`;
  try {
    return new URL(destination).host;
  } catch {
    return destination;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (hash: string) => `${hash.slice(0, 6)}…${hash.slice(-4)}`;

/** Why a denial happened, in the customer's words. */
export function reasonText(code: ReasonCode, a?: EventAction): string {
  switch (code) {
    case "MALFORMED_REQUEST": return "the request was malformed";
    case "AGENT_UNAUTHENTICATED": return "the agent's key was missing or wrong";
    case "AGENT_MISMATCH": return "a different agent tried to use your warrant";
    case "WARRANT_NOT_FOUND": return "no such warrant";
    case "TERMS_TAMPERED": return "the stored terms no longer match what you signed";
    case "WARRANT_NOT_ACTIVE": return "the warrant was not approved";
    case "WARRANT_REVOKED": return "you revoked this warrant";
    case "WARRANT_NOT_YET_VALID": return "the warrant had not started yet";
    case "WARRANT_EXPIRED": return "the warrant had expired";
    case "ACTION_NOT_ALLOWED": return `${a?.type ?? "this action"} is not in your warrant`;
    case "DESTINATION_NOT_ALLOWED": return `${a ? place(a.destination) : "that destination"} is not an allowed destination`;
    case "ACCOUNT_NOT_ALLOWED": return `account ${a?.account ?? "?"} is not in your warrant`;
    case "MERCHANT_NOT_ALLOWED": return `merchant ${a?.merchant ?? "?"} is not in your warrant`;
    case "FIELD_NOT_ALLOWED": {
      const extra = a?.fieldNames.filter((f) => !KNOWN_FIELDS.includes(f)) ?? [];
      return extra.length ? `it sent a field your warrant does not allow (${andList(extra)})` : "it sent a field your warrant does not allow";
    }
    case "FIELD_CONSTRAINT": {
      const big = a ? Object.entries(a.fieldSizes).sort((x, y) => y[1] - x[1])[0] : undefined;
      return big ? `the ${big[0]} field was too long (${big[1].toLocaleString("en-CA")} characters)` : "a field broke its size limit";
    }
    case "CURRENCY_MISMATCH": return "the currency is not CAD";
    case "AMOUNT_INVALID": return "the amount was not a valid positive amount";
    case "PER_ACTION_LIMIT": return `${a?.amountCents !== undefined ? money(a.amountCents) : "the amount"} is over your per-payment limit`;
    case "BUDGET_EXHAUSTED": return "not enough of your total limit was left";
    case "LEDGER_UNAVAILABLE": return "the ledger could not be written, so nothing was allowed";
  }
}

/** What the agent did or tried, in one line. */
function actionPhrase(a: EventAction | undefined, tried: boolean): string {
  if (!a) return tried ? "Tried an unreadable request" : "Did something";
  const amount = a.amountCents !== undefined ? money(a.amountCents) : "";
  if (a.type === "payment.create") {
    const from = a.account ? ` from ${a.account}` : "";
    const to = a.destination === "fintech" ? "" : ` via ${place(a.destination)}`;
    return `${tried ? "Tried to pay" : "Paid"} ${a.merchant ?? "?"} ${amount}${from}${to}`;
  }
  if (a.type === "kyc.refresh") return tried ? `Tried to refresh KYC on ${a.account ?? "?"}` : `Refreshed KYC on ${a.account ?? "?"} at the bank`;
  return `${tried ? "Tried to export data" : "Exported data"} to ${place(a.destination)}`;
}

/** The trace for one DECISION (and its EXECUTION, if any). */
function decisionTrace(d: AuditEvent, exec: AuditEvent | undefined, before: number, after: number, approvedBy: string | null): TraceStep[] {
  const code = d.decision === "deny" ? d.reasonCode ?? "MALFORMED_REQUEST" : undefined;
  const a = d.action;
  const steps: TraceStep[] = [];
  let stopped = false;
  const next = (label: string, failsOn: ReasonCode[], okDetail: string) => {
    if (stopped) steps.push({ label, status: "not-reached", detail: "Not reached." });
    else if (code && failsOn.includes(code)) {
      stopped = true;
      steps.push({ label, status: "failed", detail: `Blocked: ${reasonText(code, a)} (${code}).` });
    } else steps.push({ label, status: "ok", detail: okDetail });
  };

  next("Agent identified", IDENTITY_CODES, `${d.agentId ?? "The agent"} presented its own key, and it matched.`);
  next("Warrant and signed terms", WARRANT_CODES,
    `The warrant was approved ${approvedBy ?? "with a passkey"}, and its stored terms still hash to ${d.termsHash ? short(d.termsHash) : "the signed value"}.`);

  // Rules: every check in order, up to and including the failing one.
  const failIndex = code ? RULES.findIndex((r) => r.code === code) : -1;
  if (stopped) steps.push({ label: "Rules checked in fixed order", status: "not-reached", detail: "Not reached." });
  else if (failIndex >= 0) {
    stopped = true;
    const checks = [...RULES.slice(0, failIndex).map((r) => `${r.name} ✓`), `${RULES[failIndex].name} ✗`];
    steps.push({ label: "Rules checked in fixed order", status: "failed", detail: `${checks.join(", ")}. Blocked: ${reasonText(code!, a)} (${code}).` });
  } else steps.push({ label: "Rules checked in fixed order", status: "ok", detail: `${RULES.map((r) => r.name).join(", ")}: all passed.` });

  const amount = a?.amountCents ?? 0;
  next("Budget reserved in one atomic step", BUDGET_CODES,
    amount > 0 ? `${money(before)} → ${money(after)} left. Two requests at once cannot spend the same money.` : "No money involved; the warrant was confirmed active and unexpired.");

  if (code === "LEDGER_UNAVAILABLE") {
    steps.push({ label: "Recorded before acting", status: "failed", detail: "The ledger could not be written, so the gate refused (fail closed)." });
  } else {
    steps.push({ label: "Recorded before acting", status: "ok", detail: `Ledger entry #${d.seq}, chained to #${d.seq - 1} (hash ${short(d.hash)}), signed by the gate.` });
  }

  if (d.decision === "deny") {
    steps.push({ label: "Sent to the bank", status: "not-reached", detail: "Nothing was sent to any bank or fintech." });
    return steps;
  }

  const dest = a ? place(a.destination) : "the institution";
  steps.push({ label: "Receipt signed by the gate", status: "ok", detail: `Valid for 60 seconds and addressed to ${dest} only. The agent never holds it.` });
  if (!exec) {
    steps.push({ label: `${cap(dest)} checked it itself`, status: "flag", detail: "No execution record yet. If this stays, the gate stopped between deciding and sending; nothing ran without a record." });
  } else if (exec.outcome === "executed") {
    steps.push({ label: `${cap(dest)} checked it itself`, status: "ok", detail: "Gate signature, your passkey signature against the key it enrolled itself, the terms and its own policy all passed." });
    steps.push({ label: "Done", status: "ok", detail: `Executed${exec.institutionRef ? ` (${exec.institutionRef})` : ""}. Ledger entry #${exec.seq}.` });
  } else if (exec.outcome === "rejected") {
    steps.push({ label: `${cap(dest)} checked it itself`, status: "failed", detail: `${cap(dest)} refused it under its own checks, even though the gate allowed it.` });
    steps.push({ label: "Money released", status: "ok", detail: `The held ${money(amount)} went back to your limit. Ledger entry #${exec.seq}.` });
  } else {
    steps.push({ label: `${cap(dest)} checked it itself`, status: "flag", detail: `No answer within 5 seconds. The ${money(amount)} stays held until someone checks. Ledger entry #${exec.seq}.` });
  }
  return steps;
}

/**
 * Turns one warrant's ledger events into the customer's activity list, oldest first.
 * totalLimitCents is the warrant's signed total; the running "left" figure is rebuilt from the events.
 */
export function buildActivity(totalLimitCents: number, events: AuditEvent[]): ActivityItem[] {
  const sorted = [...events].sort((x, y) => x.seq - y.seq);
  const execByDecision = new Map<string, AuditEvent>();
  for (const e of sorted) if (e.type === "EXECUTION" && e.decisionId) execByDecision.set(e.decisionId, e);

  const items: ActivityItem[] = [];
  let left = totalLimitCents;
  let approvedBy: string | null = null;

  for (const e of sorted) {
    if (e.type === "WARRANT_CREATED") {
      items.push({ seq: e.seq, ts: e.ts, kind: "created", headline: "You set up this warrant.", remainingAfterCents: left, steps: [
        { label: "Recorded", status: "ok", detail: `Ledger entry #${e.seq}. Terms hash ${e.termsHash ? short(e.termsHash) : "?"}.` },
      ] });
    } else if (e.type === "WARRANT_APPROVED") {
      const test = /software test authenticator/i.test(e.summary);
      approvedBy = test ? "by the software test authenticator" : "with your passkey";
      items.push({ seq: e.seq, ts: e.ts, kind: "approved", headline: test ? "Approved by the software test authenticator (tests only)." : "You approved it with your passkey.", steps: [
        { label: "Passkey signature over the exact terms", status: test ? "flag" : "ok", detail: `The signed challenge is the terms hash ${e.termsHash ? short(e.termsHash) : "?"}; changing any term breaks it.` },
        { label: "Recorded", status: "ok", detail: `Ledger entry #${e.seq}.` },
      ] });
    } else if (e.type === "REVOKED") {
      items.push({ seq: e.seq, ts: e.ts, kind: "revoked", headline: "You revoked this warrant. The agent's next action will be blocked.", steps: [
        { label: "Revoked", status: "ok", detail: `${e.summary} Ledger entry #${e.seq}.` },
      ] });
    } else if (e.type === "CHILD_ISSUED") {
      items.push({ seq: e.seq, ts: e.ts, kind: "child", headline: "Your agent handed a smaller part of this warrant to a helper agent.", steps: [
        { label: "Delegation that only shrinks", status: "ok", detail: `${e.summary} Ledger entry #${e.seq}.` },
      ] });
    } else if (e.type === "DECISION") {
      const exec = e.decisionId ? execByDecision.get(e.decisionId) : undefined;
      const amount = e.action?.amountCents ?? 0;
      const before = left;
      if (e.decision === "allow") {
        left -= amount;
        const after = left;
        if (exec?.outcome === "rejected") left += amount;
        const outcome = exec?.outcome ?? "none";
        const where = place(e.action?.destination ?? "");
        const headline =
          outcome === "executed" ? actionPhrase(e.action, false)
          : outcome === "rejected" ? `${actionPhrase(e.action, true)}: allowed, but ${where} refused it; money released`
          : outcome === "unknown" ? `${actionPhrase(e.action, true)}: no answer from ${where}; money held`
          : `${actionPhrase(e.action, true)}: allowed, no execution record yet`;
        items.push({ seq: e.seq, ts: e.ts, kind: "allowed", headline, outcome, remainingAfterCents: left, steps: decisionTrace(e, exec, before, after, approvedBy) });
      } else {
        const code = e.reasonCode ?? "MALFORMED_REQUEST";
        items.push({
          seq: e.seq, ts: e.ts, kind: "blocked",
          headline: `${actionPhrase(e.action, true)}: blocked, ${reasonText(code, e.action)}`,
          remainingAfterCents: left,
          steps: decisionTrace(e, undefined, before, before, approvedBy),
        });
      }
    }
  }
  return items;
}
