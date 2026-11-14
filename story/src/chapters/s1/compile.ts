// api.compile in mock mode always returns mocks/compile.json (the green $500 terms). Chapter 1 needs the red
// "life savings" case too, so mock mode picks it here by the text. Live mode goes straight to the gate.
// ponytail: delete once api.ts mock fixtures can vary by input.
import * as api from "../../api";
import type { CompileResponse } from "../../types";
import lifeSavings from "./compileLifeSavings.json";

export async function compileFor(text: string): Promise<CompileResponse> {
  if (!api.isMock() || /\b500\b/.test(text)) return api.compile(text);
  await new Promise((r) => setTimeout(r, 300));
  return structuredClone(lifeSavings) as CompileResponse;
}
