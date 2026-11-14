// Shared motion + formatting helpers for chapters and components.
import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

/** The one spring every transition uses (≈450 ms, no overshoot you can see). */
export const spring = { type: "spring", stiffness: 260, damping: 30, mass: 0.9 } as const;

/** "$1,000" / "$84,000" from integer cents (drops .00, keeps real cents). */
export const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 ? 2 : 0 });

/** Milliseconds since `running` became true (rAF clock, stops after `until` ms; then returns Infinity).
 *  Returns Infinity under reduced motion, so reveals finish instantly. Change `restartKey` to replay. */
export function useElapsed(running = true, until = 8000, restartKey: unknown = null): number {
  const reduce = useReducedMotion();
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!running || reduce) return;
    setT(0);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const e = now - start;
      if (e >= until) return setT(Infinity);
      setT(e);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, reduce, until, restartKey]);
  return reduce ? Infinity : running ? t : 0;
}

/** Characters of `text` revealed after `elapsed` ms at `cps` chars/sec, starting at `delay`. */
export const typed = (text: string, elapsed: number, cps = 90, delay = 0) =>
  text.slice(0, Math.max(0, Math.floor(((elapsed - delay) / 1000) * cps)));
