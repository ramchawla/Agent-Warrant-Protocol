// Creates collections, $jsonSchema validators, indexes and the ledger genesis. Safe to re-run.
// Database names honour AWP_DB_PREFIX. Needs createCollection, collMod and createIndex: for the
// demo databases run it with the admin user's URIs (gate_app must never hold collMod).
//   npm run setup-db
import { pathToFileURL } from "node:url";
import { MongoClient, type Db, type Document } from "mongodb";
import { GENESIS_HASH } from "../src/shared/canonical.ts";
import { config, need, type InstitutionId } from "../src/shared/config.ts";

// $jsonSchema is draft 4: bsonType "int"/"long" (no "integer", no "format").
const str = { bsonType: "string" };
const strOrNull = { bsonType: ["string", "null"] };
const int = { bsonType: ["int", "long"] };
const cents = { bsonType: ["int", "long"], minimum: 0 };
const strArray = { bsonType: "array", items: str };
const hash43 = { bsonType: "string", minLength: 43, maxLength: 43 };

const ACTION_TYPES = ["kyc.refresh", "payment.create", "data.export"];
const REASON_CODES = [
  "MALFORMED_REQUEST", "AGENT_UNAUTHENTICATED", "AGENT_MISMATCH", "WARRANT_NOT_FOUND", "TERMS_TAMPERED",
  "WARRANT_NOT_ACTIVE", "WARRANT_REVOKED", "WARRANT_NOT_YET_VALID", "WARRANT_EXPIRED", "ACTION_NOT_ALLOWED",
  "DESTINATION_NOT_ALLOWED", "ACCOUNT_NOT_ALLOWED", "MERCHANT_NOT_ALLOWED", "FIELD_NOT_ALLOWED", "FIELD_CONSTRAINT",
  "CURRENCY_MISMATCH", "AMOUNT_INVALID", "PER_ACTION_LIMIT", "BUDGET_EXHAUSTED", "LEDGER_UNAVAILABLE",
];

export const warrantValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    additionalProperties: false,
    required: ["_id", "terms", "termsHash", "approval", "state", "ancestors", "expiresAt", "createdAt"],
    properties: {
      _id: str,
      terms: {
        bsonType: "object",
        additionalProperties: false,
        required: ["v", "warrantId", "userId", "agentId", "parentWarrantId", "scope", "currency", "perActionMaxCents", "totalLimitCents", "notBefore", "expiresAt", "nonce"],
        properties: {
          v: { enum: [1] },
          warrantId: str,
          userId: str,
          agentId: str,
          parentWarrantId: strOrNull,
          scope: {
            bsonType: "object",
            additionalProperties: false,
            required: ["actions", "accounts", "merchants", "destinations", "fields"],
            properties: {
              actions: { bsonType: "array", items: { enum: ACTION_TYPES } },
              accounts: strArray,
              merchants: strArray,
              destinations: strArray,
              // Keys are action types and contain dots, so they are checked by value shape only.
              fields: { bsonType: "object", additionalProperties: strArray },
            },
          },
          currency: { enum: ["CAD"] },
          perActionMaxCents: cents,
          totalLimitCents: cents,
          notBefore: str,
          expiresAt: str,
          nonce: str,
        },
      },
      termsHash: hash43,
      approval: {
        anyOf: [
          { bsonType: "null" },
          { bsonType: "object", required: ["kind"], properties: { kind: { enum: ["passkey", "delegation"] } } },
        ],
      },
      state: {
        bsonType: "object",
        additionalProperties: false,
        required: ["status", "remainingCents", "actionCount"],
        properties: {
          status: { enum: ["pending", "active", "revoked", "rejected"] },
          remainingCents: cents,
          actionCount: cents,
          revokedAt: str,
          revokedBy: str,
        },
      },
      ancestors: strArray,
      expiresAt: { bsonType: "date" },
      createdAt: { bsonType: "date" },
    },
  },
};

