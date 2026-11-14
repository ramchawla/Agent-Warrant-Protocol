// Tiny shared story state (React context). Later chapters read what earlier ones produced.
// Usage: const { state, update, setResult } = useStory();  update({ warrantId, termsHash });  setResult(4, response);
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "./api";
import type { Databases, WarrantSummary } from "./types";

export type StoryState = {
  warrantId: string | null;
  termsHash: string | null;
  warrant: WarrantSummary | null;          // latest summary from any response
  results: Record<number, unknown>;        // chapter number → whatever that chapter wants to keep (API responses)
  completed: Record<number, boolean>;      // chapter number → done; gates → / Space
};

const initial: StoryState = { warrantId: null, termsHash: null, warrant: null, results: {}, completed: {} };

/** Facts about the demo world from the gate (GET /api/demo/state, POST /api/demo/reset). Survives clear(). */
export type World = { databases: Databases | null; savingsCents: number | null };

type Ctx = {
  state: StoryState;
  world: World;
  setWorld: (patch: Partial<World>) => void;
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
  const [world, setW] = useState<World>({ databases: null, savingsCents: null });
  const setWorld = useCallback<Ctx["setWorld"]>((patch) => setW((w) => ({ ...w, ...patch })), []);
  // After a page reload mid-demo, pick the live warrant back up so later chapters still point at it.
  useEffect(() => {
    api.demoState().then(
      (d) => {
        setW((w) => ({ databases: d.databases ?? w.databases, savingsCents: d.savingsCents ?? w.savingsCents }));
        if (d.warrant) setState((s) => (s.warrantId ? s : { ...s, warrantId: d.warrant!.warrantId, warrant: s.warrant ?? d.warrant }));
      },
      () => {},
    );
  }, []);
  const value = useMemo(
    () => ({ state, world, setWorld, update, setResult, complete, clear }),
    [state, world, setWorld, update, setResult, complete, clear],
  );
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
