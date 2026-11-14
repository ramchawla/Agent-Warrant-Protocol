// npm run eval: the numbers for the slide (PRD 8.9, goals G1 to G6). Owner: Max, task 11.
// Self-contained: the gate and both institutions run in this process on ephemeral ports, with the real database.
// Everything it creates (warrants, users, agents, credentials, institution rows) is removed at the end except ledger events,
// which are insert-only. While src/gate/ledger.ts is still the stub, G1, G5 and the idempotency check print n/a.
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { MongoClient } from "mongodb";
import type { Action, Receipt, Terms, WarrantDoc } from "../src/shared/types.ts";

// Environment first: .env, the software authenticator flag, then dynamic imports so config sees both.
try {
  process.loadEnvFile();
} catch {
  // no .env file
}
process.env.AWP_ALLOW_TEST_AUTHENTICATOR = "1";

const { ansi, pad, visible, money } = await import("../src/agent/run.ts");
const { config } = await import("../src/shared/config.ts");
const { b64url, ed25519Sign, hashJcs, jcs, termsHash } = await import("../src/shared/canonical.ts");
const { newId, newNonce } = await import("../src/shared/ids.ts");
const { createSoftAuthenticator } = await import("../test/softAuthenticator.ts");

type Inst = "bank" | "fintech";
const INSTS: Inst[] = ["bank", "fintech"];
const other = (i: Inst): Inst => (i === "bank" ? "fintech" : "bank");

const started = Date.now();
const missing = ["MONGODB_URI_GATE", "MONGODB_URI_BANK", "MONGODB_URI_FINTECH", "GATE_ED25519_PRIVATE_KEY", "GATE_ED25519_PUBLIC_KEY", "ENROLL_SECRET"].filter((n) => !process.env[n]);
if (missing.length > 0) {
  console.error(`eval needs ${missing.join(", ")} in the environment or .env`);
  process.exit(2);
}

// ---- bring up the institutions, then the gate ----

const { buildInstitution } = await import("../src/institutions/server.ts");
const insts = { bank: await buildInstitution("bank"), fintech: await buildInstitution("fintech") };
const url = {} as Record<Inst, string>;
for (const i of INSTS) {
  await insts[i].listen({ port: 0, host: "127.0.0.1" });
  url[i] = `http://127.0.0.1:${(insts[i].server.address() as AddressInfo).port}`;
}
process.env.AWP_BANK_URL = url.bank;
process.env.AWP_FINTECH_URL = url.fintech;

const { hashAgentKey } = await import("../src/gate/agents.ts");
const { issueOptions, verifyAndActivate } = await import("../src/gate/approval.ts");
const { agents, auditEvents, challenges, closeDb, credentials, users, warrants } = await import("../src/gate/db.ts");
const { verifyChain } = await import("../src/gate/ledger.ts");
const { buildServer } = await import("../src/gate/server.ts");
const gateApp = await buildServer();
await gateApp.listen({ port: 0, host: "127.0.0.1" });
const gateUrl = `http://127.0.0.1:${(gateApp.server.address() as AddressInfo).port}`;

const stubLedger = readFileSync(new URL("../src/gate/ledger.ts", import.meta.url), "utf8").includes('prevHash: "stub"');
const bankMongo = new MongoClient(config.mongoUri.bank!);
const fintechMongo = new MongoClient(config.mongoUri.fintech!);
const instDb = (i: Inst) => (i === "bank" ? bankMongo : fintechMongo).db(config.dbName[i]);

// ---- fixtures: one user, two agents, one software authenticator enrolled at both institutions ----

const tag = `ev${randomBytes(3).toString("hex")}`;        // account names are run-scoped so the demo accounts A1 to A9 stay untouched
const acct = (n: string): string => `${tag}-${n}`;
const RUN = newId("run");
const userId = newId("usr");
const agentA = newId("agt");
const agentB = newId("agt");
const keyA = `eval-${randomBytes(16).toString("hex")}`;
const keyB = `eval-${randomBytes(16).toString("hex")}`;
const auth = createSoftAuthenticator();
const warrantIds: string[] = [];
const decisionIds: string[] = [];
const fakeSeqs: number[] = [];
const latencies: number[] = [];

// ---- output helpers ----

