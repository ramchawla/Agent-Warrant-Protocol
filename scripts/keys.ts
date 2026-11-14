// Prints a new Ed25519 gate key pair as .env lines (base64url DER: PKCS#8 private, SPKI public).
//   npm run --silent keys >> .env
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
console.log(`GATE_ED25519_PRIVATE_KEY=${privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url")}`);
console.log(`GATE_ED25519_PUBLIC_KEY=${publicKey.export({ format: "der", type: "spki" }).toString("base64url")}`);
