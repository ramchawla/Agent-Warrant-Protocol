// Chapter 2. Shape documented at the top of src/ChapterShell.tsx.
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { Placeholder } from "./Placeholder";

const actionLabel = "Sign with Touch ID";

function Artifact({ complete, Narrative }: ChapterProps) {
  return (
    <>
      <Narrative>
        <PrimaryButton onClick={complete}>{actionLabel}</PrimaryButton>
      </Narrative>
      <Placeholder
        shows="Pipeline: terms → RFC 8785 canonical JSON → SHA-256 → termsHash → WebAuthn challenge → signature. Ends on “Signed by a real person · user verified”."
        endpoints={["POST /api/warrants/:id/approve/options","/verify","GET /api/warrants/:id/inspect"]}
      />
    </>
  );
}

export default {
  number: 2,
  title: "Sign it with Touch ID.",
  body: "Your fingerprint never leaves the laptop. Touch ID signs a fingerprint of these exact terms instead.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
