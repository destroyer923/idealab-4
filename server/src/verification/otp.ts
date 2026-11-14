import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import type { OtpRecord } from "../models/Verification.js";

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_RESEND_MS = 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_PER_HOUR = 3;

export type OtpChannel = "phone" | "email";
export type OtpAttemptResult = "verified" | "wrong_code" | "expired" | "attempts_exhausted" | "destination_mismatch";

export function isDevelopmentMockOtpEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "development" && env.DEV_MOCK_OTP_ENABLED === "true";
}

export function isMockOtpProviderEnabled(providerType: string | undefined, env: NodeJS.ProcessEnv): boolean {
  return providerType === "demo" && isDevelopmentMockOtpEnabled(env);
}

export function normalizeOtpDestination(channel: OtpChannel, destination: string): string {
  return channel === "email"
    ? destination.trim().toLowerCase()
    : destination.trim().replace(/[\s().-]/g, "");
}

export function hashOtpDestination(channel: OtpChannel, destination: string, secret: string): string {
  return createHmac("sha256", secret).update(`${channel}:${normalizeOtpDestination(channel, destination)}`).digest("hex");
}

function hashOtp(salt: string, code: string): Buffer {
  return scryptSync(code, salt, 32);
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function createOtpRecord(
  channel: OtpChannel,
  destination: string,
  code: string,
  now: number,
  secret: string,
): OtpRecord {
  const salt = randomBytes(16).toString("hex");
  const timestamp = new Date(now).toISOString();
  return {
    destinationHash: hashOtpDestination(channel, destination, secret),
    otpHash: hashOtp(salt, code).toString("hex"),
    salt,
    expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
    attempts: 0,
    attemptsAt: [],
    createdAt: timestamp,
    sentAt: timestamp,
  };
}

export function evaluateOtpAttempt(
  otp: OtpRecord,
  channel: OtpChannel,
  destination: string,
  code: string,
  now: number,
  secret: string,
): OtpAttemptResult {
  if (!Number.isFinite(Date.parse(otp.expiresAt)) || now >= Date.parse(otp.expiresAt)) return "expired";
  if (otp.destinationHash !== hashOtpDestination(channel, destination, secret)) return "destination_mismatch";
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return "attempts_exhausted";

  const actual = hashOtp(otp.salt, code);
  const expected = Buffer.from(otp.otpHash, "hex");
  const correct = actual.length === expected.length && timingSafeEqual(actual, expected);
  if (correct) return "verified";

  otp.attempts++;
  otp.attemptsAt.push(now);
  return otp.attempts >= OTP_MAX_ATTEMPTS ? "attempts_exhausted" : "wrong_code";
}

export function otpResendSeconds(lastSentAt: string | undefined, now: number): number {
  if (!lastSentAt) return 0;
  const sentAt = Date.parse(lastSentAt);
  if (!Number.isFinite(sentAt)) return 0;
  return Math.min(OTP_RESEND_MS / 1000, Math.max(0, Math.ceil((OTP_RESEND_MS - (now - sentAt)) / 1000)));
}
