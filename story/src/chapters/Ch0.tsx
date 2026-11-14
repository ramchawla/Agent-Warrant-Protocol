// Chapter 0. Shape documented at the top of src/ChapterShell.tsx.
import type { ChapterModule, ChapterProps } from "../ChapterShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { Placeholder } from "./Placeholder";

const actionLabel = "Issue a warrant instead";

function Artifact({ complete, Narrative }: ChapterProps) {
  return (
    <>
      <Narrative>
        <PrimaryButton onClick={complete}>{actionLabel}</PrimaryButton>
      </Narrative>
      <Placeholder
        shows="Cold open: a password field handed to a robot, crossed out. Tagline: “Don't give agents your keys. Give them a warrant.”"
        endpoints={[]}
      />
    </>
  );
}

export default {
  number: 0,
  title: "Your agent wants your bank login.",
  body: "Agents that move money usually ask for your password. Once they have it, they can do anything you can.",
  actionLabel,
  Artifact,
} satisfies ChapterModule;
