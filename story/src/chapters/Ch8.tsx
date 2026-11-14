// Chapter 8. Shape documented at the top of src/ChapterShell.tsx.
// Ledger timeline (GET /api/ledger) + two independent checks: the passkey signature against the stored terms
// (verify-approval) and the hash chain (ledger/verify). "Tamper" edits the record as admin; re-checking then fails.
//
// Mock mode: api.ts returns one fixture per function, so the fixtures hold the honest *before* state and this chapter
// derives the *after* state locally once tamper() has run (see `afterTamper` below). Live mode uses the responses as-is.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Link2, ScanSearch, ShieldCheck, X } from "lucide-react";
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import * as api from "../api";
import type { AuditEvent, LedgerVerifyResponse, TamperResponse, VerifyApprovalResponse } from "../types";
import { useStory } from "../store";
import { PrimaryButton } from "../components/PrimaryButton";
import { Shorten } from "../components/Shorten";
import { reasonLine, spring, usd } from "../components/util";

const actionLabel = "Re-verify signature";

// ---- mock-only: what the backend would answer after the tamper ----
const MOCK_RECOMPUTED = "Vb2nQ7rKx0aLmT4sYc9uHf1pWd3eZg8iJo6kNq5vXr0";
function setPath(o: Record<string, unknown>, path: string, v: unknown) {
  const ks = path.split(".");
  let cur = o;
  for (const k of ks.slice(0, -1)) cur = (cur[k] ??= {}) as Record<string, unknown>;
  cur[ks[ks.length - 1]] = v;
}
const afterTamper = {
  approval: (r: VerifyApprovalResponse): VerifyApprovalResponse => ({ ...r, valid: false, recomputedHash: MOCK_RECOMPUTED, reason: "TERMS_HASH_MISMATCH" }),
  chain: (r: LedgerVerifyResponse, t: TamperResponse["tampered"]): LedgerVerifyResponse => ({ ...r, ok: false, firstBrokenSeq: t.seq, checked: t.seq }),
  ledger: (events: AuditEvent[], t: TamperResponse["tampered"]) =>
    events.map((e) => {
      if (e.seq !== t.seq) return e;
      const c = structuredClone(e) as unknown as Record<string, unknown>;
      setPath(c, t.field, t.after);
      return c as unknown as AuditEvent;
    }),
};

// ---- presentation helpers ----
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
/** A tampered value as the viewer reads it: cents fields in dollars, anything else as stored. */
const shown = (field: string, v: unknown) => (/Cents$/.test(field) && typeof v === "number" ? usd(v) : String(v));
const fullClock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).toLowerCase();

function label(e: AuditEvent) {
  switch (e.type) {
    case "WARRANT_CREATED": return "Warrant created";
    case "WARRANT_APPROVED": return "Approved with Touch ID";
    case "EXECUTION": return "Executed by the brokerage";
    case "REVOKED": return "Warrant revoked";
    case "CHILD_ISSUED": return "Sub-warrant issued";
    default: return e.decision === "allow" ? "Allowed" : "Denied";
  }
}

type Row = { kind: "one"; e: AuditEvent } | { kind: "burst"; events: AuditEvent[] };

/** Runs of ≥5 consecutive same-type DECISION or EXECUTION events, each within 3 s of the previous, render as one row.
 *  Live, the 20-way burst lands as ~0.6 s-apart decisions followed by the brokerage executions. */
function group(events: AuditEvent[]): Row[] {
  const rows: Row[] = [];
  let run: AuditEvent[] = [];
  const flush = () => {
    if (run.length >= 5) rows.push({ kind: "burst", events: run });
    else run.forEach((e) => rows.push({ kind: "one", e }));
    run = [];
  };
  const groupable = (e: AuditEvent) => e.type === "DECISION" || e.type === "EXECUTION";
  for (const e of events) {
    const prev = run[run.length - 1];
    if (prev && e.type === prev.type && Date.parse(e.ts) - Date.parse(prev.ts) < 3000) run.push(e);
    else {
      flush();
      if (groupable(e)) run.push(e);
      else rows.push({ kind: "one", e });
    }
  }
  flush();
  return rows;
}

