// MongoDB validators (REQ-002). Runs against the configured gate database after `npm run setup-db`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { closeDb, db, warrants } from "../src/gate/db.ts";
import { termsHash } from "../src/shared/canonical.ts";
import { config } from "../src/shared/config.ts";
import { newId, newNonce } from "../src/shared/ids.ts";
import type { Terms, WarrantDoc } from "../src/shared/types.ts";

const noUri = !config.mongoUri.gate && "MONGODB_URI_GATE is not set; validator tests need a database";

function makeWarrant(): WarrantDoc {
  const warrantId = newId("wrt");
  const terms: Terms = {
    v: 1,
    warrantId,
    userId: "usr_validator_test",
    agentId: "agt_validator_test",
    parentWarrantId: null,
    scope: {
      actions: ["kyc.refresh", "payment.create"],
      accounts: ["A1"],
      merchants: ["M1"],
      destinations: ["bank", "fintech"],
      fields: { "kyc.refresh": ["account", "fields"], "payment.create": ["fromAccount", "merchant", "amountCents", "currency", "memo"], "data.export": [] },
    },
    currency: "CAD",
    perActionMaxCents: 5000,
    totalLimitCents: 12000,
    notBefore: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    nonce: newNonce(),
  };
  return {
    _id: warrantId,
    terms,
    termsHash: termsHash(terms),
    approval: null,
    state: { status: "pending", remainingCents: terms.totalLimitCents, actionCount: 0 },
    ancestors: [],
    expiresAt: new Date(terms.expiresAt),
    createdAt: new Date(),
  };
}

const isValidationError = (error: unknown): boolean => (error as { code?: number }).code === 121;

test("warrant validator", { skip: noUri }, async (t) => {
  const inserted: string[] = [];
  // One hook, in order: remove test documents, then close the client so the process can exit.
  t.after(async () => {
    await warrants().deleteMany({ _id: { $in: inserted } });
    await closeDb();
  });
  const info = await db().listCollections({ name: "warrants" }).next();
  if (!(info as { options?: { validator?: unknown } } | null)?.options?.validator) {
    t.skip(`${config.dbName.gate}.warrants has no validator; run \`npm run setup-db\` first`);
    return;
  }
  await t.test("accepts a well-formed warrant", async () => {
    const doc = makeWarrant();
    await warrants().insertOne(doc);
    inserted.push(doc._id);
  });

  const malformed: [string, (doc: any) => void][] = [
    ["a missing terms field", (d) => delete d.terms.nonce],
    ["an unknown top-level field", (d) => (d.note = "x")],
    ["an unknown terms field", (d) => (d.terms.extra = true)],
    ["an unknown state field", (d) => (d.state.bonusCents = 5)],
    ["a status outside the enum", (d) => (d.state.status = "expired")],
    ["a fractional limit", (d) => (d.terms.totalLimitCents = 120.5)],
    ["an unknown action type", (d) => d.terms.scope.actions.push("account.close")],
    ["a currency other than CAD", (d) => (d.terms.currency = "USD")],
    ["a short terms hash", (d) => (d.termsHash = "abc")],
    ["a negative remainingCents on insert", (d) => (d.state.remainingCents = -1)],
    ["expiresAt stored as a string", (d) => (d.expiresAt = d.terms.expiresAt)],
  ];
  for (const [name, breakIt] of malformed) {
    await t.test(`rejects ${name}`, async () => {
      const doc = makeWarrant();
      breakIt(doc);
      inserted.push(doc._id);   // cleaned up if the validator wrongly lets it in
      await assert.rejects(warrants().insertOne(doc), isValidationError);
    });
  }

  await t.test("rejects an update that makes remainingCents negative", async () => {
    const doc = makeWarrant();
    await warrants().insertOne(doc);
    inserted.push(doc._id);
    await warrants().updateOne({ _id: doc._id }, { $inc: { "state.remainingCents": -12000 } });
    await assert.rejects(warrants().updateOne({ _id: doc._id }, { $inc: { "state.remainingCents": -1 } }), isValidationError);
    const stored = await warrants().findOne({ _id: doc._id });
    assert.equal(stored?.state.remainingCents, 0);
  });
});
