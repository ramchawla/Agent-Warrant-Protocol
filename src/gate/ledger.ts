// Hash-chained, gate-signed ledger (REQ-008). Owner: Pro, task 5. Called by routes/act.ts and the warrant routes.
// Stub: appendEvent writes nothing and returns a placeholder event. Signatures are fixed by PRD Section 11.
import type { ClientSession } from "mongodb";
import { config } from "../shared/config.ts";
import type { AuditEvent } from "../shared/types.ts";

export type NewEvent = Omit<AuditEvent, "_id" | "seq" | "ts" | "prevHash" | "hash" | "gateSig" | "policyVersion">;

/** Must be called inside the caller's transaction. */
export async function appendEvent(session: ClientSession, event: NewEvent): Promise<AuditEvent> {
  return { _id: 0, seq: 0, ts: new Date().toISOString(), ...event, policyVersion: config.policyVersion, prevHash: "stub", hash: "stub", gateSig: "stub" };
}

export async function verifyChain(): Promise<{ ok: boolean; checked: number; firstBrokenSeq?: number }> {
  throw new Error("not implemented");
}