export const auditEventValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    additionalProperties: false,
    required: ["_id", "seq", "ts", "type", "warrantId", "termsHash", "agentId", "runId", "summary", "policyVersion", "prevHash", "hash", "gateSig"],
    properties: {
      _id: int,
      seq: int,
      ts: str,
      type: { enum: ["WARRANT_CREATED", "WARRANT_APPROVED", "DECISION", "EXECUTION", "REVOKED", "CHILD_ISSUED"] },
      warrantId: strOrNull,
      termsHash: strOrNull,
      agentId: strOrNull,
      runId: strOrNull,
      decisionId: str,
      idempotencyKey: str,
      decision: { enum: ["allow", "deny"] },
      reasonCode: { enum: REASON_CODES },
      action: {
        bsonType: "object",
        additionalProperties: false,
        required: ["type", "destination", "fieldNames", "fieldSizes"],
        properties: {
          type: { enum: ACTION_TYPES },
          destination: str,
          account: str,
          merchant: str,
          // Any number: a denied attempt may carry a negative or fractional amount.
          amountCents: { bsonType: "number" },
          fieldNames: strArray,
          fieldSizes: { bsonType: "object", additionalProperties: int },
        },
      },
      actionHash: hash43,
      outcome: { enum: ["executed", "rejected", "unknown"] },
      institutionRef: str,
      summary: str,
      policyVersion: str,
      prevHash: hash43,
      hash: hash43,
      gateSig: str,
    },
  },
};

async function ensureCollection(db: Db, name: string, validator?: Document): Promise<void> {
  const exists = await db.listCollections({ name }).hasNext();
  if (!exists) await db.createCollection(name, validator ? { validator } : {});
  else if (validator) await db.command({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
}

export async function setupGate(db: Db): Promise<void> {
  await ensureCollection(db, "users");
  await ensureCollection(db, "credentials");
  await ensureCollection(db, "agents");
  await ensureCollection(db, "warrants", warrantValidator);
  await ensureCollection(db, "challenges");
  await ensureCollection(db, "audit_events", auditEventValidator);
  await ensureCollection(db, "meta");

  await db.collection("credentials").createIndex({ userId: 1 });
  await db.collection("agents").createIndex({ keyHash: 1 }, { unique: true });
  await db.collection("warrants").createIndex({ expiresAt: 1 });
  await db.collection("warrants").createIndex({ ancestors: 1 });
  await db.collection("warrants").createIndex({ "terms.userId": 1 });
  await db.collection("challenges").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection("audit_events").createIndex({ runId: 1 });
  await db.collection("audit_events").createIndex({ warrantId: 1 });
  // Idempotency (REQ-007). Only DECISION events that carry a key are indexed, so denials
  // recorded before a key is known (no key on the event) never collide with each other.
  await db.collection("audit_events").createIndex(
    { warrantId: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { type: "DECISION", idempotencyKey: { $exists: true } } },
  );

  // Genesis: the ledger head starts at seq 0 with the genesis hash. There is no seq 0 document
  // in audit_events; the first event is seq 1 with prevHash = GENESIS_HASH.
  const meta = db.collection<{ _id: string }>("meta");
  await meta.updateOne({ _id: "ledger_head" }, { $setOnInsert: { seq: 0, hash: GENESIS_HASH } }, { upsert: true });
  await meta.updateOne({ _id: "policy" }, { $set: { version: config.policyVersion } }, { upsert: true });
}

export async function setupInstitution(db: Db, institution: InstitutionId): Promise<void> {
  await ensureCollection(db, "enrolled_credentials");
  await ensureCollection(db, "seen_receipts");   // _id is the decision ID
  await ensureCollection(db, "anchors");
  await ensureCollection(db, institution === "bank" ? "accounts" : "payments");
  await db.collection("enrolled_credentials").createIndex({ userId: 1 });
}

async function withDb(uri: string, name: string, run: (db: Db) => Promise<void>): Promise<void> {
  const client = new MongoClient(uri);
  try {
    await run(client.db(name));
    console.log(`ok       ${name}`);
  } finally {
    await client.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await withDb(need(config.mongoUri.gate, "MONGODB_URI_GATE"), config.dbName.gate, setupGate);
  for (const institution of ["bank", "fintech"] as const) {
    const uri = config.mongoUri[institution];
    if (uri) await withDb(uri, config.dbName[institution], (db) => setupInstitution(db, institution));
    else console.log(`skipped  ${config.dbName[institution]} (MONGODB_URI_${institution.toUpperCase()} is not set)`);
  }
}
