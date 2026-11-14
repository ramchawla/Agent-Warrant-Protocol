// Chapter 2: Touch ID signs the termsHash. Then the real values flow: terms → canonical → SHA-256 → challenge → signature.
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BadgeCheck, Fingerprint, RotateCcw } from "lucide-react";
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import * as api from "../api";
import { HashFlow } from "../components/HashFlow";
import { PrimaryButton } from "../components/PrimaryButton";
import { Shorten } from "../components/Shorten";
import { spring } from "../components/util";
import { useResult, useStory } from "../store";
import type { InspectResponse } from "../types";
import { authFlags, hex } from "./s1/flags";

const actionLabel = "Sign with Touch ID";
const FALLBACK_TEXT = "okay, $500 at a time, $1,000 max"; // only when chapter 1 was skipped in a rehearsal

type Phase = "idle" | "touch" | "flow" | "done" | "error";

const clip = (s: string, n = 104) => (s.length > n ? `${s.slice(0, n)}…` : s);

function friendly(e: unknown): string {
  const m = (e as Error).message ?? String(e);
  if (/not allowed|cancel|abort|timed out/i.test(m)) return "Touch ID was cancelled. Nothing was signed.";
  return m;
}

function Artifact({ complete, Narrative }: ChapterProps) {
  const reduce = useReducedMotion();
  const { state, update, setResult } = useStory();
  const kept = useResult<InspectResponse>(2);
  const [ins, setIns] = useState<InspectResponse | null>(kept ?? null);
  const [phase, setPhase] = useState<Phase>(kept ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);

  const sign = async () => {
    setError(null);
    setPhase("touch");
    try {
      let { warrantId, termsHash } = state;
      if (!warrantId || !termsHash) {
        const w = await api.createWarrant(FALLBACK_TEXT);
        ({ warrantId, termsHash } = w);
        update({ warrantId, termsHash });
      }
      const demo = await api.demoState();
      if (!demo.user.hasPasskey) await api.registerPasskey(demo.user.userId, demo.user.name);
      else await api.demoSession();
      await api.approveWarrant(warrantId, termsHash);
      const r = await api.inspect(warrantId);
      setIns(r);
      setResult(2, r);
      setPhase("flow");
    } catch (e) {
      setError(friendly(e));
      setPhase("error");
    }
  };

  const a = ins?.approval;
  const f = a ? authFlags(a.authenticatorData) : null;
  const same = !!a && a.clientDataJSON.challenge === ins!.termsHash;
  const bytes = ins ? new TextEncoder().encode(ins.canonical).length : 0;

  return (
    <>
      <Narrative>
        {phase === "error" ? (
          <PrimaryButton icon={RotateCcw} tone="amber" onClick={sign}>Try Touch ID again</PrimaryButton>
        ) : (
          <PrimaryButton icon={Fingerprint} tone="amber" busy={phase === "touch"} disabled={phase === "flow" || phase === "done"} onClick={sign}>
            {phase === "flow" || phase === "done" ? "Signed" : actionLabel}
          </PrimaryButton>
        )}
      </Narrative>

      <div className="flex flex-col gap-5">
        {/* the sensor */}
        <div className="flex items-center gap-5 rounded-2xl border border-line bg-raised px-5 py-4">
          <span className="relative grid h-14 w-14 shrink-0 place-items-center">
            {phase === "touch" && !reduce && (
              <motion.span
                className="absolute inset-0 rounded-full border border-amber"
                initial={{ scale: 0.8, opacity: 0.9 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut" }}
              />
            )}
            <span
              className={`grid h-14 w-14 place-items-center rounded-full border transition-colors duration-500 ${
                phase === "flow" || phase === "done"
                  ? "border-amber bg-amber text-ink"
                  : phase === "touch"
                    ? "border-amber text-amber"
                    : phase === "error"
                      ? "border-red/60 text-red"
                      : "border-line-strong text-muted"
              }`}
            >
              <Fingerprint size={28} strokeWidth={1.5} aria-hidden />
            </span>
          </span>
          <div className="min-w-0 text-[15px] leading-snug" aria-live="polite">
            {phase === "idle" && (
              <>
                <p className="text-fg">Touch ID will sign this exact hash, nothing else.</p>
                <p className="mt-1 text-[13px] text-faint">
                  termsHash {state.termsHash ? <Shorten value={state.termsHash} tone="amber" /> : "is created when you sign"}
                </p>
              </>
            )}
            {phase === "touch" && <p className="text-amber">Touch the sensor to sign.</p>}
            {phase === "error" && <p role="alert" className="text-red">{error}</p>}
            {(phase === "flow" || phase === "done") && ins && (
              <>
                <p className="text-fg">Signed on this laptop. The fingerprint itself never left the sensor.</p>
                <p className="mt-1 text-[13px] text-faint">
                  passkey <Shorten value={a?.credentialId ?? ""} tone="muted" /> · origin <span className="font-mono text-muted">{String(a?.clientDataJSON.origin ?? "")}</span>
                </p>
              </>
            )}
          </div>
        </div>

        {/* the pipeline: every value is from GET /api/warrants/:id/inspect */}
        {ins && a && (
          <HashFlow
            stepMs={reduce ? 1 : 850}
            onDone={() => {
              setPhase("done");
              complete();
            }}
            steps={[
              { label: "The terms you wrote, as JSON", value: clip(JSON.stringify(ins.terms)) },
              { label: "RFC 8785 canonical JSON: keys sorted, no spaces", value: clip(ins.canonical), note: `${bytes} bytes, the same on every machine` },
              { label: "SHA-256 of those bytes: the termsHash", value: ins.termsHash, tone: "amber" },
              {
                label: "WebAuthn challenge that Touch ID signed",
                value: String(a.clientDataJSON.challenge),
                tone: same ? "green" : "red",
                note: same ? "Identical to the termsHash: the signature covers these terms and nothing else" : "Does not match the termsHash",
              },
              { label: "Signature from your passkey (ECDSA P-256)", value: a.signature, tone: "amber" },
            ]}
          />
        )}

        <AnimatePresence>
          {phase === "done" && a && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
              className="flex items-center gap-3"
            >
              <BadgeCheck size={30} strokeWidth={1.5} className={a.userVerified ? "text-amber" : "text-red"} aria-hidden />
              <p className={`font-display text-[clamp(1.7rem,2.3vw,2.2rem)] leading-none ${a.userVerified ? "text-amber" : "text-red"}`}>
                {a.userVerified ? "Signed by a real person · user verified" : "Signed, but the user was not verified"}
              </p>
              {f !== null && (
                <span className="ml-auto font-mono text-[12px] text-faint" title="authenticatorData flags byte: 0x01 user present, 0x04 user verified">
                  flags {hex(f)}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

export default {
  number: 2,
  title: "Sign it with Touch ID.",
  body: "Your fingerprint never leaves the laptop. Touch ID signs a hash of these exact terms instead.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
