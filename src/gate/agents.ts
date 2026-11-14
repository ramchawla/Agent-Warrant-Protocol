// Agent identity: hashed API keys (REQ-004). Owner: Max, task 7. Called by routes/act.ts.
import { timingSafeEqual } from "node:crypto";
import { b64url, sha256 } from "../shared/canonical.ts";
import { agents } from "./db.ts";

/** base64url(SHA-256(key)): the only form of an agent key the gate stores. */
export const hashAgentKey = (key: string): string => b64url(sha256(key));

/**
 * The agent _id for "Authorization: Bearer <key>", or null (no key, unknown key, disabled agent).
 * Throws only when the database fails; callers treat that as a denial.
 */
export async function authenticateAgent(authorizationHeader: string | undefined): Promise<string | null> {
  const key = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : "";
  if (key.length === 0 || key.length > 512) return null;
  const keyHash = hashAgentKey(key);
  const agent = await agents().findOne({ keyHash });   // unique index lookup
  if (!agent) return null;
  const stored = Buffer.from(agent.keyHash);
  const presented = Buffer.from(keyHash);
  const same = stored.length === presented.length && timingSafeEqual(stored, presented);
  return same && agent.status === "active" ? agent._id : null;
}
