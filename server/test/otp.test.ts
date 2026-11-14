import assert from "node:assert/strict";
import type { NextFunction, Response } from "express";
import { test } from "node:test";
import type { OtpRecord } from "../src/models/Verification.js";
import { requireAuth, type AuthenticatedRequest } from "../src/middleware/auth.js";
import {
  createOtpRecord, evaluateOtpAttempt, generateOtpCode, hashOtpDestination, isDevelopmentMockOtpEnabled,
  isMockOtpProviderEnabled, normalizeOtpDestination, OTP_MAX_ATTEMPTS, OTP_RESEND_MS, OTP_TTL_MS, otpResendSeconds,
} from "../src/verification/otp.js";

const now = Date.parse("2026-01-01T00:00:00.000Z");
const testSecret = "otp-test-secret";
const wrongCode = (code: string) => code === "000000" ? "000001" : "000000";

test("phone and email OTPs are independent, hashed, and bound to their destination", () => {
  const phone = createOtpRecord("phone", "+1 (202) 555-0100", "012345", now, testSecret);
  const email = createOtpRecord("email", "Member@example.test", "543210", now, testSecret);

  assert.match(generateOtpCode(), /^\d{6}$/);
  assert.equal(phone.destinationHash, hashOtpDestination("phone", "+12025550100", testSecret));
  assert.equal(email.destinationHash, hashOtpDestination("email", "member@example.test", testSecret));
  assert.notEqual(phone.destinationHash, hashOtpDestination("phone", "+12025550100", "different-secret"));
  assert.notEqual(phone.destinationHash, email.destinationHash);
  assert.notEqual(phone.otpHash, "012345");
  assert.equal("code" in phone, false);
  assert.equal("destination" in phone, false);
  assert.equal(phone.expiresAt, new Date(now + 5 * 60_000).toISOString());
  assert.equal(evaluateOtpAttempt(phone, "phone", "+12025550100", "012345", now, testSecret), "verified");
  assert.equal(evaluateOtpAttempt(email, "email", "member@example.test", "543210", now, testSecret), "verified");
  assert.equal(evaluateOtpAttempt(phone, "phone", "+12025550101", "012345", now, testSecret), "destination_mismatch");
  assert.equal(normalizeOtpDestination("email", " Member@Example.Test "), "member@example.test");
});

test("wrong OTPs count toward the attempt cap and the correct OTP remains usable before the cap", () => {
  const otp = createOtpRecord("phone", "+12025550100", "012345", now, testSecret);
  assert.equal(evaluateOtpAttempt(otp, "phone", "+12025550100", wrongCode("012345"), now, testSecret), "wrong_code");
  assert.equal(otp.attempts, 1);
  assert.equal(evaluateOtpAttempt(otp, "phone", "+12025550100", "012345", now, testSecret), "verified");
});

test("expired OTPs are rejected at the five-minute boundary", () => {
  const otp = createOtpRecord("email", "member@example.test", "012345", now, testSecret);
  assert.equal(evaluateOtpAttempt(otp, "email", "member@example.test", "012345", now + OTP_TTL_MS, testSecret), "expired");
});

test("the fifth wrong attempt exhausts the OTP and further attempts stay blocked", () => {
  const otp = createOtpRecord("phone", "+12025550100", "012345", now, testSecret);
  for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt++) {
    assert.equal(evaluateOtpAttempt(otp, "phone", "+12025550100", wrongCode("012345"), now, testSecret), "wrong_code");
  }
  assert.equal(evaluateOtpAttempt(otp, "phone", "+12025550100", wrongCode("012345"), now, testSecret), "attempts_exhausted");
  assert.equal(otp.attempts, OTP_MAX_ATTEMPTS);
  assert.equal(evaluateOtpAttempt(otp, "phone", "+12025550100", "012345", now, testSecret), "attempts_exhausted");
});

test("OTP replacement and successful consumption prevent reuse", () => {
  const first = createOtpRecord("email", "member@example.test", "012345", now, testSecret);
  const replacement = createOtpRecord("email", "member@example.test", "543210", now + OTP_RESEND_MS, testSecret);
  assert.equal(evaluateOtpAttempt(replacement, "email", "member@example.test", "012345", now + OTP_RESEND_MS, testSecret), "wrong_code");
  assert.equal(evaluateOtpAttempt(first, "email", "member@example.test", "012345", now + OTP_RESEND_MS, testSecret), "verified");

  let stored: OtpRecord | undefined = first;
  const successful = stored && evaluateOtpAttempt(stored, "email", "member@example.test", "012345", now + OTP_RESEND_MS, testSecret);
  if (successful === "verified") stored = undefined;
  assert.equal(stored, undefined);
  assert.equal(stored ? evaluateOtpAttempt(stored, "email", "member@example.test", "012345", now, testSecret) : "no_code", "no_code");
});

test("resend cooldown is calculated across reloads and expires at its boundary", () => {
  const sentAt = new Date(now).toISOString();
  assert.equal(otpResendSeconds(sentAt, now), OTP_RESEND_MS / 1000);
  assert.equal(otpResendSeconds(sentAt, now + 59_100), 1);
  assert.equal(otpResendSeconds(sentAt, now + OTP_RESEND_MS), 0);
});

test("mock provider is enabled only with explicit development configuration", () => {
  assert.equal(isDevelopmentMockOtpEnabled({ NODE_ENV: "development", DEV_MOCK_OTP_ENABLED: "true" }), true);
  assert.equal(isMockOtpProviderEnabled("demo", { NODE_ENV: "production", DEV_MOCK_OTP_ENABLED: "true" }), false);
  assert.equal(isMockOtpProviderEnabled("demo", { NODE_ENV: "test", DEV_MOCK_OTP_ENABLED: "true" }), false);
  assert.equal(isMockOtpProviderEnabled("demo", { NODE_ENV: "development", DEV_MOCK_OTP_ENABLED: "false" }), false);
  assert.equal(isMockOtpProviderEnabled("http", { NODE_ENV: "development", DEV_MOCK_OTP_ENABLED: "true" }), false);
});

test("OTP verification endpoint rejects unauthenticated requests", async () => {
  const state: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      state.status = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as Response;
  let nextCalled = false;
  const next = (() => { nextCalled = true; }) as NextFunction;

  await requireAuth({ headers: {} } as AuthenticatedRequest, response, next);
  assert.equal(state.status, 401);
  assert.equal(nextCalled, false);
});
