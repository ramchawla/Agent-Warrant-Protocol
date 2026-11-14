// Reveal clock for chapters 4–6: returns how many of `times` (ms after start) have passed.
// start=false holds at 0; `instant` (revisit or reduced motion) jumps to the end.
import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

export function useSteps(times: number[], start: boolean, instant = false): number {
  const reduce = useReducedMotion();
  const skip = instant || !!reduce;
  const [n, setN] = useState(0);
  const key = times.join(",");
  useEffect(() => {
    if (!start) return setN(0);
    if (skip) return setN(times.length);
    setN(0);
    const ids = times.map((t, i) => window.setTimeout(() => setN((c) => Math.max(c, i + 1)), t));
    return () => ids.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, skip, key]);
  return n;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