const mark = (ok: boolean): string => (ok ? ansi.green("✓") : ansi.red("✗"));
const heading = (n: number, title: string, note = ""): void => console.log(`\n${ansi.bold(ansi.cyan(`${n}  ${title}`))}${note ? `  ${ansi.dim(note)}` : ""}`);
const NA = ansi.yellow("n/a (real ledger not merged)");

type Status = { ok: boolean | null; text: string };   // null = could not run (n/a): not a failure
const results: Record<string, Status> = {};

// ---- gate calls: real HTTP, timed ----

type Answer = { decision: "allow" | "deny"; reasonCode?: string; outcome?: string; remainingCents?: number; decisionId?: string; ms: number };

async function act(key: string | undefined, warrantId: string, action: Action, o: { idem?: string; untimed?: boolean } = {}): Promise<Answer> {
  const t0 = performance.now();
  const res = await fetch(`${gateUrl}/api/act`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ warrantId, runId: RUN, idempotencyKey: o.idem ?? randomUUID(), action }),
  });
  const body = (await res.json()) as Omit<Answer, "ms">;
  const ms = performance.now() - t0;
  if (body.decisionId) decisionIds.push(body.decisionId);
  if (body.decision === "allow" && !o.untimed) latencies.push(ms);
  return { ...body, ms };
}

// W1 of PRD 8.9: KYC on A1 to A5 at the bank; payments from A1 to M1 up to $50 each and $120 in total, CAD.
async function makeWarrant(o: { agentId?: string; total?: number; expired?: boolean; activate?: boolean } = {}): Promise<string> {
  const warrantId = newId("wrt");
  const now = Date.now();
  const total = o.total ?? 12000;
  const terms: Terms = {
    v: 1,
    warrantId,
    userId,
    agentId: o.agentId ?? agentA,
    parentWarrantId: null,
    scope: {
      actions: ["kyc.refresh", "payment.create"],
      accounts: ["A1", "A2", "A3", "A4", "A5"].map(acct),
      merchants: ["M1"],
      destinations: ["bank", "fintech"],
      fields: { "kyc.refresh": ["account", "fields"], "payment.create": ["fromAccount", "merchant", "amountCents", "currency", "memo"], "data.export": [] },
    },
    currency: "CAD",
    perActionMaxCents: 5000,
    totalLimitCents: total,
    notBefore: new Date(now - (o.expired ? 7_200_000 : 60_000)).toISOString(),
    expiresAt: new Date(now + (o.expired ? -60_000 : 3_600_000)).toISOString(),
    nonce: newNonce(),
  };
  // An expired warrant cannot be approved (approval refuses it), so it is stored as active with the expiry in the past, in terms and in the Date copy.
  const doc: WarrantDoc = {
    _id: warrantId,
    terms,
    termsHash: termsHash(terms),
    approval: null,
    state: { status: o.expired ? "active" : "pending", remainingCents: total, actionCount: 0 },
    ancestors: [],
    expiresAt: new Date(terms.expiresAt),
    createdAt: new Date(),
  };
  warrantIds.push(warrantId);
  await warrants().insertOne(doc);
  if (!o.expired && o.activate !== false) await verifyAndActivate(warrantId, auth.getAssertion(await issueOptions(warrantId, doc.termsHash)));
  return warrantId;
}

const kyc = (n: string): Action => ({ type: "kyc.refresh", destination: "bank", params: { account: acct(n), fields: ["name", "address"] } });
const pay = (amountCents: number, extra: Record<string, unknown> = {}): Action => ({
  type: "payment.create",
  destination: "fintech",
  params: { fromAccount: acct("A1"), merchant: "M1", amountCents, currency: "CAD", ...extra },
});
const COLLECTOR = "https://collector.example/c";

// ---- 1. G2 labelled set ----

type Case = { label: string; expect: string; run: () => Promise<Answer> };

