// Chapter 7. Shape documented at the top of src/ChapterShell.tsx.
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { Placeholder } from "./Placeholder";

const actionLabel = "Fire 20 at once";

function Artifact({ complete, Narrative }: ChapterProps) {
  return (
    <>
      <Narrative>
        <PrimaryButton onClick={complete}>{actionLabel}</PrimaryButton>
      </Narrative>
      <Placeholder
        shows="20 dots hit the gate together; exactly 10 green, 10 red; “10 allowed · 10 denied · $0 left”. Revoke greys the warrant; next claim DENIED · WARRANT_REVOKED."
        endpoints={["POST /api/demo/burst","POST /api/demo/revoke"]}
      />
    </>
  );
}

export default {
  number: 7,
  title: "Limits hold under pressure.",
  body: "Twenty purchases fired at once cannot overspend the warrant. Revoke it, and the very next claim is refused.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
