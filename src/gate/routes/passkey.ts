// Passkey registration (REQ-001). Owner: Jackson, task 3. Stub: every route answers 501.
// After a verified registration: reply.startSession(userId), then enroll the credential at both
// institutions (POST {institutionUrl}/enroll, header config.enrollHeader = ENROLL_SECRET).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const notImplemented = async (_req: FastifyRequest, reply: FastifyReply) => reply.code(501).send({ error: "not implemented" });

export default async function passkeyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/passkey/register/options", notImplemented);   // {userId} -> registration options JSON
  app.post("/api/passkey/register/verify", notImplemented);    // {userId, response} -> {credentialId}
}
