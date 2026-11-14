// Chapter 8. Shape documented at the top of src/ChapterShell.tsx.
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { Placeholder } from "./Placeholder";

const actionLabel = "Re-verify signature";

function Artifact({ complete, Narrative }: ChapterProps) {
  return (
    <>
      <Narrative>
        <PrimaryButton onClick={complete}>{actionLabel}</PrimaryButton>
      </Narrative>
      <Placeholder
        shows="Event timeline; re-verify ✓. Tamper → chain turns red at the broken seq; re-verify ✗ “Signature does not match these terms”."
        endpoints={["GET /api/warrants/:id/verify-approval","GET /api/ledger/verify","POST /api/demo/tamper"]}
      />
    </>
  );
}

export default {
  number: 8,
  title: "Anyone can verify it. Forever.",
  body: "Anyone can reload the record and check the original signature against the terms. Change one number and the check fails.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
