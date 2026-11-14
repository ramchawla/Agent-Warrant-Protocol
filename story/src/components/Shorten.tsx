// Shorten: long hash/signature as "a1b2c3…9z8y" in mono; click copies the full value. Full value is in the tooltip.
// <Shorten value={termsHash} tone="amber" />
import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function Shorten({
  value,
  head = 8,
  tail = 6,
  tone = "fg",
}: {
  value: string;
  head?: number;
  tail?: number;
  tone?: "fg" | "amber" | "green" | "red" | "muted";
}) {
  const [copied, setCopied] = useState(false);
  const short = value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
  const color = { fg: "text-fg", amber: "text-amber", green: "text-green", red: "text-red", muted: "text-muted" }[tone];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard blocked: tooltip still shows the full value */ }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      className={`group inline-flex items-center gap-1.5 rounded-md px-1 -mx-1 font-mono text-[0.92em] ${color} hover:bg-white/5`}
    >
      {short}
      {copied ? (
        <Check size={12} className="text-green" aria-label="Copied" />
      ) : (
        <Copy size={12} className="opacity-0 transition-opacity group-hover:opacity-60" aria-hidden />
      )}
    </button>
  );
}
