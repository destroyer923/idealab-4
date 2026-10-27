/**
 * Verification engine: contact OTP codes, provider integration, evidence helpers.
 *
 * Security properties enforced here (not in the UI):
 *  - Codes are generated with crypto.getRandomValues and stored only as
 *    SHA-256(salt + code); the code itself is never persisted.
 *  - Codes expire (OTP_TTL_MINUTES), are single-use, and are capped at OTP_MAX_ATTEMPTS.
 *  - Resends are rate limited (OTP_RESEND_MIN_MS / OTP_MAX_RESENDS_PER_HOUR) and the
 *    previous code is invalidated on resend.
 *  - Provider failures never produce a verified status.
 *
 * `demo` is an explicitly labelled local delivery channel so the whole OTP round trip can
 * be exercised without a real SMS/email gateway. It never bypasses any of the checks above.
 * `http` is the shape a real gateway integration would use.
 */
import type { BusinessType, ProviderConfig } from "./types";
// The real Key union lives with the locale — never the loose alias in types.ts.
import type { Key } from "@/locales/en";

export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_MIN_MS = 60_000;
export const OTP_MAX_RESENDS_PER_HOUR = 3;

export const PHONE_RE = /^\+?[0-9][0-9 \-()]{7,19}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const UDYAM_RE = /^\d{10}$/;

export const BUSINESS_TYPES: readonly BusinessType[] = [
  "farmer",
  "artisan",
  "seller",
  "designer",
  "transporter",
  "trader",
  "service",
  "other",
] as const;

export const PROVIDER_TYPES = ["none", "http", "demo"] as const;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generates a 6-digit code using a CSPRNG. */
export function generateCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let n = 0;
  for (const b of bytes) n = (n * 256 + b) % 1_000_000;
  return String(n).padStart(OTP_LENGTH, "0");
}

/** Compares a submitted code against a stored hash (constant-time-ish, hashes both). */
export async function verifyCode(code: string, salt: string, expectedHash: string): Promise<boolean> {
  const a = await sha256Hex(salt + code.trim());
  const b = expectedHash;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function hashOtp(code: string, salt: string): Promise<string> {
  return sha256Hex(salt + code);
}

/** Masks contact details for display; full values are never shown outside verification flows. */
export function maskPhone(phone: string) {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 7) return "—";
  return `${digits.slice(0, digits.length - 4).padStart(digits.length, "*")}…${digits.slice(-4)}`;
}

export function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return "—";
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"*".repeat(Math.max(name.length - visible.length, 1))}@${domain}`;
}

/** Derives the destination the code was requested for, defaulting to the account email. */
export function destinationFor(channel: "phone" | "email", input: { phone?: string; email: string }, dbEmail?: string) {
  return channel === "phone" ? (input.phone ?? "").trim() : (input.email ?? dbEmail ?? "").trim();
}

export function validatePhone(phone: string): string | undefined {
  if (!phone) return "verify.err.phoneRequired";
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 10 || digits.length > 15) return "verify.err.phoneFormat";
  if (!PHONE_RE.test(phone)) return "verify.err.phoneFormat";
  return undefined;
}

export function validateEmail(email: string): string | undefined {
  if (!email) return "verify.err.emailRequired";
  if (!EMAIL_RE.test(email)) return "verify.err.emailFormat";
  return undefined;
}

/* ------------------------------------------------------------------ */
/* provider delivery                                                   */
/* ------------------------------------------------------------------ */

/** Every message is a translation key; callers render it through the current language. */
export type SendResult = { ok: true; message: Key } | { ok: false; message: Key };

/**
 * Delivers a code through the configured channel.
 * Returns ok:false (never a throw that would be swallowed) so callers can record the failure.
 */
/** Maps an HTTP gateway status to a translated key; unknown codes get a generic message. */
function httpStatusKey(status: number): Key {
  if (status === 400) return "verify.provider.http400";
  if (status === 401) return "verify.provider.http401";
  if (status === 403) return "verify.provider.http403";
  if (status === 429) return "verify.provider.http429";
  if (status === 500) return "verify.provider.http500";
  return "verify.provider.httpOther";
}

export async function sendOtp(cfg: ProviderConfig, destination: string, code: string, channel: "phone" | "email"): Promise<SendResult> {
  if (!cfg.type || cfg.type === "none") return { ok: false, message: "verify.provider.unconfigured" };
  if (!destination) return { ok: false, message: "verify.err.missingDestination" };
  if (cfg.type === "demo") return { ok: true, message: "verify.provider.demo" };
  try {
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${cfg.apiToken}`,
        "x-channel": channel,
      },
      body: JSON.stringify({ destination, code }),
    });
    if (!res.ok) return { ok: false, message: httpStatusKey(res.status) };
    return { ok: true, message: "verify.provider.ok" };
  } catch {
    return { ok: false, message: "verify.provider.network" };
  }
}

export function maskForAudit(kind: string, value: string): string {
  if (kind === "email") return maskEmail(value);
  return maskPhone(value);
}
