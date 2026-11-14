// Chapter 1. Shape documented at the top of src/ChapterShell.tsx.
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { Placeholder } from "./Placeholder";

const actionLabel = "Compile the terms";

function Artifact({ complete, Narrative }: ChapterProps) {
  return (
    <>
      <Narrative>
        <PrimaryButton onClick={complete}>{actionLabel}</PrimaryButton>
      </Narrative>
      <Placeholder
        shows="Plain-English terms card next to the canonical JSON it compiles to; worst case turns from red ($84,000) to green ($1,000)."
        endpoints={["POST /api/demo/compile","POST /api/demo/warrant"]}
      />
    </>
  );
}

export default {
  number: 1,
  title: "Say what it may do.",
  body: "Tell the agent what it may do, in your own words. You see the exact terms, and the worst case, before you sign.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
