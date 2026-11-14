// Chapter 6: a plain-English rule stored as a plain document (Atlas embeds it), a payload minimized, matched by
// $vectorSearch, held for a fresh Touch ID, then released to the LLM without the sensitive fields.
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Fingerprint, Plus, Sparkles } from "lucide-react";
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import * as api from "../api";
import type { AddPolicyResponse, ApprovalVerifyResponse, DemoStepResponse, PolicyIndexResponse } from "../types";
import { useStory, useResult } from "../store";
import { AgentBubble } from "../components/AgentBubble";
import { AtlasCard } from "../components/AtlasCard";
import { CodeCard } from "../components/CodeCard";
import { HashFlow } from "../components/HashFlow";
import { PrimaryButton } from "../components/PrimaryButton";
import { Stamp } from "../components/Stamp";
import { spring } from "../components/util";
import { ErrorNote, Ghost } from "./s2/parts";
import { errText, useSteps } from "./s2/useSteps";

const actionLabel = "Agent: summarize my portfolio";
const SUGGESTION = "Require Touch ID before any account statement leaves our network";

// after the sensitive response: diff in, strike-through, match card, score fills, stamp
const TIMES = [300, 1200, 2600, 3200, 4300];

type Saved = {
  rule?: string;
  added?: AddPolicyResponse;
  index?: PolicyIndexResponse | null;
  sens?: DemoStepResponse;
  verify?: ApprovalVerifyResponse;
};

const STEPS = ["Write a rule", "Strip the data", "Match by meaning", "Release"];

