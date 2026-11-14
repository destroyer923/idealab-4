import mongoose, { Schema } from "mongoose";

const verificationSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    phone: { type: Schema.Types.Mixed, default: () => ({ status: "not_started", masked: "", attempts: 0 }) },
    email: { type: Schema.Types.Mixed, default: () => ({ status: "not_started", masked: "", attempts: 0 }) },
    business: { type: Schema.Types.Mixed, default: () => ({ status: "not_started" }) },
    identity: { type: Schema.Types.Mixed, default: () => ({ status: "not_started" }) },
    completedExchanges: { type: Number, default: 0 },
    trust: { type: String, enum: ["new", "contact_verified", "business_verified", "identity_verified"], default: "new" },
    updatedAt: { type: String, required: true },
    otpPhone: { type: Schema.Types.Mixed, default: undefined, select: false },
    otpEmail: { type: Schema.Types.Mixed, default: undefined, select: false },
  },
  { timestamps: false },
);

const verifyEventSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    actorId: { type: String, required: true },
    type: { type: String, required: true },
    key: { type: String, required: true },
    vars: { type: Schema.Types.Mixed, default: undefined },
    body: { type: String, default: undefined },
    createdAt: { type: String, required: true },
  },
  { timestamps: false },
);

const verifyConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "platform" },
    phone: { type: Schema.Types.Mixed, default: () => ({ channel: "phone", type: "none", endpoint: "", apiToken: "", label: "" }) },
    email: { type: Schema.Types.Mixed, default: () => ({ channel: "email", type: "none", endpoint: "", apiToken: "", label: "" }) },
    identity: { type: Schema.Types.Mixed, default: () => ({ channel: "identity", type: "manual", endpoint: "", apiToken: "", label: "Manual review" }) },
    requiredBusinessCategories: { type: [String], default: [] },
  },
  { timestamps: false },
);

export interface VerificationRecord {
  userId: string;
  phone: Record<string, unknown> & { status: string; masked?: string; attempts?: number; lastSentAt?: string };
  email: Record<string, unknown> & { status: string; masked?: string; attempts?: number; lastSentAt?: string };
  business: Record<string, unknown> & { status: string };
  identity: Record<string, unknown> & { status: string };
  completedExchanges: number;
  trust: "new" | "contact_verified" | "business_verified" | "identity_verified";
  updatedAt: string;
  otpPhone?: OtpRecord;
  otpEmail?: OtpRecord;
}

export interface OtpRecord {
  destinationHash: string;
  otpHash: string;
  salt: string;
  expiresAt: string;
  attempts: number;
  attemptsAt: number[];
  createdAt: string;
  sentAt: string;
}

export const VerificationModel =
  mongoose.models.SkillSwapVerification ?? mongoose.model("SkillSwapVerification", verificationSchema);
export const VerifyEventModel =
  mongoose.models.SkillSwapVerifyEvent ?? mongoose.model("SkillSwapVerifyEvent", verifyEventSchema);
export const VerifyConfigModel =
  mongoose.models.SkillSwapVerifyConfig ?? mongoose.model("SkillSwapVerifyConfig", verifyConfigSchema);
