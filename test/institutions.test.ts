// Mock institutions (REQ-009, PRD 8.9 receipt tamper set), over HTTP against both, with the gate's real signing key
// and the software test authenticator. Needs the institution databases after `npm run setup-db`.
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { buildInstitution } from "../src/institutions/server.ts";
import { b64url, ed25519Sign, hashJcs, jcs, termsHash } from "../src/shared/canonical.ts";
import { config, type InstitutionId } from "../src/shared/config.ts";
import { newId, newNonce } from "../src/shared/ids.ts";
import type { Action, Receipt, Terms, WarrantDoc } from "../src/shared/types.ts";
import { createSoftAuthenticator } from "./softAuthenticator.ts";

const skip =
  (!config.mongoUri.bank && "MONGODB_URI_BANK is not set; institution tests need a database") ||
  (!config.mongoUri.fintech && "MONGODB_URI_FINTECH is not set; institution tests need a database") ||
  (!config.gatePrivateKey && "GATE_ED25519_PRIVATE_KEY is not set; the tests sign receipts as the gate") ||
  (!config.gatePublicKey && "GATE_ED25519_PUBLIC_KEY is not set; the institutions pin it") ||
  (!config.enrollSecret && "ENROLL_SECRET is not set; the tests enroll credentials");

const INSTITUTIONS: InstitutionId[] = ["bank", "fintech"];
const other = (i: InstitutionId): InstitutionId => (i === "bank" ? "fintech" : "bank");

function makeTerms(userId: string, account: string): Terms {
  return {
    v: 1,
    warrantId: newId("wrt"),
    userId,
    agentId: "agt_institution_test",
    parentWarrantId: null,
    scope: {
      actions: ["kyc.refresh", "payment.create"],
      accounts: [account],
      merchants: ["M1"],
      destinations: ["bank", "fintech"],
      fields: { "kyc.refresh": ["account", "fields"], "payment.create": ["fromAccount", "merchant", "amountCents", "currency", "memo"], "data.export": [] },
    },
    currency: "CAD",
    perActionMaxCents: 5000,
    totalLimitCents: 12000,
    notBefore: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    nonce: newNonce(),
  };
}

