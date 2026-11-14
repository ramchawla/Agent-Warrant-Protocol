// Revocation (REQ-011). Owner: Pro, task 9.
// One updateMany over the warrant and every descendant, plus one REVOKED event, in one transaction.
// Enforcement needs no notification: act.ts reads the status inside its own atomic update, so the first
// action after this commits is denied WARRANT_REVOKED. A decision that committed earlier still executes.
import type { FastifyInstance } from "fastify";
import { mongo, warrants } from "../db.ts";
import { appendEvent, withLedgerLock } from "../ledger.ts";

const WARRANT_ID = /^wrt_[0-9a-f]{24}$/;

export default async function revokeRoutes(app: FastifyInstance): Promise<void> {
  // {} -> {revoked: number}; revoked counts the warrants that changed state, 0 when it was already revoked.
  app.post<{ Params: { id: string } }>("/api/warrants/:id/revoke", { preHandler: app.requireSessionOrReviewer }, async (req, reply) => {
    const id = req.params.id;
    if (!WARRANT_ID.test(id)) return reply.code(400).send({ error: "malformed warrant id" });
    const warrant = await warrants().findOne({ _id: id });
    if (!warrant) return reply.code(404).send({ error: "warrant not found" });
    // A customer may revoke only their own warrants; the reviewer token may revoke any.
    const isOwner = req.userId !== null && req.userId === warrant.terms.userId;
    if (!isOwner && !req.reviewer) return reply.code(403).send({ error: "not your warrant" });
    const revokedBy = isOwner ? warrant.terms.userId : "reviewer";

    let revoked = 0;
    const session = mongo().startSession();
    try {
      // The lock is held across the whole transaction so this and act.ts do not thrash on the ledger head.
      await withLedgerLock(() =>
        session.withTransaction(async () => {
          const result = await warrants().updateMany(
            { $or: [{ _id: id }, { ancestors: id }], "state.status": { $in: ["pending", "active"] } },
            { $set: { "state.status": "revoked", "state.revokedAt": new Date().toISOString(), "state.revokedBy": revokedBy } },
            { session },
          );
          revoked = result.modifiedCount;
          if (revoked === 0) return;
          await appendEvent(session, {
            type: "REVOKED",
            warrantId: id,
            termsHash: warrant.termsHash,
            agentId: warrant.terms.agentId,
            runId: null,
            summary: `Warrant ${id} revoked by ${isOwner ? `user ${revokedBy}` : "the reviewer"}; ${revoked} warrant${revoked === 1 ? "" : "s"} stopped.`,
          });
        }),
      );
    } finally {
      await session.endSession();
    }
    return { revoked };
  });
}
