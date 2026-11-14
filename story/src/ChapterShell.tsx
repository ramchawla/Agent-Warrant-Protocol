/*
 * ChapterShell: full-viewport story frame. Left 40% narrative, right 60% live artifact, presenter keys, dot nav.
 *
 * ── Chapter module shape (S1–S3: fill src/chapters/ChN.tsx, never edit this file) ──────────────────────────
 *
 *   import type { ChapterModule, ChapterProps } from "../ChapterShell";
 *
 *   function Artifact({ complete, Narrative }: ChapterProps) {
 *     const [busy, setBusy] = useState(false);
 *     return (
 *       <>
 *         <Narrative>                         // portals into the left column, under the body text
 *           <PrimaryButton busy={busy} onClick={run}>Let the agent buy $500</PrimaryButton>
 *         </Narrative>
 *         …right-hand artifact (fills the 60% stage, centred, max ~760px wide)…
 *       </>
 *     );
 *   }
 *
 *   export default {
 *     number: 4,
 *     title: "The agent acts. The gate decides.",   // exact title from STORY-UI-PLAN §3
 *     body: "At most two plain sentences.",
 *     actionLabel: "Let the agent buy $500",         // documentation + the placeholder button label
 *     Artifact,
 *   } satisfies ChapterModule;
 *
 * ChapterProps:
 *   number      this chapter's number
 *   isComplete  true once complete() was called (survives navigating away and back; cleared by R)
 *   complete()  unlock → / Space to the next chapter (call when the chapter's moment has finished)
 *   next()      advance now (e.g. after a final animation); same as pressing →
 *   Narrative   <Narrative>{buttons, inputs}</Narrative> renders into the left column
 *
 * Chapter state that later chapters need goes in the shared store (src/store.tsx: useStory / useResult).
 * The Artifact remounts each time the chapter is shown; keep results in the store if a revisit must restore them.
 *
 * Keys: → / Space next (only when complete), ← back, 0–9 jump (always), R reset (api.reset → chapter 0), M mock.
 * Keys are ignored while typing in an input/textarea/contenteditable.
 */
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as api from "./api";
import { useStory } from "./store";
import { spring } from "./components/util";

export type ChapterProps = {
  number: number;
  isComplete: boolean;
  complete: () => void;
  next: () => void;
  Narrative: ComponentType<{ children: ReactNode }>;
};

export type ChapterModule = {
  number: number;
  title: string;
  body: string;
  actionLabel?: string;
  Artifact: ComponentType<ChapterProps>;
};

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function useMockFlag() {
  const [on, setOn] = useState(api.isMock());
  useEffect(() => {
    const f = () => setOn(api.isMock());
    window.addEventListener("awp-mock-change", f);
    return () => window.removeEventListener("awp-mock-change", f);
  }, []);
  return on;
}