async function labelled(): Promise<void> {
  heading(1, "G2  Out-of-warrant actions are stopped", "labelled set, PRD 8.9");
  const w1 = await makeWarrant();
  const inWarrant: Case[] = [
    { label: "KYC refresh A1", expect: "allow", run: () => act(keyA, w1, kyc("A1")) },
    { label: "KYC refresh A3", expect: "allow", run: () => act(keyA, w1, kyc("A3")) },
    { label: "Pay $30.00 to M1", expect: "allow", run: () => act(keyA, w1, pay(3000)) },
    { label: "Pay $50.00 to M1", expect: "allow", run: () => act(keyA, w1, pay(5000)) },
  ];

  const print = (c: Case, answer: Answer): string => {
    const got = answer.decision === "allow" ? "allow" : (answer.reasonCode ?? "NO_ANSWER");
    const note = answer.decision === "allow" ? (answer.outcome === "executed" ? "executed" : "refused by the institution's own policy") : "";
    console.log(`${mark(got === c.expect)} ${pad(c.label, 40)} ${pad((got === c.expect ? ansi.green : ansi.red)(got), 24)} ${ansi.dim(note)}`);
    return got;
  };

  console.log(ansi.dim("  in-warrant: expect allow"));
  let allowed = 0;
  for (const c of inWarrant) if (print(c, await c.run()) === "allow") allowed++;   // one at a time: these are the timed calls

  // Warrants in the states the out-of-warrant cases need, made one at a time (each approval writes to the ledger).
  const wRevoked = await makeWarrant();
  await warrants().updateOne({ _id: wRevoked }, { $set: { "state.status": "revoked", "state.revokedAt": new Date().toISOString(), "state.revokedBy": userId } });
  const wTampered = await makeWarrant();
  await warrants().updateOne({ _id: wTampered }, { $set: { "terms.perActionMaxCents": 999_999 } });   // terms edited after approval
  const wExpired = await makeWarrant({ expired: true });
  const wPending = await makeWarrant({ activate: false });
  const wBudget = await makeWarrant({ total: 8000 });

  const outOfWarrant: Case[] = [
    { label: "KYC refresh A9", expect: "ACCOUNT_NOT_ALLOWED", run: () => act(keyA, w1, kyc("A9")) },
    { label: "Pay $80.00 (over $50 cap)", expect: "PER_ACTION_LIMIT", run: () => act(keyA, w1, pay(8000)) },
    { label: "Pay to M2", expect: "MERCHANT_NOT_ALLOWED", run: () => act(keyA, w1, pay(2000, { merchant: "M2" })) },
    { label: "Pay in USD", expect: "CURRENCY_MISMATCH", run: () => act(keyA, w1, pay(2000, { currency: "USD" })) },
    { label: "Pay -$10.00", expect: "AMOUNT_INVALID", run: () => act(keyA, w1, pay(-1000)) },
    {
      label: "Pay $50.00 when $40.00 remains",
      expect: "BUDGET_EXHAUSTED",
      run: async () => {
        await act(keyA, wBudget, pay(4000), { untimed: true });   // spend down to $40.00
        return act(keyA, wBudget, pay(5000));
      },
    },
    { label: "data.export to collector.example", expect: "ACTION_NOT_ALLOWED", run: () => act(keyA, w1, { type: "data.export", destination: COLLECTOR, params: { data: "clientList" } }) },
    { label: "Payment to destination collector.example", expect: "DESTINATION_NOT_ALLOWED", run: () => act(keyA, w1, { ...pay(1000), destination: COLLECTOR }) },
    { label: "Payment with extra clientList field", expect: "FIELD_NOT_ALLOWED", run: () => act(keyA, w1, pay(1000, { clientList: "Ada Okafor, Ben Tran" })) },
    { label: "Payment with 5,000 character memo", expect: "FIELD_CONSTRAINT", run: () => act(keyA, w1, pay(1000, { memo: "x".repeat(5000) })) },
    { label: "Expired warrant", expect: "WARRANT_EXPIRED", run: () => act(keyA, wExpired, kyc("A1")) },
    { label: "Revoked warrant", expect: "WARRANT_REVOKED", run: () => act(keyA, wRevoked, kyc("A1")) },
    { label: "Pending warrant (never approved)", expect: "WARRANT_NOT_ACTIVE", run: () => act(keyA, wPending, kyc("A1")) },
    { label: "Another agent's key", expect: "AGENT_MISMATCH", run: () => act(keyB, w1, kyc("A1")) },
    { label: "No agent key", expect: "AGENT_UNAUTHENTICATED", run: () => act(undefined, w1, kyc("A1")) },
    { label: "Stored terms edited after approval", expect: "TERMS_TAMPERED", run: () => act(keyA, wTampered, kyc("A1")) },
  ];

  console.log(ansi.dim("  out-of-warrant: expect the exact reason code"));
  const answers = await Promise.all(outOfWarrant.map((c) => c.run()));   // none of these spends anything, so they can overlap
  let blocked = 0;
  let exact = 0;
  outOfWarrant.forEach((c, n) => {
    const got = print(c, answers[n]!);
    if (got !== "allow") blocked++;
    if (got === c.expect) exact++;
  });
  const falseBlocks = inWarrant.length - allowed;
  const pct = Math.round((blocked / outOfWarrant.length) * 100);
  const good = blocked === outOfWarrant.length && exact === outOfWarrant.length && falseBlocks === 0;
  console.log(`  ${ansi.bold(`block rate ${blocked}/${outOfWarrant.length} (${pct}%)`)}   exact reason ${exact}/${outOfWarrant.length}   false blocks ${falseBlocks}/${inWarrant.length}`);
  results.G2 = { ok: good, text: `${pct}% blocked (${blocked}/${outOfWarrant.length}), ${falseBlocks} false blocks` };
}

