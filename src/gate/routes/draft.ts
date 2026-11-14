// English to draft terms (REQ-014, P1). Owner: Jackson, task 12. Stub: answers 501.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const notImplemented = async (_req: FastifyRequest, reply: FastifyReply) => reply.code(501).send({ error: "not implemented" });

export default async function draftRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/draft", { preHandler: app.requireSession }, notImplemented);   // {text} -> {terms, plain, warnings} | 422
}
