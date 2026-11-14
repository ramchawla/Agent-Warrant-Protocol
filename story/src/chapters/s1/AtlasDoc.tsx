// Local variant of AtlasCard/CodeCard for chapter 3: several highlighted paths, collapsible subtrees, and long
// strings shortened to one line (full value in the tooltip). The shared CodeCard takes one highlight and wraps long values.
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Leaf } from "lucide-react";
import { spring } from "../../components/util";

type Line = { depth: number; path: string; parts: ReactNode[] };
const isObj = (v: unknown): v is Record<string, unknown> | unknown[] => typeof v === "object" && v !== null;
const short = (s: string, n = 46) => (s.length > n ? `${s.slice(0, 26)}…${s.slice(-14)}` : s);

function scalar(v: unknown): ReactNode {
  if (typeof v === "string") return <span className="text-fg" title={v}>"{short(v)}"</span>;
  if (typeof v === "number") return <span className="text-[#d9d2c3]">{v}</span>;
  return <span className="italic text-[#b9bcc4]">{String(v)}</span>;
}

function walk(v: unknown, path: string, depth: number, key: string | null, comma: boolean, collapse: string[], out: Line[]) {
  const k = key === null ? [] : [<span key="k" className="text-[#7fa3ad]">{key}</span>, <span key="c" className="text-faint">: </span>];
  const tail = comma ? <span key="t" className="text-faint">,</span> : null;
  if (isObj(v)) {
    const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v);
    const [open, close] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
    if (!entries.length || collapse.includes(path)) {
      const inner = entries.length ? <span key="i" className="text-faint"> … {entries.length} fields </span> : null;
      out.push({ depth, path, parts: [...k, <span key="o" className="text-faint">{open}</span>, inner, <span key="x" className="text-faint">{close}</span>, tail] });
      return;
    }
    out.push({ depth, path, parts: [...k, <span key="o" className="text-faint">{open}</span>] });
    entries.forEach(([ck, cv], i) =>
      walk(cv, path ? `${path}.${ck}` : ck, depth + 1, Array.isArray(v) ? null : ck, i < entries.length - 1, collapse, out),
    );
    out.push({ depth, path: `${path}#close`, parts: [<span key="x" className="text-faint">{close}</span>, tail] });
    return;
  }
  out.push({ depth, path, parts: [...k, <span key="v">{scalar(v)}</span>, tail] });
}

export function AtlasDoc({
  database,
  collection,
  document,
  highlight = [],
  collapse = [],
  caption,
  maxHeight = 400,
}: {
  database: string;
  collection: string;
  document: Record<string, unknown>;
  highlight?: string[];
  collapse?: string[];
  caption?: ReactNode;
  maxHeight?: number;
}) {
  const lines: Line[] = [];
  walk(document, "", 0, null, false, collapse, lines);
  return (
    <motion.section
      initial={{ opacity: 0, y: -40, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring, stiffness: 200 }}
      className="overflow-hidden rounded-2xl border border-[#0f3a4a] bg-[#071820] shadow-[0_30px_80px_-30px_rgba(0,237,100,0.18)]"
    >
      <header className="flex items-center gap-3 border-b border-[#0f3a4a] bg-atlas-slate px-4 py-3">
        <Leaf size={16} className="text-atlas" strokeWidth={2} aria-hidden />
        <span className="text-[13px] text-[#c1ccd1]">MongoDB Atlas</span>
        <span className="font-mono text-[13px] text-[#e8edeb]">
          {database}
          <span className="text-[#5c7a85]">.</span>
          {collection}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-[#7fa3ad]">
          <span className="h-1.5 w-1.5 rounded-full bg-atlas" /> 1 document
        </span>
      </header>
      <div className="scroll-quiet overflow-auto bg-[#04121a] py-3 font-mono text-[12.5px] leading-[1.65]" style={{ maxHeight }}>
        {lines.map((l, i) => {
          const on = highlight.includes(l.path);
          return (
            <div
              key={i}
              className={`whitespace-nowrap pr-4 ${on ? "bg-amber/10 shadow-[inset_2px_0_0_var(--color-amber)] [&_span]:!text-amber" : ""}`}
              style={{ paddingLeft: 16 + l.depth * 16 }}
            >
              {l.parts}
            </div>
          );
        })}
      </div>
      {caption && <div className="border-t border-[#0f3a4a] px-4 py-2.5 text-[13px] text-[#9fb7be]">{caption}</div>}
    </motion.section>
  );
}