// ---- 2. behavioural ----

async function behavioural(): Promise<void> {
  heading(2, "Behavioural", "idempotency and concurrency");

  // Same idempotency key twice: one DECISION, one EXECUTION, one payment. Needs the real ledger.
  if (stubLedger) {
    console.log(`  ${pad("same idempotency key twice: one decision, one execution", 62)} ${NA}`);
    results.idempotency = { ok: null, text: "n/a" };
  } else {
    const id = await makeWarrant();
    const idem = randomUUID();
    const first = await act(keyA, id, pay(500), { idem, untimed: true });
    const second = await act(keyA, id, pay(500), { idem, untimed: true });
    const decisions = await auditEvents().countDocuments({ type: "DECISION", warrantId: id, idempotencyKey: idem });
    const executions = await auditEvents().countDocuments({ type: "EXECUTION", decisionId: first.decisionId });
    const payments = await instDb("fintech").collection("payments").countDocuments({ _id: first.decisionId as never });
    const ok = first.decisionId === second.decisionId && decisions === 1 && executions === 1 && payments === 1;
    console.log(`${mark(ok)} same idempotency key twice: ${decisions} decision, ${executions} execution, ${payments} payment at the fintech`);
    results.idempotency = { ok, text: "" };
  }

  // G3: 20 parallel $10 payments against a fresh $100 warrant.
  const id = await makeWarrant({ total: 10_000 });
  const answers = await Promise.all(Array.from({ length: 20 }, () => act(keyA, id, pay(1000), { untimed: true })));
  const allowed = answers.filter((a) => a.decision === "allow").length;
  const exhausted = answers.filter((a) => a.reasonCode === "BUDGET_EXHAUSTED").length;
  const executed = answers.filter((a) => a.outcome === "executed").length;
  const remaining = (await warrants().findOne({ _id: id }))!.state.remainingCents;
  const ok = allowed === 10 && exhausted === 10 && remaining === 0;
  console.log(`${mark(ok)} 20 parallel $10 payments on a fresh $100 warrant: ${ansi.bold(`${allowed} allowed`)} (${executed} executed), ${ansi.bold(`${exhausted} BUDGET_EXHAUSTED`)}, remaining ${money(remaining)}`);
  results.G3 = { ok, text: `${allowed} allowed, ${exhausted} BUDGET_EXHAUSTED, remaining ${money(remaining)}` };
}

// ---- 3. G4 receipt tamper set, over HTTP against both institutions ----

type Signed = { receipt: Receipt; gateSig: string };
type Reply = { status: number; body: { executed?: boolean; rejected?: boolean; duplicate?: boolean; reason?: string; institutionRef?: string } };
type Cell = { ok: boolean; text: string };

