// Revocation (REQ-011). Owner: Pro, task 9. Stub: answers 501.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const notImplemented = async (_req: FastifyRequest, reply: FastifyReply) => reply.code(501).send({ error: "not implemented" });

export default async function revokeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/warrants/:id/revoke", { preHandler: app.requireSessionOrReviewer }, notImplemented);   // {} -> {revoked: number}
}
