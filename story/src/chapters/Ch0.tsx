// Chapter 0: cold open. A bank sign-in card slides to the agent, then gets struck out. No endpoint.
import { motion, useReducedMotion } from "motion/react";
import { Bot, Landmark, Lock } from "lucide-react";
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { spring, typed, useElapsed } from "../components/util";

const actionLabel = "Issue a warrant instead";
const DOTS = "••••••••••••";

function Artifact({ complete, next, Narrative }: ChapterProps) {
  const reduce = useReducedMotion();
  const t = useElapsed(true, 5200);
  const handed = t >= 1700;
  const struck = t >= 2600;
  const said = t >= 3300;

  return (
    <>
      <Narrative>
        <PrimaryButton
          tone="amber"
          onClick={() => {
            complete();
            next();
          }}
        >
          {actionLabel}
        </PrimaryButton>
      </Narrative>

      <div className="mx-auto flex max-w-[620px] flex-col">
        <div className="flex flex-wrap items-center justify-between gap-6">
          {/* the sign-in card being handed over */}
          <motion.div
            animate={reduce ? {} : { x: handed ? 96 : 0, rotate: handed ? 2.5 : 0, scale: handed ? 0.95 : 1 }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
            className="relative z-10 w-[340px] shrink-0 rounded-2xl border border-line-strong bg-raised p-6 shadow-[0_40px_90px_-40px_rgba(0,0,0,0.95)]"
          >
            <div className="flex items-center gap-2.5 text-[14px] text-muted">
              <Landmark size={16} strokeWidth={1.75} aria-hidden /> Your bank: sign in
            </div>
            <div className="mt-5 text-[12px] text-faint">Username</div>
            <div className="mt-1.5 rounded-lg border border-line bg-sunk px-3 py-2.5 font-mono text-[14px] text-fg">ram.chawla</div>
            <div className="mt-4 text-[12px] text-faint">Password</div>
            <div className="mt-1.5 flex h-[42px] items-center gap-2.5 rounded-lg border border-line bg-sunk px-3 font-mono text-[15px] tracking-[0.2em] text-fg">
              <Lock size={13} className="shrink-0 text-faint" aria-hidden />
              {typed(DOTS, t, 10, 200)}
            </div>
            <p className="mt-5 text-[13px] leading-snug text-muted">
              Full access. Any amount, any account, any time, and no record of who did it.
            </p>

            {/* the strike: one red stroke corner to corner */}
            <motion.span
              aria-hidden
              className="pointer-events-none absolute bottom-[-10px] left-[-14px] h-[5px] w-[132%] origin-left rounded-full bg-red shadow-[0_0_24px_rgba(255,90,95,0.55)]"
              style={{ rotate: -41 }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: struck ? 1 : 0 }}
              transition={{ duration: 0.42, ease: [0.65, 0, 0.35, 1] }}
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring, delay: 0.3 }}
            className="flex shrink-0 flex-col items-center gap-3"
          >
            <span className={`grid h-24 w-24 place-items-center rounded-full border bg-raised transition-colors duration-500 ${struck ? "border-red/50 text-red" : "border-line-strong text-muted"}`}>
              <Bot size={44} strokeWidth={1.25} aria-hidden />
            </span>
            <span className="text-[13px] text-faint">Your AI agent</span>
          </motion.div>
        </div>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: said ? 1 : 0, y: said ? 0 : 12 }}
          transition={spring}
          className="mt-16 font-display text-[clamp(2.2rem,3.4vw,3.25rem)] leading-[1.04] text-fg"
        >
          Don't give agents your keys.
          <br />
          <span className="italic text-amber">Give them a warrant.</span>
        </motion.p>
      </div>
    </>
  );
}

export default {
  number: 0,
  title: "Your agent wants your bank login.",
  body: "Agents that move money usually ask for your password. Once they have it, they can do anything you can.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