const signReceipt = (receipt: Receipt, key = config.gatePrivateKey!): Signed => ({ receipt, gateSig: ed25519Sign(key, jcs(receipt)) });
const postExecute = async (i: Inst, payload: unknown): Promise<Reply> => {
  const res = await fetch(`${url[i]}/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  return { status: res.status, body: (await res.json()) as Reply["body"] };
};

let tamperCount = 0;
function tamperTerms(account: string, forUser = userId): Terms {
  return {
    v: 1,
    warrantId: newId("wrt"),
    userId: forUser,
    agentId: "agt_eval",
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
const approvalFor = (a: ReturnType<typeof createSoftAuthenticator>, terms: Terms): WarrantDoc["approval"] => ({
  kind: "passkey",
  credentialId: a.credentialId,
  response: a.getAssertion({ challenge: termsHash(terms) }),
  origin: config.origin,
  rpId: config.rpId,
  approvedAt: new Date().toISOString(),
});
const actionFor = (i: Inst, account: string, amountCents = 3000): Action =>
  i === "bank"
    ? { type: "kyc.refresh", destination: "bank", params: { account, fields: ["name", "address"] } }
    : { type: "payment.create", destination: "fintech", params: { fromAccount: account, merchant: "M1", amountCents, currency: "CAD", memo: "eval" } };

function receiptFor(o: { aud: Inst; terms: Terms; approval: WarrantDoc["approval"]; action: Action; iat?: Date }): Signed {
  const iat = o.iat ?? new Date();
  const seq = 9_000_000_000_000 + Math.floor(Math.random() * 1e9);   // far from any real ledger seq; its anchor is deleted at the end
  const decisionId = newId("dec");
  decisionIds.push(decisionId);
  fakeSeqs.push(seq);
  return signReceipt({
    v: 1,
    decisionId,
    aud: o.aud,
    iat: iat.toISOString(),
    exp: new Date(iat.getTime() + config.receiptTtlMs).toISOString(),
    chain: [{ terms: o.terms, approval: o.approval }],
    action: o.action,
    actionHash: hashJcs(o.action),
    ledger: { seq, hash: b64url(randomBytes(32)) },
  } satisfies Receipt);
}

/** A fresh account, its terms, and a valid receipt for institution i. */
function validFor(i: Inst, amountCents?: number) {
  const account = acct(`T${++tamperCount}`);
  const terms = tamperTerms(account);
  const approval = approvalFor(auth, terms);
  return { account, terms, approval, signed: receiptFor({ aud: i, terms, approval, action: actionFor(i, account, amountCents) }) };
}

/** 4xx with rejected:true, and the institution recorded nothing for this receipt. */
async function refused(i: Inst, signed: Signed, label?: string): Promise<Cell> {
  const r = await postExecute(i, signed);
  const seen = await instDb(i).collection("seen_receipts").countDocuments({ _id: signed.receipt.decisionId as never });
  const ok = r.status >= 400 && r.status < 500 && r.body.rejected === true && seen === 0;
  return { ok, text: `${r.status} ${label ?? r.body.reason ?? "?"}` };
}

const TAMPER: { label: string; run: (i: Inst) => Promise<Cell> }[] = [
  {
    label: "valid receipt accepted",
    run: async (i) => {
      const r = await postExecute(i, validFor(i).signed);
      return { ok: r.status === 200 && r.body.executed === true, text: `${r.status} executed` };
    },
  },
  {
    label: "altered amount",
    run: async (i) => {
      const { signed, terms, approval, account } = validFor(i);
      const edit = (s: Signed) => void (i === "bank" ? (s.receipt.action.params.account = "acct_other") : (s.receipt.action.params.amountCents = 1));
      const plain = structuredClone(signed);   // edited after signing
      edit(plain);
      const resigned = receiptFor({ aud: i, terms, approval, action: actionFor(i, account) });   // edited, then re-signed by the gate key
      edit(resigned);
      const again = signReceipt(resigned.receipt);
      const a = await refused(i, plain);
      const b = await refused(i, again);
      return { ok: a.ok && b.ok, text: b.text };
    },
  },
  {
    label: "altered terms",
    run: async (i) => {
      const { signed } = validFor(i);
      const plain = structuredClone(signed);
      plain.receipt.chain[0]!.terms.perActionMaxCents = 99_999;
      const resigned = structuredClone(signed);
      resigned.receipt.chain[0]!.terms.perActionMaxCents = 99_999;
      const a = await refused(i, plain);
      const b = await refused(i, signReceipt(resigned.receipt));
      return { ok: a.ok && b.ok, text: b.text };
    },
  },
  {
    label: "wrong audience",
    run: async (i) => {
      const { terms, approval, account } = validFor(i);
      return refused(i, receiptFor({ aud: other(i), terms, approval, action: actionFor(other(i), account) }));
    },
  },
  {
    label: "expired receipt",
    run: async (i) => {
      const { terms, approval, account } = validFor(i);
      return refused(i, receiptFor({ aud: i, terms, approval, action: actionFor(i, account), iat: new Date(Date.now() - 10 * 60_000) }));
    },
  },
  {
    label: "invalid gate signature",
    run: async (i) => {
      const { signed } = validFor(i);
      const stranger = b64url(generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }));
      return refused(i, signReceipt(signed.receipt, stranger));
    },
  },
  {
    label: "unknown credential",
    run: async (i) => {
      const account = acct(`T${++tamperCount}`);
      const terms = tamperTerms(account);
      return refused(i, receiptFor({ aud: i, terms, approval: approvalFor(createSoftAuthenticator(), terms), action: actionFor(i, account) }));   // never enrolled
    },
  },
  {
    label: "assertion from a different warrant",
    run: async (i) => {
      const { terms, account } = validFor(i);
      const otherTerms = tamperTerms(account);
      return refused(i, receiptFor({ aud: i, terms, approval: approvalFor(auth, otherTerms), action: actionFor(i, account) }));
    },
  },
  {
    label: "same receipt twice executes once",
    run: async (i) => {
      const { signed, account } = validFor(i);
      const first = await postExecute(i, signed);
      const second = await postExecute(i, signed);
      const stored =
        i === "bank"
          ? (await instDb(i).collection("accounts").findOne({ _id: account as never }))?.refreshCount
          : await instDb(i).collection("payments").countDocuments({ _id: signed.receipt.decisionId as never });
      const ok = first.status === 200 && second.status === 200 && second.body.duplicate === true && second.body.institutionRef === first.body.institutionRef && stored === 1;
      return { ok, text: `200, then 200 duplicate (${stored}x)` };
    },
  },
  {
    label: "allowed by gate, outside own policy",
    run: async (i) => {
      const { terms, approval, account } = validFor(i);
      const action: Action = i === "fintech" ? actionFor("fintech", account, 5000) : { type: "payment.create", destination: "bank", params: { fromAccount: account, merchant: "M1", amountCents: 100, currency: "CAD" } };
      const r = await postExecute(i, receiptFor({ aud: i, terms, approval, action }));
      return { ok: r.status === 403 && r.body.rejected === true && !!r.body.reason?.startsWith("POLICY_"), text: `${r.status} ${r.body.reason ?? "?"}` };
    },
  },
];

/** Runs the whole set against both institutions at once. Prints nothing, so it can overlap the gate-bound checks. */
const runTamper = () => Promise.all(TAMPER.map((t) => Promise.all(INSTS.map((i) => t.run(i).catch((error: Error): Cell => ({ ok: false, text: error.message.slice(0, 26) }))))));

function printTamper(rows: Cell[][]): void {
  heading(3, "G4  Receipts are provable by the institutions", "tamper set, PRD 8.9, over HTTP");
  console.log(ansi.dim(`  ${pad("", 36)}${pad("bank", 34)}fintech`));
  let passed = 0;
  TAMPER.forEach((t, n) => {
    passed += rows[n]!.filter((c) => c.ok).length;
    console.log(`  ${pad(t.label, 36)}${rows[n]!.map((c) => pad(`${mark(c.ok)} ${c.ok ? ansi.green(c.text) : ansi.red(c.text)}`, 34)).join("")}`);
  });
  const total = TAMPER.length * INSTS.length;
  console.log(`  ${ansi.bold(`${passed}/${total} as expected`)}  ${ansi.dim("(rejected, nothing recorded; valid accepted; duplicate executes once)")}`);
  results.G4 = { ok: passed === total, text: `${passed}/${total} tamper checks as expected, valid receipts accepted` };
}

// ---- 4 and 5. G1, G5, G6 ----

async function ledgerChecks(): Promise<void> {
  heading(4, "G1 and G5  Authority checked first; history tamper-evident");
  if (stubLedger) {
    console.log(`  G1 decision before execution   ${NA}\n  G5 verify chain                ${NA}`);
    results.G1 = { ok: null, text: "n/a" };
    results.G5 = { ok: null, text: "n/a" };
    return;
  }
  const events = await auditEvents().find({ runId: RUN, type: { $in: ["DECISION", "EXECUTION"] } }).toArray();
  const decisionSeq = new Map(events.filter((e) => e.type === "DECISION").map((e) => [e.decisionId, e.seq]));
  const executed = events.filter((e) => e.type === "EXECUTION" && e.outcome === "executed");
  const before = executed.filter((e) => (decisionSeq.get(e.decisionId) ?? Infinity) < e.seq).length;
  const g1 = executed.length > 0 && before === executed.length;
  const pct = executed.length === 0 ? 0 : (100 * before) / executed.length;
  console.log(`${mark(g1)} G1  ${ansi.bold(`${pct.toFixed(1)}%`)} of executed actions have their DECISION before their EXECUTION  ${ansi.dim(`(${before}/${executed.length}, ${decisionSeq.size} decisions this run)`)}`);
  results.G1 = { ok: g1, text: `${pct.toFixed(1)}% decision first (${before}/${executed.length} executed)` };

  try {
    const v = await verifyChain();
    console.log(`${mark(v.ok)} G5  verifyChain: ${v.ok ? "ok" : `broken at seq ${v.firstBrokenSeq}`}, ${v.checked} events checked`);
    results.G5 = { ok: v.ok, text: v.ok ? `chain ok, ${v.checked} events checked` : `broken at seq ${v.firstBrokenSeq}` };
  } catch (error) {
    console.log(`${mark(false)} G5  verifyChain failed: ${(error as Error).message}`);
    results.G5 = { ok: false, text: "verifyChain failed" };
  }
}

/** Sequential allowed actions on a fresh warrant: KYC and payments alternating. Adds to the latency sample. */
async function latencySample(): Promise<void> {
  const id = await makeWarrant();
  for (let n = 0; n < 4; n++) await act(keyA, id, n % 2 === 0 ? kyc("A1") : pay(1000));
}

function latencyReport(): void {
  heading(5, "G6  Latency", "POST /api/act round trip, including the institution's execution");
  const sorted = [...latencies].sort((a, b) => a - b);
  if (sorted.length === 0) {
    console.log(`  ${ansi.red("no allowed action was measured")}`);
    results.G6 = { ok: false, text: "no allowed action measured" };
    return;
  }
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)]!;
  const within = median <= 300;
  console.log(`  allowed actions measured: ${sorted.length}   min ${sorted[0]!.toFixed(0)} ms   max ${sorted.at(-1)!.toFixed(0)} ms`);
  console.log(`  median ${ansi.bold(`${median.toFixed(0)} ms`)}   p95 ${ansi.bold(`${p95.toFixed(0)} ms`)}`);
  console.log(`  target: median ≤ 300 ms  ${within ? ansi.green("✓ met") : ansi.yellow("above target; reported as measured")}`);
  results.G6 = { ok: true, text: `median ${median.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms (target median ≤ 300 ms${within ? "" : ", not met"})` };
}

// ---- cleanup: everything this run created, except ledger events (insert-only) ----

async function cleanup(): Promise<string> {
  const idList = decisionIds as never[];
  const gate = await Promise.allSettled([
    warrants().deleteMany({ _id: { $in: warrantIds } }),
    challenges().deleteMany({ warrantId: { $in: warrantIds } }),
    agents().deleteMany({ _id: { $in: [agentA, agentB] } }),
    credentials().deleteMany({ _id: auth.credentialId }),
    users().deleteMany({ _id: userId }),
  ]);
  const inst = await Promise.allSettled(
    INSTS.map(async (i) => {
      const db = instDb(i);
      await db.collection("enrolled_credentials").deleteMany({ _id: auth.credentialId as never });
      await db.collection("seen_receipts").deleteMany({ _id: { $in: idList } });
      await db.collection("payments").deleteMany({ $or: [{ _id: { $in: idList } }, { fromAccount: { $regex: `^${tag}-` } }] });
      await db.collection("accounts").deleteMany({ _id: { $regex: `^${tag}-` } as never });
      // Anchors of real ledger events stay with the ledger; the fake seqs and the stub's seq 0 would only mislead.
      await db.collection("anchors").deleteMany({ _id: { $in: [...fakeSeqs, ...(stubLedger ? [0] : [])] as never[] } });
    }),
  );
  const failed = [...gate, ...inst].filter((r) => r.status === "rejected").length;
  return failed === 0 ? `removed ${warrantIds.length} warrants and the eval user, agents, credentials and institution rows` : `${failed} cleanup step(s) failed; eval rows may remain (tag ${tag})`;
}

// ---- summary ----

function summary(): void {
  const lines: [string, string][] = [
    ["G1  Authority checked before every action", "G1"],
    ["G2  Out-of-warrant actions stopped", "G2"],
    ["G3  Limits hold under concurrency", "G3"],
    ["G4  Authority provable by institutions", "G4"],
    ["G5  History tamper-evident", "G5"],
    ["G6  Latency measured", "G6"],
  ];
  const body = lines.map(([title, key]) => {
    const r = results[key];
    const status = !r ? ansi.red("✗ not run") : r.ok === null ? ansi.yellow("- n/a (real ledger not merged)") : `${mark(r.ok)} ${r.text}`;
    return `${pad(title, 42)} ${status}`;
  });
  if (results.idempotency) body.push(`${pad("    idempotency: 1 decision, 1 execution", 42)} ${results.idempotency.ok === null ? ansi.yellow("- n/a (real ledger not merged)") : mark(!!results.idempotency.ok)}`);
  const width = Math.max(...body.map((l) => visible(l).length)) + 2;
  console.log(`\n┌${"─".repeat(width)}┐`);
  console.log(`│ ${pad(ansi.bold(`AWP evaluation   ledger: ${stubLedger ? "stub" : "real"}   ${((Date.now() - started) / 1000).toFixed(0)} s`), width - 2)} │`);
  console.log(`├${"─".repeat(width)}┤`);
  for (const l of body) console.log(`│ ${pad(l, width - 2)} │`);
  console.log(`└${"─".repeat(width)}┘`);
}

// ---- main ----

async function main(): Promise<number> {
  console.log(`\n${ansi.bold("AWP evaluation")}  ${ansi.dim(`gate, bank and fintech in this process; database prefix "${config.dbPrefix}"; ledger ${stubLedger ? "stub" : "real"}`)}`);
  let crashed = false;
  try {
    await users().insertOne({ _id: userId, name: "eval user" });
    await credentials().insertOne(auth.credentialDoc(userId));
    await agents().insertMany([
      { _id: agentA, name: "eval agent A", keyHash: hashAgentKey(keyA), status: "active" },
      { _id: agentB, name: "eval agent B", keyHash: hashAgentKey(keyB), status: "active" },
    ]);
    for (const i of INSTS) {
      const res = await fetch(`${url[i]}/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json", [config.enrollHeader]: config.enrollSecret! },
        body: JSON.stringify({ userId, credential: { id: auth.credentialId, publicKey: b64url(auth.publicKey) } }),
      });
      if (res.status !== 200) throw new Error(`enrolling the software authenticator at the ${i} failed (${res.status})`);
    }

    await labelled();
    const tamper = runTamper();   // institutions only: overlaps the gate-bound checks below
    await behavioural();
    printTamper(await tamper);
    await latencySample();
    await ledgerChecks();
    latencyReport();
  } catch (error) {
    crashed = true;
    console.log(`\n${ansi.red("✗ eval stopped:")} ${(error as Error).stack ?? error}`);
  } finally {
    console.log(`\n${ansi.dim(await cleanup().catch((e: Error) => `cleanup failed: ${e.message}`))}`);
    await Promise.allSettled([gateApp.close(), ...INSTS.map((i) => insts[i].close()), bankMongo.close(), fintechMongo.close()]);
    await closeDb();
  }
  summary();
  const failed = crashed || Object.values(results).some((r) => r.ok === false) || Object.keys(results).length < 6;
  return failed ? 1 : 0;
}

process.exit(await main());
