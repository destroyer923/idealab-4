import { pbkdf2Sync, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const LEGACY_PBKDF2_HASH_RE = /^[a-f\d]{64}$/i;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export async function registrationAccountExists(
  findOne: (filter: { $or: [{ email: string }, { "profile.username": string }] }) => Promise<unknown>,
  email: string,
  username: string,
): Promise<boolean> {
  const found = await findOne({
    $or: [{ email: normalizeEmail(email) }, { "profile.username": username.trim().toLowerCase() }],
  });
  return found !== null && found !== undefined;
}

export interface PasswordRecord {
  passwordHash: string;
  salt?: string;
  save(): Promise<unknown>;
  set(path: "salt", value: undefined): void;
}

export async function verifyPasswordAndUpgrade(password: string, user: PasswordRecord): Promise<boolean> {
  if (BCRYPT_HASH_RE.test(user.passwordHash)) {
    return bcrypt.compare(password, user.passwordHash);
  }

  if (!user.salt || !LEGACY_PBKDF2_HASH_RE.test(user.passwordHash)) return false;

  const actual = pbkdf2Sync(password, user.salt, 120_000, 32, "sha256");
  const expected = Buffer.from(user.passwordHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;

  user.passwordHash = await bcrypt.hash(password, 12);
  user.set("salt", undefined);
  await user.save();
  return true;
}