export function ChapterShell({ chapters }: { chapters: ChapterModule[] }) {
  const { state, complete, clear } = useStory();
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const mock = useMockFlag();
  const reduce = useReducedMotion();
  const ch = chapters[index];
  const done = !!state.completed[ch.number];

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  const go = useCallback(
    (i: number) => {
      if (i < 0 || i >= chapters.length) return;
      setDir(i >= index ? 1 : -1);
      setIndex(i);
    },
    [chapters.length, index],
  );

  const next = useCallback(() => go(index + 1), [go, index]);

  const reset = useCallback(async () => {
    say("Resetting the demo…");
    try {
      await api.reset();
      clear();
      go(0);
      say("Demo reset");
    } catch (e) {
      say(`Reset failed: ${(e as Error).message}`);
    }
  }, [clear, go, say]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = e.key;
      if (k === "ArrowRight" || k === " ") {
        e.preventDefault();
        if (done) next();
        else if (index < chapters.length - 1) say(`Finish this step first, or press ${index + 1} to skip`);
      } else if (k === "ArrowLeft") {
        e.preventDefault();
        go(index - 1);
      } else if (/^[0-9]$/.test(k)) {
        go(Number(k));
      } else if (k === "r" || k === "R") {
        void reset();
      } else if (k === "m" || k === "M") {
        api.setMock(!api.isMock());
        say(api.isMock() ? "Mock mode on" : "Live mode: talking to the gate");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, next, go, index, chapters.length, reset, say]);

  const Narrative = useMemo(
    () =>
      function Narrative({ children }: { children: ReactNode }) {
        return slot ? createPortal(children, slot) : null;
      },
    [slot],
  );

  const Artifact = ch.Artifact;
  const enter = reduce ? { opacity: 0 } : { opacity: 0, y: 18 * dir };
  const exit = reduce ? { opacity: 0 } : { opacity: 0, y: -12 * dir };

  return (
    <div className="grain relative flex h-dvh w-full flex-col overflow-hidden bg-ink text-fg">
      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          key={index}
          className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
        >
          {/* Narrative: 40% */}
          <section className="relative flex min-h-0 flex-col justify-center px-[clamp(28px,5vw,88px)] pb-[clamp(72px,11vh,110px)] pt-[clamp(56px,9vh,96px)]">
            <motion.div initial={enter} animate={{ opacity: 1, y: 0 }} exit={exit} transition={spring} className="max-w-[30rem]">
              <div className="flex items-baseline gap-3 font-display text-[clamp(1.5rem,2vw,1.9rem)] italic leading-none">
                <span className={done ? "text-amber" : "text-muted"}>{ch.number}</span>
                <span className="h-px w-10 translate-y-[-0.35em] bg-line-strong" aria-hidden />
                <span className="text-faint">{chapters.length - 1}</span>
              </div>
              <h1 className="mt-[clamp(18px,3vh,32px)] font-display text-[clamp(2.6rem,4.3vw,4.5rem)] leading-[0.98] tracking-[-0.012em] text-balance text-fg">
                {ch.title}
              </h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ ...spring, delay: reduce ? 0 : 0.12 }}
                className="mt-[clamp(16px,2.6vh,28px)] max-w-[34ch] text-[clamp(1rem,1.25vw,1.15rem)] leading-[1.6] text-muted text-pretty"
              >
                {ch.body}
              </motion.p>
              <motion.div
                ref={setSlot}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ ...spring, delay: reduce ? 0 : 0.22 }}
                className="mt-[clamp(24px,4vh,44px)] flex flex-wrap items-center gap-3 empty:hidden"
              />
            </motion.div>
          </section>

          {/* Artifact: 60% */}
          <section className="stage relative flex min-h-0 items-center justify-center overflow-y-auto border-l border-line px-[clamp(24px,4vw,72px)] py-[clamp(40px,7vh,80px)]">
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ ...spring, delay: reduce ? 0 : 0.08 }}
              className="w-full max-w-[760px]"
            >
              <Artifact
                number={ch.number}
                isComplete={done}
                complete={() => complete(ch.number)}
                next={next}
                Narrative={Narrative}
              />
            </motion.div>
          </section>
        </motion.main>
      </AnimatePresence>

      {/* Chrome: brand, mock badge, dot nav, toast. Persistent across chapters. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-[clamp(28px,5vw,88px)] pt-[clamp(20px,3.5vh,34px)]">
        <div className="flex items-center gap-2.5 text-[13px] text-muted">
          <span className="h-2 w-2 rotate-45 bg-amber" aria-hidden />
          Agent Warrant Protocol
        </div>
        {mock && (
          <span className="pointer-events-auto rounded-md border border-amber/40 bg-amber/10 px-2 py-0.5 font-mono text-[11px] tracking-wider text-amber" title="Mock mode: fixtures, no backend. Press M to switch.">
            MOCK
          </span>
        )}
      </div>

      <nav
        aria-label="Chapters"
        className="absolute bottom-0 left-0 flex w-full items-center gap-5 px-[clamp(28px,5vw,88px)] pb-[clamp(20px,3.5vh,34px)] lg:w-[40%]"
      >
        <ol className="flex items-center gap-2">
          {chapters.map((c, i) => {
            const here = i === index;
            const ok = !!state.completed[c.number];
            return (
              <li key={c.number}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Chapter ${c.number}: ${c.title}`}
                  aria-current={here ? "step" : undefined}
                  title={`${c.number} · ${c.title}`}
                  className="grid h-6 place-items-center px-0.5"
                >
                  <motion.span
                    layout
                    transition={spring}
                    className={`block h-1.5 rounded-full ${here ? "w-6 bg-fg" : ok ? "w-1.5 bg-amber" : "w-1.5 bg-line-strong hover:bg-muted"}`}
                  />
                </button>
              </li>
            );
          })}
        </ol>
        <AnimatePresence>
          {done && index < chapters.length - 1 && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={spring}
              className="text-[12px] text-faint"
            >
              Press <kbd className="font-mono text-muted">→</kbd> to continue
            </motion.span>
          )}
        </AnimatePresence>
      </nav>

      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={spring}
            className="absolute bottom-[clamp(20px,3.5vh,34px)] right-[clamp(24px,3vw,48px)] rounded-full border border-line-strong bg-raised px-4 py-2 text-[13px] text-fg shadow-2xl"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
