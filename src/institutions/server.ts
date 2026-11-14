// Mock institution, run twice: INSTITUTION=bank (:4001) or INSTITUTION=fintech (:4002). Owner: Max, task 8.
// Each instance has its own Mongo client and database, and never touches the gate's. PRD 8.5 routes, 8.7 steps 3, 7, 8.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { Binary, MongoClient, type Db } from "mongodb";
import { z } from "zod";
import { fromB64url } from "../shared/canonical.ts";
import { config, need, type InstitutionId } from "../shared/config.ts";
import type { Receipt } from "../shared/types.ts";
import { verifyReceipt } from "../verifier/verifyReceipt.ts";

// Policy file shape. Strict: JSON has no comments, so a stray key such as "_comment" fails at startup.
// The fintech's perActionMaxCents (4000) is deliberately below what the demo warrant allows (5000), so a
// gate-allowed $50 payment is refused here by the institution's own policy (Story 4, third bullet).
const Policy = z.strictObject({
  institution: z.enum(["bank", "fintech"]),
  acceptedActions: z.array(z.string()).min(1),
  currency: z.literal("CAD"),
  perActionMaxCents: z.number().int().positive().optional(),
});
type Policy = z.infer<typeof Policy>;

const b64 = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+$/);
const EnrollBody = z.strictObject({
  userId: z.string().min(1).max(128),
  credential: z.strictObject({ id: b64(1024), publicKey: b64(2048) }),
});

// Shape only; verifyReceipt does the real checks on the original body (parsing must not strip or reorder keys that were signed).
const ExecuteBody = z.object({
  receipt: z.looseObject({
    v: z.literal(1),
    decisionId: z.string().min(1).max(100),
    aud: z.enum(["bank", "fintech"]),
    iat: z.string().max(40),
    exp: z.string().max(40),
    chain: z.array(z.looseObject({ terms: z.looseObject({}), approval: z.unknown() })).min(1).max(20),
    action: z.looseObject({ type: z.string().max(40), destination: z.string().max(200), params: z.record(z.string(), z.unknown()) }),
    actionHash: z.string().max(100),
    ledger: z.looseObject({ seq: z.number().int().min(0), hash: z.string().max(100) }),
  }),
  gateSig: z.string().min(1).max(200),
});

const KycParams = z.looseObject({ account: z.string().min(1).max(100), fields: z.array(z.string().max(100)).max(50) });
const PayParams = z.looseObject({
  fromAccount: z.string().min(1).max(100),
  merchant: z.string().min(1).max(200),
  amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().max(10),
  memo: z.string().max(1000).optional(),
});

// Stored in seen_receipts.result and replayed to duplicates.
type Result = { status: number; body: Record<string, unknown> };
type Seen = { _id: string; state: "processing" | "done"; receivedAt: Date; result?: Result };

// Verifier reason -> HTTP status: 400 malformed; 403 scope, limit or chain refusals; otherwise 401 (signature, credential, audience, expiry, terms hash).
const FORBIDDEN = new Set(["CHAIN_NOT_SUBSET", "WARRANT_EXPIRED", "ACTION_OUT_OF_SCOPE", "AMOUNT_OVER_LIMIT", "ACTION_HASH_MISMATCH"]);
const statusFor = (reason: string): number => (reason === "MALFORMED" ? 400 : FORBIDDEN.has(reason) ? 403 : 401);

const digest = (text: string): Buffer => createHash("sha256").update(text).digest();
const enrollSecretOk = (presented: unknown): boolean =>
  !!config.enrollSecret && typeof presented === "string" && timingSafeEqual(digest(presented), digest(config.enrollSecret));

const refuse = (status: number, reason: string): Result => ({ status, body: { rejected: true, reason } });

/** Own policy (8.7 step 7). Returns a refusal, or null when the action is acceptable. */
function checkPolicy(policy: Policy, receipt: Receipt): Result | null {
  const { action } = receipt;
  if (!policy.acceptedActions.includes(action.type)) return refuse(403, "POLICY_ACTION_NOT_ACCEPTED");
  if (action.destination !== policy.institution) return refuse(403, "POLICY_DESTINATION");
  if (action.type === "kyc.refresh") return KycParams.safeParse(action.params).success ? null : refuse(403, "POLICY_MALFORMED_PARAMS");
  const pay = PayParams.safeParse(action.params);
  if (!pay.success) return refuse(403, "POLICY_MALFORMED_PARAMS");
  if (pay.data.currency !== policy.currency) return refuse(403, "POLICY_CURRENCY");
  if (policy.perActionMaxCents !== undefined && pay.data.amountCents > policy.perActionMaxCents) return refuse(403, "POLICY_PER_ACTION_LIMIT");
  return null;
}

