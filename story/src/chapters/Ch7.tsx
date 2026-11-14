// Chapter 7. Shape documented at the top of src/ChapterShell.tsx.
// Burst: 20 dots launch the instant the button is pressed and hover at the gate until POST /api/demo/burst answers;
// then each dot resolves to exactly what its item says (allow → through the gate, deny → bounced back). Revoke greys
// the warrant and the next claim stamps DENIED · <reasonCode from the response>.
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Ban, ShieldCheck, Zap } from "lucide-react";
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import * as api from "../api";
import type { DemoItem, DemoStepResponse, WarrantSummary } from "../types";
import { useResult, useStory } from "../store";
import { PrimaryButton } from "../components/PrimaryButton";
import { Meter } from "../components/Meter";
import { Stamp } from "../components/Stamp";
import { spring, usd } from "../components/util";

const actionLabel = "Fire 20 at once";
const GATE_X = 50; // % of arena width

type Phase = "idle" | "flying" | "landed" | "revoking" | "revoked";
type Saved = { burst: DemoStepResponse; revoke?: DemoStepResponse };

// Where dot i sits in each phase (percent of arena).
const start = (i: number) => ({ left: 8 + (i % 4) * 4.4, top: 24 + Math.floor(i / 4) * 13 });
const queue = (i: number, n: number) => {
  const a = (i / n) * Math.PI * 2;
  return { left: GATE_X - 8 + Math.cos(a) * 3.2, top: 52 + Math.sin(a) * 24 };
};
const slot = (k: number, side: "allow" | "deny") => {
  const col = k % 5, row = Math.floor(k / 5);
  return { left: (side === "allow" ? 66 : 9) + col * 6, top: 40 + row * 15 };
};

