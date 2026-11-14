// AtlasCard: a stored MongoDB Atlas document, Data Explorer style (database.collection header + document JSON).
// <AtlasCard database="awp" collection="warrants" document={inspect.document} highlight="approval.signature" />
import { motion } from "motion/react";
import { Leaf } from "lucide-react";
import { CodeCard } from "./CodeCard";
import { spring } from "./util";

export function AtlasCard({
  database,
  collection,
  document,
  highlight,
  caption,
  maxHeight = 380,
}: {
  database: string;
  collection: string;
  document: Record<string, unknown>;
  highlight?: string;   // dot path painted amber (see CodeCard)
  caption?: string;     // one line under the card, e.g. "We store the proof, never the biometric."
  maxHeight?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: -24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
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
      <div className="p-3">
        <CodeCard value={document} highlight={highlight} maxHeight={maxHeight} className="border-[#0f3a4a] bg-[#04121a]" />
      </div>
      {caption && <p className="border-t border-[#0f3a4a] px-4 py-2.5 text-[13px] text-[#9fb7be]">{caption}</p>}
    </motion.section>
  );
}