test("institutions: receipt verification, replay and own policy", { skip }, async (t) => {
  const mongo = new MongoClient(config.mongoUri.bank!);   // for assertions and cleanup; the servers have their own clients
  const fintechMongo = new MongoClient(config.mongoUri.fintech!);
  const dbOf = (i: InstitutionId) => (i === "bank" ? mongo : fintechMongo).db(config.dbName[i]);
  const apps = { bank: await buildInstitution("bank"), fintech: await buildInstitution("fintech") };

  const created = { decisionIds: [] as string[], credentialIds: [] as string[], seqs: [] as number[], accounts: [] as string[] };
  // One hook, in order: remove test documents from both databases, close the servers, then our own clients.
  t.after(async () => {
    for (const i of INSTITUTIONS) {
      const db = dbOf(i);
      await db.collection("seen_receipts").deleteMany({ _id: { $in: created.decisionIds as never[] } });
      await db.collection("payments").deleteMany({ _id: { $in: created.decisionIds as never[] } });
      await db.collection("accounts").deleteMany({ _id: { $in: created.accounts as never[] } });
      await db.collection("anchors").deleteMany({ _id: { $in: created.seqs as never[] } });
      await db.collection("enrolled_credentials").deleteMany({ _id: { $in: created.credentialIds as never[] } });
    }
    await Promise.all(INSTITUTIONS.map((i) => apps[i].close()));
    await Promise.all([mongo.close(), fintechMongo.close()]);
  });

  const seenCount = (i: InstitutionId, decisionId: string) => dbOf(i).collection("seen_receipts").countDocuments({ _id: decisionId as never });
  const storeCount = (i: InstitutionId, decisionId: string, account: string) =>
    i === "bank"
      ? dbOf(i).collection("accounts").countDocuments({ _id: account as never })
      : dbOf(i).collection("payments").countDocuments({ _id: decisionId as never });

  const enrollHeaders = { [config.enrollHeader]: config.enrollSecret! };
  const enroll = (i: InstitutionId, userId: string, auth: ReturnType<typeof createSoftAuthenticator>, headers: Record<string, string> = enrollHeaders) => {
    created.credentialIds.push(auth.credentialId);
    return apps[i].inject({ method: "POST", url: "/enroll", headers, payload: { userId, credential: { id: auth.credentialId, publicKey: b64url(auth.publicKey) } } });
  };

  /** A user with a credential enrolled at both institutions. */
  async function enrolledUser() {
    const userId = newId("usr");
    const auth = createSoftAuthenticator();
    for (const i of INSTITUTIONS) assert.equal((await enroll(i, userId, auth)).statusCode, 200);
    return { userId, auth };
  }

  /** The action and the account it touches, for institution i. */
  const actionFor = (i: InstitutionId, account: string, amountCents = 3000): Action =>
    i === "bank"
      ? { type: "kyc.refresh", destination: "bank", params: { account, fields: ["name", "address"] } }
      : { type: "payment.create", destination: "fintech", params: { fromAccount: account, merchant: "M1", amountCents, currency: "CAD", memo: "test" } };

  const approval = (auth: ReturnType<typeof createSoftAuthenticator>, terms: Terms): WarrantDoc["approval"] => ({
    kind: "passkey",
    credentialId: auth.credentialId,
    response: auth.getAssertion({ challenge: termsHash(terms) }),
    origin: config.origin,
    rpId: config.rpId,
    approvedAt: new Date().toISOString(),
  });

  /** A receipt as the gate would build it, plus its signature. Overrides let a test build the wrong thing and sign it properly. */
  function makeReceipt(o: { aud: InstitutionId; terms: Terms; approval: WarrantDoc["approval"]; action: Action; iat?: Date }) {
    const iat = o.iat ?? new Date();
    const seq = 9_000_000_000_000 + Math.floor(Math.random() * 1e9);
    const decisionId = newId("dec");
    created.decisionIds.push(decisionId);
    created.seqs.push(seq);
    const receipt: Receipt = {
      v: 1,
      decisionId,
      aud: o.aud,
      iat: iat.toISOString(),
      exp: new Date(iat.getTime() + config.receiptTtlMs).toISOString(),
      chain: [{ terms: o.terms, approval: o.approval }],
      action: o.action,
      actionHash: hashJcs(o.action),
      ledger: { seq, hash: b64url(randomBytes(32)) },
    };
    return { receipt, gateSig: ed25519Sign(config.gatePrivateKey!, jcs(receipt)) };
  }
  type Signed = ReturnType<typeof makeReceipt>;

  const post = (i: InstitutionId, payload: unknown) => apps[i].inject({ method: "POST", url: "/execute", payload: payload as object });
  const clone = (s: Signed): Signed => structuredClone(s);

  /** A valid, enrolled, approved receipt for institution i on a fresh account. */
  async function valid(i: InstitutionId, amountCents?: number) {
    const { userId, auth } = await enrolledUser();
    const account = `acct_${randomBytes(6).toString("hex")}`;
    created.accounts.push(account);
    const terms = makeTerms(userId, account);
    const signed = makeReceipt({ aud: i, terms, approval: approval(auth, terms), action: actionFor(i, account, amountCents) });
    return { signed, terms, auth, userId, account };
  }

  /** The request was refused before the store: 4xx with rejected:true, nothing recorded or executed. */
  async function assertRefusedUntouched(i: InstitutionId, signed: Signed, account: string, status?: number) {
    const res = await post(i, signed);
    assert.ok(res.statusCode >= 400 && res.statusCode < 500, `expected 4xx, got ${res.statusCode}: ${res.body}`);
    if (status) assert.equal(res.statusCode, status);
    assert.equal(res.json().rejected, true);
    assert.equal(typeof res.json().reason, "string");
    assert.equal(await seenCount(i, signed.receipt.decisionId), 0);
    assert.equal(await storeCount(i, signed.receipt.decisionId, account), 0);
    assert.equal(await dbOf(i).collection("anchors").countDocuments({ _id: signed.receipt.ledger.seq as never }), 0);
  }

  for (const i of INSTITUTIONS) {
    await t.test(`${i}: a valid receipt executes, shows in /state and leaves an anchor`, async () => {
      const { signed, account } = await valid(i);
      const res = await post(i, signed);
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      assert.equal(body.executed, true);
      assert.match(body.institutionRef, i === "bank" ? /^bank_kyc_[0-9a-f]{16}$/ : /^fin_pay_[0-9a-f]{16}$/);
      assert.equal(body.duplicate, undefined);

      const seen = await dbOf(i).collection("seen_receipts").findOne({ _id: signed.receipt.decisionId as never });
      assert.equal(seen?.state, "done");
      assert.deepEqual(seen?.result.body, { executed: true, institutionRef: body.institutionRef });

      const state = (await apps[i].inject({ method: "GET", url: "/state" })).json();
      assert.equal(state.institution, i);
      if (i === "bank") {
        const row = state.accounts.find((a: { _id: string }) => a._id === account);
        assert.equal(row.refreshCount, 1);
        assert.equal(row.lastInstitutionRef, body.institutionRef);
        assert.equal(typeof row.lastKycRefreshAt, "string");
      } else {
        const row = state.payments.find((p: { _id: string }) => p._id === signed.receipt.decisionId);
        assert.equal(row.institutionRef, body.institutionRef);
        assert.deepEqual([row.merchant, row.fromAccount, row.amountCents, row.currency, row.memo], ["M1", account, 3000, "CAD", "test"]);
      }

      const anchors = (await apps[i].inject({ method: "GET", url: "/anchors" })).json();
      assert.ok(anchors.every((a: object) => Object.keys(a).sort().join() === "hash,seq"));
      assert.deepEqual(anchors.find((a: { seq: number }) => a.seq === signed.receipt.ledger.seq), signed.receipt.ledger);
      const seqs = anchors.map((a: { seq: number }) => a.seq);
      assert.deepEqual(seqs, [...seqs].sort((a: number, b: number) => a - b));
    });

    await t.test(`${i}: an altered amount or action is refused`, async () => {
      const { signed, account } = await valid(i);
      const tampered = clone(signed);
      const key = i === "bank" ? "account" : "amountCents";
      tampered.receipt.action.params[key] = i === "bank" ? "acct_other" : 1;
      await assertRefusedUntouched(i, tampered, account);

      // Signed by the gate, but the action no longer matches its hash.
      const resigned = makeReceipt({ aud: i, terms: signed.receipt.chain[0]!.terms, approval: signed.receipt.chain[0]!.approval, action: actionFor(i, account) });
      resigned.receipt.action.params[key] = i === "bank" ? "acct_other" : 1;
      resigned.gateSig = ed25519Sign(config.gatePrivateKey!, jcs(resigned.receipt));
      await assertRefusedUntouched(i, resigned, account);
    });

    await t.test(`${i}: altered terms are refused`, async () => {
      const { signed, account } = await valid(i);
      const tampered = clone(signed);
      tampered.receipt.chain[0]!.terms.perActionMaxCents = 99_999;
      await assertRefusedUntouched(i, tampered, account);

      // Re-signed by the gate: the terms no longer hash to what the passkey approved.
      const resigned = clone(signed);
      resigned.receipt.chain[0]!.terms.perActionMaxCents = 99_999;
      resigned.gateSig = ed25519Sign(config.gatePrivateKey!, jcs(resigned.receipt));
      await assertRefusedUntouched(i, resigned, account);
    });

    await t.test(`${i}: a receipt addressed to the other institution is refused`, async () => {
      const { terms, auth, account } = await valid(i);
      const wrong = makeReceipt({ aud: other(i), terms, approval: approval(auth, terms), action: actionFor(other(i), account) });
      await assertRefusedUntouched(i, wrong, account);
      // The same receipt is fine where it was addressed.
      assert.equal((await post(other(i), wrong)).statusCode, 200);
    });

    await t.test(`${i}: an expired receipt is refused`, async () => {
      const { terms, auth, account } = await valid(i);
      const old = makeReceipt({ aud: i, terms, approval: approval(auth, terms), action: actionFor(i, account), iat: new Date(Date.now() - 10 * 60_000) });
      await assertRefusedUntouched(i, old, account);
    });

    await t.test(`${i}: an invalid gate signature is refused`, async () => {
      const { signed, account } = await valid(i);
      const other = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" });
      const forged = { receipt: signed.receipt, gateSig: ed25519Sign(b64url(other), jcs(signed.receipt)) };
      await assertRefusedUntouched(i, forged, account, 401);
      await assertRefusedUntouched(i, { receipt: signed.receipt, gateSig: "not-a-signature" }, account, 401);
    });

    await t.test(`${i}: a user with no enrolled key is refused`, async () => {
      const userId = newId("usr");
      const auth = createSoftAuthenticator();   // never enrolled
      const account = `acct_${randomBytes(6).toString("hex")}`;
      const terms = makeTerms(userId, account);
      const signed = makeReceipt({ aud: i, terms, approval: approval(auth, terms), action: actionFor(i, account) });
      await assertRefusedUntouched(i, signed, account);

      // A key enrolled for another user does not count either.
      const { auth: strangerAuth } = await enrolledUser();
      const strangerTerms = makeTerms(userId, account);
      const forged = makeReceipt({ aud: i, terms: strangerTerms, approval: approval(strangerAuth, strangerTerms), action: actionFor(i, account) });
      await assertRefusedUntouched(i, forged, account);
    });

    await t.test(`${i}: an assertion from a different warrant is refused`, async () => {
      const { terms, auth, userId, account } = await valid(i);
      const otherTerms = makeTerms(userId, account);
      const swapped = makeReceipt({ aud: i, terms, approval: approval(auth, otherTerms), action: actionFor(i, account) });
      await assertRefusedUntouched(i, swapped, account);
    });

    await t.test(`${i}: a malformed request is refused`, async () => {
      for (const payload of [{}, { receipt: {}, gateSig: "x" }, { gateSig: "x" }]) {
        const res = await post(i, payload);
        assert.equal(res.statusCode, 400);
        assert.equal(res.json().rejected, true);
      }
    });

    await t.test(`${i}: the same receipt twice executes once`, async () => {
      const { signed, account } = await valid(i);
      const first = await post(i, signed);
      assert.equal(first.statusCode, 200);
      const second = await post(i, signed);
      assert.equal(second.statusCode, 200);
      assert.equal(second.json().duplicate, true);
      assert.equal(second.json().institutionRef, first.json().institutionRef);
      assert.equal(await seenCount(i, signed.receipt.decisionId), 1);
      if (i === "bank") assert.equal((await dbOf(i).collection("accounts").findOne({ _id: account as never }))?.refreshCount, 1);
      else assert.equal(await storeCount(i, signed.receipt.decisionId, account), 1);
    });

    await t.test(`${i}: an action outside its own policy is refused and the refusal is replayed`, async () => {
      // Fintech: the gate allowed $50 (the warrant's cap is $50) but the fintech's own cap is $40.
      // Bank: it accepts only kyc.refresh, so a payment receipt addressed to it is refused.
      const { terms, auth, account } = await valid(i);
      const action: Action = i === "fintech"
        ? actionFor("fintech", account, 5000)
        : { type: "payment.create", destination: "bank", params: { fromAccount: account, merchant: "M1", amountCents: 100, currency: "CAD" } };
      const signed = makeReceipt({ aud: i, terms, approval: approval(auth, terms), action });
      const res = await post(i, signed);
      assert.equal(res.statusCode, 403, res.body);
      assert.deepEqual(res.json(), { rejected: true, reason: i === "fintech" ? "POLICY_PER_ACTION_LIMIT" : "POLICY_ACTION_NOT_ACCEPTED" });
      assert.equal(await storeCount(i, signed.receipt.decisionId, account), 0);
      // The refusal is the stored result; the anchor is still kept.
      assert.equal(await seenCount(i, signed.receipt.decisionId), 1);
      assert.equal(await dbOf(i).collection("anchors").countDocuments({ _id: signed.receipt.ledger.seq as never }), 1);
      const again = await post(i, signed);
      assert.equal(again.statusCode, 403);
      assert.equal(again.json().duplicate, true);
    });

    await t.test(`${i}: enrollment never rebinds an existing credential`, async () => {
      const { userId, auth } = await enrolledUser();
      // The same enrollment again is idempotent.
      assert.equal((await enroll(i, userId, auth)).statusCode, 200);
      // Another user cannot claim the credential ID.
      assert.equal((await enroll(i, newId("usr"), auth)).statusCode, 409);
      // Nor can the ID be given a different public key.
      const other = createSoftAuthenticator();
      const swap = await apps[i].inject({ method: "POST", url: "/enroll", headers: enrollHeaders, payload: { userId, credential: { id: auth.credentialId, publicKey: b64url(other.publicKey) } } });
      assert.equal(swap.statusCode, 409);
      const stored = await dbOf(i).collection("enrolled_credentials").findOne({ _id: auth.credentialId as never });
      assert.equal(stored?.userId, userId);
      assert.deepEqual(Buffer.from(stored?.publicKey.value()), Buffer.from(auth.publicKey));
    });

    await t.test(`${i}: enrollment needs the secret and a well-formed body`, async () => {
      const auth = createSoftAuthenticator();
      const userId = newId("usr");
      assert.equal((await enroll(i, userId, auth, {})).statusCode, 401);
      assert.equal((await enroll(i, userId, auth, { [config.enrollHeader]: "wrong" })).statusCode, 401);
      assert.equal(await dbOf(i).collection("enrolled_credentials").countDocuments({ _id: auth.credentialId as never }), 0);

      const bad = await apps[i].inject({ method: "POST", url: "/enroll", headers: enrollHeaders, payload: { userId, credential: { id: "not base64!", publicKey: "" } } });
      assert.equal(bad.statusCode, 400);
      assert.equal((await enroll(i, userId, auth)).statusCode, 200);
      const stored = await dbOf(i).collection("enrolled_credentials").findOne({ _id: auth.credentialId as never });
      assert.equal(stored?.userId, userId);
      assert.deepEqual(new Uint8Array(stored?.publicKey.value()), auth.publicKey);
    });

    await t.test(`${i}: /state is capped and newest first`, async () => {
      const state = (await apps[i].inject({ method: "GET", url: "/state" })).json();
      const rows = i === "bank" ? state.accounts : state.payments;
      assert.ok(Array.isArray(rows) && rows.length <= 100);
      const key = i === "bank" ? "lastKycRefreshAt" : "createdAt";
      // Demo accounts seeded by `npm run seed` have no refresh time yet; only rows that have one are ordered.
      const times = rows.filter((r: Record<string, string>) => r[key] !== undefined).map((r: Record<string, string>) => String(r[key]));
      assert.deepEqual(times, [...times].sort().reverse());
    });
  }
});