function Arena({ phase, items, n }: { phase: Phase; items: DemoItem[] | null; n: number }) {
  const reduce = useReducedMotion();
  // rank within its side, so allowed fill the right grid and denied the left, in response order
  let a = 0, d = 0;
  const ranks = items?.map((it) => (it.decision === "allow" ? a++ : d++)) ?? [];
  const resolved = !!items && phase !== "flying";
  return (
    <div className="relative h-[290px] overflow-hidden rounded-xl border border-line bg-sunk/80">
      <div className="absolute left-5 top-4 text-[13px] text-muted">{resolved ? "Refused at the gate" : "The agent"}</div>
      <div className="absolute right-5 top-4 text-right text-[13px] text-muted">Reached the brokerage</div>

      {/* the gate */}
      <div className="absolute bottom-10 top-12 w-px" style={{ left: `${GATE_X}%` }}>
        <motion.div
          className="absolute inset-0 w-px bg-amber"
          initial={false}
          animate={{ opacity: phase === "flying" ? [0.35, 1, 0.35] : 0.75 }}
          transition={phase === "flying" ? { duration: 0.9, repeat: Infinity } : spring}
        />
        <div className="absolute inset-y-0 -left-8 w-16 bg-[radial-gradient(ellipse_at_center,rgba(245,181,68,0.18),transparent_70%)]" />
      </div>
      <div className="absolute bottom-4 -translate-x-1/2 text-[12px] text-amber/90" style={{ left: `${GATE_X}%` }}>The gate</div>

      {Array.from({ length: n }, (_, i) => {
        const it = items?.[i];
        const done = resolved && !!it;
        const pos = phase === "idle" ? start(i) : !done ? queue(i, n) : slot(ranks[i], it.decision);
        const tone = !done ? "bg-fg" : it.decision === "allow" ? "bg-green" : "bg-red";
        const glow = !done ? "shadow-[0_0_10px_rgba(236,235,232,0.35)]" : it.decision === "allow" ? "shadow-[0_0_14px_rgba(61,220,151,0.75)]" : "shadow-[0_0_14px_rgba(255,90,95,0.65)]";
        const waiting = phase === "flying" && !reduce;
        return (
          <motion.span
            key={i}
            aria-hidden
            className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[background-color,box-shadow] duration-300 ${tone} ${glow}`}
            style={{ transitionDelay: done ? `${i * 45 + 220}ms` : "0ms" }}
            initial={false}
            animate={{
              left: `${pos.left}%`,
              top: waiting ? [`${pos.top}%`, `${pos.top + 3}%`, `${pos.top}%`] : `${pos.top}%`,
              opacity: phase === "idle" ? 0.4 : 1,
            }}
            transition={
              waiting
                ? { left: { ...spring, delay: i * 0.012 }, top: { duration: 1 + (i % 5) * 0.13, repeat: Infinity, ease: "easeInOut" } }
                : { ...spring, delay: done ? i * 0.045 : 0 }
            }
          />
        );
      })}
    </div>
  );
}

function WarrantCard({ w, revoked }: { w: WarrantSummary | null; revoked: boolean }) {
  return (
    <div className={`rounded-xl border bg-raised px-5 py-4 transition-colors duration-700 ${revoked ? "border-line" : "border-line-strong"}`}>
      <div className="flex items-center justify-between gap-4">
        <motion.div
          initial={false}
          animate={{ filter: revoked ? "grayscale(1)" : "grayscale(0)", opacity: revoked ? 0.45 : 1 }}
          transition={{ duration: 0.8 }}
          className="flex items-center gap-2.5 text-[14px] text-fg"
        >
          <ShieldCheck size={16} className="text-amber" aria-hidden />
          Warrant <span className="font-mono text-[13px] text-muted">{w?.warrantId ?? "…"}</span>
        </motion.div>
        <span className={`rounded-full border px-2.5 py-0.5 text-[12px] ${w?.status === "revoked" ? "border-red/60 text-red" : "border-green/40 text-green"}`}>
          {w?.status ?? "active"}
        </span>
      </div>
      <motion.div
        initial={false}
        animate={{ filter: revoked ? "grayscale(1)" : "grayscale(0)", opacity: revoked ? 0.45 : 1 }}
        transition={{ duration: 0.8 }}
        className="mt-3"
      >
        <Meter label="Budget left" value={w?.remainingCents ?? 50000} max={w?.totalLimitCents ?? 100000} />
      </motion.div>
    </div>
  );
}

function Artifact({ complete, Narrative }: ChapterProps) {
  const { state, update, setResult } = useStory();
  const saved = useResult<Saved>(7);
  const [burst, setBurst] = useState<DemoStepResponse | null>(saved?.burst ?? null);
  const [revoke, setRevoke] = useState<DemoStepResponse | null>(saved?.revoke ?? null);
  const [phase, setPhase] = useState<Phase>(saved?.revoke ? "revoked" : saved?.burst ? "landed" : "idle");
  const [error, setError] = useState<string | null>(null);

  // ponytail: before the burst the card shows the store's warrant (set by chapter 4); else the $500-left demo value
  const warrant = revoke?.warrant ?? burst?.warrant ?? state.warrant;

  const fire = async () => {
    setError(null);
    setPhase("flying");
    try {
      const r = await api.burst();
      setBurst(r);
      setPhase("landed");
      update({ warrant: r.warrant });
      setResult(7, { burst: r });
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
    }
  };

  const doRevoke = async () => {
    setError(null);
    setPhase("revoking");
    try {
      const r = await api.revoke();
      setRevoke(r);
      setPhase("revoked");
      update({ warrant: r.warrant });
      setResult(7, { burst, revoke: r });
      complete();
    } catch (e) {
      setError((e as Error).message);
      setPhase("landed");
    }
  };

  const c = burst?.counts;
  const after = revoke?.items[0];
  const n = burst?.items.length || 20;

  return (
    <>
      <Narrative>
        {phase === "idle" || phase === "flying" ? (
          <PrimaryButton icon={Zap} busy={phase === "flying"} onClick={fire}>{actionLabel}</PrimaryButton>
        ) : (
          <PrimaryButton icon={Ban} tone="red" busy={phase === "revoking"} disabled={phase === "revoked"} onClick={doRevoke}>
            {phase === "revoked" ? "Revoked" : "Revoke"}
          </PrimaryButton>
        )}
        {error && <p role="alert" className="w-full text-[13px] text-red">{error}</p>}
      </Narrative>

      <div className="flex flex-col gap-4">
        <WarrantCard w={warrant} revoked={phase === "revoked"} />
        <Arena phase={phase === "revoking" || phase === "revoked" ? "landed" : phase} items={burst?.items ?? null} n={n} />

        {/* counter: every number comes from response.counts */}
        <div className="min-h-[72px] px-1">
          <AnimatePresence mode="wait">
            {c ? (
              <motion.div key="c" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: saved ? 0 : 1 }}>
                <p className="font-display text-[clamp(1.8rem,2.8vw,2.6rem)] leading-none tabular-nums text-fg">
                  <span className="text-green">{c.allowed} allowed</span>
                  <span className="text-faint"> · </span>
                  <span className="text-red">{c.denied} denied</span>
                  <span className="text-faint"> · </span>
                  {usd(c.remainingCents)} left
                </p>
                <p className="mt-2.5 text-[14px] text-muted">
                  {/* ponytail: live elapsedMs is ~20 s (each allowed buy settles at the brokerage), so it is not shown */}
                  {c.allowed + c.denied} purchases in parallel. Each is one atomic write, so no two can spend the same dollar.
                </p>
              </motion.div>
            ) : (
              <motion.p key="w" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-2 text-[15px] text-muted">
                {phase === "flying"
                  ? "Twenty purchases of $50 hit the gate at the same moment…"
                  : `Twenty purchases of $50, fired at once, against ${usd(warrant?.remainingCents ?? 50000)} left.`}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* the claim after revoking */}
        <AnimatePresence>
          {after && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
              className="flex items-center justify-between gap-6 rounded-xl border border-red/30 bg-red/[0.05] px-5 py-4"
            >
              <div className="min-w-0">
                <div className="text-[12px] text-faint">Next claim · ledger event {after.seq}</div>
                <div className="mt-1 text-[16px] text-fg">{after.agentText}</div>
                <div className="mt-1 font-mono text-[12px] text-muted">
                  matched {after.trace.atomicUpdate.matched} · {after.trace.gateMs} ms
                </div>
              </div>
              <Stamp kind={after.decision === "allow" ? "allowed" : "denied"} reason={after.reasonCode} delay={0.25} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

export default {
  number: 7,
  title: "Limits hold under pressure.",
  body: "Twenty purchases fired at once cannot overspend the warrant. Revoke it, and the very next claim is refused.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
