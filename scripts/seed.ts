// Demo data: user usr_demo, agent agt_demo, bank accounts A1 to A9, an empty fintech store. Safe to re-run. Owner: Max, task 11.
//   npm run seed                 create what is missing; a new agent key is printed once as an .env line
//   npm run seed -- --reset      first delete demo warrants, their challenges, bank accounts and fintech payments
//   npm run seed -- --new-key    replace the agent key (or set AGENT_DEMO_KEY to choose it)
// audit_events is never touched: it is insert-only for the gate user.
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { MongoClient } from "mongodb";
import { ansi } from "../src/agent/run.ts";
import { hashAgentKey } from "../src/gate/agents.ts";
import { agents, challenges, closeDb, users, warrants } from "../src/gate/db.ts";
import { config, need } from "../src/shared/config.ts";

export const DEMO_USER = "usr_demo";
export const DEMO_AGENT = "agt_demo";
// A string, like the one the bank writes on each refresh: the bank's /state sorts on it.
const LAST_REFRESH = "2025-01-15T09:00:00.000Z";
const ACCOUNTS = Array.from({ length: 9 }, (_, i) => `A${i + 1}`);

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { reset: { type: "boolean" }, "new-key": { type: "boolean" } } });
  const ok = (text: string) => console.log(`${ansi.green("✓")} ${text}`);
  console.log(`\n${ansi.bold("AWP seed")}  ${ansi.dim(`databases ${config.dbName.gate}, ${config.dbName.bank}, ${config.dbName.fintech}`)}\n`);

  const bankClient = new MongoClient(need(config.mongoUri.bank, "MONGODB_URI_BANK"));
  const fintechClient = new MongoClient(need(config.mongoUri.fintech, "MONGODB_URI_FINTECH"));
  const accounts = bankClient.db(config.dbName.bank).collection<{ _id: string }>("accounts");
  const payments = fintechClient.db(config.dbName.fintech).collection("payments");
  try {
    if (values.reset) {
      const ids = (await warrants().find({ "terms.userId": DEMO_USER }, { projection: { _id: 1 } }).toArray()).map((w) => w._id);
      await challenges().deleteMany({ warrantId: { $in: ids } });
      const w = await warrants().deleteMany({ _id: { $in: ids } });
      const a = await accounts.deleteMany({});
      const p = await payments.deleteMany({});
      ok(`reset: removed ${w.deletedCount} demo warrants, ${a.deletedCount} bank accounts, ${p.deletedCount} fintech payments`);
    }

    await users().updateOne({ _id: DEMO_USER }, { $set: { name: "Demo customer" } }, { upsert: true });
    ok(`user ${DEMO_USER}`);

    // Only hashAgentKey(key) is stored. A key is printed only when this run generates one.
    const existing = await agents().findOne({ _id: DEMO_AGENT });
    const chosen = process.env.AGENT_DEMO_KEY || undefined;
    if (existing && !chosen && !values["new-key"]) {
      ok(`agent ${DEMO_AGENT} exists, key unchanged ${ansi.dim("(AGENT_DEMO_KEY in .env is the key; --new-key replaces it)")}`);
    } else {
      const key = chosen && !values["new-key"] ? chosen : `awp_demo_${randomBytes(24).toString("base64url")}`;
      await agents().updateOne({ _id: DEMO_AGENT }, { $set: { name: "Demo agent", keyHash: hashAgentKey(key), status: "active" } }, { upsert: true });
      ok(`agent ${DEMO_AGENT} ${chosen && !values["new-key"] ? "key set from AGENT_DEMO_KEY" : "key generated"}`);
      if (!(chosen && !values["new-key"])) console.log(`\n  ${ansi.yellow("add this line to .env (shown once):")}\n  AGENT_DEMO_KEY=${key}\n`);
    }

    for (const account of ACCOUNTS) await accounts.updateOne({ _id: account }, { $setOnInsert: { holder: `Demo account ${account}`, refreshCount: 0, lastKycRefreshAt: LAST_REFRESH } }, { upsert: true });
    ok(`bank accounts ${ACCOUNTS[0]} to ${ACCOUNTS.at(-1)} (${await accounts.countDocuments()} in the bank)`);
    ok(`fintech payments: ${await payments.countDocuments()}`);
  } finally {
    await Promise.all([closeDb(), bankClient.close(), fintechClient.close()]);
  }
  console.log(`\n${ansi.dim("next: create warrant W1 in the browser, then")} npm run agent -- in-warrant --warrant wrt_...`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
