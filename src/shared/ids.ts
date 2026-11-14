// ID and nonce generation. Frozen after task 2.
import { randomBytes } from "node:crypto";

export type IdPrefix = "usr" | "agt" | "wrt" | "dec" | "run";

/** "wrt_" + 24 hex characters (96 random bits). */
export const newId = (prefix: IdPrefix): string => `${prefix}_${randomBytes(12).toString("hex")}`;

/** Terms nonce: base64url of 16 random bytes. */
export const newNonce = (): string => randomBytes(16).toString("base64url");
