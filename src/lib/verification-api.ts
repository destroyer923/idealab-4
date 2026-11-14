import { ApiError } from "./db";
import type { Key } from "@/locales/en";
import { getLang, translate } from "./i18n";
import type {
  BusinessEvidence, CheckStatus, IdentitySubmission, ProviderConfig, TrustTier, Verification, VerifyConfig, VerifyEvent,
} from "./types";
import type { Eligibility } from "./api";
import type { ID, Listing, PublicVerification, Vars } from "./types";

const API_BASE_URL =
  (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL?.replace(/\/+$/, "") ||
  "http://localhost:5000";
const AUTH_TOKEN_KEY = "skillswap-rural.auth-token.v1";

async function request<T>(path: string, method = "GET", body?: unknown, authenticated = true): Promise<T> {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (authenticated && !token) throw new ApiError("err.unauthenticated", "unauthenticated");
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/verification${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError("err.generic", "network_error");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("err.generic", "invalid_server_response");
  }
  if (!response.ok) {
    const result = typeof payload === "object" && payload !== null
      ? payload as { code?: unknown; message?: unknown; vars?: unknown }
      : {};
    const vars = typeof result.vars === "object" && result.vars !== null
      ? result.vars as Record<string, string | number>
      : undefined;
    if (result.message === "verify.err.publishBlocked" && typeof vars?.steps === "string") {
      vars.steps = vars.steps.split(", ").map((key) => translate(key as Key, undefined, getLang())).join(", ");
    }
    throw new ApiError(
      typeof result.message === "string" ? result.message : "err.generic",
      typeof result.code === "string" ? result.code : "server_error",
      vars,
    );
  }
  return payload as T;
}

export interface VerificationView {
  verification: Verification;
  email: string;
  phoneConfigured: boolean;
  emailConfigured: boolean;
  contactVerified: boolean;
  identityAvailable: boolean;
  identityType: VerifyConfig["identity"]["type"];
  mockOtpEnabled: boolean;
  requiredBusinessCategories: string[];
  eligibility: Eligibility;
  provider: VerifyConfig;
  reviewer: boolean;
}

export async function getVerification(): Promise<VerificationView> {
  return request("/me");
}

export async function getPublicVerification(userId: ID): Promise<PublicVerification> {
  return request(`/public/${encodeURIComponent(userId)}`, "GET", undefined, false);
}

export async function isReviewer(): Promise<boolean> {
  return (await getVerification()).reviewer;
}

export async function getPublishEligibility(businessClaimed?: boolean, category?: string): Promise<Eligibility> {
  const params = new URLSearchParams();
  if (businessClaimed) params.set("businessClaimed", "true");
  if (category) params.set("category", category);
  return request(`/eligibility?${params.toString()}`);
}

export async function getVerifyEvents(limit = 30): Promise<VerifyEvent[]> {
  return request(`/events?limit=${encodeURIComponent(String(limit))}`);
}

export async function requestVerificationCode(channel: "phone" | "email", destination: string): Promise<{
  masked: string;
  delivered: boolean;
  channel: "phone" | "email";
  mock: boolean;
}> {
  return request(`/otp/${channel}`, "POST", { destination });
}

export async function verifyContactCode(channel: "phone" | "email", code: string, destination: string) {
  return request(`/otp/${channel}/verify`, "POST", { code, destination });
}

export async function submitBusinessEvidence(evidence: BusinessEvidence) {
  return request("/business", "POST", evidence);
}

export type BusinessEvidenceView =
  | {
      reviewer: false;
      evidence: BusinessEvidence | null;
      status: CheckStatus;
      submittedAt?: string;
      rejectionReason?: Key;
      rejectionVars?: Vars;
      reviewedAt?: string;
    }
  | {
      reviewer: true;
      submissions: Array<{
        userId: ID;
        status: CheckStatus;
        submittedAt?: string;
        evidence?: BusinessEvidence;
        rejectionReason?: Key;
        rejectionVars?: Vars;
        ownerName: string;
      }>;
    };

export async function getBusinessEvidence(): Promise<BusinessEvidenceView> {
  return request("/business");
}

export async function reviewBusinessEvidence(userId: ID, decision: "approve" | "reject", reason?: string) {
  return request(`/business/${encodeURIComponent(userId)}/review`, "POST", { decision, reason });
}

export async function submitIdentityVerification(input: { fullName: string; idReference: string; note: string }) {
  return request("/identity", "POST", input);
}

export type IdentityEvidenceView =
  | {
      reviewer: false;
      submission: IdentitySubmission | null;
      status: CheckStatus;
      rejectionReason?: Key;
      rejectionVars?: Vars;
      reviewedAt?: string;
    }
  | {
      reviewer: true;
      submissions: Array<{
        userId: ID;
        status: CheckStatus;
        submittedAt?: string;
        submission?: IdentitySubmission;
        ownerName: string;
      }>;
    };

export async function getIdentityEvidence(): Promise<IdentityEvidenceView> {
  return request("/identity");
}

export async function reviewIdentityVerification(userId: ID, decision: "approve" | "reject", reason?: string) {
  return request(`/identity/${encodeURIComponent(userId)}/review`, "POST", { decision, reason });
}

export async function updateProviderConfig(channel: "phone" | "email", config: Partial<ProviderConfig>) {
  return request(`/provider/${channel}`, "PATCH", {
    ...config,
    keepExistingToken: !config.apiToken,
  });
}

export async function getAdminReviewQueue() {
  return request<{
    pending: Array<{
      userId: ID; type: "business" | "identity"; submittedAt?: string; reviewedAt?: string;
      status: string; ownerName: string; ownerUsername?: string; evidence?: BusinessEvidence;
      submission?: IdentitySubmission; rejectionReason?: string;
    }>;
    all: Array<{
      userId: ID; type: "business" | "identity"; submittedAt?: string; reviewedAt?: string;
      status: string; ownerName: string; ownerUsername?: string; evidence?: BusinessEvidence;
      submission?: IdentitySubmission; rejectionReason?: string;
    }>;
  }>("/admin/reviews");
}

export async function getAdminReviewHistory(limit = 50): Promise<Array<VerifyEvent & { ownerName: string }>> {
  return request(`/admin/review-history?limit=${encodeURIComponent(String(limit))}`);
}

export async function getListingReviewQueue(): Promise<Array<{
  listing: Listing;
  ownerName: string;
  ownerUsername: string;
  contactVerified: boolean;
  businessVerified: boolean;
}>> {
  return request("/listings/queue");
}

export async function reviewListing(listingId: ID, decision: "approve" | "reject", reason?: string) {
  return request(`/listings/${encodeURIComponent(listingId)}/review`, "POST", { decision, reason });
}

export { type TrustTier };
