// Placeholder artifact used by unbuilt chapters. Delete the import once your chapter has a real artifact.
export function Placeholder({ shows, endpoints = [] }: { shows: string; endpoints?: string[] }) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-ink/60 p-[clamp(24px,3vw,40px)]">
      <p className="text-[13px] text-faint">Live artifact, to be built</p>
      <p className="mt-3 max-w-[52ch] text-[17px] leading-relaxed text-fg/85">{shows}</p>
      {endpoints.length > 0 && (
        <ul className="mt-6 flex flex-wrap gap-2">
          {endpoints.map((e) => (
            <li key={e} className="rounded-md border border-line bg-raised px-2.5 py-1 font-mono text-[12px] text-muted">
              {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
