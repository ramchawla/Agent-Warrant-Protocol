// Spoken read-back and alerts (REQ-015, P1). Owner: Jackson, task 14. Stub: answers 501.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const notImplemented = async (_req: FastifyRequest, reply: FastifyReply) => reply.code(501).send({ error: "not implemented" });

export default async function ttsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/tts", { preHandler: app.requireSessionOrReviewer }, notImplemented);   // {kind, id} -> audio stream
}
