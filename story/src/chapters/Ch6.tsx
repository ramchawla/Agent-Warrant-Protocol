// Chapter 6. Shape documented at the top of src/ChapterShell.tsx.
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { Placeholder } from "./Placeholder";

const actionLabel = "Agent: summarize my portfolio";

function Artifact({ complete, Narrative }: ChapterProps) {
  return (
    <>
      <Narrative>
        <PrimaryButton onClick={complete}>{actionLabel}</PrimaryButton>
      </Narrative>
      <Placeholder
        shows="New egress_policies document (no embedding written by us) + autoEmbed index; redaction diff; $vectorSearch score bar → TOUCH ID REQUIRED → released; what Claude received."
        endpoints={["POST /api/policies","GET /api/policies/index","POST /api/demo/sensitive","POST /api/approvals/:id/options","/verify"]}
      />
    </>
  );
}

export default {
  number: 6,
  title: "Policies in plain English, matched by meaning.",
  body: "Write a rule the way you would say it, and Atlas matches requests to it by meaning. Sensitive data is stripped first, and anything the rule catches waits for your Touch ID.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
