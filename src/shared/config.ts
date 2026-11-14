// Environment and fixed values. Frozen after task 2.
// Loads .env from the working directory when present; variables already set win.
try {
  process.loadEnvFile();
} catch {
  // no .env file; rely on the process environment
}

const env = process.env;
const opt = (name: string): string | undefined => env[name] || undefined;
const prefix = env.AWP_DB_PREFIX ?? "";

export const config = {
  mongoUri: {
    gate: opt("MONGODB_URI_GATE"),
    bank: opt("MONGODB_URI_BANK"),
    fintech: opt("MONGODB_URI_FINTECH"),
    reviewer: opt("MONGODB_URI_REVIEWER"),
  },
  dbPrefix: prefix,
  dbName: {
    gate: `${prefix}awp_gate`,
    bank: `${prefix}awp_bank`,
    fintech: `${prefix}awp_fintech`,
  },

  rpId: opt("RP_ID") ?? "localhost",
  origin: opt("ORIGIN") ?? "http://localhost:3000",

  gatePrivateKey: opt("GATE_ED25519_PRIVATE_KEY"),
  gatePublicKey: opt("GATE_ED25519_PUBLIC_KEY"),
  sessionSecret: opt("SESSION_SECRET"),
  reviewerToken: opt("REVIEWER_TOKEN"),
  enrollSecret: opt("ENROLL_SECRET"),

  allowTestAuthenticator: env.AWP_ALLOW_TEST_AUTHENTICATOR === "1",
  fixtures: env.AWP_FIXTURES === "1",

  anthropicApiKey: opt("ANTHROPIC_API_KEY"),
  llmModel: opt("AWP_LLM_MODEL") ?? "claude-sonnet-5-5",
  elevenLabsApiKey: opt("ELEVENLABS_API_KEY"),

  // Fixed by the PRD.
  port: { gate: 3000, bank: 4001, fintech: 4002 },
  institutionUrl: { bank: "http://localhost:4001", fintech: "http://localhost:4002" },
  policyVersion: "awp-policy-1",
  receiptTtlMs: 60_000,
  receiptSkewMs: 5_000,
  challengeTtlMs: 5 * 60_000,
  executeTimeoutMs: 5_000,
  // POST /enroll carries the enrollment secret in this header; credential.publicKey is base64url COSE bytes.
  enrollHeader: "x-enroll-secret",
} as const;

export type InstitutionId = keyof typeof config.institutionUrl;

/** Returns a required setting or throws naming the missing variable. Callers fail closed. */
export function need(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
