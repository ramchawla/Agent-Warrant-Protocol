// #/kitchen: every shared component with sample data from the mock fixtures. Press "Replay" to re-run animations.
import { useState, type ReactNode } from "react";
import { Fingerprint, RotateCcw } from "lucide-react";
import { AgentBubble } from "./components/AgentBubble";
import { AtlasCard } from "./components/AtlasCard";
import { CodeCard } from "./components/CodeCard";
import { HashFlow } from "./components/HashFlow";
import { Inspector } from "./components/Inspector";
import { Meter } from "./components/Meter";
import { PrimaryButton } from "./components/PrimaryButton";
import { Shorten } from "./components/Shorten";
import { Stamp } from "./components/Stamp";
import { usd } from "./components/util";
import inspect from "./mocks/inspect.json";
import blocked from "./mocks/blocked.json";
import sensitive from "./mocks/sensitive.json";
import type { DemoStepResponse, InspectResponse } from "./types";

const ins = inspect as InspectResponse;
const sens = sensitive as DemoStepResponse;
const blk = blocked as DemoStepResponse;

function Spec({ name, props, children, wide }: { name: string; props: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`rounded-2xl border border-line bg-ink/70 p-6 ${wide ? "lg:col-span-2" : ""}`}>
      <header className="mb-5 flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h2 className="font-display text-[28px] leading-none">{name}</h2>
        <code className="truncate font-mono text-[11px] text-faint">{props}</code>
      </header>
      {children}
    </section>
  );
}

export function Kitchen() {
  const [run, setRun] = useState(0);
  const [meter, setMeter] = useState(100000);
  return (
    <div className="stage min-h-dvh px-[clamp(20px,4vw,64px)] py-12 text-fg">
      <header className="mx-auto mb-10 flex max-w-[1280px] items-end justify-between gap-6">
        <div>
          <a href="#/" className="text-[13px] text-muted hover:text-fg">← Back to the story</a>
          <h1 className="mt-3 font-display text-[56px] leading-none">Kitchen</h1>
          <p className="mt-3 text-muted">Every shared component, with sample data from <code className="font-mono text-[13px]">src/mocks</code>.</p>
        </div>
        <PrimaryButton variant="ghost" icon={RotateCcw} onClick={() => setRun((r) => r + 1)}>Replay</PrimaryButton>
      </header>

      <div key={run} className="mx-auto grid max-w-[1280px] gap-6 lg:grid-cols-2">
        <Spec name="PrimaryButton" props="children onClick icon tone busy disabled variant">
          <div className="flex flex-wrap gap-3">
            <PrimaryButton>Issue a warrant instead</PrimaryButton>
            <PrimaryButton tone="amber" icon={Fingerprint}>Sign with Touch ID</PrimaryButton>
            <PrimaryButton busy>Working</PrimaryButton>
            <PrimaryButton variant="ghost">Verify chain</PrimaryButton>
            <PrimaryButton tone="red">Tamper with the record</PrimaryButton>
          </div>
        </Spec>

        <Spec name="Stamp" props="kind reason delay size">
          <div className="flex flex-wrap items-center gap-6 py-2">
            <Stamp kind="allowed" />
            <Stamp kind="denied" reason="PER_ACTION_LIMIT" delay={0.2} />
            <Stamp kind="touchid" delay={0.4} />
          </div>
        </Spec>

        <Spec name="AgentBubble" props="text name delay aside">
          <div className="space-y-4">
            {blk.items.map((it, i) => (
              <AgentBubble key={i} text={it.agentText} delay={i * 0.9} aside={<Stamp kind="denied" size="sm" reason={it.reasonCode} delay={i * 0.9 + 0.7} />} />
            ))}
          </div>
        </Spec>

        <Spec name="Meter" props="value max label format tone">
          <div className="space-y-6">
            <Meter label="Warrant budget left" value={meter} max={100000} />
            <div className="flex gap-2">
              {[100000, 50000, 0].map((v) => (
                <PrimaryButton key={v} variant="ghost" onClick={() => setMeter(v)}>{usd(v)}</PrimaryButton>
              ))}
            </div>
          </div>
        </Spec>

        <Spec name="HashFlow" props="steps direction stepMs play onDone" wide>
          <HashFlow
            steps={[
              { label: "Canonical terms (RFC 8785)", value: ins.canonical.slice(0, 120) + "…" },
              { label: "SHA-256 → termsHash", value: ins.termsHash, tone: "amber" },
              { label: "WebAuthn challenge", value: ins.challenge },
              { label: "Touch ID signature", value: ins.approval!.signature, tone: "amber", note: "Signed by a real person · user verified" },
            ]}
          />
        </Spec>

        <Spec name="CodeCard" props="value title highlight maxHeight">
          <CodeCard title="Canonical terms" value={ins.terms} highlight="perActionMaxCents" maxHeight={300} />
        </Spec>

        <Spec name="AtlasCard" props="database collection document highlight caption">
          <AtlasCard database="awp" collection="warrants" document={ins.document} highlight="approval" caption="We store the proof, never the biometric." maxHeight={260} />
        </Spec>

        <Spec name="Inspector" props="trace decision sections maxHeight">
          <Inspector trace={sens.items[0].trace} decision="deny" maxHeight={160} />
        </Spec>

        <Spec name="Shorten" props="value head tail tone">
          <div className="space-y-3 text-[15px]">
            <p>termsHash <Shorten value={ins.termsHash} tone="amber" /></p>
            <p>signature <Shorten value={ins.approval!.signature} head={10} /></p>
            <p className="text-muted">Click to copy; hover for the full value.</p>
          </div>
        </Spec>
      </div>
    </div>
  );
}
