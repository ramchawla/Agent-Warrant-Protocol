// The ONLY module that talks to the backend. One typed function per route in docs/STORY-API.md.
// Mock mode (`?mock=1`, or the M key) returns src/mocks/<functionName>.json after 300 ms; Touch ID calls after 800 ms.
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
  AddPolicyResponse, ApprovalVerifyResponse, AuthOptionsResponse, CompileResponse, CreateWarrantResponse,
  DemoStateResponse, DemoStepResponse, InspectResponse, InstitutionStateResponse, LedgerResponse,
  LedgerVerifyResponse, PoliciesResponse, PolicyIndexResponse, RegisterOptionsResponse, ResetResponse,
  SessionResponse, TamperResponse, VerifyApprovalResponse, VerifyResponse,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// ---- mock mode ----

const MOCK_KEY = "awp-story-mock";
const fixtures = import.meta.glob<unknown>("./mocks/*.json", { eager: true, import: "default" });

function readMock(): boolean {
  try {
    const q = new URLSearchParams(location.search).get("mock");
    if (q !== null) localStorage.setItem(MOCK_KEY, q === "1" ? "1" : "0");
    return localStorage.getItem(MOCK_KEY) === "1";
  } catch {
    return new URLSearchParams(location.search).get("mock") === "1";
  }
}

