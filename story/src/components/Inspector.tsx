// Inspector: what the gate actually did for one decision — the atomic findOneAndUpdate filter, matched 0|1, gate time,
// plus the minimize diff and Atlas Vector Search match when the trace has them.
// <Inspector trace={item.trace} decision={item.decision} />
import type { ReactNode } from "react";
import { motion } from "motion/react";
import type { Trace } from "../types";
import { CodeCard } from "./CodeCard";
import { spring } from "./util";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-mono text-[14px] text-fg">{children}</span>
    </div>
  );
}

export function Inspector({
  trace,
  decision,
  sections = ["atomic", "minimize", "semantic"],
  maxHeight = 220,
}: {
  trace: Trace;
  decision?: "allow" | "deny";
  sections?: ("atomic" | "minimize" | "semantic")[];   // which parts to show (when present in the trace)
  maxHeight?: number;                                   // code well height
}) {
  const { atomicUpdate: a, minimize: m, semantic: s } = trace;
  const ok = a.matched === 1;
  return (
    <motion.aside
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="rounded-2xl border border-line bg-raised/95 p-4 backdrop-blur"
      aria-label="Gate inspector"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14px] font-medium text-fg">Gate inspector</h3>
        <span className="font-mono text-[12px] text-faint">{trace.gateMs} ms</span>
      </div>

      {sections.includes("atomic") && (
        <>
          <CodeCard title="findOneAndUpdate filter (one atomic write)" value={a.filter} maxHeight={maxHeight} />
          <div className="mt-2 divide-y divide-line">
            <Row label="matched">
              <span className={ok ? "text-green" : "text-red"}>
                {a.matched} {decision ? `→ ${decision}` : ok ? "→ allow" : "→ deny"}
              </span>
            </Row>
            <Row label="gate time">{trace.gateMs} ms</Row>
          </div>
        </>
      )}

      {m && sections.includes("minimize") && (
        <div className="mt-4 border-t border-line pt-3">
          <Row label="removed before sending">
            {m.removed.map((r) => (
              <span key={r} className="ml-2 text-red line-through decoration-red/70">{r}</span>
            ))}
          </Row>
          <Row label="tokens">
            {m.tokensBefore} → <span className="text-green">{m.tokensAfter}</span>{" "}
            <span className="text-faint">(−{Math.round((1 - m.tokensAfter / Math.max(1, m.tokensBefore)) * 100)}%)</span>
          </Row>
        </div>
      )}

      {s && sections.includes("semantic") && (
        <div className="mt-4 border-t border-line pt-3">
          <Row label={s.path === "vector" ? "Atlas Vector Search" : "keyword fallback"}>
            score <span className="text-amber">{s.topScore.toFixed(2)}</span>
          </Row>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
            <motion.div
              className="h-full rounded-full bg-amber"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(1, s.topScore) * 100}%` }}
              transition={{ ...spring, delay: 0.2 }}
            />
          </div>
          <p className="mt-2.5 text-[14px] leading-snug text-fg">“{s.rule}”</p>
          <p className="mt-1 font-mono text-[12px] text-muted">
            {s.action === "REQUIRE_FACEID" ? "Touch ID required" : s.action.toLowerCase()} · {s.policyId}
          </p>
        </div>
      )}
    </motion.aside>
  );
}
