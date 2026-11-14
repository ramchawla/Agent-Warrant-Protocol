// The agent's only capability (REQ-004 to REQ-010, PRD 8.6). Owner: Max, task 7.
// Child warrants (REQ-016, task 13) live here because they are authenticated by agent key.
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ClientSession } from "mongodb";
import { z } from "zod";
import { hashJcs, jcs, termsHash } from "../../shared/canonical.ts";
import { config } from "../../shared/config.ts";
import { newId } from "../../shared/ids.ts";
import type { ActAllow, ActDeny, Action, AuditEvent, ReasonCode, WarrantDoc } from "../../shared/types.ts";
import { authenticateAgent } from "../agents.ts";
import { auditEvents, mongo, warrants } from "../db.ts";
import { actionAmountCents, evaluate } from "../evaluate.ts";
import { appendEvent, type NewEvent } from "../ledger.ts";
import { buildReceipt, forwardReceipt } from "../receipts.ts";

// ---- request shape (bounded sizes; unknown top-level keys are malformed) ----

const jcsable = (value: unknown): boolean => {
  try {
    jcs(value);   // rejects values with no canonical form, such as 1e999
    return true;
  } catch {
    return false;
  }
};

const ActRequestSchema = z.strictObject({
  warrantId: z.string().min(1).max(64),
  runId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(128),
  action: z
    .strictObject({
      type: z.enum(["kyc.refresh", "payment.create", "data.export"]),
      destination: z.string().max(256),
      params: z.record(z.string().max(64), z.unknown()).refine((p) => Object.keys(p).length <= 50),
    })
    .refine(jcsable),
});

// ---- one in-process mutex around every transaction (PRD 8.6 step 5); correctness comes from the conditional updates ----

let tail: Promise<unknown> = Promise.resolve();
function locked<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work);
  tail = run.catch(() => undefined);
  return run;
}

function tx<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  return locked(async () => {
    const session = mongo().startSession();
    try {
      return await session.withTransaction(work);
    } finally {
      await session.endSession();
    }
  });
}

// ---- event text and shape: field names and sizes, never parameter values ----

type Ctx = {
  agentId: string | null;
  warrantId: string | null;
  runId: string | null;
  termsHash: string | null;
  decisionId: string;
  idempotencyKey?: string;   // set only once the caller is known to own the warrant
  action?: Action;           // absent for unauthenticated and malformed requests
  note?: string;             // summary text when there is no action
  warrant?: WarrantDoc;
  trace?: AtomicTrace;       // filled by decide(); returned only when the caller asks for it
  receiptView?: ReceiptView; // filled by execute(); returned only when the caller asks for it
};
type ReceiptView = { decisionId: string; aud: "bank" | "fintech"; iat: string; exp: string; actionHash: string; ledger: { seq: number; hash: string }; gateSig: string };

// ---- trace (story inspector): the conditional update that decided, as plain JSON ----

export type AtomicTrace = { filter: Record<string, unknown>; update: Record<string, unknown>; matched: 0 | 1 };
export type Trace = { atomicUpdate: AtomicTrace; gateMs: number };

const holdFilter = (warrantId: string, now: Date, amount: number) => ({
  _id: warrantId, "state.status": "active" as const, expiresAt: { $gt: now }, "state.remainingCents": { $gte: amount },
});
const holdUpdate = (amount: number) => ({ $inc: { "state.remainingCents": 0 - amount, "state.actionCount": 1 } });
const shownAmount = (action: Action | undefined): number => {
  const a = action?.type === "payment.create" ? action.params.amountCents : 0;
  return typeof a === "number" && Number.isFinite(a) ? a : 0;
};
const plainJson = (v: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(v));
function traceOf(c: Ctx, now: Date): AtomicTrace {
  const amount = shownAmount(c.action);
  return c.trace ?? { filter: { ...plainJson(holdFilter("", now, amount)), _id: c.warrantId }, update: plainJson(holdUpdate(amount)), matched: 0 };
}
type AllowCtx = Ctx & { action: Action; warrant: WarrantDoc };

const clip = (s: string): string => (s.length > 64 ? `${s.slice(0, 64)}...` : s);
const text = (v: unknown): string | undefined => (typeof v === "string" ? clip(v) : undefined);
const money = (cents: number): string => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

function describe({ type, destination, params }: Action): string {
  if (type === "data.export") return `data.export to ${destination}`;
  const account = text(params.account ?? params.fromAccount);
  const merchant = text(params.merchant);
  const currency = text(params.currency);
  const amount = typeof params.amountCents === "number" && Number.isFinite(params.amountCents) ? params.amountCents : undefined;
  const parts: string[] = [type];
  if (type === "payment.create") {
    if (amount !== undefined) parts.push("of", money(amount) + (currency ? ` ${currency}` : ""));
    if (account) parts.push("from", account);
    if (merchant) parts.push("to", merchant);
  } else if (account) parts.push("on account", account);
  parts.push("at", destination);
  return parts.join(" ");
}

