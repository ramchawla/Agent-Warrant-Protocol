// HashFlow: a pipeline of labelled values that type in one after another (terms → canonical → SHA-256 → challenge → signature).
// <HashFlow steps={[{ label: "termsHash", value: hash, tone: "amber" }, …]} onDone={() => complete()} />
import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { spring, useElapsed } from "./util";

export type HashStep = {
  label: string;                         // plain-English name, e.g. "SHA-256 of the canonical terms"
  value: string;                         // the real value from the API
  tone?: "neutral" | "amber" | "green" | "red";
  note?: string;                         // tiny caption under the value
};

const toneClass = { neutral: "text-fg", amber: "text-amber", green: "text-green", red: "text-red" };

export function HashFlow({
  steps,
  direction = "column",
  stepMs = 700,
  play = true,
  onDone,
}: {
  steps: HashStep[];
  direction?: "row" | "column";
  stepMs?: number;      // time each value takes to type in
  play?: boolean;       // false = hold at empty; flip to true to start
  onDone?: () => void;  // fires once, after the last value finishes
}) {
  const total = steps.length * stepMs;
  const t = useElapsed(play, total + 50, steps.map((s) => s.value).join("|"));
  const done = useRef(false);
  useEffect(() => {
    if (t >= total && play && !done.current) {
      done.current = true;
      onDone?.();
    }
  }, [t, total, play, onDone]);

  const Arrow = direction === "row" ? ArrowRight : ArrowDown;
  return (
    <ol className={`flex ${direction === "row" ? "flex-row items-stretch gap-2" : "flex-col gap-1.5"}`}>
      {steps.map((s, i) => {
        const p = Math.min(1, Math.max(0, (t - i * stepMs) / stepMs));
        const shown = s.value.slice(0, Math.ceil(p * s.value.length));
        const started = p > 0;
        return (
          <li key={i} className={`flex ${direction === "row" ? "flex-1 flex-row items-center gap-2" : "flex-col"}`}>
            <motion.div
              initial={false}
              animate={{ opacity: started ? 1 : 0.28 }}
              transition={spring}
              className={`min-w-0 flex-1 rounded-xl border px-4 py-3 ${started ? "border-line-strong bg-raised" : "border-line bg-transparent"}`}
            >
              <div className="text-[13px] text-muted">{s.label}</div>
              <div className={`mt-1 min-h-[1.6em] font-mono text-[14px] leading-relaxed break-all ${toneClass[s.tone ?? "neutral"]}`}>
                {shown}
                {p > 0 && p < 1 && <span className="ml-px inline-block h-[1em] w-[2px] translate-y-[2px] bg-current opacity-70" />}
              </div>
              {s.note && p === 1 && <div className="mt-1 text-[12px] text-faint">{s.note}</div>}
            </motion.div>
            {i < steps.length - 1 && (
              <Arrow
                aria-hidden
                className={`shrink-0 text-faint transition-opacity duration-300 ${direction === "column" ? "mx-auto my-0.5" : ""} ${p === 1 ? "opacity-100" : "opacity-20"}`}
                size={16}
                strokeWidth={1.5}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
