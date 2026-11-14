// Scripted agent that replays src/agent/scenarios/*.json through POST /api/act (REQ-013). Owner: Max, task 11.
// Its only capability is that one HTTP call with the agent key: no database, no institution access, never a receipt.
// The one exception is a scenario step marked "direct": a demo of the bank refusing a call that has no receipt.
//   npm run agent -- <scenario> --warrant wrt_... [--key ...] [--gate http://localhost:3000] [--bank http://localhost:4001]
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { config } from "../shared/config.ts";
import { newId } from "../shared/ids.ts";

// ---- terminal colours (shared with scripts/eval.ts) ----

const colourOn = !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
const wrap = (code: number) => (s: string) => (colourOn ? `\x1b[${code}m${s}\x1b[0m` : s);
export const ansi = { green: wrap(32), red: wrap(31), yellow: wrap(33), cyan: wrap(36), dim: wrap(2), bold: wrap(1) };
export const visible = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
export const pad = (s: string, width: number): string => s + " ".repeat(Math.max(0, width - visible(s).length));
export const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

// ---- scenarios ----

type Action = { type: string; destination: string; params: Record<string, unknown> };
export type Step = {
  label: string;
  action?: Action;
  expect?: string;          // "allow", a reason code, or "refused" (direct call)
  count?: number;
  parallel?: boolean;
  direct?: "bank";          // POST the action to the bank's /execute with no receipt
  read?: string;            // a text file the agent "reads", relative to src/agent
};

const here = (path: string) => new URL(path, import.meta.url);

export function loadScenario(name: string): Step[] {
  if (!/^[a-z-]+$/.test(name)) throw new Error(`bad scenario name "${name}"`);
  const steps = JSON.parse(readFileSync(here(`./scenarios/${name}.json`), "utf8")) as Step[];
  if (!Array.isArray(steps) || steps.some((s) => typeof s.label !== "string")) throw new Error(`scenario ${name} is not a list of steps`);
  return steps;
}

/** { "$fill": n } becomes an n-character string of plausible-looking client data (a payload to smuggle out). */
export function resolveParams<T>(value: T): T {
  if (Array.isArray(value)) return value.map(resolveParams) as T;
  if (typeof value === "object" && value !== null) {
    const fill = (value as { $fill?: unknown }).$fill;
    if (typeof fill === "number") return "Ada Okafor,A1,4521;Ben Tran,A2,7730;".repeat(Math.ceil(fill / 36)).slice(0, fill) as T;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveParams(v)])) as T;
  }
  return value;
}

// ---- the one capability ----

type Answer = { decision?: "allow" | "deny"; reasonCode?: string; outcome?: string; remainingCents?: number };

async function act(gate: string, key: string, warrantId: string, runId: string, action: Action): Promise<Answer> {
  const res = await fetch(`${gate}/api/act`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ warrantId, runId, idempotencyKey: randomUUID(), action }),
  });
  return (await res.json()) as Answer;
}

