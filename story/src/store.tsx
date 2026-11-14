// Tiny shared story state (React context). Later chapters read what earlier ones produced.
// Usage: const { state, update, setResult } = useStory();  update({ warrantId, termsHash });  setResult(4, response);
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { WarrantSummary } from "./types";

export type StoryState = {
  warrantId: string | null;
  termsHash: string | null;
  warrant: WarrantSummary | null;          // latest summary from any response
  results: Record<number, unknown>;        // chapter number → whatever that chapter wants to keep (API responses)
  completed: Record<number, boolean>;      // chapter number → done; gates → / Space
};

const initial: StoryState = { warrantId: null, termsHash: null, warrant: null, results: {}, completed: {} };

type Ctx = {
  state: StoryState;
  update: (patch: Partial<Omit<StoryState, "results" | "completed">>) => void;
  setResult: (chapter: number, value: unknown) => void;
  complete: (chapter: number) => void;
  clear: () => void;
};

const StoryContext = createContext<Ctx | null>(null);

export function StoryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoryState>(initial);
  const update = useCallback<Ctx["update"]>((patch) => setState((s) => ({ ...s, ...patch })), []);
  const setResult = useCallback<Ctx["setResult"]>((n, v) => setState((s) => ({ ...s, results: { ...s.results, [n]: v } })), []);
  const complete = useCallback<Ctx["complete"]>(
    (n) => setState((s) => (s.completed[n] ? s : { ...s, completed: { ...s.completed, [n]: true } })),
    [],
  );
  const clear = useCallback(() => setState(initial), []);
  const value = useMemo(() => ({ state, update, setResult, complete, clear }), [state, update, setResult, complete, clear]);
  return <StoryContext.Provider value={value}>{children}</StoryContext.Provider>;
}

export function useStory() {
  const ctx = useContext(StoryContext);
  if (!ctx) throw new Error("useStory must be used inside <StoryProvider>");
  return ctx;
}

/** Typed read of an earlier chapter's result: const work = useResult<DemoStepResponse>(4); */
export function useResult<T>(chapter: number): T | undefined {
  return useStory().state.results[chapter] as T | undefined;
}