function actionRecord({ type, destination, params }: Action): NonNullable<AuditEvent["action"]> {
  const fieldNames = Object.keys(params).sort();
  const record: NonNullable<AuditEvent["action"]> = {
    type,
    destination,
    fieldNames,
    fieldSizes: Object.fromEntries(fieldNames.map((name) => [name, jcs(params[name]).length])),
  };
  const account = text(params.account ?? params.fromAccount);
  const merchant = text(params.merchant);
  if (account !== undefined) record.account = account;
  if (merchant !== undefined) record.merchant = merchant;
  if (typeof params.amountCents === "number" && Number.isFinite(params.amountCents)) record.amountCents = params.amountCents;
  return record;
}

function decisionEvent(c: Ctx, reasonCode?: ReasonCode): NewEvent {
  const what = c.action ? describe(c.action) : (c.note ?? "request");
  const event: NewEvent = {
    type: "DECISION",
    warrantId: c.warrantId,
    termsHash: c.termsHash,
    agentId: c.agentId,
    runId: c.runId,
    decisionId: c.decisionId,
    decision: reasonCode ? "deny" : "allow",
    summary: reasonCode ? `Denied ${what}: ${reasonCode}.` : `Allowed ${what}.`,
  };
  if (c.idempotencyKey !== undefined) event.idempotencyKey = c.idempotencyKey;
  if (reasonCode) event.reasonCode = reasonCode;
  if (c.action) {
    event.action = actionRecord(c.action);
    event.actionHash = hashJcs(c.action);
  }
  return event;
}

// ---- the decision transaction ----

async function whyNotSpent(warrantId: string, now: Date, session: ClientSession): Promise<ReasonCode> {
  const w = await warrants().findOne({ _id: warrantId }, { session });
  if (!w) return "WARRANT_NOT_FOUND";
  if (w.state.status === "revoked") return "WARRANT_REVOKED";
  if (w.state.status !== "active") return "WARRANT_NOT_ACTIVE";
  if (!(w.expiresAt.getTime() > now.getTime())) return "WARRANT_EXPIRED";
  return "BUDGET_EXHAUSTED";
}

/** pre is a denial already decided; without it the action tries to spend. Appends the DECISION event either way. */
function decide(c: Ctx, pre: ReasonCode | undefined, now: Date): Promise<{ event: AuditEvent; remainingCents?: number }> {
  if (pre === undefined && !(c.action && c.warrantId)) throw new Error("allow path needs a warrant and an action");
  return tx(async (session) => {
    let reasonCode = pre;
    let remainingCents: number | undefined;
    if (reasonCode === undefined && c.action && c.warrantId) {
      const amount = actionAmountCents(c.action);   // 0 - amount below: a double -0 would fail the warrant's integer validator
      const filter = holdFilter(c.warrantId, now, amount);
      const update = holdUpdate(amount);
      const held = await warrants().findOneAndUpdate(filter, update, { session, returnDocument: "after" });
      c.trace = { filter: plainJson(filter), update: plainJson(update), matched: held ? 1 : 0 };
      if (held) remainingCents = held.state.remainingCents;
      else reasonCode = await whyNotSpent(c.warrantId, now, session);
    }
    return { event: await appendEvent(session, decisionEvent(c, reasonCode)), remainingCents };
  });
}

// ---- answers ----

const unavailable: ActDeny = { decision: "deny", decisionId: "", seq: -1, reasonCode: "LEDGER_UNAVAILABLE" };   // nothing could be recorded

const denial = (e: AuditEvent): ActDeny => ({ decision: "deny", decisionId: e.decisionId ?? "", seq: e.seq, reasonCode: e.reasonCode ?? "LEDGER_UNAVAILABLE" });

const findDecision = (warrantId: string, idempotencyKey: string) => auditEvents().findOne({ type: "DECISION", warrantId, idempotencyKey });

/** A retry gets the original decision back, with the outcome and budget as they stand now. */
async function replay(e: AuditEvent): Promise<ActAllow | ActDeny> {
  if (e.decision !== "allow") return denial(e);
  const executed = await auditEvents().findOne({ type: "EXECUTION", decisionId: e.decisionId });
  const warrant = e.warrantId ? await warrants().findOne({ _id: e.warrantId }) : null;
  return { decision: "allow", decisionId: e.decisionId ?? "", seq: e.seq, outcome: executed?.outcome ?? "unknown", remainingCents: warrant?.state.remainingCents ?? 0 };
}

// ---- after the DECISION committed: forward, then record the outcome. Never throws. ----

