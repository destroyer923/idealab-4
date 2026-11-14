import { Router } from "express";
import { z } from "zod";
import { ListingModel } from "../models/Listing.js";
import { UserModel } from "../models/User.js";
import { OtpRecord, VerificationModel, VerificationRecord, VerifyConfigModel, VerifyEventModel } from "../models/Verification.js";
import { AuthenticatedRequest, requireAdmin, requireAuth } from "../middleware/auth.js";
import {
  createOtpRecord, evaluateOtpAttempt, generateOtpCode, hashOtpDestination, isDevelopmentMockOtpEnabled,
  isMockOtpProviderEnabled, normalizeOtpDestination, OTP_MAX_ATTEMPTS, OTP_MAX_PER_HOUR, OTP_TTL_MS, otpResendSeconds,
} from "../verification/otp.js";
import { isVerificationAdmin, newVerificationRecord, trustOf, verificationEligibility } from "../verification/policy.js";

const router = Router();
const rejectSchema = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(500).optional() }).strict();
const businessSchema = z.object({
  businessType: z.enum(["farmer", "artisan", "seller", "designer", "transporter", "trader", "service", "other"]),
  businessName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(80),
  udyamNumber: z.string().trim().max(10).optional().default(""),
  location: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(600),
  documents: z.array(z.object({
    title: z.string().trim().min(1).max(80),
    type: z.enum(["photo", "text", "link"]),
    value: z.string().trim().max(4000),
  }).strict()).max(6).optional().default([]),
}).strict();
const identitySchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  idReference: z.string().trim().min(3).max(40),
  note: z.string().trim().min(10).max(500),
}).strict();
const providerSchema = z.object({
  type: z.enum(["none", "http", "demo"]),
  endpoint: z.string().max(200).optional(),
  apiToken: z.string().max(200).optional(),
  keepExistingToken: z.boolean().optional(),
  label: z.string().max(60).optional(),
}).strict();

type Channel = "phone" | "email";
type Provider = { channel: Channel; type: "none" | "http" | "demo"; endpoint: string; apiToken: string; label: string };

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return `${value.slice(0, Math.max(0, value.length - 4)).replace(/\d/g, "*")}${digits.slice(-4)}`;
}

function maskEmail(value: string): string {
  const [name, domain] = value.split("@");
  return `${name.slice(0, 1)}${"*".repeat(Math.max(2, name.length - 1))}@${domain}`;
}

function maskIdentityReference(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 4 ? "****" : `${trimmed.slice(0, 2)}***${trimmed.slice(-4)}`;
}

async function getVerification(userId: string): Promise<VerificationRecord> {
  const existing = await VerificationModel.findOne({ userId }).lean<VerificationRecord>();
  if (existing) return existing;
  const record = newVerificationRecord(userId);
  try {
    const created = await VerificationModel.findOneAndUpdate(
      { userId },
      { $setOnInsert: record },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean<VerificationRecord>();
    if (!created) throw new Error("Verification record could not be initialized");
    return created;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      const concurrent = await VerificationModel.findOne({ userId }).lean<VerificationRecord>();
      if (concurrent) return concurrent;
    }
    throw error;
  }
}

