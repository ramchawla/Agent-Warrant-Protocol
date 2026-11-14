// Build and sign receipts, forward them to an institution (REQ-009, REQ-010). Owner: Max, task 6.
import { ed25519Sign, hashJcs, jcs } from "../shared/canonical.ts";
import { config, need } from "../shared/config.ts";
import type { Action, Receipt } from "../shared/types.ts";

export type ReceiptChainElement = Receipt["chain"][number];

/** Signs JCS(receipt) with the gate key. Throws if the key is missing; the gate maps any throw to deny LEDGER_UNAVAILABLE. */
export function buildReceipt(args: {
  decisionId: string;
  aud: "bank" | "fintech";
  action: Action;
  chain: ReceiptChainElement[];
  ledger: { seq: number; hash: string };
  now?: Date;
}): { receipt: Receipt; gateSig: string } {
  const key = need(config.gatePrivateKey, "GATE_ED25519_PRIVATE_KEY");
  const iat = args.now ?? new Date();
  const receipt: Receipt = {
    v: 1,
    decisionId: args.decisionId,
    aud: args.aud,
    iat: iat.toISOString(),
    exp: new Date(iat.getTime() + config.receiptTtlMs).toISOString(),
    chain: args.chain,
    action: args.action,
    actionHash: hashJcs(args.action),
    ledger: args.ledger,
  };
  return { receipt, gateSig: ed25519Sign(key, jcs(receipt)) };
}

export type ForwardResult = { outcome: "executed" | "rejected" | "unknown"; institutionRef?: string; result?: unknown; reason?: string };

/** POST {base}/execute. Only a clear answer from the institution is "executed" or "rejected"; everything else is "unknown". Never throws. */
export async function forwardReceipt(aud: "bank" | "fintech", receipt: Receipt, gateSig: string): Promise<ForwardResult> {
  try {
    const override = aud === "bank" ? process.env.AWP_BANK_URL : process.env.AWP_FINTECH_URL;
    const base = (override || config.institutionUrl[aud]).replace(/\/+$/, "");
    const res = await fetch(`${base}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receipt, gateSig }),
      signal: AbortSignal.timeout(config.executeTimeoutMs),
    });
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return { outcome: "unknown" };
    const reply = body as { executed?: unknown; rejected?: unknown; institutionRef?: unknown; reason?: unknown };
    if (res.status === 200 && reply.executed === true) {
      return { outcome: "executed", ...(typeof reply.institutionRef === "string" && { institutionRef: reply.institutionRef }), result: body };
    }
    if (res.status >= 400 && reply.rejected === true) {
      return { outcome: "rejected", ...(typeof reply.reason === "string" && { reason: reply.reason }) };
    }
    return { outcome: "unknown" };
  } catch {
    return { outcome: "unknown" };
  }
}