type ChainState = "idle" | "ok" | "broken" | "after"; // after = past the first broken link

function Node({ s }: { s: ChainState }) {
  const cls = { idle: "border-line-strong bg-ink", ok: "border-amber bg-amber/20", broken: "border-red bg-red", after: "border-red/50 bg-ink" }[s];
  return <span className={`relative z-10 mt-[7px] h-2.5 w-2.5 shrink-0 rounded-full border-2 transition-colors duration-500 ${cls}`} />;
}

function Timeline({ events, verify, tampered }: { events: AuditEvent[]; verify: LedgerVerifyResponse | null; tampered: TamperResponse["tampered"] | null }) {
  const broken = verify && !verify.ok ? verify.firstBrokenSeq ?? null : null;
  const state = (seq: number): ChainState =>
    !verify ? "idle" : broken === null ? "ok" : seq < broken ? "ok" : seq === broken ? "broken" : "after";
  const brokenRef = useRef<HTMLLIElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // scroll only the timeline (scrollIntoView would also move the stage)
    const li = brokenRef.current, ol = listRef.current;
    if (broken !== null && li && ol) ol.scrollTo({ top: li.offsetTop - ol.clientHeight / 2 + li.clientHeight / 2, behavior: "smooth" });
  }, [broken]);

  const rows = group(events);
  return (
    <ol ref={listRef} className="scroll-quiet relative max-h-[min(440px,48vh)] overflow-y-auto pr-2">
      {rows.map((r, i) => {
        if (r.kind === "burst") {
          const first = r.events[0].seq, last = r.events[r.events.length - 1].seq;
          const hasBroken = broken !== null && broken >= first && broken <= last;
          const s = state(hasBroken ? broken! : first);
          const allowed = r.events.filter((e) => e.decision === "allow").length;
          return (
            <li key={`b${first}`} ref={hasBroken ? brokenRef : undefined} className="relative flex gap-4 py-2.5">
              <Link s={s} last={i === rows.length - 1} />
              <Node s={s} />
              <span className="w-[44px] shrink-0 pt-[3px] font-mono text-[12px] tabular-nums text-faint">{first}–{last}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] text-fg">
                  {r.events[0].type === "EXECUTION" ? (
                    <>{r.events.length} executed by the brokerage</>
                  ) : (
                    <>{r.events.length} purchases at once <span className="text-muted">· {allowed} allowed · {r.events.length - allowed} denied</span></>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {r.events.map((e) => (
                    <span
                      key={e.seq}
                      title={`#${e.seq} ${e.summary}`}
                      className={`h-2 w-2 rounded-full ${e.seq === broken ? "ring-2 ring-red" : ""} ${e.decision === "allow" || e.type === "EXECUTION" ? "bg-green/80" : "bg-red/70"}`}
                    />
                  ))}
                </div>
              </div>
              <span className="hidden shrink-0 pt-[3px] font-mono text-[12px] text-faint sm:block">{fullClock(r.events[0].ts)}</span>
            </li>
          );
        }
        const e = r.e;
        const s = state(e.seq);
        const hit = tampered && tampered.seq === e.seq;
        return (
          <li
            key={e.seq}
            ref={s === "broken" ? brokenRef : undefined}
            className={`relative flex gap-4 rounded-lg py-2.5 transition-colors duration-500 ${s === "broken" ? "-mx-2 bg-red/[0.07] px-2" : ""}`}
          >
            <Link s={s} last={i === rows.length - 1} />
            <Node s={s} />
            <span className="w-[44px] shrink-0 pt-[3px] font-mono text-[12px] tabular-nums text-faint">{e.seq}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
                <span className={e.decision === "deny" ? "text-red" : e.decision === "allow" ? "text-green" : "text-fg"}>{label(e)}</span>
                {e.action?.amountCents !== undefined && (
                  <span className="font-mono text-[13px] text-fg">
                    {hit && <span className="mr-1.5 text-faint line-through">{usd(Number(tampered!.before))}</span>}
                    <span className={hit ? "text-red" : ""}>{usd(e.action.amountCents)}</span>
                  </span>
                )}
                {e.reasonCode && (
                  <span className="text-[12px] text-muted">
                    {reasonLine(e.reasonCode)} <span className="font-mono text-[11px] text-faint">{e.reasonCode}</span>
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[13px] text-muted">{e.summary}</div>
              {s === "broken" && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="mt-1.5 text-[12px] text-red">
                  Stored hash <span className="font-mono">{e.hash.slice(0, 10)}…</span> no longer matches this event's contents.
                </motion.div>
              )}
            </div>
            <span className="hidden shrink-0 pt-[3px] font-mono text-[12px] text-faint sm:block">
              <Shorten value={e.hash} head={6} tail={4} tone={s === "broken" ? "red" : s === "ok" ? "amber" : "muted"} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The chain line from this node down to the next. */
function Link({ s, last }: { s: ChainState; last: boolean }) {
  if (last) return null;
  const cls = { idle: "bg-line-strong", ok: "bg-amber/60", broken: "bg-red", after: "bg-red/40" }[s];
  return <span aria-hidden className={`absolute left-[4px] top-[22px] -bottom-[8px] w-0.5 transition-colors duration-500 ${cls}`} />;
}

function Verdict({
  icon: Icon,
  title,
  state,
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  state: "idle" | "ok" | "bad" | "stale";
  children: React.ReactNode;
}) {
  const tone = { idle: "border-line", stale: "border-line", ok: "border-green/40 bg-green/[0.04]", bad: "border-red/50 bg-red/[0.06]" }[state];
  return (
    <div className={`min-h-[118px] rounded-xl border bg-raised px-4 py-3.5 transition-colors duration-500 ${tone}`}>
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <Icon size={15} aria-hidden /> {title}
        <span className="ml-auto">
          {state === "ok" && <Check size={18} className="text-green" aria-label="passes" />}
          {state === "bad" && <X size={18} className="text-red" aria-label="fails" />}
        </span>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Artifact({ complete, Narrative }: ChapterProps) {
  const { state, world } = useStory();
  const warrantId = state.warrantId ?? state.warrant?.warrantId ?? (api.isMock() ? "wrt_01JD8NVDA" : ""); // live: seeded from /api/demo/state
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [sig, setSig] = useState<VerifyApprovalResponse | null>(null);
  const [chain, setChain] = useState<LedgerVerifyResponse | null>(null);
  const [tampered, setTampered] = useState<TamperResponse["tampered"] | null>(null);
  const [tamperedWarrant, setTamperedWarrant] = useState<TamperResponse["warrant"] | null>(null);
  const [busy, setBusy] = useState<"sig" | "chain" | "tamper" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.ledger().then((r) => setEvents(r.events), (e: Error) => setError(e.message));
  }, []);

  const run = async (k: "sig" | "chain" | "tamper", fn: () => Promise<void>) => {
    setBusy(k);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const reverify = () =>
    run("sig", async () => {
      const r = await api.verifyApproval(warrantId);
      setSig(tampered && api.isMock() ? afterTamper.approval(r) : r);
    });

  const verifyChain = () =>
    run("chain", async () => {
      const r = await api.ledgerVerify();
      setChain(tampered && api.isMock() ? afterTamper.chain(r, tampered) : r);
    });

  const tamper = () =>
    run("tamper", async () => {
      const { tampered: t, warrant: tw } = await api.tamper();
      setTampered(t);
      setTamperedWarrant(tw ?? null);
      setSig(null);
      setChain(null);
      const l = await api.ledger();
      setEvents(api.isMock() ? afterTamper.ledger(l.events, t) : l.events);
    });

  useEffect(() => {
    if (tampered && sig && chain) complete();
  }, [tampered, sig, chain, complete]);

  const sigState = !sig ? (tampered ? "stale" : "idle") : sig.valid ? "ok" : "bad";
  const chainState = !chain ? (tampered ? "stale" : "idle") : chain.ok ? "ok" : "bad";

  return (
    <>
      <Narrative>
        <PrimaryButton icon={ShieldCheck} busy={busy === "sig"} onClick={reverify}>{actionLabel}</PrimaryButton>
        {sig && !tampered && (
          <PrimaryButton variant="ghost" busy={busy === "tamper"} onClick={tamper}>Tamper with the record</PrimaryButton>
        )}
        {tampered && (
          <PrimaryButton variant="ghost" icon={Link2} busy={busy === "chain"} onClick={verifyChain}>Verify chain</PrimaryButton>
        )}
        {error && <p role="alert" className="w-full text-[13px] text-red">{error}</p>}
      </Narrative>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Verdict icon={ScanSearch} title="Owner's signature on the terms" state={sigState}>
            {!sig ? (
              <p className="text-[14px] text-faint">{tampered ? "The record changed. Check it again." : "Reloaded from MongoDB and checked from scratch."}</p>
            ) : sig.valid ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <p className="text-[15px] text-fg">
                  Approved by a real person · {sig.userVerified ? "user verified" : "user not verified"}
                  {sig.approvedAt && <> · {clock(sig.approvedAt)}</>}
                </p>
                <p className="mt-1.5 font-mono text-[12px] text-muted">
                  <Shorten value={sig.termsHash} head={10} tail={4} tone="green" /> = recomputed
                </p>
              </motion.div>
            ) : (
              <motion.div initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={spring}>
                <p className="text-[15px] text-red">Signature does not match these terms</p>
                <p className="mt-1.5 font-mono text-[12px] text-muted">
                  signed <Shorten value={sig.termsHash} head={8} tail={4} tone="muted" /> ≠ now{" "}
                  <Shorten value={sig.recomputedHash} head={8} tail={4} tone="red" />
                </p>
              </motion.div>
            )}
          </Verdict>

          <Verdict icon={Link2} title="Hash chain of every event" state={chainState}>
            {!chain ? (
              <p className="text-[14px] text-faint">
                {tampered ? "The record changed. Check it again." : events ? `${events.length} events, each sealing the one before.` : "Loading the ledger…"}
              </p>
            ) : chain.ok ? (
              <p className="text-[15px] text-fg">Intact · {chain.checked} events checked</p>
            ) : (
              <motion.div initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={spring}>
                <p className="text-[15px] text-red">Broken at event {chain.firstBrokenSeq}</p>
                <p className="mt-1.5 text-[12px] text-muted">Everything after it can no longer be trusted.</p>
              </motion.div>
            )}
          </Verdict>
        </div>

        <AnimatePresence>
          {tampered && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={spring}
              className="overflow-hidden text-[13px] text-muted"
            >
              Someone with database access changed event {tampered.seq}:{" "}
              <span className="font-mono text-fg">{tampered.field}</span>{" "}
              <span className="font-mono text-faint line-through">{shown(tampered.field, tampered.before)}</span>{" "}
              <span className="font-mono text-red">{shown(tampered.field, tampered.after)}</span>
              {tamperedWarrant && (
                <>
                  , and the warrant's <span className="font-mono text-fg">{tamperedWarrant.field}</span>{" "}
                  <span className="font-mono text-faint line-through">{shown(tamperedWarrant.field, tamperedWarrant.before)}</span>{" "}
                  <span className="font-mono text-red">{shown(tamperedWarrant.field, tamperedWarrant.after)}</span>
                </>
              )}
            </motion.p>
          )}
        </AnimatePresence>

        <section className="rounded-2xl border border-line bg-sunk/80 px-4 pb-2 pt-3.5">
          <header className="mb-1 flex items-baseline justify-between gap-4 px-0.5">
            <h2 className="text-[14px] text-fg">The record</h2>
            <span className="text-[12px] text-faint">MongoDB Atlas · <span className="font-mono">{world.databases?.gate ?? "…"}.audit_events</span></span>
          </header>
          {events ? (
            <Timeline events={events} verify={chain} tampered={tampered} />
          ) : (
            <p className="py-10 text-center text-[14px] text-faint">Loading the ledger…</p>
          )}
        </section>
      </div>
    </>
  );
}

export default {
  number: 8,
  title: "Anyone can verify it. Forever.",
  body: "Anyone can reload the record and check the original signature against the terms. Change one number and the check fails.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