async function getConfig() {
  try {
    return await VerifyConfigModel.findOneAndUpdate(
      { key: "platform" },
      { $setOnInsert: { key: "platform" } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      const concurrent = await VerifyConfigModel.findOne({ key: "platform" }).lean();
      if (concurrent) return concurrent;
    }
    throw error;
  }
}

function publicProvider(config: Record<string, unknown>, channel: Channel) {
  const value = config[channel] as Provider | undefined;
  return {
    channel,
    type: value?.type ?? "none",
    endpoint: value?.endpoint ?? "",
    apiToken: "",
    label: value?.label ?? "",
  };
}

function publicConfig(config: Record<string, unknown>) {
  const identity = config.identity as Record<string, unknown> | undefined;
  return {
    phone: publicProvider(config, "phone"),
    email: publicProvider(config, "email"),
    identity: {
      channel: "identity" as const,
      type: identity?.type === "none" || identity?.type === "http" ? identity.type : "manual",
      endpoint: typeof identity?.endpoint === "string" ? identity.endpoint : "",
      apiToken: "",
      label: typeof identity?.label === "string" ? identity.label : "Manual review",
    },
    requiredBusinessCategories: Array.isArray(config.requiredBusinessCategories)
      ? config.requiredBusinessCategories.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function updateTrust(record: VerificationRecord) {
  record.trust = trustOf(record);
  record.updatedAt = new Date().toISOString();
}

async function addEvent(userId: string, actorId: string, type: string, key: string, vars?: Record<string, string | number>) {
  await VerifyEventModel.create({ id: crypto.randomUUID(), userId, actorId, type, key, vars, createdAt: new Date().toISOString() });
}

function authUser(req: AuthenticatedRequest) {
  return req.user!;
}

function statusCode(error: unknown): number {
  return error instanceof z.ZodError ? 400 : 500;
}

router.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = authUser(req);
    const [verification, config] = await Promise.all([getVerification(user.id), getConfig()]);
    const safeConfig = publicConfig(config ?? {});
    res.json({
      verification,
      email: user.email,
      phoneConfigured: safeConfig.phone.type !== "none",
      emailConfigured: safeConfig.email.type !== "none",
      contactVerified: verification.phone.status === "verified" || verification.email.status === "verified",
      identityAvailable: safeConfig.identity.type !== "none",
      identityType: safeConfig.identity.type,
      mockOtpEnabled: isDevelopmentMockOtpEnabled(process.env),
      requiredBusinessCategories: safeConfig.requiredBusinessCategories,
      eligibility: verificationEligibility(verification, safeConfig.requiredBusinessCategories),
      provider: safeConfig,
      reviewer: isVerificationAdmin(user.role),
    });
  } catch (error) {
    console.error("Get verification error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.get("/eligibility", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const verification = await getVerification(authUser(req).id);
    const config = await getConfig();
    const safeConfig = publicConfig(config ?? {});
    const businessClaimed = req.query.businessClaimed === "true";
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    res.json(verificationEligibility(verification, safeConfig.requiredBusinessCategories, { businessClaimed, category }));
  } catch (error) {
    console.error("Get publish eligibility error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.get("/events", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsedLimit = Number(req.query.limit);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), 100) : 30;
    const events = await VerifyEventModel.find({ userId: authUser(req).id }).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(events);
  } catch (error) {
    console.error("Get verification events error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.get("/admin/reviews", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const records = await VerificationModel.find({
      $or: [
        { "business.status": { $in: ["pending", "verified", "rejected"] } },
        { "identity.status": { $in: ["pending", "verified", "rejected"] } },
      ],
    }).lean<VerificationRecord[]>();
    const owners = await UserModel.find({ id: { $in: records.map((item) => item.userId) } }).select("id profile").lean();
    const profiles = new Map(owners.map((owner) => [owner.id, owner.profile]));
    const submissions = records.flatMap((record) => {
      const profile = profiles.get(record.userId);
      const owner = { ownerName: profile?.fullName ?? "—", ownerUsername: profile?.username ?? "" };
      return [
        ...(["pending", "verified", "rejected"].includes(record.business.status) && record.business.evidence
          ? [{ userId: record.userId, type: "business" as const, submittedAt: record.business.submittedAt ?? record.business.reviewedAt, reviewedAt: record.business.reviewedAt, status: record.business.status, evidence: record.business.evidence, rejectionReason: (record.business.rejectionVars as { reason?: string } | undefined)?.reason, ...owner }]
          : []),
        ...(["pending", "verified", "rejected"].includes(record.identity.status) && record.identity.submission
          ? [{ userId: record.userId, type: "identity" as const, submittedAt: record.identity.submittedAt ?? record.identity.reviewedAt, reviewedAt: record.identity.reviewedAt, status: record.identity.status, submission: record.identity.submission, rejectionReason: (record.identity.rejectionVars as { reason?: string } | undefined)?.reason, ...owner }]
          : []),
      ];
    }).sort((a, b) => String(b.submittedAt ?? "").localeCompare(String(a.submittedAt ?? "")));
    res.json({ pending: submissions.filter((item) => item.status === "pending"), all: submissions });
  } catch (error) {
    console.error("Get admin verification queue error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.get("/admin/review-history", requireAuth, requireAdmin, async (req, res) => {
  try {
    const parsedLimit = Number(req.query.limit);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), 100) : 50;
    const events = await VerifyEventModel.find({ type: { $in: ["business_reviewed", "identity_reviewed"] } })
      .sort({ createdAt: -1 }).limit(limit).lean();
    const owners = await UserModel.find({ id: { $in: events.map((event) => event.userId) } }).select("id profile.fullName").lean();
    const profiles = new Map(owners.map((owner) => [owner.id, owner.profile?.fullName ?? "—"]));
    res.json(events.map((event) => ({ ...event, ownerName: profiles.get(event.userId) ?? "—" })));
  } catch (error) {
    console.error("Get admin verification history error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.get("/admin/overview", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [users, verifications, listings] = await Promise.all([
      UserModel.countDocuments(),
      VerificationModel.find().lean<VerificationRecord[]>(),
      ListingModel.countDocuments({ deletedAt: { $exists: false } }),
    ]);
    res.json({
      totalUsers: users,
      pending: verifications.filter((record) => record.business.status === "pending" || record.identity.status === "pending").length,
      approved: verifications.filter((record) => record.business.status === "verified" || record.identity.status === "verified").length,
      rejected: verifications.filter((record) => record.business.status === "rejected" || record.identity.status === "rejected").length,
      bizPending: verifications.filter((record) => record.business.status === "pending").length,
      idPending: verifications.filter((record) => record.identity.status === "pending").length,
      totalListings: listings,
    });
  } catch (error) {
    console.error("Get admin verification overview error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.get("/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const parsedLimit = Number(req.query.limit);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), 200) : 100;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter = query
      ? { $or: [{ email: { $regex: escaped, $options: "i" } }, { "profile.fullName": { $regex: escaped, $options: "i" } }, { "profile.username": { $regex: escaped, $options: "i" } }] }
      : {};
    const [users, total] = await Promise.all([
      UserModel.find(filter).select("id email role status createdAt profile").sort({ createdAt: -1 }).limit(limit).lean(),
      UserModel.countDocuments(filter),
    ]);
    const userIds = users.map((user) => user.id);
    const [verificationRecords, listings] = await Promise.all([
      VerificationModel.find({ userId: { $in: userIds } }).lean<VerificationRecord[]>(),
      ListingModel.find({ ownerId: { $in: userIds }, deletedAt: { $exists: false } }).select("ownerId kind status").lean(),
    ]);
    const verifications = new Map(verificationRecords.map((record) => [record.userId, record]));
    const listingsByOwner = new Map<string, typeof listings>();
    for (const listing of listings) {
      const ownerListings = listingsByOwner.get(listing.ownerId) ?? [];
      ownerListings.push(listing);
      listingsByOwner.set(listing.ownerId, ownerListings);
    }
    res.json({
      users: users.map((user) => {
        const verification = verifications.get(user.id);
        const ownerListings = listingsByOwner.get(user.id) ?? [];
        return {
          userId: user.id,
          fullName: user.profile?.fullName ?? "—",
          username: user.profile?.username ?? "",
          email: user.email,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt.toISOString(),
          phoneVerified: verification?.phone.status === "verified",
          emailVerified: verification?.email.status === "verified",
          businessVerified: verification?.business.status === "verified",
          identityVerified: verification?.identity.status === "verified",
          trust: verification?.trust ?? "new",
          listings: ownerListings.length,
          activeOffers: ownerListings.filter((listing) => listing.kind === "offer" && listing.status === "active").length,
          openNeeds: ownerListings.filter((listing) => listing.kind === "need" && listing.status === "open").length,
        };
      }),
      total,
    });
  } catch (error) {
    console.error("Get admin verification users error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.patch("/admin/users/:userId/status", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = z.object({
      status: z.enum(["active", "suspended"]),
      reason: z.string().trim().max(500).optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success || (parsed.data.status === "suspended" && (parsed.data.reason?.length ?? 0) < 5)) {
      res.status(400).json({ code: "invalid_status", message: "verify.err.rejectReason" });
      return;
    }
    const userId = routeParam(req.params.userId);
    const user = await UserModel.findOne({ id: userId });
    if (!user) {
      res.status(404).json({ code: "not_found", message: "err.memberGone" });
      return;
    }
    if (user.role === "admin") {
      res.status(403).json({ code: "forbidden", message: "verify.err.cannotSuspendAdmin" });
      return;
    }
    if (user.status === parsed.data.status) {
      res.status(409).json({ code: "unchanged", message: "verify.err.statusUnchanged" });
      return;
    }
    user.status = parsed.data.status;
    await user.save();
    const actorId = authUser(req).id;
    const suspended = parsed.data.status === "suspended";
    await addEvent(userId, actorId, "role_changed", suspended ? "verify.ev.accountSuspended" : "verify.ev.accountActivated", {
      reason: parsed.data.reason?.trim() ?? "",
    });
    res.json({ status: user.status });
  } catch (error) {
    console.error("Update admin account status error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.post("/otp/:channel", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const channel = req.params.channel;
    if (channel !== "phone" && channel !== "email") {
      res.status(400).json({ code: "invalid_channel", message: "verify.err.providerType" });
      return;
    }
    const destinationRaw = typeof req.body?.destination === "string" ? req.body.destination : "";
    const destination = normalizeOtpDestination(channel, destinationRaw);
    const user = authUser(req);
    if (!destination || (channel === "email" && destination !== user.email.toLowerCase())) {
      res.status(400).json({ code: "invalid_destination", message: "verify.err.missingDestination" });
      return;
    }
    if (channel === "phone" && !/^\+?[1-9]\d{7,14}$/.test(destination)) {
      res.status(400).json({ code: "invalid_destination", message: "verify.err.phoneFormat" });
      return;
    }
    if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
      res.status(400).json({ code: "invalid_destination", message: "verify.err.emailFormat" });
      return;
    }

    const key = channel === "phone" ? "otpPhone" : "otpEmail";
    const record = await VerificationModel.findOne({ userId: user.id }).select(`+${key}`).lean<VerificationRecord>();
    const verification = record ?? await getVerification(user.id);
    const contact = verification[channel];
    if (contact.status === "verified") {
      res.status(409).json({ code: "already_verified", message: "verify.err.alreadyVerified" });
      return;
    }
    const nowMs = Date.now();
    const resendWait = otpResendSeconds(typeof contact.lastSentAt === "string" ? contact.lastSentAt : undefined, nowMs);
    if (resendWait > 0) {
      res.status(429).json({
        code: "rate_limited",
        message: "verify.err.resendWait",
        vars: { seconds: resendWait },
      });
      return;
    }
    const recent = await VerifyEventModel.countDocuments({ userId: user.id, type: "otp_requested", createdAt: { $gt: new Date(nowMs - 3_600_000).toISOString() }, "vars.channel": channel });
    if (recent >= OTP_MAX_PER_HOUR) {
      res.status(429).json({ code: "rate_limited", message: "verify.err.resendLimit", vars: { max: OTP_MAX_PER_HOUR } });
      return;
    }
    const config = await getConfig();
    const provider = config?.[channel] as Provider | undefined;
    if (!provider || provider.type === "none" || (provider.type === "demo" && !isMockOtpProviderEnabled(provider.type, process.env))) {
      res.status(503).json({ code: "provider_unconfigured", message: "verify.provider.unconfigured" });
      return;
    }

    const code = generateOtpCode();
    const now = new Date(nowMs).toISOString();
    const masked = channel === "phone" ? maskPhone(destination) : maskEmail(destination);
    if (provider.type === "http") {
      const response = await fetch(provider.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiToken}`, "x-channel": channel },
        body: JSON.stringify({ destination, code }),
      }).catch(() => null);
      if (!response?.ok) {
        const attemptedAt = new Date().toISOString();
        await VerificationModel.updateOne(
          { userId: user.id },
          {
            $set: { [channel]: { status: "pending", masked, attempts: 0, note: "verify.provider.network" }, updatedAt: attemptedAt },
            $unset: { [key]: 1 },
          },
          { upsert: true },
        );
        await addEvent(user.id, user.id, "otp_failed_send", "verify.provider.network", { destination: masked, channel });
        res.status(502).json({ code: "provider_error", message: "verify.provider.network" });
        return;
      }
    }
    const otp = createOtpRecord(channel, destination, code, nowMs, process.env.JWT_SECRET ?? "");
    contact.status = "pending";
    contact.masked = masked;
    contact.attempts = 0;
    contact.lastSentAt = now;
    delete contact.note;
    updateTrust(verification);
    await VerificationModel.updateOne({ userId: user.id }, { $set: { [channel]: contact, [key]: otp, trust: verification.trust, updatedAt: now } }, { upsert: true });
    await addEvent(user.id, user.id, "otp_requested", "verify.ev.otpRequested", { destination: masked, ttl: OTP_TTL_MS / 60_000, channel });
    if (provider.type === "demo") {
      console.info(`[DEV OTP] channel=${channel} userId=${user.id} destination=${masked} code=${code} expiresAt=${otp.expiresAt}`);
    }
    res.json({ masked, delivered: provider.type === "http", channel, mock: provider.type === "demo" });
  } catch (error) {
    console.error("Request verification code error:", error);
    res.status(statusCode(error)).json({ code: "server_error", message: "err.generic" });
  }
});

router.post("/otp/:channel/verify", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const channel = req.params.channel;
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    const user = authUser(req);
    const destinationRaw = typeof req.body?.destination === "string" ? req.body.destination : "";
    if ((channel !== "phone" && channel !== "email") || !/^\d{6}$/.test(code)) {
      res.status(400).json({ code: "invalid_code", message: "verify.err.codeFormat" });
      return;
    }
    const destination = normalizeOtpDestination(channel, destinationRaw);
    if (channel === "email" && destination !== user.email.toLowerCase()) {
      res.status(400).json({ code: "invalid_destination", message: "verify.err.missingDestination" });
      return;
    }
    if (
      (channel === "phone" && !/^\+?[1-9]\d{7,14}$/.test(destination)) ||
      (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination))
    ) {
      res.status(400).json({ code: "invalid_destination", message: channel === "phone" ? "verify.err.phoneFormat" : "verify.err.emailFormat" });
      return;
    }
    const userId = user.id;
    const key = channel === "phone" ? "otpPhone" : "otpEmail";
    const verification = await VerificationModel.findOne({ userId }).select(`+${key}`);
    const otp = verification?.get(key) as OtpRecord | undefined;
    if (!verification || !otp) {
      res.status(404).json({ code: "no_code", message: "verify.err.noCode" });
      return;
    }
    const now = Date.now();
    const secret = process.env.JWT_SECRET ?? "";
    const destinationHash = hashOtpDestination(channel, destination, secret);
    const result = evaluateOtpAttempt(otp, channel, destination, code, now, secret);
    const otpFilter = {
      userId,
      [`${key}.otpHash`]: otp.otpHash,
      [`${key}.destinationHash`]: destinationHash,
      [`${key}.attempts`]: result === "wrong_code" || result === "attempts_exhausted" ? otp.attempts - 1 : otp.attempts,
    };
    if (result === "destination_mismatch") {
      res.status(400).json({ code: "invalid_destination", message: "verify.err.missingDestination" });
      return;
    }
    if (result === "expired") {
      const removed = await VerificationModel.updateOne(otpFilter, { $unset: { [key]: 1 } });
      if (removed.modifiedCount !== 1) {
        res.status(409).json({ code: "otp_replaced", message: "verify.err.noCode" });
        return;
      }
      res.status(410).json({ code: "code_expired", message: "verify.err.codeExpired" });
      return;
    }
    if (result === "attempts_exhausted" || result === "wrong_code") {
      const contact: Record<string, unknown> = { ...(verification.get(channel) as Record<string, unknown>), attempts: otp.attempts };
      if (result === "attempts_exhausted") {
        contact.status = "rejected";
        contact.note = "verify.err.attemptsExhausted";
      }
      const updated = verification.toObject() as VerificationRecord;
      Object.assign(updated[channel], contact);
      updateTrust(updated);
      const update = await VerificationModel.updateOne(
        otpFilter,
        {
          $set: { [channel]: contact, trust: updated.trust, updatedAt: updated.updatedAt },
          ...(result === "attempts_exhausted" ? { $unset: { [key]: 1 } } : { $push: { [`${key}.attemptsAt`]: now }, $inc: { [`${key}.attempts`]: 1 } }),
        },
      );
      if (update.modifiedCount !== 1) {
        res.status(409).json({ code: "otp_replaced", message: "verify.err.noCode" });
        return;
      }
      if (result === "attempts_exhausted") {
        res.status(429).json({ code: "attempts_exhausted", message: "verify.err.attemptsExhausted" });
        return;
      }
      res.status(400).json({ code: "wrong_code", message: "verify.err.codeWrong", vars: { remaining: OTP_MAX_ATTEMPTS - otp.attempts } });
      return;
    }
    const contact: Record<string, unknown> = { ...(verification.get(channel) as Record<string, unknown>), status: "verified", at: new Date(now).toISOString() };
    delete contact.note;
    const updated = verification.toObject() as VerificationRecord;
    Object.assign(updated[channel], contact);
    updateTrust(updated);
    const update = await VerificationModel.updateOne(
      otpFilter,
      { $set: { [channel]: contact, trust: updated.trust, updatedAt: updated.updatedAt }, $unset: { [key]: 1 } },
    );
    if (update.modifiedCount !== 1) {
      res.status(409).json({ code: "otp_replaced", message: "verify.err.noCode" });
      return;
    }
    await addEvent(userId, userId, "otp_verified", channel === "phone" ? "verify.ev.phoneVerified" : "verify.ev.emailVerified", { destination: String(contact.masked ?? "") });
    res.json(contact);
  } catch (error) {
    console.error("Verify contact code error:", error);
    res.status(statusCode(error)).json({ code: "server_error", message: "err.generic" });
  }
});

router.post("/business", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = businessSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_business_evidence", message: "verify.err.businessName" });
      return;
    }
    const userId = authUser(req).id;
    const verification = await getVerification(userId);
    if (verification.business.status === "verified") {
      res.status(409).json({ code: "already_verified", message: "verify.err.businessVerified" });
      return;
    }
    const udyamNumber = parsed.data.udyamNumber.replace(/\D/g, "");
    if (udyamNumber && !/^\d{10}$/.test(udyamNumber)) {
      res.status(400).json({ code: "invalid_business_evidence", message: "verify.err.udyamFormat" });
      return;
    }
    const evidence = { ...parsed.data, udyamNumber };
    const business = { status: "pending", submittedAt: new Date().toISOString(), evidence };
    const next = { ...verification, business };
    updateTrust(next);
    await VerificationModel.updateOne({ userId }, { $set: { business, trust: next.trust, updatedAt: next.updatedAt } }, { upsert: true });
    await addEvent(userId, userId, "business_submitted", "verify.ev.businessSubmitted", { businessType: evidence.businessType });
    res.json(business);
  } catch (error) {
    console.error("Submit business evidence error:", error);
    res.status(statusCode(error)).json({ code: "server_error", message: "err.generic" });
  }
});

router.get("/business", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = authUser(req);
    if (isVerificationAdmin(user.role)) {
      const pending = await VerificationModel.find({ "business.status": "pending" }).lean<VerificationRecord[]>();
      const owners = await UserModel.find({ id: { $in: pending.map((item) => item.userId) } }).select("id profile").lean();
      const profiles = new Map(owners.map((owner) => [owner.id, owner.profile]));
      res.json({
        reviewer: true,
        submissions: pending.map((item) => ({
          userId: item.userId,
          status: item.business.status,
          submittedAt: item.business.submittedAt,
          evidence: item.business.evidence,
          rejectionReason: item.business.rejectionReason,
          rejectionVars: item.business.rejectionVars,
          ownerName: profiles.get(item.userId)?.fullName ?? "—",
        })),
      });
      return;
    }
    const verification = await getVerification(user.id);
    res.json({
      reviewer: false,
      evidence: verification.business.evidence ?? null,
      status: verification.business.status,
      submittedAt: verification.business.submittedAt,
      rejectionReason: verification.business.rejectionReason,
      rejectionVars: verification.business.rejectionVars,
      reviewedAt: verification.business.reviewedAt,
    });
  } catch (error) {
    console.error("Get business evidence error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.post("/business/:userId/review", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success || (parsed.data.decision === "reject" && (parsed.data.reason?.trim().length ?? 0) < 5)) {
      res.status(400).json({ code: "invalid_review", message: "verify.err.rejectReason" });
      return;
    }
    const userId = routeParam(req.params.userId);
    const verification = await getVerification(userId);
    if (verification.business.status !== "pending") {
      res.status(409).json({ code: "not_pending", message: "verify.err.notPending" });
      return;
    }
    const decision = parsed.data.decision;
    const reason = parsed.data.reason?.trim() ?? "";
    const business = {
      ...verification.business,
      status: decision === "approve" ? "verified" : "rejected",
      reviewedAt: new Date().toISOString(),
      reviewedBy: authUser(req).id,
      ...(decision === "reject" ? { rejectionReason: "verify.business.rejected", rejectionVars: { reason }, evidence: undefined } : {}),
    };
    const next = { ...verification, business };
    updateTrust(next);
    await VerificationModel.updateOne({ userId }, { $set: { business, trust: next.trust, updatedAt: next.updatedAt } });
    await addEvent(userId, authUser(req).id, "business_reviewed", decision === "approve" ? "verify.ev.businessApproved" : "verify.ev.businessRejected", { reason });
    res.json({ status: business.status });
  } catch (error) {
    console.error("Review business evidence error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.post("/identity", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = identitySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_identity_submission", message: "verify.err.identityName" });
      return;
    }
    const userId = authUser(req).id;
    const verification = await getVerification(userId);
    if (verification.identity.status === "verified") {
      res.status(409).json({ code: "already_verified", message: "verify.err.identityVerified" });
      return;
    }
    const config = await getConfig();
    if (publicConfig(config ?? {}).identity.type === "none") {
      res.status(503).json({ code: "identity_unavailable", message: "verify.err.identityUnavailable" });
      return;
    }
    const identity = {
      status: "pending",
      submittedAt: new Date().toISOString(),
      submission: { ...parsed.data, idReference: maskIdentityReference(parsed.data.idReference) },
    };
    const next = { ...verification, identity };
    updateTrust(next);
    await VerificationModel.updateOne({ userId }, { $set: { identity, trust: next.trust, updatedAt: next.updatedAt } }, { upsert: true });
    await addEvent(userId, userId, "identity_submitted", "verify.ev.identitySubmitted");
    res.json(identity);
  } catch (error) {
    console.error("Submit identity verification error:", error);
    res.status(statusCode(error)).json({ code: "server_error", message: "err.generic" });
  }
});

router.get("/identity", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = authUser(req);
    if (isVerificationAdmin(user.role)) {
      const pending = await VerificationModel.find({ "identity.status": "pending" }).lean<VerificationRecord[]>();
      const owners = await UserModel.find({ id: { $in: pending.map((item) => item.userId) } }).select("id profile").lean();
      const profiles = new Map(owners.map((owner) => [owner.id, owner.profile]));
      res.json({
        reviewer: true,
        submissions: pending.map((item) => ({
          userId: item.userId,
          status: item.identity.status,
          submittedAt: item.identity.submittedAt,
          submission: item.identity.submission,
          ownerName: profiles.get(item.userId)?.fullName ?? "—",
        })),
      });
      return;
    }
    const verification = await getVerification(user.id);
    res.json({
      reviewer: false,
      submission: verification.identity.submission ?? null,
      status: verification.identity.status,
      rejectionReason: verification.identity.rejectionReason,
      rejectionVars: verification.identity.rejectionVars,
      reviewedAt: verification.identity.reviewedAt,
    });
  } catch (error) {
    console.error("Get identity evidence error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.post("/identity/:userId/review", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success || (parsed.data.decision === "reject" && (parsed.data.reason?.trim().length ?? 0) < 5)) {
      res.status(400).json({ code: "invalid_review", message: "verify.err.rejectReason" });
      return;
    }
    const userId = routeParam(req.params.userId);
    const verification = await getVerification(userId);
    if (verification.identity.status !== "pending") {
      res.status(409).json({ code: "not_pending", message: "verify.err.identityNotPending" });
      return;
    }
    const decision = parsed.data.decision;
    const reason = parsed.data.reason?.trim() ?? "";
    const identity = {
      ...verification.identity,
      status: decision === "approve" ? "verified" : "rejected",
      reviewedAt: new Date().toISOString(),
      reviewedBy: authUser(req).id,
      ...(decision === "approve" ? { at: new Date().toISOString(), note: undefined, rejectionReason: undefined, rejectionVars: undefined } : { rejectionReason: "verify.identity.rejected", rejectionVars: { reason } }),
    };
    const next = { ...verification, identity };
    updateTrust(next);
    await VerificationModel.updateOne({ userId }, { $set: { identity, trust: next.trust, updatedAt: next.updatedAt } });
    await addEvent(userId, authUser(req).id, "identity_reviewed", decision === "approve" ? "verify.ev.identityApproved" : "verify.ev.identityRejected", { reason });
    res.json({ status: identity.status });
  } catch (error) {
    console.error("Review identity verification error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.get("/provider", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const config = await getConfig();
    res.json(publicConfig(config ?? {}));
  } catch (error) {
    console.error("Get verification providers error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.patch("/provider/:channel", requireAuth, requireAdmin, async (req, res) => {
  try {
    const channel = req.params.channel;
    if (channel !== "phone" && channel !== "email") {
      res.status(400).json({ code: "invalid_channel", message: "verify.err.providerType" });
      return;
    }
    const parsed = providerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_provider", message: "verify.err.providerType" });
      return;
    }
    if (parsed.data.type === "http") {
      if (!parsed.data.endpoint || (!parsed.data.apiToken && !parsed.data.keepExistingToken)) {
        res.status(400).json({ code: "invalid_provider", message: "verify.err.providerEndpoint" });
        return;
      }
      let endpoint: URL;
      try {
        endpoint = new URL(parsed.data.endpoint);
      } catch {
        res.status(400).json({ code: "invalid_provider", message: "verify.err.providerEndpoint" });
        return;
      }
      if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
        res.status(400).json({ code: "invalid_provider", message: "verify.err.providerEndpoint" });
        return;
      }
    }
    const config = await getConfig();
    const previous = config?.[channel] as Provider | undefined;
    const next: Provider = {
      channel,
      type: parsed.data.type,
      endpoint: parsed.data.endpoint?.trim() ?? "",
      apiToken: parsed.data.apiToken || (parsed.data.keepExistingToken ? previous?.apiToken ?? "" : ""),
      label: parsed.data.label?.trim() || (parsed.data.type === "demo" ? "Demo" : "HTTP"),
    };
    if (next.type === "http" && !next.apiToken) {
      res.status(400).json({ code: "invalid_provider", message: "verify.err.providerToken" });
      return;
    }
    await VerifyConfigModel.updateOne({ key: "platform" }, { $set: { [channel]: next } }, { upsert: true });
    await addEvent(authUser(req).id, authUser(req).id, "role_changed", "verify.ev.providerChanged", { channel, type: next.type });
    res.json(publicProvider({ [channel]: next }, channel));
  } catch (error) {
    console.error("Update verification provider error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.get("/listings/queue", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const listings = await ListingModel.find({ status: "pending_review", deletedAt: { $exists: false } }).sort({ createdAt: -1 }).lean();
    const ownerIds = [...new Set(listings.map((listing) => listing.ownerId))];
    const owners = await UserModel.find({ id: { $in: ownerIds } }).select("id profile").lean();
    const profiles = new Map(owners.map((owner) => [owner.id, owner.profile]));
    const verifications = await VerificationModel.find({ userId: { $in: ownerIds } }).lean<VerificationRecord[]>();
    const verificationByUser = new Map(verifications.map((verification) => [verification.userId, verification]));
    res.json(listings.map((listing) => {
      const profile = profiles.get(listing.ownerId);
      const verification = verificationByUser.get(listing.ownerId);
      return {
        listing,
        ownerName: profile?.fullName ?? "—",
        ownerUsername: profile?.username ?? "",
        contactVerified: verification?.phone.status === "verified" || verification?.email.status === "verified",
        businessVerified: verification?.business.status === "verified",
      };
    }));
  } catch (error) {
    console.error("Get listing review queue error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.post("/listings/:id/review", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success || (parsed.data.decision === "reject" && (parsed.data.reason?.trim().length ?? 0) < 5)) {
      res.status(400).json({ code: "invalid_review", message: "verify.err.rejectReason" });
      return;
    }
    const listing = await ListingModel.findOne({ id: req.params.id, status: "pending_review", deletedAt: { $exists: false } });
    if (!listing) {
      res.status(409).json({ code: "not_pending", message: "verify.err.notPendingReview" });
      return;
    }
    const decision = parsed.data.decision;
    if (decision === "approve") {
      const verification = await getVerification(listing.ownerId);
      const config = await getConfig();
      const requiredCategories = publicConfig(config ?? {}).requiredBusinessCategories;
      const eligibility = verificationEligibility(verification, requiredCategories, { businessClaimed: listing.businessClaimed, category: listing.category });
      if (!eligibility.ok) {
        res.status(403).json({ code: "verification_required", message: "verify.err.publishBlocked", vars: { steps: eligibility.missing.map((step) => step.key).join(", ") } });
        return;
      }
    }
    const reason = parsed.data.reason?.trim() ?? "";
    listing.status = decision === "approve" ? (listing.kind === "offer" ? "active" : "open") : "rejected";
    listing.reviewedBy = authUser(req).id;
    listing.reviewedAt = new Date().toISOString();
    listing.updatedAt = new Date().toISOString();
    listing.reviewReason = decision === "reject" ? "verify.listing.rejected" : undefined;
    listing.reviewReasonVars = decision === "reject" ? { reason } : undefined;
    await listing.save();
    await addEvent(listing.ownerId, authUser(req).id, decision === "approve" ? "listing_approved" : "listing_rejected", decision === "approve" ? "verify.ev.listingApproved" : "verify.ev.listingRejected", { title: listing.title, reason });
    res.json({ status: listing.status });
  } catch (error) {
    console.error("Review listing error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.get("/public/:userId", async (req, res) => {
  try {
    const verification = await VerificationModel.findOne({ userId: req.params.userId }).lean<VerificationRecord>();
    res.json({
      phoneVerified: verification?.phone.status === "verified",
      emailVerified: verification?.email.status === "verified",
      businessVerified: verification?.business.status === "verified",
      identityVerified: verification?.identity.status === "verified",
      completedExchanges: verification?.completedExchanges ?? 0,
      trust: verification?.trust ?? "new",
    });
  } catch (error) {
    console.error("Get public verification error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

export default router;
