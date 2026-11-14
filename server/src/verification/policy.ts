import type { VerificationRecord } from "../models/Verification.js";

export type VerificationStatus = "not_started" | "pending" | "verified" | "rejected" | "unavailable";
export type VerificationChannel = "phone" | "email" | "identity" | "business";

export interface VerificationStep {
  channel: VerificationChannel;
  key: string;
  status: VerificationStatus;
  reason?: string;
  vars?: Record<string, string | number>;
  businessRequired?: boolean;
}

export interface Eligibility {
  ok: boolean;
  required: VerificationStep[];
  missing: VerificationStep[];
}

export function newVerificationRecord(userId: string) {
  const updatedAt = new Date().toISOString();
  return {
    userId,
    phone: { status: "not_started" as VerificationStatus, masked: "", attempts: 0 },
    email: { status: "not_started" as VerificationStatus, masked: "", attempts: 0 },
    business: { status: "not_started" as VerificationStatus },
    identity: { status: "not_started" as VerificationStatus },
    completedExchanges: 0,
    trust: "new" as const,
    updatedAt,
  };
}

export function verificationEligibility(
  verification: { phone: { status: string }; email: { status: string }; identity: { status: string }; business: { status: string } },
  requiredBusinessCategories: string[],
  options: { businessClaimed?: boolean; category?: string } = {},
): Eligibility {
  const businessRequired = !!options.businessClaimed || requiredBusinessCategories.includes(options.category ?? "");
  const steps: VerificationStep[] = [
    { channel: "phone", key: "verify.step.phone", status: statusOf(verification.phone.status) },
    { channel: "email", key: "verify.step.email", status: statusOf(verification.email.status) },
    { channel: "identity", key: "verify.step.identity", status: statusOf(verification.identity.status) },
    {
      channel: "business",
      key: "verify.step.business",
      status: statusOf(verification.business.status),
      businessRequired,
    },
  ];
  const required = steps.filter((step) => step.channel !== "business" || step.businessRequired);
  const missing = required.filter((step) => step.status !== "verified");
  return { ok: missing.length === 0, required, missing };
}

function statusOf(status: string): VerificationStatus {
  return ["not_started", "pending", "verified", "rejected", "unavailable"].includes(status)
    ? status as VerificationStatus
    : "not_started";
}

export function isVerificationAdmin(role: string | undefined): boolean {
  return role === "admin";
}

export function trustOf(record: Pick<VerificationRecord, "phone" | "email" | "business" | "identity">): VerificationRecord["trust"] {
  if (record.identity.status === "verified") return "identity_verified";
  if (record.business.status === "verified") return "business_verified";
  if (record.phone.status === "verified" || record.email.status === "verified") return "contact_verified";
  return "new";
}