/** Mock execution (8.7 step 8). The bank refreshes an account record; the fintech records a payment keyed by decision ID. */
async function execute(db: Db, institution: InstitutionId, receipt: Receipt): Promise<string> {
  const now = new Date();
  const ref = (prefix: string) => `${prefix}_${randomBytes(8).toString("hex")}`;
  if (institution === "bank") {
    const { account } = KycParams.parse(receipt.action.params);
    const institutionRef = ref("bank_kyc");
    await db.collection<{ _id: string }>("accounts").updateOne(
      { _id: account },
      { $set: { lastKycRefreshAt: now.toISOString(), lastDecisionId: receipt.decisionId, lastInstitutionRef: institutionRef }, $inc: { refreshCount: 1 } },
      { upsert: true },
    );
    return institutionRef;
  }
  const p = PayParams.parse(receipt.action.params);
  const institutionRef = ref("fin_pay");
  await db.collection<{ _id: string; merchant: string; fromAccount: string; amountCents: number; currency: string; memo?: string; institutionRef: string; createdAt: Date }>("payments").insertOne({
    _id: receipt.decisionId,
    merchant: p.merchant,
    fromAccount: p.fromAccount,
    amountCents: p.amountCents,
    currency: p.currency,
    ...(p.memo !== undefined && { memo: p.memo }),
    institutionRef,
    createdAt: now,
  });
  return institutionRef;
}

export async function buildInstitution(institution: InstitutionId, options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const policy = Policy.parse(JSON.parse(readFileSync(new URL(`./policy.${institution}.json`, import.meta.url), "utf8")));
  if (policy.institution !== institution) throw new Error(`policy.${institution}.json is for ${policy.institution}`);
  const client = new MongoClient(need(config.mongoUri[institution], `MONGODB_URI_${institution.toUpperCase()}`));
  const db = client.db(config.dbName[institution]);
  const credentialsColl = db.collection<{ _id: string; userId: string; publicKey: Binary; enrolledAt: Date }>("enrolled_credentials");
  const seen = db.collection<Seen>("seen_receipts");
  const anchors = db.collection<{ _id: number; seq: number; hash: string }>("anchors");

  const app = Fastify({ logger: options.logger ?? false });
  app.addHook("onClose", async () => {
    await client.close();
  });

  app.post("/enroll", async (req, reply) => {
    if (!enrollSecretOk(req.headers[config.enrollHeader])) return reply.code(401).send({ error: "enrollment secret required" });
    const body = EnrollBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid enrollment" });
    const { userId, credential } = body.data;
    await credentialsColl.updateOne(
      { _id: credential.id },
      { $set: { userId, publicKey: new Binary(fromB64url(credential.publicKey)), enrolledAt: new Date() } },
      { upsert: true },
    );
    return { enrolled: true };
  });

  app.post("/execute", async (req, reply) => {
    const send = (r: Result) => reply.code(r.status).send(r.body);
    const gatePublicKey = config.gatePublicKey;
    if (!gatePublicKey) return send(refuse(500, "GATE_KEY_NOT_CONFIGURED"));   // fail closed
    const shape = ExecuteBody.safeParse(req.body);
    if (!shape.success) return send(refuse(400, "MALFORMED_REQUEST"));
    const input = req.body as { receipt: Receipt; gateSig: string };   // the original, not the parsed copy: the signature covers its exact JCS

    // 8.7 steps 1, 2, 4, 5, 6.
    const verdict = await verifyReceipt(input, {
      institution,
      gatePublicKey,
      rpId: config.rpId,
      origin: config.origin,
      now: new Date(),
      credentialsFor: async (userId) =>
        (await credentialsColl.find({ userId }).toArray()).map((c) => ({ id: c._id, publicKey: new Uint8Array(c.publicKey.value()) })),
    });
    if (!verdict.ok) return send(refuse(statusFor(verdict.reason), verdict.reason));
    const { receipt } = input;

    // Step 3: only a verified receipt is recorded; the unique _id makes a second presentation a duplicate-key error.
    try {
      await seen.insertOne({ _id: receipt.decisionId, state: "processing", receivedAt: new Date() });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const first = await seen.findOne({ _id: receipt.decisionId });
      if (first?.state === "done" && first.result) return send({ status: first.result.status, body: { ...first.result.body, duplicate: true } });
      return send(refuse(409, "IN_FLIGHT"));
    }

    // Steps 7 and 8. ponytail: a crash after the marker insert leaves it "processing" (answers IN_FLIGHT); fail closed, the receipt expires in 60 s anyway.
    let result = checkPolicy(policy, receipt);
    if (!result) result = { status: 200, body: { executed: true, institutionRef: await execute(db, institution, receipt) } };
    await seen.updateOne({ _id: receipt.decisionId }, { $set: { state: "done", result } });
    // Anchor: first write wins, so a later receipt cannot rewrite a checkpoint.
    await anchors.updateOne(
      { _id: receipt.ledger.seq },
      { $setOnInsert: { seq: receipt.ledger.seq, hash: receipt.ledger.hash } },
      { upsert: true },
    );
    return send(result);
  });

  app.get("/state", async () => {
    if (institution === "bank") {
      return { institution, accounts: await db.collection("accounts").find().sort({ lastKycRefreshAt: -1 }).limit(100).toArray() };
    }
    return { institution, payments: await db.collection("payments").find().sort({ createdAt: -1 }).limit(100).toArray() };
  });

  app.get("/anchors", async () => anchors.find({}, { projection: { _id: 0, seq: 1, hash: 1 } }).sort({ _id: 1 }).toArray());

  return app;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const institution = process.env.INSTITUTION as InstitutionId;
  if (institution !== "bank" && institution !== "fintech") throw new Error("INSTITUTION must be bank or fintech");
  const app = await buildInstitution(institution, { logger: true });
  await app.listen({ port: config.port[institution], host: "localhost" });
}
