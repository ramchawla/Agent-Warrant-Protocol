// Warrant create, get and approve (REQ-002, REQ-003). Owner: Jackson, task 3.
// Approval calls issueOptions and verifyAndActivate from ../approval.ts.
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { termsHash } from "../../shared/canonical.ts";
import { newId, newNonce } from "../../shared/ids.ts";
import type { ActionType, Terms, WarrantDoc } from "../../shared/types.ts";
import { issueOptions, verifyAndActivate } from "../approval.ts";
import { agents, mongo, warrants } from "../db.ts";
import { appendEvent } from "../ledger.ts";
import { money, plainTerms, termsWarnings, when } from "../templates.ts";

const fail = (statusCode: number, message: string): Error => Object.assign(new Error(message), { statusCode });

const ACTION_TYPES = ["kyc.refresh", "payment.create", "data.export"] as const;
const MAX_CENTS = 100_000_000;                        // $1,000,000: far above any demo limit, well inside int32
const MAX_LIFETIME_MS = 30 * 24 * 3_600_000;          // 30 days

const Name = z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/);
const FieldName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/);
const Cents = z.number().int().min(0).max(MAX_CENTS);
const IsoTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO 8601 time");
const unique = <T>(list: T[]) => new Set(list).size === list.length;

// What the page sends: the terms without warrantId and nonce (PRD 8.5). Unknown keys are refused.
const TermsInput = z.strictObject({
  v: z.literal(1),
  userId: z.string().optional(),                    // must be the session user when present
  agentId: z.string().regex(/^agt_[A-Za-z0-9_-]{1,64}$/),
  parentWarrantId: z.null().optional(),             // root warrants only; children come from /children (P1)
  scope: z.strictObject({
    actions: z.array(z.enum(ACTION_TYPES)).min(1).refine(unique, "actions repeat"),
    accounts: z.array(Name).max(50).refine(unique, "accounts repeat"),
    merchants: z.array(Name).max(50).refine(unique, "merchants repeat"),
    destinations: z.array(Name).min(1).max(10).refine(unique, "destinations repeat"),
    fields: z.partialRecord(z.enum(ACTION_TYPES), z.array(FieldName).max(20).refine(unique, "fields repeat")),
  }),
  currency: z.literal("CAD"),
  perActionMaxCents: Cents,
  totalLimitCents: Cents,
  notBefore: IsoTime,
  expiresAt: IsoTime,
});
const CreateBody = z.strictObject({ terms: TermsInput });
const OptionsBody = z.object({ termsHash: z.string().length(43) });
const VerifyBody = z.object({ response: z.looseObject({ id: z.string(), response: z.looseObject({}) }) });
const IdParams = z.object({ id: z.string().regex(/^wrt_[A-Za-z0-9_-]{1,64}$/) });

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw fail(400, `${what}: ${first ? `${first.path.join(".") || "(root)"} ${first.message}` : "invalid"}`);
  }
  return result.data;
}

/** The warrant, if the caller may see it: its own user, or a reviewer. Otherwise 404 (no hint that it exists). */
async function loadVisible(req: FastifyRequest, opts: { ownerOnly: boolean }): Promise<WarrantDoc> {
  const { id } = parse(IdParams, req.params, "warrant id");
  const doc = await warrants().findOne({ _id: id });
  const owner = doc && req.userId && doc.terms.userId === req.userId;
  if (!doc || !(owner || (!opts.ownerOnly && req.reviewer))) throw fail(404, "warrant not found");
  return doc;
}

export default async function warrantRoutes(app: FastifyInstance): Promise<void> {
  // {terms} without warrantId and nonce -> {warrantId, termsHash, status: "pending", plain: string[]}
  app.post("/api/warrants", { preHandler: app.requireSession }, async (req) => {
    const input = parse(CreateBody, req.body, "terms").terms;
    const userId = req.userId!;
    if (input.userId !== undefined && input.userId !== userId) throw fail(403, "terms.userId must be the signed-in user");

    const notBefore = Date.parse(input.notBefore);
    const expiresAt = Date.parse(input.expiresAt);
    if (!(expiresAt > Date.now())) throw fail(422, "expiresAt must be in the future");
    if (!(notBefore < expiresAt)) throw fail(422, "notBefore must be before expiresAt");
    if (expiresAt - Date.now() > MAX_LIFETIME_MS) throw fail(422, "a warrant may last at most 30 days");
    if (input.perActionMaxCents > input.totalLimitCents) throw fail(422, "perActionMaxCents cannot exceed totalLimitCents");

    const agent = await agents().findOne({ _id: input.agentId });
    if (!agent || agent.status !== "active") throw fail(422, `agent ${input.agentId} is unknown or disabled`);

    const warrantId = newId("wrt");
    const fields = Object.fromEntries(ACTION_TYPES.map((a) => [a, input.scope.fields[a] ?? []])) as Record<ActionType, string[]>;
    const terms: Terms = {
      v: 1,
      warrantId,
      userId,
      agentId: input.agentId,
      parentWarrantId: null,
      scope: {
        actions: input.scope.actions,
        accounts: input.scope.accounts,
        merchants: input.scope.merchants,
        destinations: input.scope.destinations,
        fields,
      },
      currency: "CAD",
      perActionMaxCents: input.perActionMaxCents,
      totalLimitCents: input.totalLimitCents,
      notBefore: new Date(notBefore).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      nonce: newNonce(),
    };
    const hash = termsHash(terms);
    const doc: WarrantDoc = {
      _id: warrantId,
      terms,
      termsHash: hash,
      approval: null,
      state: { status: "pending", remainingCents: terms.totalLimitCents, actionCount: 0 },
      ancestors: [],
      expiresAt: new Date(terms.expiresAt),
      createdAt: new Date(),
    };

    const session = mongo().startSession();
    try {
      await session.withTransaction(async () => {
        await warrants().insertOne(doc, { session });
        await appendEvent(session, {
          type: "WARRANT_CREATED",
          warrantId,
          termsHash: hash,
          agentId: terms.agentId,
          runId: null,
          summary:
            `Warrant ${warrantId} created by user ${userId} for agent ${terms.agentId}: ` +
            `${terms.scope.actions.join(", ")}, up to ${money(terms.totalLimitCents)} in total, until ${when(terms.expiresAt)}.`,
        });
      });
    } finally {
      await session.endSession();
    }

    return { warrantId, termsHash: hash, status: "pending" as const, plain: plainTerms(terms), warnings: termsWarnings(terms) };
  });

  // -> WarrantDoc plus plain
  app.get("/api/warrants/:id", { preHandler: app.requireSessionOrReviewer }, async (req) => {
    const doc = await loadVisible(req, { ownerOnly: false });
    return { ...doc, plain: plainTerms(doc.terms), warnings: termsWarnings(doc.terms) };
  });

  // {termsHash} -> authentication options; 409 if the hash differs
  app.post("/api/warrants/:id/approve/options", { preHandler: app.requireSession }, async (req) => {
    const doc = await loadVisible(req, { ownerOnly: true });
    const { termsHash: displayed } = parse(OptionsBody, req.body, "body");
    return issueOptions(doc._id, displayed);
  });

  // {response} -> {status: "active"}
  app.post("/api/warrants/:id/approve/verify", { preHandler: app.requireSession }, async (req) => {
    const doc = await loadVisible(req, { ownerOnly: true });
    const { response } = parse(VerifyBody, req.body, "body");
    return verifyAndActivate(doc._id, response as unknown as AuthenticationResponseJSON);
  });
}
