// Chapter 9. Shape documented at the top of src/ChapterShell.tsx.
// Closing architecture: Touch ID → warrant → gate → brokerage across the top, MongoDB Atlas underneath, value pulses
// travelling the wires. No API calls. Team line is a placeholder until Max confirms names.
import { useEffect, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Bot, Fingerprint, Landmark, Leaf, ScrollText, ShieldCheck, type LucideIcon } from "lucide-react";
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import { spring } from "../components/util";

const TEAM = "Ram Chawla · Jackson Lippert";

const nodes: { icon: LucideIcon; title: string; sub: string; tone: string }[] = [
  { icon: Fingerprint, title: "Touch ID", sub: "a real person signs", tone: "text-amber" },
  { icon: ScrollText, title: "Warrant", sub: "the exact terms, hashed", tone: "text-amber" },
  { icon: ShieldCheck, title: "Gate", sub: "checks every claim", tone: "text-fg" },
  { icon: Landmark, title: "Brokerage", sub: "verifies the receipt", tone: "text-green" },
];

const collections = [
  { name: "warrants", note: "terms + passkey proof" },
  { name: "ledger", note: "hash-chained events" },
  { name: "policies", note: "plain English + vector index" },
  { name: "change streams", note: "revocation, live" },
];

const step = 0.22; // reveal stagger, s

function Wire({ i, vertical = false }: { i: number; vertical?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.15 + i * step }}
      className={`relative self-center ${vertical ? "mx-auto h-9 w-px" : "h-px w-full"} bg-line-strong`}
      aria-hidden
    >
      {!reduce && (
        <motion.span
          className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber shadow-[0_0_10px_rgba(245,181,68,0.9)]"
          style={vertical ? { left: "50%" } : { top: "50%" }}
          initial={vertical ? { top: "0%", opacity: 0 } : { left: "0%", opacity: 0 }}
          animate={vertical ? { top: ["0%", "100%"], opacity: [0, 1, 0] } : { left: ["0%", "100%"], opacity: [0, 1, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, repeatDelay: 2.1, delay: 1.4 + i * 0.75, ease: "easeInOut" }}
        />
      )}
    </motion.div>
  );
}

function Box({ i, children, className = "" }: { i: number; children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: i * step }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function Artifact({ complete }: ChapterProps) {
  useEffect(complete, [complete]);
  return (
    <div className="flex flex-col">
      {/* the agent only ever talks to the gate */}
      <div className="grid grid-cols-[1fr_28px_1fr_28px_1fr_28px_1fr]">
        <Box i={3} className="col-start-5 mx-auto inline-flex items-center gap-2 rounded-full border border-line-strong bg-raised px-3.5 py-1.5 text-[13px] text-fg">
          <Bot size={15} className="text-muted" aria-hidden /> AI agent
        </Box>
        <div className="col-start-5"><Wire i={3} vertical /></div>
      </div>

      {/* the request path */}
      <div className="grid grid-cols-[1fr_28px_1fr_28px_1fr_28px_1fr] items-stretch">
        {nodes.map((n, i) => (
          <div key={n.title} className="contents">
            <Box i={i} className="rounded-xl border border-line-strong bg-raised px-3.5 py-4">
              <n.icon size={20} strokeWidth={1.75} className={n.tone} aria-hidden />
              <div className="mt-3 text-[15px] text-fg">{n.title}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-muted">{n.sub}</div>
            </Box>
            {i < nodes.length - 1 && <Wire i={i} />}
          </div>
        ))}
      </div>

      {/* wires down into Atlas from warrant and gate */}
      <div className="grid grid-cols-[1fr_28px_1fr_28px_1fr_28px_1fr]">
        <span />
        <span />
        <Wire i={4} vertical />
        <span />
        <Wire i={5} vertical />
      </div>

      {/* MongoDB Atlas */}
      <Box i={5} className="overflow-hidden rounded-2xl border border-[#0f3a4a] bg-[#071820] shadow-[0_30px_80px_-30px_rgba(0,237,100,0.2)]">
        <header className="flex items-center gap-2.5 border-b border-[#0f3a4a] bg-atlas-slate px-4 py-3">
          <Leaf size={16} className="text-atlas" strokeWidth={2} aria-hidden />
          <span className="text-[14px] text-[#e8edeb]">MongoDB Atlas</span>
          <span className="ml-auto text-[12px] text-[#7fa3ad]">one source of truth</span>
        </header>
        <ul className="grid grid-cols-2 gap-px bg-[#0f3a4a] sm:grid-cols-4">
          {collections.map((c, i) => (
            <motion.li
              key={c.name}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 6 * step + i * 0.12 }}
              className="bg-[#071820] px-4 py-3.5"
            >
              <div className="font-mono text-[13px] text-[#e8edeb]">{c.name}</div>
              <div className="mt-1 text-[12px] leading-snug text-[#9fb7be]">{c.note}</div>
            </motion.li>
          ))}
        </ul>
      </Box>

      {/* closing */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...spring, delay: 8 * step + 0.4 }}
        className="mt-[clamp(32px,6vh,64px)] flex items-end justify-between gap-6 border-t border-line pt-6"
      >
        <div>
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rotate-45 bg-amber" aria-hidden />
            <span className="font-display text-[clamp(1.9rem,3vw,2.8rem)] leading-none text-fg">Agent Warrant Protocol</span>
          </div>
          <p className="mt-3 text-[15px] text-muted">Signed by a person. Enforced by the gate. Sealed in Atlas.</p>
        </div>
        <p className="shrink-0 text-[15px] text-fg">{TEAM}</p>
      </motion.div>
    </div>
  );
}

export default {
  number: 9,
  title: "Don't give agents your keys. Give them a warrant.",
  body: "Touch ID signs the terms, MongoDB Atlas seals them, and the gate holds every agent to them.",
  Artifact,
} satisfies ChapterModule;