async function recordExecution(c: AllowCtx, outcome: "executed" | "rejected" | "unknown", institutionRef: string | undefined): Promise<void> {
  const { action, warrant, decisionId } = c;
  const summary =
    outcome === "executed" ? `Executed ${action.type} for decision ${decisionId} at ${action.destination}${institutionRef ? ` (${clip(institutionRef)})` : ""}.`
    : outcome === "rejected" ? `Rejected ${action.type} for decision ${decisionId} by ${action.destination}; held amount released.`
    : `Unknown outcome of ${action.type} for decision ${decisionId} at ${action.destination}: no confirmation from the institution; amount stays held.`;
  await tx(async (session) => {
    // execute() is the only caller, once per committed decision. The duplicate check (one round trip under the mutex)
    // guards only the release, the one step a second record would get wrong. The mutex is held, so they cannot interleave.
    if (outcome === "rejected") {
      if (await auditEvents().findOne({ type: "EXECUTION", decisionId }, { session })) return;
      await warrants().updateOne({ _id: warrant._id }, { $inc: { "state.remainingCents": actionAmountCents(action), "state.actionCount": -1 } }, { session });
    }
    const event: NewEvent = {
      type: "EXECUTION",
      warrantId: warrant._id,
      termsHash: warrant.termsHash,
      agentId: c.agentId,
      runId: c.runId,
      decisionId,
      outcome,
      summary,
    };
    if (institutionRef) event.institutionRef = clip(institutionRef);
    await appendEvent(session, event);
  });
}

async function execute(c: AllowCtx, decision: AuditEvent, remainingAfterHold: number, log: FastifyBaseLogger, source: Ctx): Promise<ActAllow> {
  const { action, warrant } = c;
  // A destination that is not an institution (the story's "llm") is released by the gate's own egress step, not forwarded here.
  if (action.destination !== "bank" && action.destination !== "fintech" && action.type === "data.export") {
    return { decision: "allow", decisionId: c.decisionId, seq: decision.seq, outcome: "unknown", remainingCents: remainingAfterHold };
  }
  let forwarded: Awaited<ReturnType<typeof forwardReceipt>> = { outcome: "unknown" };
  try {
    const aud = action.destination;
    if (aud !== "bank" && aud !== "fintech") throw new Error(`no institution for destination ${clip(aud)}`);
    // TODO(task 13): for a warrant with ancestors the chain is every ancestor, root first. One element for now.
    const chain = [{ terms: warrant.terms, approval: warrant.approval }];
    const { receipt, gateSig } = buildReceipt({ decisionId: c.decisionId, aud, action, chain, ledger: { seq: decision.seq, hash: decision.hash } });
    const { decisionId, iat, exp, actionHash, ledger } = receipt;
    source.receiptView = { decisionId, aud, iat, exp, actionHash, ledger, gateSig };
    forwarded = await forwardReceipt(aud, receipt, gateSig);
  } catch (error) {
    log.error({ err: error, decisionId: c.decisionId }, "receipt or forwarding failed; outcome is unknown");
  }
  const { outcome, institutionRef, result } = forwarded;
  try {
    await recordExecution(c, outcome, institutionRef);
  } catch (error) {
    // The DECISION is committed and the institution has answered; the missing EXECUTION is what the reviewer view flags.
    log.error({ err: error, decisionId: c.decisionId }, "could not record the EXECUTION event");
  }
  const answer: ActAllow = {
    decision: "allow",
    decisionId: c.decisionId,
    seq: decision.seq,
    outcome,
    remainingCents: outcome === "rejected" ? remainingAfterHold + actionAmountCents(action) : remainingAfterHold,
  };
  if (outcome === "executed" && result !== undefined) answer.result = result;
  return answer;
}

/** Records the decision (or returns the winner of an idempotency race) and, for an allow, executes. */
async function settle(c: Ctx, pre: ReasonCode | undefined, now: Date, log: FastifyBaseLogger, seen?: { decidedAt?: number }): Promise<ActAllow | ActDeny> {
  let decided: { event: AuditEvent; remainingCents?: number };
  try {
    decided = await decide(c, pre, now);
    if (seen) seen.decidedAt = Date.now();
  } catch (error) {
    // Two identical requests committed at once: the unique index let one win; this one returns the winner's decision.
    if (c.idempotencyKey !== undefined && c.warrantId && (error as { code?: number }).code === 11000) {
      const winner = await findDecision(c.warrantId, c.idempotencyKey);
      if (winner) return replay(winner);
    }
    throw error;
  }
  if (decided.event.decision !== "allow") return denial(decided.event);
  if (!(c.action && c.warrant)) throw new Error("allow without warrant");   // unreachable: decide checks it
  return execute({ ...c, action: c.action, warrant: c.warrant }, decided.event, decided.remainingCents ?? 0, log, c);
}

