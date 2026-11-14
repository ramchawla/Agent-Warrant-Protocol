// AgentBubble: the agent "speaking" one line; text types in. Use one per agent claim.
// <AgentBubble text="Buying $500 of NVDA" />
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Bot } from "lucide-react";
import { spring, typed, useElapsed } from "./util";

export function AgentBubble({
  text,
  name = "Agent",
  delay = 0,
  aside,
}: {
  text: string;
  name?: string;
  delay?: number;            // seconds before it appears
  aside?: ReactNode;   // right-hand slot, e.g. a <Stamp size="sm" />
}) {
  const t = useElapsed(true, 4000, text);
  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...spring, delay }}
      className="flex items-start gap-3"
    >
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line-strong bg-raised text-muted">
        <Bot size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-faint">{name}</div>
        <div className="mt-1 flex items-center gap-4">
          <p className="rounded-2xl rounded-tl-sm border border-line bg-raised px-4 py-2.5 text-[16px] leading-snug text-fg" aria-label={text}>
            {typed(text, t, 60, delay * 1000) || " "}
          </p>
          {aside}
        </div>
      </div>
    </motion.div>
  );
}
