// The agent's only capability (REQ-004 to REQ-010, PRD 8.6). Owner: Max, task 7. Stub: every route answers 501.
// Child warrants (REQ-016, task 13) live here because they are authenticated by agent key.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const notImplemented = async (_req: FastifyRequest, reply: FastifyReply) => reply.code(501).send({ error: "not implemented" });

export default async function actRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/act", notImplemented);                     // ActRequest -> 200 ActAllow | 403 ActDeny
  app.post("/api/warrants/:id/children", notImplemented);   // {terms} -> {warrantId, status: "active"} | 422
}
