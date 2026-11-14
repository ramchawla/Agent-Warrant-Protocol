// Mock institution, run twice: INSTITUTION=bank (:4001) or INSTITUTION=fintech (:4002). Owner: Max, task 8.
// Stub: every route answers 501.
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { config, type InstitutionId } from "../shared/config.ts";

const institution = process.env.INSTITUTION as InstitutionId;
if (institution !== "bank" && institution !== "fintech") throw new Error("INSTITUTION must be bank or fintech");

const notImplemented = async (_req: FastifyRequest, reply: FastifyReply) => reply.code(501).send({ error: "not implemented" });

const app = Fastify({ logger: true });
app.post("/enroll", notImplemented);    // header config.enrollHeader; {userId, credential: {id, publicKey}} -> {enrolled: true}
app.post("/execute", notImplemented);   // {receipt, gateSig} -> 200 {executed: true, institutionRef, duplicate?} | 4xx {rejected: true, reason}
app.get("/state", notImplemented);      // accounts or payments, for display
app.get("/anchors", notImplemented);    // [{seq, hash}]
await app.listen({ port: config.port[institution], host: "localhost" });
