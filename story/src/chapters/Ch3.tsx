// Chapter 3. Shape documented at the top of src/ChapterShell.tsx.
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { Placeholder } from "./Placeholder";

const actionLabel = "Show the record";

function Artifact({ complete, Narrative }: ChapterProps) {
  return (
    <>
      <Narrative>
        <PrimaryButton onClick={complete}>{actionLabel}</PrimaryButton>
      </Narrative>
      <Placeholder
        shows="The stored warrants document drops into an Atlas card; the first ledger event links prevHash → hash with a gold chain line."
        endpoints={["GET /api/warrants/:id/inspect","GET /api/ledger"]}
      />
    </>
  );
}

export default {
  number: 3,
  title: "Sealed in MongoDB Atlas.",
  body: "The signed warrant is stored as a document, with an audit chain beside it. We store the proof, never the biometric.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