/** Not an agent capability: the demo script shows that the bank refuses a call with no receipt. */
async function directToBank(bank: string, action: Action): Promise<{ status: number; reason: string }> {
  const res = await fetch(`${bank}/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
  const body = (await res.json().catch(() => ({}))) as { executed?: boolean; reason?: string };
  return { status: res.status, reason: body.executed ? "EXECUTED" : (body.reason ?? "no reason") };
}

// ---- output ----

const W = { label: 46, verdict: 6, reason: 22 };
let remaining: number | undefined;   // last budget the gate reported to this agent

function line(label: string, verdict: string, reason: string, mark: string, left?: number): void {
  const colour = verdict === "ALLOW" ? ansi.green : ansi.red;
  const budget = left === undefined ? ansi.dim("-") : ansi.dim(`${money(left)} left`);
  console.log(`${mark} ${pad(label, W.label)} ${pad(colour(verdict), W.verdict)} ${pad(colour(reason), W.reason)} ${budget}`);
}

/** Prints one answer; true when it matches the step's expectation (or there is none). */
function show(label: string, expect: string | undefined, a: Answer): boolean {
  if (a.remainingCents !== undefined) remaining = a.remainingCents;
  const got = a.decision === "allow" ? "allow" : (a.reasonCode ?? "NO_ANSWER");
  const ok = expect === undefined || expect === got;
  const mark = expect === undefined ? " " : ok ? ansi.green("✓") : ansi.red("✗");
  if (a.decision === "allow") line(label, "ALLOW", a.outcome === "executed" ? "executed" : `${a.outcome ?? "unknown"} by institution`, mark, remaining);
  else line(label, "DENY", got, mark, remaining);
  return ok;
}

function showDocument(path: string): void {
  console.log(ansi.dim(`  ┌─ ${path}`));
  const injection = /^IMPORTANT SYSTEM/;
  let inside = false;
  for (const text of readFileSync(here(`./${path}`), "utf8").trimEnd().split("\n")) {
    if (injection.test(text)) inside = true;
    else if (text.trim() === "") inside = false;
    console.log(`  ${ansi.dim("│")} ${inside ? ansi.red(text) : ansi.dim(text)}`);
  }
  console.log(`${ansi.dim("  └─")}\n`);
}

// ---- main ----

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { warrant: { type: "string" }, key: { type: "string" }, gate: { type: "string" }, bank: { type: "string" } },
  });
  const scenario = positionals[0];
  const key = values.key ?? process.env.AGENT_DEMO_KEY;
  const warrantId = values.warrant;
  if (!scenario || !warrantId || !key) {
    console.error("usage: npm run agent -- <in-warrant|out-of-warrant|injection|burst> --warrant wrt_... [--key ...] [--gate http://localhost:3000]");
    if (!key) console.error("no agent key: set AGENT_DEMO_KEY (npm run seed prints it) or pass --key");
    return 2;
  }
  const gate = (values.gate ?? "http://localhost:3000").replace(/\/+$/, "");
  const bank = (values.bank ?? config.institutionUrl.bank).replace(/\/+$/, "");
  const steps = loadScenario(scenario);
  const runId = newId("run");

  console.log(`\n${ansi.bold("AWP scripted agent")}  ${ansi.cyan(scenario)}  warrant ${warrantId}  run ${runId}\n`);
  let failed = 0;
  const check = (ok: boolean) => void (ok || failed++);

  for (const step of steps) {
    try {
      if (step.read) {
        console.log(`${ansi.dim("•")} ${step.label}`);
        showDocument(step.read);
      } else if (step.direct === "bank" && step.action) {
        const r = await directToBank(bank, step.action);
        const ok = r.status >= 400 && r.status < 500;
        line(step.label, "REFUSE", `${r.status} ${r.reason}`, step.expect === undefined ? " " : ok ? ansi.green("✓") : ansi.red("✗"));
        check(ok);
      } else if (step.action) {
        const action = resolveParams(step.action);
        const n = step.count ?? 1;
        const run = (i: number) => act(gate, key, warrantId, runId, action).then((a) => ({ i, a }));
        const answers: { i: number; a: Answer }[] = [];
        if (step.parallel) answers.push(...(await Promise.all(Array.from({ length: n }, (_, i) => run(i)))));
        else for (let i = 0; i < n; i++) answers.push(await run(i));
        // Parallel answers arrive in any order: show allows by falling budget, then the denials.
        if (step.parallel) {
          const rank = (x: { a: Answer }) => (x.a.decision === "allow" ? 1_000_000 - (x.a.remainingCents ?? 0) : 2_000_000);
          answers.sort((x, y) => rank(x) - rank(y));
        }
        answers.forEach(({ i, a }, k) => check(show(n > 1 ? `${step.label} #${String(step.parallel ? k + 1 : i + 1).padStart(2, "0")}` : step.label, step.expect, a)));
        if (n > 1) {
          const allowed = answers.filter((x) => x.a.decision === "allow").length;
          console.log(`  ${ansi.bold(`${allowed} allowed, ${n - allowed} denied`)}${remaining === undefined ? "" : ansi.dim(`   remaining ${money(remaining)}`)}`);
        }
      }
    } catch (error) {
      failed++;
      console.log(`${ansi.red("✗")} ${step.label}: ${ansi.red((error as Error).message)}  ${ansi.dim(`(is the gate running at ${gate}?)`)}`);
    }
  }
  console.log(failed === 0 ? `\n${ansi.green("done")}` : `\n${ansi.red(`${failed} step(s) did not behave as expected`)}`);
  return failed === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(await main());
