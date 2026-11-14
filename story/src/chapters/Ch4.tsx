// Chapter 4. Shape documented at the top of src/ChapterShell.tsx.
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { Placeholder } from "./Placeholder";

const actionLabel = "Let the agent buy $500";

function Artifact({ complete, Narrative }: ChapterProps) {
  return (
    <>
      <Narrative>
        <PrimaryButton onClick={complete}>{actionLabel}</PrimaryButton>
      </Narrative>
      <Placeholder
        shows="Agent bubble → checkpoint → inspector (filter, matched: 1, gate ms) → receipt to the brokerage → its own three checks → Executed. Budget $1,000 → $500."
        endpoints={["POST /api/demo/work","GET /fintech/state"]}
      />
    </>
  );
}

export default {
  number: 4,
  title: "The agent acts. The gate decides.",
  body: "Every claim passes one atomic check in the database. The brokerage then verifies the receipt on its own.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
