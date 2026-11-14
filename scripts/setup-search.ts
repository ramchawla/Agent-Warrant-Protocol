// Creates the egress_policy_vec autoEmbed vector index on egress_policies, seeds the policies,
// and waits until the index is queryable. Safe to re-run. Database honours AWP_DB_PREFIX.
//   npm run setup-search
import { closeDb, db } from "../src/gate/db.ts";
import { INDEX_DEFINITION, INDEX_NAME, indexStatus, policies, seedPolicies } from "../src/gate/policies.ts";

await seedPolicies(); // the collection must exist before createSearchIndex
const existing = await indexStatus();
if (existing.status === "absent") {
  try {
    await policies().createSearchIndex({ name: INDEX_NAME, type: "vectorSearch", definition: INDEX_DEFINITION });
    console.log(`creating ${INDEX_NAME} on ${db().databaseName}.egress_policies`);
  } catch (e) {
    console.error(`Atlas refused ${INDEX_NAME}: ${(e as Error).message}`);
    await closeDb();
    process.exit(1);
  }
}
const started = Date.now();
for (;;) {
  const s = await indexStatus();
  if (s.queryable) {
    console.log(`ok       ${INDEX_NAME} ${s.status} queryable (${Math.round((Date.now() - started) / 1000)} s)`);
    break;
  }
  if (s.status === "FAILED" || Date.now() - started > 10 * 60_000) {
    console.error(`${INDEX_NAME} not queryable: ${JSON.stringify(s)}`);
    await closeDb();
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
await closeDb();
