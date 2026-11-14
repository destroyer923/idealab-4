import assert from "node:assert/strict";
import type { NextFunction, Response } from "express";
import { test } from "node:test";
import { requireAdmin, type AuthenticatedRequest } from "../src/middleware/auth.js";
import { isVerificationAdmin, newVerificationRecord, trustOf, verificationEligibility } from "../src/verification/policy.js";

test("unverified account cannot publish a need", () => {
  const record = newVerificationRecord("member-1");
  const eligibility = verificationEligibility(record, []);
  assert.equal(eligibility.ok, false);
  assert.deepEqual(eligibility.missing.map((step) => step.channel), ["phone", "email", "identity"]);
});

test("verified contacts and identity allow publishing without business declaration", () => {
  const record = {
    ...newVerificationRecord("member-2"),
    phone: { status: "verified" },
    email: { status: "verified" },
    identity: { status: "verified" },
  };
  assert.equal(verificationEligibility(record, []).ok, true);
});

test("verified phone and email do not approve identity or bypass identity eligibility", () => {
  const record = {
    ...newVerificationRecord("member-contact-only"),
    phone: { status: "verified" },
    email: { status: "verified" },
  };
  const eligibility = verificationEligibility(record, []);

  assert.equal(record.identity.status, "not_started");
  assert.equal(trustOf(record), "contact_verified");
  assert.equal(eligibility.ok, false);
  assert.deepEqual(eligibility.missing.map((step) => step.channel), ["identity"]);
});

test("business claim/category requires approved business verification", () => {
  const record = {
    ...newVerificationRecord("member-3"),
    phone: { status: "verified" },
    email: { status: "verified" },
    identity: { status: "verified" },
  };
  const claimed = verificationEligibility(record, [], { businessClaimed: true });
  assert.equal(claimed.ok, false);
  assert.equal(claimed.missing[0]?.channel, "business");
  record.business = { status: "verified" };
  assert.equal(verificationEligibility(record, ["agriculture"], { category: "agriculture" }).ok, true);
});

test("only the authoritative admin role is authorized to review verification", () => {
  assert.equal(isVerificationAdmin("admin"), true);
  assert.equal(isVerificationAdmin("reviewer"), false);
  assert.equal(isVerificationAdmin("member"), false);

  const resState: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      resState.status = code;
      return this;
    },
    json(body: unknown) {
      resState.body = body;
      return this;
    },
  } as Response;
  let nextCalled = false;
  const next = (() => { nextCalled = true; }) as NextFunction;

  requireAdmin({ user: { id: "member-4", email: "member@example.test", role: "member", status: "active" } } as AuthenticatedRequest, response, next);
  assert.equal(resState.status, 403);
  assert.equal(nextCalled, false);

  requireAdmin({ user: { id: "admin-1", email: "admin@example.test", role: "admin", status: "active" } } as AuthenticatedRequest, response, next);
  assert.equal(nextCalled, true);
});