function Artifact({ complete, Narrative }: ChapterProps) {
  const saved = useResult<Saved>(6);
  const { setResult } = useStory();
  const [s, setS] = useState<Saved>(saved ?? {});
  const [rule, setRule] = useState(saved?.rule ?? "");
  const [busy, setBusy] = useState<null | "add" | "sens" | "touch">(null);
  const [err, setErr] = useState<string | null>(null);
  const [revisit] = useState(!!saved?.sens);
  const n = useSteps(TIMES, !!s.sens, revisit);

  // ponytail: closes over this render's `s`; each step is a fresh click after the previous one rendered
  const save = (patch: Saved) => {
    const next = { ...s, ...patch };
    setS(next);
    setResult(6, next);
  };

  const add = async () => {
    setBusy("add");
    setErr(null);
    try {
      const [added, index] = await Promise.all([
        api.addPolicy(rule.trim(), "REQUIRE_FACEID"),
        api.policyIndex().catch(() => null),
      ]);
      save({ rule: rule.trim(), added, index });
    } catch (e) {
      setErr(`Could not store the rule: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const summarize = async () => {
    setBusy("sens");
    setErr(null);
    try {
      const sens = await api.sensitive();
      save({ sens });
      if (!sens.pending) window.setTimeout(complete, TIMES[TIMES.length - 1] + 400);
    } catch (e) {
      setErr(`The gate did not answer: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!s.sens?.pending) return;
    setBusy("touch");
    setErr(null);
    try {
      const verify = await api.approvalOptionsAndVerify(s.sens.pending.approvalId);
      save({ verify });
      window.setTimeout(complete, 2600);
    } catch (e) {
      const m = errText(e);
      setErr(
        /NotAllowed|cancel|abort|timed out/i.test(m)
          ? "Touch ID was cancelled. Nothing left the network. Try again when ready."
          : `Approval failed: ${m}`,
      );
    } finally {
      setBusy(null);
    }
  };

  const item = s.sens?.items[0];
  const pending = s.sens?.pending;
  const stage = s.verify ? 3 : s.sens ? (n >= 3 ? 2 : 1) : 0;

  return (
    <>
      <Narrative>
        {!s.added ? (
          <form
            className="flex w-full flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (rule.trim()) void add();
            }}
          >
            <label htmlFor="ch6-rule" className="text-[13px] text-muted">
              New policy, in plain English
            </label>
            <div className="flex w-full items-center gap-2 rounded-full border border-line-strong bg-raised py-1 pl-5 pr-1 focus-within:border-muted">
              <input
                id="ch6-rule"
                value={rule}
                onChange={(e) => setRule(e.target.value)}
                placeholder="Type a rule…"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent py-2 text-[15px] text-fg placeholder:text-faint focus:outline-none"
              />
              <button
                type="submit"
                disabled={!rule.trim() || busy === "add"}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-fg px-4 text-[14px] font-medium text-ink transition-colors hover:bg-white disabled:opacity-40"
              >
                <Plus size={16} aria-hidden /> Add
              </button>
            </div>
            {!rule && (
              <button
                type="button"
                onClick={() => setRule(SUGGESTION)}
                className="self-start rounded-full border border-dashed border-line-strong px-3.5 py-1.5 text-left text-[13px] leading-snug text-muted transition-colors hover:border-muted hover:text-fg"
              >
                {SUGGESTION}
              </button>
            )}
          </form>
        ) : !s.sens ? (
          <PrimaryButton icon={Sparkles} busy={busy === "sens"} onClick={summarize}>
            {actionLabel}
          </PrimaryButton>
        ) : pending && !s.verify ? (
          <PrimaryButton icon={Fingerprint} tone="amber" busy={busy === "touch"} disabled={n < TIMES.length} onClick={approve}>
            Approve with Touch ID
          </PrimaryButton>
        ) : null}
        {err && <ErrorNote>{err}</ErrorNote>}
      </Narrative>

      <div className="flex flex-col gap-5">
        <ol className="flex items-center gap-2 text-[12px]" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 transition-colors duration-500 ${
                  i === stage ? "bg-fg/10 text-fg" : i < stage ? "text-muted" : "text-faint"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${i <= stage ? "bg-amber" : "bg-line-strong"}`} aria-hidden />
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="h-px w-4 bg-line-strong" aria-hidden />}
            </li>
          ))}
        </ol>

        <AnimatePresence mode="wait">
          {stage <= 0 && (
            <motion.div key="rule" exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="flex flex-col gap-4">
              {s.added ? (
                <>
                  <AtlasCard
                    database="awp"
                    collection="egress_policies"
                    document={s.added.policy}
                    highlight="rule"
                    caption={`We wrote ${Object.keys(s.added.policy).join(", ")}. No embedding.`}
                  />
                  <IndexCard index={s.index} />
                </>
              ) : (
                <Ghost h={420}>The rule is stored as a plain document. Atlas does the embedding.</Ghost>
              )}
            </motion.div>
          )}

          {(stage === 1 || stage === 2) && item && (
            <motion.div key="match" exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="flex flex-col gap-4">
              <AgentBubble text={item.agentText} />
              {item.trace.minimize && n >= 1 && <Redaction m={item.trace.minimize} strike={n >= 2} />}
              {item.trace.semantic && n >= 3 && (
                <MatchCard sem={item.trace.semantic} fill={n >= 4} stamp={n >= 5 && !!pending} />
              )}
              {n >= 5 && !pending && <p className="text-[14px] text-muted">No rule asked for Touch ID, so the stripped payload went out.</p>}
            </motion.div>
          )}

          {stage === 3 && s.verify && pending && (
            <motion.div key="release" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="flex flex-col gap-4">
              <HashFlow
                stepMs={550}
                steps={[
                  { label: "Stripped payload, the only thing that can leave", value: JSON.stringify(pending.minimizedPayload) },
                  { label: "SHA-256 of it is the Touch ID challenge", value: pending.challenge, tone: "amber" },
                  { label: "Touch ID verified by the gate", value: s.verify.released ? "released" : "held", tone: s.verify.released ? "green" : "red" },
                ]}
              />
              <LlmPanel verify={s.verify} removed={item?.trace.minimize?.removed ?? []} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

function IndexCard({ index }: { index?: PolicyIndexResponse | null }) {
  if (!index) return <p className="text-[13px] text-faint">Search index definition unavailable.</p>;
  const field = ((index.definition.fields as Record<string, unknown>[] | undefined) ?? [])[0];
  const ready = /ready/i.test(index.status);
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.25 }} className="rounded-2xl border border-line bg-raised/95">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h3 className="text-[14px] font-medium text-fg">
          Search index <span className="font-mono text-muted">{index.name}</span>
        </h3>
        <span className={`inline-flex items-center gap-1.5 font-mono text-[12px] ${ready ? "text-green" : "text-amber"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-green" : "bg-amber"}`} aria-hidden />
          {index.status}
        </span>
      </header>
      <div className="p-3">
        <CodeCard value={index.definition} highlight="fields.0.type" maxHeight={200} />
      </div>
      <p className="border-t border-line px-4 py-2.5 text-[13px] text-muted">
        Atlas embeds it on insert{field?.model ? ` with ${String(field.model)}` : ""}.
      </p>
    </motion.section>
  );
}

type Minimize = NonNullable<DemoStepResponse["items"][number]["trace"]["minimize"]>;

const compact = (v: unknown) => {
  const t = JSON.stringify(v);
  return t.length > 64 ? t.slice(0, 61) + "…" : t;
};

function Redaction({ m, strike }: { m: Minimize; strike: boolean }) {
  const pct = Math.round((1 - m.tokensAfter / Math.max(1, m.tokensBefore)) * 100);
  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="rounded-2xl border border-line bg-raised/95">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h3 className="text-[14px] font-medium text-fg">Stripped before it leaves</h3>
        <span className="font-mono text-[13px] text-muted">
          {m.tokensBefore} → <span className={strike ? "text-green" : ""}>{strike ? m.tokensAfter : m.tokensBefore}</span> tokens
          <motion.span initial={false} animate={{ opacity: strike ? 1 : 0 }} className="ml-2 text-green">
            −{pct}%
          </motion.span>
        </span>
      </header>
      <ul className="px-4 py-2.5 font-mono text-[13px] leading-[1.75]">
        {Object.entries(m.before).map(([k, v], i) => {
          const gone = m.removed.includes(k);
          return (
            <li key={k} className="relative flex gap-3">
              <span className={gone && strike ? "text-red/80" : "text-muted"}>{k}</span>
              <span className="relative min-w-0 truncate text-fg">
                <motion.span initial={false} animate={{ opacity: gone && strike ? 0.45 : 1 }} transition={{ delay: i * 0.08 }} className={gone && strike ? "text-red" : ""}>
                  {compact(v)}
                </motion.span>
                {gone && (
                  <motion.span
                    aria-hidden
                    className="absolute left-0 top-1/2 h-[1.5px] bg-red"
                    initial={false}
                    animate={{ width: strike ? "100%" : "0%" }}
                    transition={{ duration: 0.45, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                  />
                )}
              </span>
              {gone && strike && <span className="ml-auto shrink-0 text-[11px] text-red/80">removed</span>}
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}

type Semantic = NonNullable<DemoStepResponse["items"][number]["trace"]["semantic"]>;

function MatchCard({ sem, fill, stamp }: { sem: Semantic; fill: boolean; stamp: boolean }) {
  const vector = sem.path === "vector";
  const stage = sem.pipeline[0] ?? {};
  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-4">
      <CodeCard
        title={vector ? "Atlas Vector Search on egress_policies" : "Keyword fallback (vector search unavailable)"}
        value={stage}
        maxHeight={210}
      />
      <div className="@container relative flex flex-col rounded-xl border border-line bg-raised/95 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-muted">{vector ? "Similarity to your rule" : "Keyword match score"}</span>
          <span className="font-mono text-[22px] text-amber">{fill ? sem.topScore.toFixed(2) : "0.00"}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
          <motion.div
            className="h-full rounded-full bg-amber"
            initial={{ width: 0 }}
            animate={{ width: fill ? `${Math.min(1, sem.topScore) * 100}%` : 0 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
        <p className="mt-3 text-[14px] leading-snug text-fg">“{sem.rule}”</p>
        <p className="mt-1 font-mono text-[12px] text-faint">path: {sem.path}</p>
        <div className="mt-auto flex min-h-[64px] items-end justify-center pt-2">
          {stamp && (
            <>
              <span className="hidden @[21rem]:inline-flex"><Stamp kind="touchid" /></span>
              <span className="@[21rem]:hidden"><Stamp kind="touchid" size="sm" /></span>
            </>
          )}
        </div>
      </div>
    </motion.section>
  );
}

function LlmPanel({ verify, removed }: { verify: ApprovalVerifyResponse; removed: string[] }) {
  const absent = removed.filter((k) => !(k in verify.sentToLlm));
  const claude = verify.llmSource === "claude";
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 1.7 }}
      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4"
    >
      <div className="flex flex-col gap-2">
        <CodeCard title="What the model received" value={verify.sentToLlm} maxHeight={240} />
        {absent.length > 0 && (
          <p className="font-mono text-[12px] text-green">
            not sent: {absent.join(", ")}
          </p>
        )}
      </div>
      <div className="flex flex-col rounded-xl border border-line bg-raised/95 p-4">
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-muted">{claude ? "Claude Code on this laptop replied" : "Canned reply"}</span>
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${claude ? "border-amber/40 text-amber" : "border-line-strong text-faint"}`}>
            llmSource: {verify.llmSource}
          </span>
        </div>
        <p className="mt-3 font-display text-[22px] leading-[1.3] text-fg">{verify.llmReply}</p>
      </div>
    </motion.section>
  );
}

export default {
  number: 6,
  title: "Policies in plain English, matched by meaning.",
  body: "Write a rule the way you would say it, and Atlas matches requests to it by meaning. Sensitive data is stripped first, and anything the rule catches waits for your Touch ID.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
