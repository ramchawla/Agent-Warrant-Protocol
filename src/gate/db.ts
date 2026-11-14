// Gate database access (awp_gate). The client is created on first use, so the gate
// starts without a database when AWP_FIXTURES=1.
import { MongoClient, type Collection, type Db } from "mongodb";
import { config, need } from "../shared/config.ts";
import type { AgentDoc, AuditEvent, ChallengeDoc, CredentialDoc, MetaDoc, UserDoc, WarrantDoc } from "../shared/types.ts";

let client: MongoClient | undefined;

/** The gate's MongoClient. Use it for sessions: mongo().startSession(). */
export function mongo(): MongoClient {
  client ??= new MongoClient(need(config.mongoUri.gate, "MONGODB_URI_GATE"));
  return client;
}

export const db = (): Db => mongo().db(config.dbName.gate);

export const users = (): Collection<UserDoc> => db().collection("users");
export const credentials = (): Collection<CredentialDoc> => db().collection("credentials");
export const agents = (): Collection<AgentDoc> => db().collection("agents");
export const warrants = (): Collection<WarrantDoc> => db().collection("warrants");
export const challenges = (): Collection<ChallengeDoc> => db().collection("challenges");
export const auditEvents = (): Collection<AuditEvent> => db().collection("audit_events");
export const meta = (): Collection<MetaDoc> => db().collection("meta");

export async function closeDb(): Promise<void> {
  await client?.close();
  client = undefined;
}
