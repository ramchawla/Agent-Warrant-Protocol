// Chapter 5. Shape documented at the top of src/ChapterShell.tsx.
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { Placeholder } from "./Placeholder";

const actionLabel = "Let the agent loose";

function Artifact({ complete, Narrative }: ChapterProps) {
  return (
    <>
      <Narrative>
        <PrimaryButton onClick={complete}>{actionLabel}</PrimaryButton>
      </Narrative>
      <Placeholder
        shows="Three claims, about a second apart, each stamped DENIED with its reason code. Inspector: matched 0 → deny. Nothing reaches the brokerage."
        endpoints={["POST /api/demo/blocked"]}
      />
    </>
  );
}

export default {
  number: 5,
  title: "Anything beyond the warrant is denied.",
  body: "The agent gets excited, distracted and tricked. Every claim outside the warrant stops before anything moves.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
