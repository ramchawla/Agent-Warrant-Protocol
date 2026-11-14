// Chapter 9. Shape documented at the top of src/ChapterShell.tsx.
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import { Placeholder } from "./Placeholder";

function Artifact(_: ChapterProps) {
  return (
    <>
      <Placeholder
        shows="Architecture in motion: Touch ID → warrant → gate → MongoDB Atlas (warrants · ledger · policies + vector index · change streams) → brokerage. Team names."
        endpoints={[]}
      />
    </>
  );
}

export default {
  number: 9,
  title: "Don't give agents your keys. Give them a warrant.",
  body: "Touch ID signs the terms, MongoDB Atlas seals them, and the gate holds every agent to them.",
  Artifact,
} satisfies ChapterModule;
