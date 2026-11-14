// Chapter 4–6 building blocks (local variants; the shared components stay untouched).
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Bot, Check, Landmark, ShieldCheck, X } from "lucide-react";
import type { Trace } from "../../types";
import { Shorten } from "../../components/Shorten";
import { spring } from "../../components/util";

/** Which filter key a reason code points at, so the failing condition can be marked. */
export const failingKey: Record<string, string> = {
  PER_ACTION_LIMIT: "terms.perActionMaxCents",
  MERCHANT_NOT_ALLOWED: "terms.merchants",
  DESTINATION_NOT_ALLOWED: "terms.destinations",
  ACCOUNT_NOT_ALLOWED: "terms.accounts",
  TOTAL_LIMIT: "state.remainingCents",
  BUDGET_EXHAUSTED: "state.remainingCents",
  WARRANT_EXPIRED: "expiresAt",
  WARRANT_REVOKED: "status",
};

function Val({ v }: { v: unknown }) {
  if (typeof v === "string" && /^[A-Za-z0-9_-]{30,}$/.test(v)) return <Shorten value={v} head={10} tail={6} tone="muted" />;
  // { "$gte": 50000 } reads as "$gte 50000": same query, half the width
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const ops = Object.entries(v as Record<string, unknown>);
    if (ops.every(([k]) => k.startsWith("$")))
      return (
        <span>
          {ops.map(([k, x]) => (
            <span key={k}>
              <span className="text-amber/90">{k}</span> {JSON.stringify(x)}{" "}
            </span>
          ))}
        </span>
      );
  }
  return <span>{JSON.stringify(v)}</span>;
}

/**
 * Compact gate inspector: the findOneAndUpdate filter as one row per condition (fits the 60% stage without scrolling),
 * matched 0|1 and gate time. `fail` marks the condition the reason code points at.
 */
/** A warrant condition the claim failed: `path` in the stored warrant, the claim's value, one human line. */
export type FailedCheck = { path: string; value: unknown; why: string };

export function AtomicInspector({ trace, fail, check, shown = true }: { trace: Trace; fail?: string; check?: FailedCheck; shown?: boolean }) {
  const a = trace.atomicUpdate;
  const ok = a.matched === 1;
  const rows = Object.entries(a.filter);
  // The gate checks the warrant's scope before the write; when it refuses there, the filter has no row for it, so the
  // failed condition is shown under the filter instead.
  const outside = check && !(fail && fail in a.filter) ? check : undefined;
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: shown ? 1 : 0.35, y: 0 }}
      transition={spring}
      aria-label="Gate inspector"
      className="@container flex flex-col rounded-2xl border border-line bg-raised/95"
    >
      <header className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <h3 className="whitespace-nowrap text-[14px] font-medium text-fg">One atomic write</h3>
        <span className="hidden truncate font-mono text-[12px] text-faint @[23rem]:inline">warrants.findOneAndUpdate</span>
      </header>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 @[24rem]:gap-x-4 gap-y-1 px-4 py-3 font-mono text-[12.5px] leading-[1.55]">
        {rows.map(([k, v], i) => {
          const bad = fail === k;
          return (
            <motion.div
              key={k}
              className="contents"
              initial={{ opacity: 0 }}
              animate={{ opacity: shown ? 1 : 0 }}
              transition={{ ...spring, delay: shown ? i * 0.05 : 0 }}
            >
              <dt className={bad ? "text-red" : "text-muted"}>{k}</dt>
              <dd className={`min-w-0 break-all ${bad ? "text-red" : "text-fg"}`}>
                <Val v={v} />
                {bad && <span className="ml-2 whitespace-nowrap text-[11px] text-red/80">no match</span>}
              </dd>
            </motion.div>
          );
        })}
      </dl>
      {outside && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: shown ? 1 : 0, y: 0 }}
          transition={{ ...spring, delay: shown ? rows.length * 0.05 + 0.1 : 0 }}
          className="border-t border-red/30 bg-red/[0.06] px-4 py-2.5"
        >
          <div className="text-[11.5px] text-red/80">Checked against the warrant first · {outside.why}</div>
          <div className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 @[24rem]:gap-x-4 font-mono text-[12.5px] leading-[1.55] text-red">
            <span>{outside.path}</span>
            <span className="min-w-0 break-all">
              <Val v={outside.value} />
              <span className="ml-2 whitespace-nowrap text-[11px] text-red/80">no match</span>
            </span>
          </div>
        </motion.div>
      )}
      <footer className="mt-auto grid grid-cols-2 border-t border-line">
        <div className="border-r border-line px-4 py-2.5">
          <div className="text-[12px] text-faint">matched</div>
          <div className={`font-mono text-[18px] ${ok ? "text-green" : "text-red"}`}>
            {a.matched} <span className="text-[14px]">→ {ok ? "allow" : "deny"}</span>
          </div>
        </div>
        <div className="px-4 py-2.5">
          <div className="text-[12px] text-faint">gate time</div>
          <div className="font-mono text-[18px] text-fg">
            {trace.gateMs} <span className="text-[14px] text-muted">ms</span>
          </div>
        </div>
      </footer>
    </motion.section>
  );
}