// ---- the request ----

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sizeOf = (v: unknown): number => {
  try {
    return jcs(v).length;
  } catch {
    return 0;
  }
};

// Names and sizes of what a malformed request sent: the sender controls the text, so it is sanitised and bounded.
function malformedNote(raw: string, body: unknown): string {
  if (!isRecord(body)) return `malformed request (body is not a JSON object, ${raw.length} characters)`;
  const names = Object.keys(body).sort();
  const fields = names.slice(0, 20).map((k) => `${k.replace(/[^\w.-]/g, "?").slice(0, 32)} ${sizeOf(body[k])}`);
  return `malformed request (fields: ${fields.join(", ")}${names.length > 20 ? ", ..." : ""})`;
}

async function handle(authorization: string | undefined, rawBody: unknown, log: FastifyBaseLogger, seen: { c?: Ctx; now?: Date; decidedAt?: number }): Promise<ActAllow | ActDeny> {
  const raw = typeof rawBody === "string" ? rawBody : "";
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  // warrantId and runId in the body are unverified until the warrant is loaded and its agent matches, so
  // unauthenticated and malformed denials never name them: nobody can write events into another warrant's or run's timeline.
  const who = { warrantId: null, runId: null, termsHash: null, decisionId: newId("dec") };
  const now = new Date();
  seen.now = now;

  const agentId = await authenticateAgent(authorization);   // first, before the body is looked at
  if (!agentId) return settle({ ...who, agentId: null, note: "request with no valid agent key" }, "AGENT_UNAUTHENTICATED", now, log);

  const request = ActRequestSchema.safeParse(body);
  if (!request.success) return settle({ ...who, agentId, note: malformedNote(raw, body) }, "MALFORMED_REQUEST", now, log);
  const { warrantId, runId, idempotencyKey, action } = request.data;
  const c: Ctx = { agentId, warrantId, runId, termsHash: null, decisionId: who.decisionId, action: action as Action };
  seen.c = c;

  // Until the caller is shown to own the warrant its idempotency key is not trusted: another agent must not be able to claim it.
  const warrant = await warrants().findOne({ _id: warrantId });
  if (!warrant) return settle(c, "WARRANT_NOT_FOUND", now, log);
  c.termsHash = warrant.termsHash;
  if (termsHash(warrant.terms) !== warrant.termsHash) return settle(c, "TERMS_TAMPERED", now, log);
  if (warrant.terms.agentId !== agentId) return settle(c, "AGENT_MISMATCH", now, log);

  c.idempotencyKey = idempotencyKey;
  const prior = await findDecision(warrantId, idempotencyKey);
  if (prior) return replay(prior);

  const verdict = evaluate(warrant.terms, c.action!, now);
  // The Date copy of the expiry is what the atomic update filters on; the signed terms are checked here too.
  const pre = verdict.decision === "deny" ? verdict.reasonCode : now.getTime() < Date.parse(warrant.terms.expiresAt) ? undefined : "WARRANT_EXPIRED";
  c.warrant = warrant;
  return settle(c, pre, now, log, seen);
}

const notImplemented = async (_req: FastifyRequest, reply: FastifyReply) => reply.code(501).send({ error: "not implemented" });

export default async function actRoutes(app: FastifyInstance): Promise<void> {
  // The body arrives as text for every content type, so a request that is not JSON is a recorded MALFORMED_REQUEST, not a framework error.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.post("/api/act", async (req, reply) => {
    let answer: ActAllow | ActDeny;
    const started = Date.now();
    const seen: { c?: Ctx; now?: Date; decidedAt?: number } = {};
    try {
      answer = await handle(req.headers.authorization, req.body, req.log, seen);
    } catch (error) {
      // Fail closed: nothing was forwarded (the only thing after the DECISION commit is caught inside execute).
      req.log.error({ err: error }, "act failed before a decision was recorded");
      answer = unavailable;
    }
    // Story inspector: "x-awp-trace: 1" adds the conditional update that decided and the gate's decision time.
    if (req.headers["x-awp-trace"] === "1") {
      const c = seen.c ?? { agentId: null, warrantId: null, runId: null, termsHash: null, decisionId: "" };
      const trace: Trace = { atomicUpdate: traceOf(c, seen.now ?? new Date()), gateMs: (seen.decidedAt ?? Date.now()) - started };
      return reply.code(answer.decision === "allow" ? 200 : 403).send({ ...answer, trace, ...(seen.c?.receiptView && { receipt: seen.c.receiptView }) });
    }
    return reply.code(answer.decision === "allow" ? 200 : 403).send(answer);
  });
  app.post("/api/warrants/:id/children", notImplemented);   // {terms} -> {warrantId, status: "active"} | 422
}
