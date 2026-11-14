// Chapter 3: the stored warrants document in Atlas, then the first ledger events chained prevHash → hash.
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, Database, Leaf } from "lucide-react";
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import * as api from "../api";
import { PrimaryButton } from "../components/PrimaryButton";
import { Shorten } from "../components/Shorten";
import { spring } from "../components/util";
import { useResult, useStory } from "../store";
import type { AuditEvent, InspectResponse } from "../types";
import { AtlasDoc } from "./s1/AtlasDoc";
import { authFlags, hex } from "./s1/flags";

const actionLabel = "Show the record";
const HIGHLIGHT = ["termsHash", "approval.response.response.signature", "approval.response.response.authenticatorData"];
const COLLAPSE = ["terms", "state", "approval.response.clientExtensionResults"];

type Kept = { ins: InspectResponse; events: AuditEvent[] };

const label: Record<string, string> = {
  WARRANT_CREATED: "Warrant created",
  WARRANT_APPROVED: "Approved with Touch ID",
};

function EventCard({ e, delay, linkedIn }: { e: AuditEvent; delay: number; linkedIn?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      className="min-w-0 flex-1 rounded-xl border border-line bg-raised px-4 py-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] text-fg">{label[e.type] ?? e.type}</span>
        <span className="font-mono text-[12px] text-faint">seq {e.seq}</span>
      </div>
      <div className="mt-2 flex h-6 items-center justify-between gap-3 text-[12.5px]">
        <span className="text-muted">prevHash</span>
        <Shorten value={e.prevHash} tone={linkedIn ? "amber" : "muted"} />
      </div>
      <div className="flex h-6 items-center justify-between gap-3 text-[12.5px]">
        <span className="text-muted">hash</span>
        <Shorten value={e.hash} tone="amber" />
      </div>
    </motion.div>
  );
}

function Artifact({ complete, Narrative }: ChapterProps) {
  const reduce = useReducedMotion();
  const { state, setResult } = useStory();
  const signed = useResult<InspectResponse>(2);
  const kept = useResult<Kept>(3);
  const [data, setData] = useState<Kept | null>(kept ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = state.warrantId ?? signed?.warrantId ?? (await api.demoState()).warrant?.warrantId;
      if (!id) throw new Error("No warrant yet. Create and sign one in chapters 1 and 2.");
      const [ins, ledger] = await Promise.all([api.inspect(id), api.ledger()]);
      const mine = ledger.events.filter((e) => e.warrantId === id);
      // ponytail: mock ledger.json is recorded against another warrant id; fall back to the first warrant events
      const events = (mine.length ? mine : ledger.events.filter((e) => e.warrantId)).sort((a, b) => a.seq - b.seq).slice(0, 2);
      const k = { ins, events };
      setData(k);
      setResult(3, k);
      window.setTimeout(complete, reduce ? 0 : 1600);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doc = data?.ins.document;
  const authData = (doc as { approval?: { response?: { response?: { authenticatorData?: string } } } } | undefined)?.approval?.response?.response?.authenticatorData
    ?? data?.ins.approval?.authenticatorData;
  const f = authData ? authFlags(authData) : null;
  const uv = data?.ins.approval?.userVerified ?? (f !== null && (f & 0x04) !== 0);
  const [e1, e2] = data?.events ?? [];
  const chained = !!e1 && !!e2 && e2.prevHash === e1.hash;

  return (
    <>
      <Narrative>
        <PrimaryButton icon={data ? Check : Database} busy={busy} disabled={!!data} onClick={show}>
          {data ? "Record shown" : actionLabel}
        </PrimaryButton>
        {error && <p role="alert" className="w-full text-[13px] text-red">{error}</p>}
      </Narrative>

      {!data || !doc ? (
        <div className="mx-auto flex max-w-[460px] flex-col items-center rounded-2xl border border-dashed border-[#0f3a4a] px-8 py-14 text-center">
          <Leaf size={22} className="text-atlas/70" aria-hidden />
          <p className="mt-4 font-mono text-[14px] text-[#9fb7be]">awp_gate.warrants</p>
          <p className="mt-2 text-[14px] text-faint">The signed warrant lands here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <AtlasDoc
            database="awp_gate"
            collection="warrants"
            document={doc}
            highlight={HIGHLIGHT}
            collapse={COLLAPSE}
            maxHeight={380}
            caption={
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-amber">We store the proof, never the biometric.</span>
                <span className={uv ? "text-green" : "text-red"}>
                  {uv ? "user verified" : "user not verified"}
                  {f !== null && <span className="ml-1.5 font-mono text-[12px] text-[#7fa3ad]">flags {hex(f)}</span>}
                </span>
              </span>
            }
          />

          {e1 && (
            <div>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mb-2 flex items-center gap-2 text-[13px] text-muted">
                Audit ledger: each event carries the hash of the one before it
              </motion.p>
              <div className="relative flex items-stretch">
                <EventCard e={e1} delay={0.55} />
                {e2 && (
                  <>
                    {/* gold chain: e1.hash (lower row) → e2.prevHash (upper row) */}
                    <svg className="w-14 shrink-0 overflow-visible" viewBox="0 0 56 100" preserveAspectRatio="none" aria-hidden>
                      <motion.path
                        d="M0 76 C 28 76, 28 52, 56 52"
                        fill="none"
                        stroke={chained ? "var(--color-amber)" : "var(--color-red)"}
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.6, delay: 1.0, ease: [0.65, 0, 0.35, 1] }}
                        style={{ filter: "drop-shadow(0 0 6px rgba(245,181,68,0.6))" }}
                      />
                    </svg>
                    <EventCard e={e2} delay={0.75} linkedIn={chained} />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default {
  number: 3,
  title: "Sealed in MongoDB Atlas.",
  body: "The signed warrant is stored as a document, with an audit chain beside it. We store the proof, never the biometric.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