/** Agent → gate → brokerage rail with a packet. stage: 0 idle, 1 at gate, 2 at brokerage. */
export function Route({
  stage,
  packet,
  verdict,
  dest = "Brokerage",
}: {
  stage: 0 | 1 | 2;
  packet: string;
  verdict?: "allow" | "deny";
  dest?: string;
}) {
  const pos = ["0%", "50%", "100%"][stage];
  const tone = verdict === "allow" ? "green" : verdict === "deny" ? "red" : "fg";
  const node = (on: boolean, color: string) =>
    `grid h-12 w-12 place-items-center rounded-full border bg-ink transition-colors duration-500 ${on ? color : "border-line-strong text-muted"}`;
  const col = (on: boolean, color: string, Icon: typeof Bot, label: string) => (
    <div className="relative z-10 flex w-32 flex-col items-center gap-2">
      <span className={node(on, color)}>
        <Icon size={20} strokeWidth={1.6} aria-hidden />
      </span>
      <span className="whitespace-nowrap text-[12px] text-faint">{label}</span>
    </div>
  );
  const gateOn = stage >= 1 && !!verdict;
  const gateColor =
    verdict === "deny"
      ? "border-red text-red shadow-[0_0_32px_-6px_var(--color-red)]"
      : "border-green text-green shadow-[0_0_32px_-6px_var(--color-green)]";
  return (
    <div className="relative pt-9">
      <div className="absolute inset-x-16 top-[60px] h-px bg-line-strong" aria-hidden />
      <div className="absolute inset-x-16 top-[60px]" aria-hidden>
        <motion.div
          className={`h-px ${verdict === "deny" ? "bg-red/70" : "bg-green/70"}`}
          initial={false}
          animate={{ width: pos }}
          transition={{ duration: 0.8, ease: [0.65, 0, 0.35, 1] }}
        />
      </div>
      <div className="flex justify-between">
        {col(true, "border-line-strong text-fg", Bot, "Agent")}
        {col(gateOn, gateColor, ShieldCheck, "Warrant gate")}
        {col(stage === 2, "border-green text-green", Landmark, dest)}
      </div>
      {/* packet rides the rail */}
      <div className="pointer-events-none absolute inset-x-16 top-[60px] z-20" aria-hidden>
        <motion.span className="absolute top-0" initial={false} animate={{ left: pos }} transition={{ duration: 0.8, ease: [0.65, 0, 0.35, 1] }}>
          <span
            className={`block -translate-x-1/2 -translate-y-[calc(100%+32px)] whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[12px] ${
              tone === "green" ? "border-green/60 bg-green/10 text-green" : tone === "red" ? "border-red/60 bg-red/10 text-red" : "border-line-strong bg-raised text-fg"
            }`}
          >
            {packet}
          </span>
        </motion.span>
      </div>
    </div>
  );
}

export function CheckRow({ label, ok, on, detail }: { label: string; ok: boolean; on: boolean; detail?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <motion.span
        initial={false}
        animate={{ scale: on ? 1 : 0.6, opacity: on ? 1 : 0.25 }}
        transition={{ type: "spring", stiffness: 520, damping: 24 }}
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${on ? (ok ? "bg-green/15 text-green" : "bg-red/15 text-red") : "bg-line text-faint"}`}
      >
        {ok ? <Check size={14} strokeWidth={2.5} aria-hidden /> : <X size={14} strokeWidth={2.5} aria-hidden />}
      </motion.span>
      <span className={`whitespace-nowrap text-[14px] transition-colors duration-300 ${on ? "text-fg" : "text-faint"}`}>{label}</span>
      {detail && on && <span className="ml-auto hidden whitespace-nowrap font-mono text-[12px] text-muted @[20rem]:inline">{detail}</span>}
    </li>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="w-full max-w-[34ch] text-[13px] leading-snug text-red">
      {children}
    </p>
  );
}

export function Ghost({ children, h = 300 }: { children: ReactNode; h?: number }) {
  return (
    <div style={{ minHeight: h }} className="grid place-items-center rounded-2xl border border-dashed border-line px-6 text-center text-[13px] text-faint">
      {children}
    </div>
  );
}

/** Agent claim without the name line (tighter than AgentBubble, for stacks of claims). */
export function Claim({ text, aside, note }: { text: string; aside?: ReactNode; note?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={spring} className="flex items-start gap-3">
      <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line-strong bg-raised text-muted">
        <Bot size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-4">
          <p className="rounded-2xl rounded-tl-sm border border-line bg-raised px-4 py-2.5 text-[16px] leading-snug text-fg">{text}</p>
          {aside}
        </div>
        {note}
      </div>
    </motion.div>
  );
}
