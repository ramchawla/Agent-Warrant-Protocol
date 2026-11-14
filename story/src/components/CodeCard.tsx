// CodeCard: mono JSON with key/value colouring. `highlight` is a dot path ("approval.signature", "items.0") painted amber.
// <CodeCard title="canonical terms" value={terms} highlight="perActionMaxCents" />
import type { ReactNode } from "react";

type Line = { depth: number; path: string; parts: ReactNode[] };

const isObj = (v: unknown): v is Record<string, unknown> | unknown[] => typeof v === "object" && v !== null;

function scalar(v: unknown): ReactNode {
  if (typeof v === "string") return <span className="text-fg break-all">"{v}"</span>;
  if (typeof v === "number") return <span className="text-[#d9d2c3]">{v}</span>;
  if (typeof v === "boolean" || v === null) return <span className="text-[#b9bcc4] italic">{String(v)}</span>;
  return <span className="text-faint">{String(v)}</span>;
}

function toLines(v: unknown, path: string, depth: number, key: string | null, comma: boolean, out: Line[]) {
  const k: ReactNode[] =
    key === null ? [] : [<span key="k" className="text-muted">"{key}"</span>, <span key="c" className="text-faint">: </span>];
  const tail = comma ? <span key="t" className="text-faint">,</span> : null;
  if (isObj(v)) {
    const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v);
    const [open, close] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
    if (!entries.length) {
      out.push({ depth, path, parts: [...k, <span key="o" className="text-faint">{open + close}</span>, tail] });
      return;
    }
    out.push({ depth, path, parts: [...k, <span key="o" className="text-faint">{open}</span>] });
    entries.forEach(([ck, cv], i) =>
      toLines(cv, path ? `${path}.${ck}` : ck, depth + 1, Array.isArray(v) ? null : ck, i < entries.length - 1, out),
    );
    out.push({ depth, path, parts: [<span key="x" className="text-faint">{close}</span>, tail] });
    return;
  }
  out.push({ depth, path, parts: [...k, <span key="v">{scalar(v)}</span>, tail] });
}

const hit = (path: string, h?: string) => !!h && (path === h || path.startsWith(h + "."));

export function CodeCard({
  value,
  title,
  highlight,
  maxHeight = 420,
  className = "",
}: {
  value: unknown;             // any JSON value; a string is shown raw (e.g. RFC 8785 canonical JSON)
  title?: ReactNode;          // small caption above the code
  highlight?: string;         // dot path to paint amber
  maxHeight?: number;         // px before it scrolls
  className?: string;
}) {
  const lines: Line[] = [];
  if (typeof value !== "string") toLines(value, "", 0, null, false, lines);
  return (
    <figure className={`rounded-xl border border-line bg-sunk/90 ${className}`}>
      {title && <figcaption className="border-b border-line px-4 py-2.5 text-[13px] text-muted">{title}</figcaption>}
      <div className="scroll-quiet overflow-auto py-3 font-mono text-[13px] leading-[1.7]" style={{ maxHeight }}>
        {typeof value === "string" ? (
          <p className="px-4 break-all text-fg">{value}</p>
        ) : (
          lines.map((l, i) => {
            const on = hit(l.path, highlight);
            return (
              <div
                key={i}
                className={`pr-4 ${on ? "bg-amber/10 shadow-[inset_1px_0_0_var(--color-amber)] [&_span]:!text-amber" : ""}`}
                style={{ paddingLeft: 16 + l.depth * 16 }}
              >
                {l.parts}
              </div>
            );
          })
        )}
      </div>
    </figure>
  );
}
