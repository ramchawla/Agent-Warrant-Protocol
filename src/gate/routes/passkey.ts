// Passkey registration (REQ-001). Owner: Jackson, task 3.
// After a verified registration: reply.startSession(userId), then enroll the credential at both
// institutions (POST {institutionUrl}/enroll, header config.enrollHeader = ENROLL_SECRET).
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import type { FastifyInstance } from "fastify";
import { Binary } from "mongodb";
import { z } from "zod";
import { b64url } from "../../shared/canonical.ts";
import { config, type InstitutionId } from "../../shared/config.ts";
import { credentials, users } from "../db.ts";

const fail = (statusCode: number, message: string): Error => Object.assign(new Error(message), { statusCode });

// Demo user IDs: "usr_" plus letters, digits, "_" or "-". The page mints usr_<24 hex>; seed data may use readable IDs.
const UserId = z.string().regex(/^usr_[A-Za-z0-9_-]{1,64}$/);
const OptionsBody = z.object({ userId: UserId, name: z.string().trim().min(1).max(80).optional() });
const VerifyBody = z.object({ userId: UserId, response: z.looseObject({ id: z.string(), response: z.looseObject({}) }) });

// Registration challenges live in this process for 5 minutes, one per user, and are used once.
// The gate is a single process (PRD 8.1), so memory is enough; a restart only means registering again.
const pending = new Map<string, { challenge: string; expiresAt: number }>();
function takeChallenge(userId: string): string | null {
  const entry = pending.get(userId);
  pending.delete(userId);
  return entry && entry.expiresAt > Date.now() ? entry.challenge : null;
}

export type Enrollment = Record<InstitutionId, boolean>;

/** POST /enroll at each institution. Never throws: a down institution is reported as false. */
export async function enrollAtInstitutions(userId: string, credentialId: string, publicKey: Uint8Array): Promise<Enrollment> {
  const body = JSON.stringify({ userId, credential: { id: credentialId, publicKey: b64url(publicKey) } });
  const ids = Object.keys(config.institutionUrl) as InstitutionId[];
  const results = await Promise.all(
    ids.map(async (id) => {
      if (!config.enrollSecret) return false;
      try {
        const res = await fetch(`${config.institutionUrl[id]}/enroll`, {
          method: "POST",
          headers: { "content-type": "application/json", [config.enrollHeader]: config.enrollSecret },
          body,
          signal: AbortSignal.timeout(3_000),
        });
        return res.ok;
      } catch {
        return false;
      }
    }),
  );
  return Object.fromEntries(ids.map((id, i) => [id, results[i]])) as Enrollment;
}

export default async function passkeyRoutes(app: FastifyInstance): Promise<void> {
  // {userId} -> registration options JSON
  app.post("/api/passkey/register/options", async (req) => {
    const parsed = OptionsBody.safeParse(req.body);
    if (!parsed.success) throw fail(400, "body must be {userId: \"usr_…\", name?}");
    const { userId, name } = parsed.data;

    await users().updateOne({ _id: userId }, { $setOnInsert: { name: name ?? userId } }, { upsert: true });
    const existing = await credentials().find({ userId, rpId: config.rpId, kind: "platform" }).toArray();

    const options = await generateRegistrationOptions({
      rpName: "Agent Warrant Protocol",
      rpID: config.rpId,
      userName: name ?? userId,
      userID: new TextEncoder().encode(userId),
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({ id: c._id })),
      // A passkey on this laptop (Touch ID, Windows Hello) with user verification required.
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
    });
    pending.set(userId, { challenge: options.challenge, expiresAt: Date.now() + config.challengeTtlMs });
    return options;
  });

  // {userId, response} -> {credentialId}; sets the session cookie; enrolls at both institutions
  app.post("/api/passkey/register/verify", async (req, reply) => {
    const parsed = VerifyBody.safeParse(req.body);
    if (!parsed.success) throw fail(400, "body must be {userId, response}");
    const { userId } = parsed.data;
    const response = parsed.data.response as unknown as RegistrationResponseJSON;

    const expectedChallenge = takeChallenge(userId);
    if (!expectedChallenge) throw fail(409, "registration challenge expired, already used, or never issued");

    let info;
    try {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
      });
      if (!result.verified || !result.registrationInfo) throw new Error("registration did not verify");
      info = result.registrationInfo;
    } catch (error) {
      throw fail(403, `passkey registration rejected: ${(error as Error).message}`);
    }

    const { id: credentialId, publicKey, counter } = info.credential;
    if (await credentials().findOne({ _id: credentialId })) throw fail(409, "this passkey is already registered");
    await credentials().insertOne({
      _id: credentialId,
      userId,
      publicKey: new Binary(publicKey),
      counter,
      kind: "platform",
      rpId: config.rpId,
    });

    reply.startSession(userId);
    const enrolled = await enrollAtInstitutions(userId, credentialId, publicKey);
    if (!enrolled.bank || !enrolled.fintech) {
      req.log.warn({ userId, enrolled }, "passkey registered but not enrolled at every institution; POST /api/passkey/enroll once they are running");
    }
    return { credentialId, enrolled };
  });

  // Not in PRD 8.5: re-sends the session user's passkeys to both institutions. Registration can run
  // before the institutions are up, and the same passkey cannot be registered twice. {} -> {enrolled}
  app.post("/api/passkey/enroll", { preHandler: app.requireSession }, async (req) => {
    const userId = req.userId!;
    const mine = await credentials().find({ userId, rpId: config.rpId, kind: "platform" }).toArray();
    if (mine.length === 0) throw fail(404, "no passkey registered for this session");
    const results = await Promise.all(mine.map((c) => enrollAtInstitutions(userId, c._id, new Uint8Array(c.publicKey.value()))));
    const enrolled = { bank: results.every((r) => r.bank), fintech: results.every((r) => r.fintech) };
    return { enrolled };
  });

  // Not in PRD 8.5: lets the pages show who is signed in. -> {userId} or 401
  app.get("/api/passkey/session", { preHandler: app.requireSession }, async (req) => ({ userId: req.userId }));
}