let mock = readMock();
export const isMock = () => mock;
export function setMock(on: boolean) {
  mock = on;
  try { localStorage.setItem(MOCK_KEY, on ? "1" : "0"); } catch { /* storage blocked: in-memory only */ }
  window.dispatchEvent(new Event("awp-mock-change"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fixture<T>(name: string, delay = 300): Promise<T> {
  await sleep(delay);
  const data = fixtures[`./mocks/${name}.json`];
  if (data === undefined) throw new ApiError(404, `No mock fixture src/mocks/${name}.json`);
  return structuredClone(data) as T;
}

// ---- live transport ----

const reviewerToken = import.meta.env.VITE_REVIEWER_TOKEN as string | undefined;

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, reviewer = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (reviewer && reviewerToken) headers.authorization = `Bearer ${reviewerToken}`;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, credentials: "include", body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new ApiError(0, `Cannot reach ${path}: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) {
    const j = json as { message?: string; error?: string } | null;
    throw new ApiError(res.status, j?.message ?? j?.error ?? (text || res.statusText));
  }
  return json as T;
}

/** Wraps a WebAuthn ceremony so a cancelled/failed Touch ID surfaces as ApiError too. */
async function ceremony<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, `Touch ID: ${(e as Error).message}`);
  }
}

const id = (s: string) => encodeURIComponent(s);
const post = <T>(path: string, body: unknown = {}, reviewer = false) => call<T>("POST", path, body, reviewer);
const get = <T>(path: string, reviewer = false) => call<T>("GET", path, undefined, reviewer);

// ---- routes ----

export const reset = () => (mock ? fixture<ResetResponse>("reset") : post<ResetResponse>("/api/demo/reset"));

export const compile = (text: string) =>
  mock ? fixture<CompileResponse>("compile") : post<CompileResponse>("/api/demo/compile", { text });

export const createWarrant = (text: string) =>
  mock ? fixture<CreateWarrantResponse>("createWarrant") : post<CreateWarrantResponse>("/api/demo/warrant", { text });

export const demoState = () => (mock ? fixture<DemoStateResponse>("demoState") : get<DemoStateResponse>("/api/demo/state"));

export const demoSession = () => (mock ? fixture<SessionResponse>("demoSession") : post<SessionResponse>("/api/demo/session"));

/** Registers a Touch ID passkey for usr_demo (call only when demoState().user.hasPasskey is false). */
export async function registerPasskey(userId = "usr_demo", name = "Ram"): Promise<VerifyResponse> {
  if (mock) return fixture<VerifyResponse>("registerPasskey", 800);
  return ceremony(async () => {
    const optionsJSON = await post<RegisterOptionsResponse>("/api/passkey/register/options", { userId, name });
    const response = await startRegistration({ optionsJSON });
    return post<VerifyResponse>("/api/passkey/register/verify", { userId, response });
  });
}

/** Signs the warrant with Touch ID: options (bound to the displayed termsHash) → startAuthentication → verify. */
export async function approveWarrant(warrantId: string, termsHash: string): Promise<VerifyResponse> {
  if (mock) return fixture<VerifyResponse>("approveWarrant", 800);
  return ceremony(async () => {
    const optionsJSON = await post<AuthOptionsResponse>(`/api/warrants/${id(warrantId)}/approve/options`, { termsHash });
    const response = await startAuthentication({ optionsJSON });
    return post<VerifyResponse>(`/api/warrants/${id(warrantId)}/approve/verify`, { response });
  });
}

export const inspect = (warrantId: string) =>
  mock ? fixture<InspectResponse>("inspect") : get<InspectResponse>(`/api/warrants/${id(warrantId)}/inspect`, true);

export const verifyApproval = (warrantId: string) =>
  mock ? fixture<VerifyApprovalResponse>("verifyApproval") : get<VerifyApprovalResponse>(`/api/warrants/${id(warrantId)}/verify-approval`, true);

export const work = () => (mock ? fixture<DemoStepResponse>("work") : post<DemoStepResponse>("/api/demo/work"));
export const blocked = () => (mock ? fixture<DemoStepResponse>("blocked") : post<DemoStepResponse>("/api/demo/blocked"));
export const sensitive = () => (mock ? fixture<DemoStepResponse>("sensitive") : post<DemoStepResponse>("/api/demo/sensitive"));

/** Fresh Touch ID for a pending sensitive release: options (challenge = SHA-256 of minimized payload) → startAuthentication → verify. */
export async function approvalOptionsAndVerify(approvalId: string): Promise<ApprovalVerifyResponse> {
  if (mock) return fixture<ApprovalVerifyResponse>("approvalOptionsAndVerify", 800);
  return ceremony(async () => {
    const optionsJSON = await post<AuthOptionsResponse>(`/api/approvals/${id(approvalId)}/options`);
    const response = await startAuthentication({ optionsJSON });
    return post<ApprovalVerifyResponse>(`/api/approvals/${id(approvalId)}/verify`, { response });
  });
}

export const burst = () => (mock ? fixture<DemoStepResponse>("burst") : post<DemoStepResponse>("/api/demo/burst"));
export const revoke = () => (mock ? fixture<DemoStepResponse>("revoke") : post<DemoStepResponse>("/api/demo/revoke"));
export const tamper = () => (mock ? fixture<TamperResponse>("tamper") : post<TamperResponse>("/api/demo/tamper"));

export const ledger = () => (mock ? fixture<LedgerResponse>("ledger") : get<LedgerResponse>("/api/ledger", true));
export const ledgerVerify = () => (mock ? fixture<LedgerVerifyResponse>("ledgerVerify") : get<LedgerVerifyResponse>("/api/ledger/verify", true));

export const addPolicy = (rule: string, action?: string) =>
  mock ? fixture<AddPolicyResponse>("addPolicy") : post<AddPolicyResponse>("/api/policies", { rule, action }, true);
export const policies = () => (mock ? fixture<PoliciesResponse>("policies") : get<PoliciesResponse>("/api/policies", true));
export const policyIndex = () => (mock ? fixture<PolicyIndexResponse>("policyIndex") : get<PolicyIndexResponse>("/api/policies/index", true));

export const fintechState = () => (mock ? fixture<InstitutionStateResponse>("fintechState") : get<InstitutionStateResponse>("/fintech/state"));
export const bankState = () => (mock ? fixture<InstitutionStateResponse>("bankState") : get<InstitutionStateResponse>("/bank/state"));
