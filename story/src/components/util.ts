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

/** Plain-language label for a policy action code (the code itself is shown small beside it). */
export const policyAction = (code: string) =>
  ({ REQUIRE_TOUCH_ID: "Touch ID required", DENY: "Blocked", ALLOW: "Allowed" })[code] ?? code;

/** One short human line per gate reason code; unknown codes fall back to "". */
export const reasonLine = (code?: string) =>
  ({
    PER_ACTION_LIMIT: "Over the per-purchase limit",
    MERCHANT_NOT_ALLOWED: "Merchant not in the warrant",
    DESTINATION_NOT_ALLOWED: "Destination not in the warrant",
    ACCOUNT_NOT_ALLOWED: "Account not in the warrant",
    BUDGET_EXHAUSTED: "Not enough budget left",
    ACTION_NOT_ALLOWED: "Action not in the warrant",
    FIELD_NOT_ALLOWED: "Field not in the warrant",
    FIELD_CONSTRAINT: "Field outside its limits",
    CURRENCY_MISMATCH: "Wrong currency",
    AMOUNT_INVALID: "Invalid amount",
    WARRANT_NOT_YET_VALID: "The warrant is not valid yet",
    WARRANT_NOT_FOUND: "No such warrant",
    AGENT_MISMATCH: "Wrong agent",
    AGENT_UNAUTHENTICATED: "Agent not signed in",
    MALFORMED_REQUEST: "Malformed request",
    LEDGER_UNAVAILABLE: "Ledger unavailable",
    WARRANT_REVOKED: "The warrant was revoked",
    WARRANT_EXPIRED: "The warrant has expired",
    WARRANT_NOT_ACTIVE: "The warrant is not active",
    TERMS_TAMPERED: "The stored terms were changed",
    APPROVAL_REQUIRED: "Waiting for Touch ID",
  } as Record<string, string>)[code ?? ""] ?? "";
