// Chapter 1: the user types what the agent may do; the gate compiles it to exact terms and a worst case.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, FileSignature } from "lucide-react";
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import * as api from "../api";
import { PrimaryButton } from "../components/PrimaryButton";
import { Shorten } from "../components/Shorten";
import { spring, usd } from "../components/util";
import { useResult, useStory } from "../store";
import type { CompileResponse, CreateWarrantResponse } from "../types";
import { compileFor } from "./s1/compile";

const actionLabel = "Create the warrant";
const SUGGESTIONS = ["Put my life savings into NVIDIA", "okay, $500 at a time, $1,000 max"];
const SAVINGS_CENTS = 8400000; // the demo world's SAVINGS balance (docs/STORY-API.md)

type Kept = { text: string; compiled: CompileResponse | null; created: CreateWarrantResponse | null };

/** Canonical JSON with the two money limits painted in the worst-case colour. */
function Canonical({ text, tone }: { text: string; tone: string }) {
  const parts = text.split(/("(?:perActionMaxCents|totalLimitCents)":\d+)/);
  return (
    <p className="break-all font-mono text-[12.5px] leading-[1.75] text-muted">
      {parts.map((p, i) => (i % 2 ? <span key={i} className={`${tone} rounded bg-white/[0.06] px-0.5`}>{p}</span> : p))}
    </p>
  );
}

function Artifact({ complete, Narrative }: ChapterProps) {
  const { update, setResult } = useStory();
  const kept = useResult<Kept>(1);
  const [text, setText] = useState(kept?.text ?? "");
  const [compiled, setCompiled] = useState<CompileResponse | null>(kept?.compiled ?? null);
  const [created, setCreated] = useState<CreateWarrantResponse | null>(kept?.created ?? null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const typing = useRef<number | null>(null);

  const run = async (t: string) => {
    if (!t.trim()) return;
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    try {
      const r = await compileFor(t);
      if (mine !== seq.current) return;
      setCompiled(r);
      setCreated(null);
      setResult(1, { text: t, compiled: r, created: null } satisfies Kept);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  };

  // Clicking a suggestion types it into the field, like a person would, then compiles.
  const suggest = (s: string) => {
    if (typing.current) window.clearInterval(typing.current);
    let i = 0;
    typing.current = window.setInterval(() => {
      i += 1;
      setText(s.slice(0, i));
      if (i >= s.length) {
        window.clearInterval(typing.current!);
        typing.current = null;
        void run(s);
      }
    }, 26);
  };
  useEffect(() => () => { if (typing.current) window.clearInterval(typing.current); }, []);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const r = await api.createWarrant(text);
      setCreated(r);
      const c = { terms: r.terms, canonical: r.canonical, plain: r.plain, worstCase: r.worstCase };
      setCompiled(c);
      update({ warrantId: r.warrantId, termsHash: r.termsHash });
      setResult(1, { text, compiled: c, created: r } satisfies Kept);
      complete();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const wc = compiled?.worstCase;
  const red = wc?.severity === "red";
  const tone = red ? "text-red" : "text-green";

  return (
    <>
      <Narrative>
        <div className="w-full">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(text);
            }}
            className="group flex items-center gap-2 rounded-2xl border border-line-strong bg-raised px-4 py-1.5 transition-colors focus-within:border-muted"
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Tell your agent what it may do"
              aria-label="What may the agent do?"
              spellCheck={false}
              className="h-11 min-w-0 flex-1 bg-transparent text-[17px] text-fg outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              disabled={!text.trim() || busy}
              aria-label="Compile the terms"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-white/5 hover:text-fg disabled:opacity-30"
            >
              <CornerDownLeft size={16} aria-hidden />
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => suggest(s)}
                className="rounded-full border border-line px-3.5 py-1.5 text-[13.5px] text-muted transition-colors hover:border-line-strong hover:text-fg"
              >
                {s}
              </button>
            ))}
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <PrimaryButton icon={FileSignature} busy={creating} disabled={!compiled || red || busy || !!created} onClick={create}>
              {created ? "Warrant created" : actionLabel}
            </PrimaryButton>
            {compiled && red && !busy && <span className="text-[13px] text-faint">Too much to hand over. Narrow it down first.</span>}
          </div>
          {error && <p role="alert" className="mt-3 text-[13px] text-red">{error}</p>}
        </div>
      </Narrative>

      <AnimatePresence mode="wait">
        {!compiled ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mx-auto max-w-[460px] rounded-2xl border border-dashed border-line-strong px-8 py-12 text-center"
          >
            <p className="font-display text-[28px] leading-tight text-fg/80">Your words become exact terms here.</p>
            <p className="mt-3 text-[14px] text-faint">Pick a suggestion on the left, or type your own.</p>
          </motion.div>
        ) : (
          <motion.div key="terms" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring} className={busy ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {/* worst case: the line the whole chapter is about */}
            <motion.div
              key={wc!.sentence}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
              className={`rounded-2xl border px-6 py-5 ${red ? "border-red/40 bg-red/[0.07]" : "border-green/35 bg-green/[0.06]"}`}
            >
              <p className={`font-display text-[clamp(1.9rem,2.7vw,2.6rem)] leading-[1.08] text-balance ${tone}`}>{wc!.sentence}</p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className={`h-full rounded-full ${red ? "bg-red" : "bg-green"}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(1.2, Math.min(1, wc!.cents / SAVINGS_CENTS) * 100)}%` }}
                  transition={{ ...spring, delay: 0.15 }}
                />
              </div>
              <p className="mt-2 text-[12.5px] text-faint">
                <span className={`font-mono ${tone}`}>{usd(wc!.cents)}</span> of {usd(SAVINGS_CENTS)} in savings at risk
              </p>
            </motion.div>

            <div className="mt-4 grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-4">
              <section className="rounded-2xl border border-line bg-raised p-5">
                <h3 className="text-[13px] text-muted">In plain English</h3>
                <ul className="mt-3 space-y-3">
                  {compiled.plain.map((line, i) => (
                    <motion.li
                      key={line}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ ...spring, delay: 0.05 * i }}
                      className="flex gap-3 text-[15.5px] leading-snug text-fg"
                    >
                      <span className={`mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full ${i < 2 ? (red ? "bg-red" : "bg-green") : "bg-line-strong"}`} />
                      {line}
                    </motion.li>
                  ))}
                </ul>
              </section>
              <section className="rounded-2xl border border-line bg-sunk/90 p-5">
                <h3 className="flex items-baseline justify-between gap-3 text-[13px] text-muted">
                  What gets signed
                  <span className="font-mono text-[11.5px] text-faint">RFC 8785 · {new TextEncoder().encode(compiled.canonical).length} bytes</span>
                </h3>
                <div className="scroll-quiet mt-3 max-h-[300px] overflow-auto">
                  <Canonical text={compiled.canonical} tone={tone} />
                </div>
              </section>
            </div>

            <AnimatePresence>
              {created && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-amber/30 bg-amber/[0.06] px-4 py-3 text-[13.5px]"
                >
                  <span className="text-amber">Waiting for your signature</span>
                  <span className="text-faint">warrant <Shorten value={created.warrantId} head={12} tail={4} tone="muted" /></span>
                  <span className="text-faint">termsHash <Shorten value={created.termsHash} tone="amber" /></span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default {
  number: 1,
  title: "Say what it may do.",
  body: "Tell the agent what it may do, in your own words. You see the exact terms, and the worst case, before you sign.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
