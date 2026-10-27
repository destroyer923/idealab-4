import { ApiError } from "./db";

/**
 * Designated administrator identity and non-reversible PBKDF2-SHA256 (120,000 iterations)
 * digest. The plaintext password is never stored in source code, configuration, or bundles,
 * and no session is ever created on page load.
 */
export const DESIGNATED_ADMIN = {
  fullName: "Leon",
  username: "anupam_dev",
  email: "shuklaanupam2008@gmail.com",
  salt: "9f4b2c7e1a8d5063c4e9b17283a5d0f6",
  passwordHash: "bbff8cbeafa5ba2d5425317c64b15cde8ca45f8eec935fe4c59d133eed7b7a68",
} as const;

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function matchesDesignatedAdmin(
  emailNormalized: string,
  password: string,
  hashFn: (password: string, salt: string) => Promise<string>,
): Promise<boolean> {
  const candidate = await hashFn(password, DESIGNATED_ADMIN.salt);
  return emailNormalized === DESIGNATED_ADMIN.email && safeEqualHex(candidate, DESIGNATED_ADMIN.passwordHash);
}

// Never provision an account or switch sessions automatically on page load.
export function hasAdminCredentials(): boolean {
  return false;
}

export async function provisionAdmin(): Promise<never> {
  throw new ApiError("community.serverRequired", "setup_required");
}
