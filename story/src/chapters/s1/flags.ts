/** WebAuthn authenticatorData flags byte (offset 32): 0x01 user present, 0x04 user verified. Null if unreadable. */
export function authFlags(authenticatorData: string): number | null {
  try {
    const bin = atob(authenticatorData.replace(/-/g, "+").replace(/_/g, "/"));
    return bin.length > 32 ? bin.charCodeAt(32) : null;
  } catch {
    return null;
  }
}

export const hex = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;
