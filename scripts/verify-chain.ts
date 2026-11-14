// Verifies the ledger chain and, when the institutions are running, their held checkpoints (REQ-008, REQ-012).
// Owner: Pro, task 5. Exit code 0 only when the chain is intact and every reachable institution agrees.
import { closeDb } from "../src/gate/db.ts";
import { verifyAnchors, verifyChain } from "../src/gate/ledger.ts";
import { config, type InstitutionId } from "../src/shared/config.ts";

let failed = false;
try {
  console.log(`Ledger database: ${config.dbName.gate}`);
  const chain = await verifyChain();
  if (chain.ok) {
    console.log(`Chain: OK, ${chain.checked} events verified (hashes, links and gate signatures)`);
  } else {
    failed = true;
    console.log(`Chain: BROKEN at seq ${chain.firstBrokenSeq} (${chain.reason}); ${chain.checked} events verified before it`);
  }
  for (const institution of ["bank", "fintech"] as InstitutionId[]) {
    const result = await verifyAnchors(institution);
    if (!result.reachable) {
      console.log(`Anchors ${institution}: skipped, not reachable (${result.error})`);
    } else if (result.ok) {
      console.log(`Anchors ${institution}: OK, ${result.checked} checkpoints match the ledger`);
    } else {
      failed = true;
      console.log(`Anchors ${institution}: MISMATCH at seq ${result.mismatchSeq} (${result.checked} checkpoints compared)`);
    }
  }
} catch (err) {
  failed = true;
  console.error(`verify-chain failed: ${err instanceof Error ? err.message : err}`);
} finally {
  await closeDb();
}
process.exit(failed ? 1 : 0);
