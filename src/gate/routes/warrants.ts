// Warrant create, get and approve (REQ-002, REQ-003). Owner: Jackson, task 3. Stub: every route answers 501.
// Approval calls issueOptions and verifyAndActivate from ../approval.ts.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const notImplemented = async (_req: FastifyRequest, reply: FastifyReply) => reply.code(501).send({ error: "not implemented" });

export default async function warrantRoutes(app: FastifyInstance): Promise<void> {
  // {terms} without warrantId and nonce -> {warrantId, termsHash, status: "pending", plain: string[]}
  app.post("/api/warrants", { preHandler: app.requireSession }, notImplemented);
  // -> WarrantDoc plus plain
  app.get("/api/warrants/:id", { preHandler: app.requireSessionOrReviewer }, notImplemented);
  // {termsHash} -> authentication options; 409 if the hash differs
  app.post("/api/warrants/:id/approve/options", { preHandler: app.requireSession }, notImplemented);
  // {response} -> {status: "active"}
  app.post("/api/warrants/:id/approve/verify", { preHandler: app.requireSession }, notImplemented);
}
