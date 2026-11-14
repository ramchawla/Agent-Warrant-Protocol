// Chapter 4: the agent buys $500; one atomic write at the gate; the brokerage verifies the receipt on its own.
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ShoppingCart } from "lucide-react";
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import * as api from "../api";
import type { DemoStepResponse, InstitutionChecks } from "../types";
import { useStory, useResult } from "../store";
import { AgentBubble } from "../components/AgentBubble";
import { Meter } from "../components/Meter";
import { PrimaryButton } from "../components/PrimaryButton";
import { Shorten } from "../components/Shorten";
import { spring, usd } from "../components/util";
import { AtomicInspector, CheckRow, ErrorNote, Ghost, Route } from "./s2/parts";
import { errText, useSteps } from "./s2/useSteps";

const actionLabel = "Let the agent buy $500";

// ms after the response: packet at gate, gate decides, receipt to brokerage, three checks, executed
const TIMES = [500, 1300, 2300, 3000, 3500, 4000, 4600];

type Saved = { res: DemoStepResponse; checks: InstitutionChecks | null };

function Artifact({ complete, Narrative }: ChapterProps) {
  const saved = useResult<Saved>(4);
  const { setResult, update } = useStory();
  const [run, setRun] = useState<Saved | null>(saved ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [revisit] = useState(!!saved); // coming back: show the end state at once
  const n = useSteps(TIMES, !!run, revisit);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.work();
      let checks = res.items[0]?.institutionChecks ?? null;
      if (!checks) checks = (await api.fintechState().catch(() => null))?.lastChecks ?? null;
      const s = { res, checks };
      setRun(s);
      setResult(4, s);
      update({ warrant: res.warrant });
      window.setTimeout(complete, TIMES[TIMES.length - 1] + 300);
    } catch (e) {
      setErr(`The gate did not answer: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const item = run?.res.items[0];
  const w = run?.res.warrant;
  const amount = Number(item?.action.params.amountCents ?? 50000);
  const merchant = String(item?.action.params.merchant ?? "BROKERAGE-NVDA");
  const allow = item?.decision === "allow";
  const checks = run?.checks;
  const executed = item?.outcome === "executed";
  const total = w?.totalLimitCents ?? 100000;
  const meterValue = !item ? total : n >= 7 ? item.remainingCents : item.remainingCents + (allow ? amount : 0);

  return (
    <>
      <Narrative>
        <PrimaryButton icon={ShoppingCart} busy={busy} disabled={!!run} onClick={go}>
          {actionLabel}
        </PrimaryButton>
        {err && <ErrorNote>{err}</ErrorNote>}
      </Narrative>

      <div className="flex flex-col gap-4">
        <div className="min-h-[64px]">
          {item ? (
            <AgentBubble text={item.agentText} />
          ) : (
            <p className="pt-5 text-[15px] text-faint">The agent holds a signed warrant. It has not tried anything yet.</p>
          )}
        </div>

        <Route
          stage={n >= 3 && allow ? 2 : n >= 1 ? 1 : 0}
          packet={n >= 2 && allow ? `receipt · ${usd(amount)}` : `${usd(amount)} NVDA`}
          verdict={n >= 2 ? item?.decision : undefined}
          dest={merchant}
        />

        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4">
          {item && n >= 2 ? <AtomicInspector trace={item.trace} /> : <Ghost>The gate's atomic write appears here.</Ghost>}

          {item && n >= 3 && item.receipt ? (
            <motion.section
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={spring}
              className="@container flex flex-col rounded-2xl border border-line bg-raised/95"
              aria-label="The brokerage's own checks"
            >
              <header className="border-b border-line px-4 py-3">
                <h3 className="text-[14px] font-medium text-fg">The brokerage checks for itself</h3>
                <p className="mt-0.5 text-[12px] text-faint">
                  Receipt for ledger entry #{item.receipt.ledger.seq}
                </p>
              </header>
              <ul className="divide-y divide-line px-4 py-1">
                <CheckRow label="Gate signature" ok={!!checks?.gateSignature} on={n >= 4} detail={<Shorten value={item.receipt.gateSig} head={6} tail={4} tone="muted" />} />
                <CheckRow label="Customer passkey" ok={!!checks?.customerPasskey} on={n >= 5} detail="Touch ID" />
                <CheckRow label="Within the terms" ok={!!checks?.terms} on={n >= 6} detail={`${usd(amount)} ≤ ${usd(w?.perActionMaxCents ?? amount)}`} />
              </ul>
              <div className="mt-auto flex min-h-[68px] items-center border-t border-line px-4 py-3">
                <AnimatePresence>
                  {n >= 7 && (
                    <div className="flex min-w-0 flex-col items-start gap-1.5">
                      <motion.div
                        initial={{ opacity: 0, scale: 1.5, rotate: -10 }}
                        animate={{ opacity: 1, scale: 1, rotate: -3 }}
                        transition={{ type: "spring", stiffness: 520, damping: 26, mass: 0.7 }}
                        className={`inline-flex rounded-md border-2 px-3 py-1 ${executed ? "border-green text-green" : "border-red text-red"}`}
                        role="status"
                      >
                        <span className="text-[18px] font-semibold tracking-[0.12em]">{executed ? "EXECUTED" : "REJECTED"}</span>
                      </motion.div>
                      {/* ponytail: the real ref (fin_pay_<16 hex>) is too long to sit inside the stamp */}
                      {checks?.institutionRef && <span className="max-w-full truncate font-mono text-[11.5px] text-faint">{checks.institutionRef}</span>}
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </motion.section>
          ) : (
            <Ghost>The brokerage's own checks appear here.</Ghost>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-raised/60 px-5 py-3.5">
          <Meter label="Warrant budget left" value={meterValue} max={total} />
        </div>
      </div>
    </>
  );
}

export default {
  number: 4,
  title: "The agent acts. The gate decides.",
  body: "Every claim passes one atomic check in the database. The brokerage then verifies the receipt on its own.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
