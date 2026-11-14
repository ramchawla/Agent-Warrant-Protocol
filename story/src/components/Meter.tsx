// Meter: budget bar that animates between values (number counts, bar eases). Pass cents.
// <Meter label="Warrant budget left" value={50000} max={100000} />
import { useEffect, useState } from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import { spring, usd } from "./util";

export function Meter({
  value,
  max,
  label,
  format = usd,
  tone,
}: {
  value: number;                         // current (cents by default)
  max: number;
  label?: string;
  format?: (n: number) => string;        // default: usd(cents)
  tone?: "green" | "amber" | "red";      // default: green, amber under 50%, red at 0
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (reduce) return setShown(value);
    const c = animate(shown, value, { duration: 0.6, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(Math.round(v)) });
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce]);
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const t = tone ?? (value <= 0 ? "red" : pct < 0.5 ? "amber" : "green");
  const bar = { green: "bg-green", amber: "bg-amber", red: "bg-red" }[t];
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-4">
        {label && <span className="text-[13px] text-muted">{label}</span>}
        <span className="font-mono text-[15px] tabular-nums text-fg">
          {format(shown)} <span className="text-faint">/ {format(max)}</span>
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
        <motion.div className={`h-full rounded-full ${bar}`} initial={false} animate={{ width: `${pct * 100}%` }} transition={spring} />
      </div>
    </div>
  );
}
