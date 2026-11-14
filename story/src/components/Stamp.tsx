// Stamp: ALLOWED / DENIED / TOUCH ID REQUIRED, lands with a small scale + rotate. Mount it when the decision arrives.
// <Stamp kind="denied" reason="PER_ACTION_LIMIT" />
import { motion, useReducedMotion } from "motion/react";

const look = {
  allowed: { text: "ALLOWED", cls: "text-green border-green", rot: -6 },
  denied: { text: "DENIED", cls: "text-red border-red", rot: -8 },
  touchid: { text: "TOUCH ID REQUIRED", cls: "text-amber border-amber", rot: -5 },
} as const;

export function Stamp({
  kind,
  reason,
  delay = 0,
  size = "md",
}: {
  kind: keyof typeof look;
  reason?: string;            // reason code shown under the word, e.g. "PER_ACTION_LIMIT"
  delay?: number;             // seconds
  size?: "sm" | "md" | "lg";
}) {
  const reduce = useReducedMotion();
  const l = look[kind];
  const word = { sm: "text-[15px] px-2.5 py-1", md: "text-[22px] px-4 py-1.5", lg: "text-[34px] px-5 py-2" }[size];
  return (
    <motion.div
      role="status"
      aria-label={`${l.text}${reason ? ` · ${reason}` : ""}`}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.9, rotate: l.rot - 10 }}
      animate={{ opacity: 1, scale: 1, rotate: l.rot }}
      transition={{ type: "spring", stiffness: 520, damping: 26, mass: 0.7, delay }}
      className={`inline-flex origin-center flex-col items-center rounded-md border-[2.5px] ${l.cls} mix-blend-screen`}
      style={{ boxShadow: "inset 0 0 0 1px color-mix(in oklab, currentColor 30%, transparent)" }}
    >
      <span className={`font-sans font-semibold tracking-[0.14em] ${word}`}>{l.text}</span>
      {reason && (
        <span className="-mt-1 px-3 pb-1.5 font-mono text-[11px] tracking-wider opacity-85">{reason}</span>
      )}
    </motion.div>
  );
}
