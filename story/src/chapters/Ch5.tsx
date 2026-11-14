// Chapter 5: three out-of-bounds claims, ~1 s apart, each denied by the same atomic filter matching nothing.
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Landmark, Zap } from "lucide-react";
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import * as api from "../api";
import type { DemoItem, DemoStepResponse } from "../types";
import { useStory, useResult } from "../store";
import { Meter } from "../components/Meter";
import { PrimaryButton } from "../components/PrimaryButton";
import { Stamp } from "../components/Stamp";
import { spring, usd } from "../components/util";
import { AtomicInspector, Claim, ErrorNote, Ghost, failingKey } from "./s2/parts";
import { errText, useSteps } from "./s2/useSteps";

const actionLabel = "Let the agent loose";

// claim i appears at 1100·i ms, its stamp lands 700 ms later
const TIMES = [0, 700, 1100, 1800, 2200, 2900];

/** One plain line on why the claim fell outside the warrant, built from the claim and the warrant. */
function why(it: DemoItem, perActionMaxCents: number) {
  const p = it.action.params;
  switch (it.reasonCode) {
    case "PER_ACTION_LIMIT":
      return `${usd(Number(p.amountCents))} asked · ${usd(perActionMaxCents)} per action allowed`;
    case "MERCHANT_NOT_ALLOWED":
      return `${String(p.merchant)} is not in the warrant`;
    case "DESTINATION_NOT_ALLOWED":
      return `${it.action.destination} is not an allowed destination`;
    default:
      return it.reasonCode ?? "";
  }
}

function Artifact({ complete, Narrative }: ChapterProps) {
  const saved = useResult<DemoStepResponse>(5);
  const { setResult, update } = useStory();
  const [res, setRes] = useState<DemoStepResponse | null>(saved ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [revisit] = useState(!!saved);
  const times = TIMES.slice(0, (res?.items.length ?? 3) * 2);
  const n = useSteps(times, !!res, revisit);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.blocked();
      setRes(r);
      setResult(5, r);
      update({ warrant: r.warrant });
      window.setTimeout(complete, TIMES[r.items.length * 2 - 1] + 600);
    } catch (e) {
      setErr(`The gate did not answer: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const items = res?.items ?? [];
  const landed = Math.floor(n / 2); // stamps that have landed
  const current = landed > 0 ? items[landed - 1] : undefined;
  const reached = items.slice(0, landed).filter((i) => i.decision === "allow").length;
  const w = res?.warrant;

  return (
    <>
      <Narrative>
        <PrimaryButton icon={Zap} tone="red" busy={busy} disabled={!!res} onClick={go}>
          {actionLabel}
        </PrimaryButton>
        {err && <ErrorNote>{err}</ErrorNote>}
      </Narrative>

      <div className="flex flex-col gap-5">
        <ol className="flex min-h-[240px] flex-col gap-3.5" aria-label="Agent claims">
          {!res && <p className="pt-2 text-[15px] text-faint">The agent still holds the same warrant. Now it starts improvising.</p>}
          {items.map((it, i) =>
            n >= i * 2 + 1 ? (
              <li key={it.decisionId}>
                <Claim
                  text={it.agentText}
                  aside={n >= i * 2 + 2 ? <Stamp kind={it.decision === "allow" ? "allowed" : "denied"} reason={it.reasonCode} size="sm" /> : null}
                  note={
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: n >= i * 2 + 2 ? 1 : 0 }}
                      transition={spring}
                      className="mt-1.5 font-mono text-[12px] text-muted"
                    >
                      {why(it, w?.perActionMaxCents ?? 50000)}
                    </motion.p>
                  }
                />
              </li>
            ) : null,
          )}
        </ol>

        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4">
          {current ? (
            <AtomicInspector key={current.decisionId} trace={current.trace} fail={failingKey[current.reasonCode ?? ""]} />
          ) : (
            <Ghost h={290}>Each claim runs the same atomic write. Watch what it matches.</Ghost>
          )}

          <section aria-label="Brokerage" className="flex flex-col rounded-2xl border border-line bg-raised/95">
            <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
              <Landmark size={16} strokeWidth={1.75} className="text-muted" aria-hidden />
              <h3 className="text-[14px] font-medium text-fg">Brokerage</h3>
            </header>
            <div className="flex flex-1 flex-col justify-center px-5 py-4">
              <div className="flex items-baseline gap-3">
                <span className={`font-display text-[clamp(44px,5vw,64px)] leading-none ${landed ? "text-fg" : "text-faint"}`}>{reached}</span>
                <span className="text-[14px] text-muted">orders received</span>
              </div>
              <AnimatePresence>
                {res && landed === items.length && reached === 0 && (
                  <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="mt-3 text-[15px] text-fg" role="status">
                    Nothing reached the brokerage.
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
            <div className="border-t border-line px-5 py-4">
              <Meter label="Budget left" value={w?.remainingCents ?? 50000} max={w?.totalLimitCents ?? 100000} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default {
  number: 5,
  title: "Anything beyond the warrant is denied.",
  body: "The agent gets excited, distracted and tricked. Every claim outside the warrant stops before anything moves.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
