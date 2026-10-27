import { ApiError, exclusiveWrite, getSessionUserId, now, read, setSessionUserId, transact, uid } from "./db";
import { DESIGNATED_ADMIN, matchesDesignatedAdmin, safeEqualHex } from "./admin";
import {
  BUSINESS_TYPES, generateCode, hashOtp, maskEmail, maskPhone, sendOtp, verifyCode,
  OTP_MAX_ATTEMPTS, OTP_MAX_RESENDS_PER_HOUR, OTP_RESEND_MIN_MS, OTP_TTL_MINUTES,
  validateEmail, validatePhone, UDYAM_RE,
} from "./verify";
import { CATEGORIES, LIMITS, NEED_TYPES, OFFER_TYPES } from "./constants";
import { getLang, isLang, setVisitorLang, translate, visitorLang } from "./i18n";
import type { Key } from "@/locales/en";
import type {
  CheckStatus, BusinessEvidence, IdentityProviderConfig, ProviderConfig, TrustTier, Verification, VerifyEventType,
  VerifyConfig,
} from "./types";
import type { PublicVerification } from "./types";
import type {
  ActivityEvent, AppNotification, CommitmentProgress, Connection, Conversation, ContextType, DB, Delivery, EventType, Exchange,
  ID, Listing, ListingKind, Message, Milestone, MilestoneStatus, Profile, PublicMember, Review, SavedListing, Skill, Vars,
} from "./types";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function sessionUser(db: DB): ID {
  const id = getSessionUserId();
  const user = db.users.find((u) => u.id === id);
  if (!id || !user) throw new ApiError("err.unauthenticated", "unauthenticated");
  if (user.status === "suspended") throw new ApiError("err.accountSuspended", "forbidden");
  return id;
}

export function currentUserId(): ID | null {
  const id = getSessionUserId();
  return id && read().users.some((u) => u.id === id && u.status !== "suspended") ? id : null;
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().replace(/\s+\n/g, "\n").slice(0, max * 2) : "");

function need(cond: unknown, key: Key, code = "invalid", vars?: Vars): asserts cond {
  if (!cond) throw new ApiError(key, code, vars);
}

function lengthCheck(value: string, max: number) {
  need(value.length <= max, "err.maxLength", "invalid", { max });
}

export function memberOf(db: DB, userId: ID): PublicMember {
  const p = db.profiles.find((x) => x.userId === userId);
  if (!p)
    return {
      userId,
      fullName: translate("common.formerMember"),
      username: "",
      occupation: "",
      verification: { phoneVerified: false, emailVerified: false, businessVerified: false, identityVerified: false, completedExchanges: 0, trust: "new" },
    };
  return {
    userId,
    fullName: p.fullName,
    username: p.username,
    occupation: p.occupation,
    avatar: p.avatar,
    location: p.visibility.location && p.location ? p.location : undefined,
    verification: getPublicVerification(userId),
  };
}

export function isPubliclyVisible(l: Listing) {
  if (l.deletedAt) return false;
  if (l.status === "pending_review" || l.status === "rejected") return false;
  return l.kind === "offer" ? l.status === "active" : l.status === "open" || l.status === "matched";
}

/** True when a listing needs a moderator before it can be seen by anyone else. */
export function needsReview(l: Listing) {
  return l.status === "pending_review";
}

export function listingReviewReason(l: Listing): { key: Key; vars?: Vars } | null {
  // reviewReason is always written from a literal key by this file; the cast is safe.
  return l.reviewReason ? { key: l.reviewReason as Key, vars: l.reviewReasonVars } : null;
}

function blockedBetween(db: DB, a: ID, b: ID) {
  return db.blocks.some((x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a));
}

function makeQrToken() {
  return `ssr_${uid().replace(/[^a-zA-Z0-9]/g, "")}${uid().replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`.toLowerCase();
}

function notify(db: DB, userId: ID, kind: AppNotification["kind"], key: Key, vars: Vars, link: string, refId?: ID) {
  if (userId === getSessionUserId() || !db.users.some((u) => u.id === userId)) return;
  const p = db.profiles.find((x) => x.userId === userId);
  const pref =
    kind === "message"
      ? p?.prefs.messages
      : kind === "review"
        ? p?.prefs.reviews
        : kind === "verification" || kind === "connection"
          ? true
          : p?.prefs.exchanges;
  if (pref === false) return;
  if (kind === "message" && refId) {
    // one unread notification per conversation — avoid spamming on every message
    const existing = db.notifications.find((n) => n.userId === userId && n.kind === "message" && n.refId === refId && !n.readAt);
    if (existing) {
      existing.key = key;
      existing.vars = vars;
      existing.createdAt = now();
      return;
    }
  }
  db.notifications.push({ id: uid(), userId, kind, text: "", key, vars, link, refId, createdAt: now() });
}

function logEvent(db: DB, e: { exchangeId?: ID; audience: ID[]; actorId: ID; type: EventType; key: Key; vars?: Vars; body?: string }) {
  db.events.push({ id: uid(), createdAt: now(), text: "", ...e });
}

const nameOf = (db: DB, id: ID) => db.profiles.find((p) => p.userId === id)?.fullName ?? "A member";

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */

export async function hashPassword(password: string, salt: string) {
  if (!crypto?.subtle) throw new ApiError("err.insecure", "insecure");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 120_000 }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function register(input: { email: string; password: string; fullName: string; username: string; language?: string }) {
  const email = clean(input.email, 120).toLowerCase();
  const fullName = clean(input.fullName, 80);
  const username = clean(input.username, 24).toLowerCase();
  need(EMAIL_RE.test(email), "err.invalidEmail");
  need(fullName.length >= 2, "err.fullNameRequired");
  lengthCheck(fullName, 80);
  need(USERNAME_RE.test(username), "err.usernameFormat");
  need(input.password.length >= 8, "err.passwordLength");
  const salt = uid();
  const passwordHash = await hashPassword(input.password, salt);
  const id = transact((db) => {
    need(!db.users.some((u) => u.email === email), "err.emailTaken", "conflict");
    need(!db.profiles.some((p) => p.username === username), "err.usernameTaken", "conflict");
    const id = uid();
    const t = now();
    db.users.push({ id, email, passwordHash, salt, role: "member", status: "active", createdAt: t });
    db.profiles.push({
      userId: id, fullName, username, bio: "", occupation: "", roles: [], location: "", languages: [], skills: [], interests: [],
      collabTypes: [], availability: "", portfolio: [], visibility: { bio: true, location: false, skills: true, portfolio: true },
      prefs: { messages: true, exchanges: true, reviews: true }, qrToken: makeQrToken(), language: isLang(input.language) ? input.language : visitorLang(), createdAt: t, updatedAt: t,
    });
    return id;
  });
  setSessionUserId(id);
}

function syncAccountLanguage(userId: ID) {
  const saved = read().profiles.find((x) => x.userId === userId)?.language;
  if (isLang(saved)) setVisitorLang(saved);
  else
    transact((db) => {
      const p = db.profiles.find((x) => x.userId === userId);
      if (p && !isLang(p.language)) p.language = visitorLang();
    });
}

/**
 * Authenticates or repairs the single designated administrator account ONLY when both
 * the normalized email and PBKDF2-SHA256 password digest match DESIGNATED_ADMIN.
 * Existing user IDs, profile data, and related records are preserved.
 */
async function authenticateOrRepairDesignatedAdmin(email: string, password: string): Promise<ID | null> {
  if (!(await matchesDesignatedAdmin(email, password, hashPassword))) return null;
  return transact((db) => {
    const existing = db.users.find((u) => u.email === DESIGNATED_ADMIN.email);
    const t = now();
    if (existing) {
      existing.salt = DESIGNATED_ADMIN.salt;
      existing.passwordHash = DESIGNATED_ADMIN.passwordHash;
      existing.role = "admin";
      existing.status = "active";
      const profile = db.profiles.find((p) => p.userId === existing.id);
      if (!profile) {
        const desired = DESIGNATED_ADMIN.username;
        const username = db.profiles.some((p) => p.username === desired) ? `${desired}_admin` : desired;
        db.profiles.push({
          userId: existing.id, fullName: DESIGNATED_ADMIN.fullName, username, bio: "", occupation: "", roles: [], location: "", languages: [], skills: [], interests: [],
          collabTypes: [], availability: "", portfolio: [], visibility: { bio: true, location: false, skills: true, portfolio: true },
          prefs: { messages: true, exchanges: true, reviews: true }, qrToken: makeQrToken(), language: visitorLang(), createdAt: t, updatedAt: t,
        });
      } else if (!profile.qrToken) {
        profile.qrToken = makeQrToken();
      }
      return existing.id;
    }
    const id = uid();
    const desired = DESIGNATED_ADMIN.username;
    const username = db.profiles.some((p) => p.username === desired) ? `${desired}_admin` : desired;
    db.users.push({
      id, email: DESIGNATED_ADMIN.email, passwordHash: DESIGNATED_ADMIN.passwordHash, salt: DESIGNATED_ADMIN.salt,
      role: "admin", status: "active", createdAt: t,
    });
    db.profiles.push({
      userId: id, fullName: DESIGNATED_ADMIN.fullName, username, bio: "", occupation: "", roles: [], location: "", languages: [], skills: [], interests: [],
      collabTypes: [], availability: "", portfolio: [], visibility: { bio: true, location: false, skills: true, portfolio: true },
      prefs: { messages: true, exchanges: true, reviews: true }, qrToken: makeQrToken(), language: visitorLang(), createdAt: t, updatedAt: t,
    });
    return id;
  });
}

export async function login(emailRaw: string, password: string) {
  const email = clean(emailRaw, 120).toLowerCase();
  const user = read().users.find((u) => u.email === email);
  // Hash even when user is unknown to keep timing similar.
  const hash = await hashPassword(password, user?.salt ?? "x");
  if (user && safeEqualHex(hash, user.passwordHash)) {
    if (user.status === "suspended") throw new ApiError("err.accountSuspended", "forbidden");
    if (await matchesDesignatedAdmin(email, password, hashPassword)) {
      transact((db) => {
        const u = db.users.find((x) => x.id === user.id);
        if (u) u.role = "admin";
      });
    }
    setSessionUserId(user.id);
    syncAccountLanguage(user.id);
    return;
  }
  const repairedId = await authenticateOrRepairDesignatedAdmin(email, password);
  if (repairedId) {
    setSessionUserId(repairedId);
    syncAccountLanguage(repairedId);
    return;
  }
  throw new ApiError("err.badCredentials", "unauthenticated");
}

export async function adminLogin(emailRaw: string, password: string) {
  const email = clean(emailRaw, 120).toLowerCase();
  const repairedId = await authenticateOrRepairDesignatedAdmin(email, password);
  if (repairedId) {
    setSessionUserId(repairedId);
    syncAccountLanguage(repairedId);
    return;
  }
  const user = read().users.find((u) => u.email === email);
  const hash = await hashPassword(password, user?.salt ?? "x");
  if (!user || !safeEqualHex(hash, user.passwordHash)) throw new ApiError("err.badCredentials", "unauthenticated");
  if (user.status === "suspended") throw new ApiError("err.accountSuspended", "forbidden");
  if (user.role !== "admin") throw new ApiError("auth.notAdmin", "forbidden");
  setSessionUserId(user.id);
  syncAccountLanguage(user.id);
}

export function logout() {
  setSessionUserId(null);
}

export async function changePassword(current: string, next: string) {
  const me = sessionUser(read());
  const user = read().users.find((u) => u.id === me)!;
  need((await hashPassword(current, user.salt)) === user.passwordHash, "err.currentPasswordWrong");
  need(next.length >= 8, "err.passwordLength");
  const salt = uid();
  const passwordHash = await hashPassword(next, salt);
  transact((db) => {
    const u = db.users.find((x) => x.id === me)!;
    u.salt = salt;
    u.passwordHash = passwordHash;
  });
}

/* ------------------------------------------------------------------ */
/* profiles                                                            */
/* ------------------------------------------------------------------ */

export function getMe(): { profile: Profile; email: string } {
  const db = read();
  const me = sessionUser(db);
  const profile = db.profiles.find((p) => p.userId === me);
  if (!profile) throw new ApiError("err.profileNotFound", "not_found");
  return { profile, email: db.users.find((u) => u.id === me)!.email };
}

export function isUsernameAvailable(username: string) {
  const db = read();
  const me = getSessionUserId();
  const u = username.trim().toLowerCase();
  return USERNAME_RE.test(u) && !db.profiles.some((p) => p.username === u && p.userId !== me);
}

export type ProfileInput = Pick<Profile, "fullName" | "username" | "bio" | "occupation" | "roles" | "location" | "languages" | "skills" | "interests" | "collabTypes" | "availability" | "avatar" | "cover" | "portfolio" | "visibility">;

export function updateProfile(input: ProfileInput) {
  const fullName = clean(input.fullName, 80);
  const username = clean(input.username, 24).toLowerCase();
  need(fullName.length >= 2, "err.fullNameRequired");
  lengthCheck(fullName, 80);
  need(USERNAME_RE.test(username), "err.usernameFormat");
  const bio = clean(input.bio, LIMITS.bio);
  lengthCheck(bio, LIMITS.bio);
  const list = (a: string[], max = 12) => [...new Set(a.map((x) => clean(x, 40)).filter(Boolean))].slice(0, max);
  const skills: Skill[] = input.skills
    .map((s) => ({ id: s.id || uid(), name: clean(s.name, 60), category: CATEGORIES.includes(s.category as never) ? s.category : "Other", level: s.level, description: clean(s.description, 300).slice(0, 300) }))
    .filter((s) => s.name)
    .slice(0, 20);
  return transact((db) => {
    const me = sessionUser(db);
    need(!db.profiles.some((p) => p.username === username && p.userId !== me), "err.usernameTaken", "conflict");
    const p = db.profiles.find((x) => x.userId === me)!;
    Object.assign(p, {
      fullName, username, bio,
      occupation: clean(input.occupation, 80).slice(0, 80),
      roles: list(input.roles),
      location: clean(input.location, 100).slice(0, 100),
      languages: list(input.languages),
      skills,
      interests: list(input.interests),
      collabTypes: list(input.collabTypes),
      availability: clean(input.availability, 120).slice(0, 120),
      avatar: input.avatar,
      cover: input.cover,
      portfolio: input.portfolio.slice(0, 8).map((x) => ({ id: x.id || uid(), title: clean(x.title, 80).slice(0, 80), image: x.image, link: /^https?:\/\//.test(x.link ?? "") ? x.link : undefined })).filter((x) => x.title),
      visibility: { ...input.visibility },
      updatedAt: now(),
    });
    return p;
  });
}

export function updatePrefs(prefs: Profile["prefs"]) {
  transact((db) => {
    const me = sessionUser(db);
    db.profiles.find((x) => x.userId === me)!.prefs = { ...prefs };
  });
}

export function setLanguage(lang: string) {
  need(lang === "en" || lang === "mr" || lang === "hi", "err.unsupportedLanguage");
  transact((db) => {
    const me = sessionUser(db);
    db.profiles.find((x) => x.userId === me)!.language = lang as Profile["language"];
  });
  setVisitorLang(lang as "en" | "hi" | "mr");
}

/** Recounts completed exchanges for a member (used to refresh trust indicators). */
export function recountExchanges(db: DB, userId: ID) {
  const v = db.verifications.find((x) => x.userId === userId);
  if (!v) return;
  v.completedExchanges = db.exchanges.filter((x) => x.status === "completed" && (x.requesterId === userId || x.recipientId === userId)).length;
}

export function qualifiesForReview(x: Exchange): boolean {
  if (x.status !== "completed" || x.requesterId === x.recipientId || !x.completedAt || !Number.isFinite(Date.parse(x.completedAt))) return false;
  const commitments = x.commitments.filter((c) => c.description.trim());
  return commitments.length > 0 && commitments.every((c) =>
    [x.requesterId, x.recipientId].includes(c.userId) && c.progress === "confirmed" && !!c.confirmedAt && Number.isFinite(Date.parse(c.confirmedAt))
  );
}

/** Preserve historical records, but never count ineligible or duplicate records as reputation. */
function eligibleReviews(db: DB): Review[] {
  const exchanges = new Map(db.exchanges.map((x) => [x.id, x]));
  const seen = new Set<string>();
  return [...db.reviews].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).filter((r) => {
    const x = exchanges.get(r.exchangeId);
    if (!x || !qualifiesForReview(x) || !Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5 || typeof r.comment !== "string" || !r.comment.trim()) return false;
    const participants = [x.requesterId, x.recipientId];
    if (r.reviewerId === r.recipientId || !participants.includes(r.reviewerId) || !participants.includes(r.recipientId)) return false;
    const key = JSON.stringify([r.exchangeId, r.reviewerId, r.recipientId]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function ratingSummary(db: DB, userId: ID) {
  const rs = eligibleReviews(db).filter((r) => r.recipientId === userId);
  const distribution = [0, 0, 0, 0, 0];
  rs.forEach((r) => distribution[r.rating - 1]++);
  const average = rs.length ? Math.round(rs.reduce((sum, r) => sum + r.rating, 0) / rs.length * 10) / 10 : null;
  return { count: rs.length, average, distribution };
}

export function getProfileReviewEligibility(userId: ID) {
  const db = read();
  const me = sessionUser(db);
  need(db.users.some((u) => u.id === userId), "err.memberGone", "not_found");
  const shared = userId === me ? [] : db.exchanges.filter((x) => qualifiesForReview(x) &&
    [x.requesterId, x.recipientId].includes(me) && [x.requesterId, x.recipientId].includes(userId));
  const pending = shared.filter((x) => !db.reviews.some((r) => r.exchangeId === x.id && r.reviewerId === me && r.recipientId === userId));
  return {
    ownProfile: me === userId,
    completedCount: shared.length,
    pending: pending.map((x) => ({ id: x.id, title: x.title, completedAt: x.completedAt! })),
  };
}

export function getReviewContext(exchangeId: ID) {
  const db = read();
  const { me, x, other } = participantExchange(db, exchangeId);
  return {
    title: x.title,
    recipient: memberOf(db, other),
    eligible: me !== other && qualifiesForReview(x),
    existing: db.reviews.some((r) => r.exchangeId === exchangeId && r.reviewerId === me && r.recipientId === other),
  };
}

export function getPublicProfile(username: string) {
  const db = read();
  const viewer = sessionUser(db);
  const p = db.profiles.find((x) => x.username === username.toLowerCase());
  if (!p) return null;
  const isMe = p.userId === viewer;
  const v = p.visibility;
  const listings = db.listings.filter((l) => l.ownerId === p.userId && isPubliclyVisible(l));
  return {
    isMe,
    blocked: blockedBetween(db, viewer, p.userId),
    member: memberOf(db, p.userId),
    verification: getPublicVerification(p.userId),
    profile: {
      fullName: p.fullName,
      username: p.username,
      occupation: p.occupation,
      roles: p.roles,
      avatar: p.avatar,
      cover: p.cover,
      languages: p.languages,
      interests: p.interests,
      collabTypes: p.collabTypes,
      availability: p.availability,
      createdAt: p.createdAt,
      bio: v.bio || isMe ? p.bio : "",
      location: v.location || isMe ? p.location : "",
      skills: v.skills || isMe ? p.skills : [],
      portfolio: v.portfolio || isMe ? p.portfolio : [],
    },
    offers: listings.filter((l) => l.kind === "offer"),
    needs: listings.filter((l) => l.kind === "need"),
    reviews: eligibleReviews(db).filter((r) => r.recipientId === p.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => ({
      ...r, reviewer: memberOf(db, r.reviewerId), verifiedExchange: true,
      canOpenExchange: r.reviewerId === viewer || r.recipientId === viewer,
      reported: db.reports.some((report) => report.reporterId === viewer && report.targetType === "review" && report.targetId === r.id),
    })),
    rating: ratingSummary(db, p.userId),
    completedExchanges: db.exchanges.filter((x) => x.status === "completed" && (x.requesterId === p.userId || x.recipientId === p.userId)).length,
  };
}

/* ------------------------------------------------------------------ */
/* listings (offers + needs)                                           */
/* ------------------------------------------------------------------ */

export interface ListingInput {
  title: string;
  category: string;
  type: string;
  description: string;
  details: string;
  exchangePref: string;
  location: string;
  availability: string;
  mode: Listing["mode"];
  quantity: string;
  tags: string[];
  images: string[];
  /** Author declares this is a registered business/enterprise. */
  businessClaimed?: boolean;
}

export type FieldError = { key: Key; vars?: Vars };

export function validateListing(kind: ListingKind, input: ListingInput): Record<string, FieldError> {
  const e: Record<string, FieldError> = {};
  const max = (n: number): FieldError => ({ key: "err.maxLength", vars: { max: n } });
  const title = input.title.trim();
  if (title.length < 4) e.title = { key: "err.titleShort" };
  else if (title.length > LIMITS.title) e.title = max(LIMITS.title);
  if (!CATEGORIES.includes(input.category as never)) e.category = { key: "err.category" };
  const types: readonly string[] = kind === "offer" ? OFFER_TYPES : NEED_TYPES;
  if (!types.includes(input.type)) e.type = { key: "err.type" };
  if (input.description.trim().length < 20) e.description = { key: "err.descriptionShort" };
  else if (input.description.trim().length > LIMITS.description) e.description = max(LIMITS.description);
  if (input.details.trim().length < 3) e.details = { key: kind === "need" ? "err.detailsNeed" : "err.detailsOffer" };
  else if (input.details.trim().length > LIMITS.details) e.details = max(LIMITS.details);
  if (input.exchangePref.trim().length > LIMITS.pref) e.exchangePref = max(LIMITS.pref);
  if (input.location.trim().length > LIMITS.short) e.location = max(LIMITS.short);
  if (input.availability.trim().length > LIMITS.short) e.availability = max(LIMITS.short);
  if (input.quantity.trim().length > LIMITS.short) e.quantity = max(LIMITS.short);
  if (input.images.length > LIMITS.imagesPerListing) e.images = { key: "err.imagesMax", vars: { n: LIMITS.imagesPerListing } };
  if (input.images.some((i) => !i.startsWith("data:image/"))) e.images = { key: "err.imagesInvalid" };
  return e;
}

function normalizeListing(input: ListingInput) {
  return {
    title: input.title.trim(),
    category: input.category,
    type: input.type,
    description: input.description.trim(),
    details: input.details.trim(),
    exchangePref: input.exchangePref.trim(),
    location: input.location.trim(),
    availability: input.availability.trim(),
    mode: (["", "remote", "in_person", "both"].includes(input.mode) ? input.mode : "") as Listing["mode"],
    quantity: input.quantity.trim(),
    tags: [...new Set(input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8).map((t) => t.slice(0, 30)),
    images: input.images.slice(0, LIMITS.imagesPerListing),
  };
}

/** Maps a listing's status to its English status value. */
export function publishedStatus(l: Listing) {
  return l.kind === "offer" ? "active" : "open";
}

export function createListing(kind: ListingKind, input: ListingInput, publish: boolean) {
  const errors = validateListing(kind, input);
  const first = Object.values(errors)[0];
  need(!first, first?.key ?? "err.invalid", "invalid", first?.vars);
  return transact((db) => {
    const me = sessionUser(db);
    // Mandatory verification gate: enforced here, not in the UI.
    if (publish) requireVerified(db, me, { businessClaimed: input.businessClaimed, category: input.category });
    const t = now();
    const normalized = normalizeListing(input);
    // requireVerified() threw above if anything was missing, so a published listing is always
    // fully verified by the time it is stored.
    const l: Listing = {
      id: uid(),
      ownerId: me,
      kind,
      ...normalized,
      businessClaimed: input.businessClaimed,
      status: publish ? (kind === "offer" ? "active" : "open") : "draft",
      createdAt: t,
      updatedAt: t,
    };
    db.listings.push(l);
    recountExchanges(db, me);
    return l;
  });
}

function ownedListing(db: DB, id: ID) {
  const me = sessionUser(db);
  const l = db.listings.find((x) => x.id === id && !x.deletedAt);
  need(l, "err.listingGone", "not_found");
  need(l.ownerId === me, "err.notYourListing", "forbidden");
  return l;
}

export function updateListing(id: ID, input: ListingInput, publish?: boolean) {
  return transact((db) => {
    const l = ownedListing(db, id);
    const errors = validateListing(l.kind, input);
    const first = Object.values(errors)[0];
  need(!first, first?.key ?? "err.invalid", "invalid", first?.vars);
    const me = sessionUser(db);
    Object.assign(l, normalizeListing(input), { updatedAt: now() });
    l.businessClaimed = input.businessClaimed;
    if (publish && l.status === "draft") {
      requireVerified(db, me, { businessClaimed: l.businessClaimed, category: l.category });
      l.status = l.kind === "offer" ? "active" : "open";
      l.reviewReason = undefined;
      l.reviewReasonVars = undefined;
    }
    return l;
  });
}

const TRANSITIONS: Record<string, string[]> = {
  "offer:draft": ["active", "pending_review"],
  "offer:pending_review": ["active", "inactive"],
  "offer:active": ["inactive"],
  "offer:inactive": ["active"],
  "offer:rejected": ["active", "pending_review", "draft"],
  "need:draft": ["open", "pending_review"],
  "need:pending_review": ["open", "paused"],
  "need:rejected": ["open", "pending_review", "draft"],
  "need:open": ["matched", "paused", "fulfilled"],
  "need:matched": ["open", "paused", "fulfilled", "in_progress"],
  "need:in_progress": ["fulfilled", "paused", "open"],
  "need:paused": ["open"],
  "need:fulfilled": ["open"],
};

export function allowedTransitions(l: Listing) {
  return TRANSITIONS[`${l.kind}:${l.status}`] ?? [];
}

export function setListingStatus(id: ID, status: string) {
  return transact((db) => {
    const l = ownedListing(db, id);
    need(allowedTransitions(l).includes(status), "err.statusConflict", "conflict");
    if (status === "active" || status === "open") {
      need(!Object.keys(validateListing(l.kind, l)).length, "err.completeBeforePublish");
      // Mandatory verification gate on every publish pathway.
      requireVerified(db, l.ownerId, { businessClaimed: l.businessClaimed, category: l.category });
    }
    l.status = status as Listing["status"];
    l.updatedAt = now();
    return l;
  });
}

/** Hard delete only when nothing references the listing; otherwise soft delete to preserve history. */
export function deleteListing(id: ID) {
  return transact((db) => {
    const l = ownedListing(db, id);
    const referenced = db.exchanges.some((x) => x.listingId === id || x.offeredListingId === id) || db.saved.some((s) => s.listingId === id) || db.conversations.some((c) => c.contextType === "listing" && c.contextId === id);
    if (referenced) {
      l.deletedAt = now();
      l.updatedAt = now();
      return "archived" as const;
    }
    db.listings = db.listings.filter((x) => x.id !== id);
    return "deleted" as const;
  });
}

export function getMyListings(kind: ListingKind) {
  const db = read();
  const me = sessionUser(db);
  return db.listings.filter((l) => l.ownerId === me && l.kind === kind && !l.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getListing(id: ID) {
  const db = read();
  const me = sessionUser(db);
  const l = db.listings.find((x) => x.id === id);
  if (!l) return null;
  const isOwner = l.ownerId === me;
  if (!isOwner && !isPubliclyVisible(l)) return { listing: null, unavailable: l.deletedAt ? "deleted" : "closed", isOwner };
  return { listing: l, owner: memberOf(db, l.ownerId), isOwner, unavailable: null as null | string };
}

/** Publicly discoverable listings by other members (excludes blocked members). */
export function getPublicListings() {
  const db = read();
  const me = sessionUser(db);
  return db.listings
    .filter((l) => l.ownerId !== me && isPubliclyVisible(l) && !blockedBetween(db, me, l.ownerId))
    .map((l) => ({ listing: l, owner: memberOf(db, l.ownerId) }));
}

/** Exchange requests linked to one of my listings (responses). */
export function getListingResponses(listingId: ID) {
  const db = read();
  const me = sessionUser(db);
  const l = db.listings.find((x) => x.id === listingId);
  need(l && l.ownerId === me, "err.forbidden", "forbidden");
  return db.exchanges
    .filter((x) => x.listingId === listingId || x.offeredListingId === listingId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((x) => ({ exchange: x, other: memberOf(db, x.requesterId === me ? x.recipientId : x.requesterId) }));
}

export function responseCount(db: DB, listingId: ID) {
  return db.exchanges.filter((x) => x.listingId === listingId).length;
}

/* ------------------------------------------------------------------ */
/* verification                                                        */
/* ------------------------------------------------------------------ */

function findVerification(db: DB, userId: ID): Verification {
  const v = db.verifications.find((x) => x.userId === userId);
  if (!v) throw new ApiError("verify.err.recordMissing", "not_found"); // migrate() guarantees this
  return v;
}

function touchVerification(v: Verification) {
  v.updatedAt = now();
}

function audit(db: DB, userId: ID, actorId: ID, type: VerifyEventType, key: Key, vars?: Vars, body?: string) {
  db.verifyEvents.push({ id: uid(), userId, actorId, type, key, vars, body, createdAt: now() });
}

/** Trust tier derived only from checks that actually completed. */
export function trustOf(v: Verification): TrustTier {
  if (v.identity.status === "verified") return "identity_verified";
  if (v.business.status === "verified") return "business_verified";
  if (v.phone.status === "verified" || v.email.status === "verified") return "contact_verified";
  return "new";
}

/** Whether the member completed at least one contact check. */
export function contactVerified(v: Verification): boolean {
  return v.phone.status === "verified" || v.email.status === "verified";
}

/** A required verification step that must genuinely complete before publishing. */
export interface RequiredStep {
  channel: "phone" | "email" | "identity" | "business";
  key: Key;
  status: CheckStatus;
  reason?: Key;
  vars?: Vars;
  /** Business verification is only mandatory for declared businesses or configured categories. */
  businessRequired?: boolean;
}

export interface Eligibility {
  ok: boolean;
  required: RequiredStep[];
  missing: RequiredStep[];
}

/**
 * Central eligibility check for publishing. One function, used by every publishing pathway
 * (create, publish-draft, set-status, resubmit). Never trust a flag from the browser.
 *
 * Required: phone OTP, email code, identity approval. Business verification is required when the
 * listing declares a business or belongs to a category the platform has marked as requiring it.
 */
export function verificationEligibility(db: DB, userId: ID, opts: { businessClaimed?: boolean; category?: string } = {}): Eligibility {
  const v = findVerification(db, userId);
  const steps: RequiredStep[] = [
    { channel: "phone", key: "verify.step.phone", status: v.phone.status, reason: (v.phone.note ?? undefined) as Key | undefined, vars: undefined },
    { channel: "email", key: "verify.step.email", status: v.email.status, reason: (v.email.note ?? undefined) as Key | undefined, vars: undefined },
    { channel: "identity", key: "verify.step.identity", status: v.identity.status, reason: (v.identity.note ?? undefined) as Key | undefined, vars: undefined },
  ];
  const bizRequired = !!opts.businessClaimed || db.verifyConfig.requiredBusinessCategories.includes(opts.category ?? "");
  steps.push({
    channel: "business",
    key: "verify.step.business",
    status: v.business.status,
    reason: (v.business.rejectionReason ?? undefined) as Key | undefined,
    vars: v.business.rejectionVars,
    businessRequired: bizRequired,
  });
  const required = steps.filter((s) => s.channel !== "business" || s.businessRequired);
  const missing = required.filter((s) => s.status !== "verified");
  return { ok: missing.length === 0, required, missing };
}

/**
 * Same eligibility rule the server enforces, evaluated with the listing's own business claim
 * and category. Used by the form UI to mirror the server exactly — the server still re-checks
 * on submission, so a UI bypass cannot publish.
 */
export function getPublishEligibility(businessClaimed?: boolean, category?: string): Eligibility {
  const db = read();
  const me = sessionUser(db);
  return verificationEligibility(db, me, { businessClaimed, category });
}

/** Throws unless every mandatory verification step is genuinely completed. */
export function requireVerified(db: DB, userId: ID, opts: { businessClaimed?: boolean; category?: string } = {}): Eligibility {
  const e = verificationEligibility(db, userId, opts);
  if (!e.ok) {
    // Name the missing steps in the viewer's language so the error is actionable.
    const steps = e.missing.map((s) => translate(s.key, undefined, getLang())).join(", ");
    throw new ApiError("verify.err.publishBlocked", "forbidden", { steps });
  }
  return e;
}

/** UI view of the signed-in member's verification record and platform provider state. */
export function getVerification(): {
  verification: Verification;
  email: string;
  phoneConfigured: boolean;
  emailConfigured: boolean;
  contactVerified: boolean;
  identityAvailable: boolean;
  identityType: IdentityProviderConfig["type"];
  requiredBusinessCategories: string[];
  eligibility: Eligibility;
  provider: VerifyConfig;
} {
  const db = read();
  const me = sessionUser(db);
  const v = findVerification(db, me);
  const u = db.users.find((x) => x.id === me)!;
  return {
    verification: v,
    email: u.email,
    phoneConfigured: db.verifyConfig.phone.type !== "none",
    emailConfigured: db.verifyConfig.email.type !== "none",
    contactVerified: contactVerified(v),
    identityAvailable: db.verifyConfig.identity.type !== "none",
    identityType: db.verifyConfig.identity.type,
    requiredBusinessCategories: db.verifyConfig.requiredBusinessCategories,
    // The same check the server enforces, surfaced so the UI can mirror it exactly.
    eligibility: verificationEligibility(db, me, { businessClaimed: false }),
    provider: db.verifyConfig,
  };
}

export function getVerifyEvents(limit = 30) {
  const db = read();
  const me = sessionUser(db);
  return db.verifyEvents.filter((e) => e.userId === me).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

const isExpired = (o: { expiresAt: string }) => Date.now() > Date.parse(o.expiresAt);

/**
 * Starts an OTP round. The code is generated and hashed outside the transaction, stored only
 * as SHA-256(salt + code), and never returned to the caller.
 */
export async function requestVerificationCode(channel: "phone" | "email", destinationRaw: string) {
  const destination = destinationRaw.trim();
  const lowered = destinationRaw.toLowerCase().trim();
  const formatErr = channel === "phone" ? validatePhone(destination) : validateEmail(lowered);
  if (formatErr) throw new ApiError(formatErr, "invalid");

  const prep = transact((db) => {
    const me = sessionUser(db);
    const v = findVerification(db, me);
    const cfg = channel === "phone" ? db.verifyConfig.phone : db.verifyConfig.email;
    if (cfg.type === "none") throw new ApiError("verify.provider.unconfigured", "unavailable");
    const c = channel === "phone" ? v.phone : v.email;
    if (c.status === "verified") throw new ApiError("verify.err.alreadyVerified", "conflict");
    if (c.lastSentAt && Date.now() - Date.parse(c.lastSentAt) < OTP_RESEND_MIN_MS)
      throw new ApiError("verify.err.resendWait", "rate_limited", {
        seconds: Math.ceil((OTP_RESEND_MIN_MS - (Date.now() - Date.parse(c.lastSentAt))) / 1000),
      });
    const hourAgo = Date.now() - 3_600_000;
    const recentSends = db.otps.filter((o) => o.userId === me && o.channel === channel && Date.parse(o.createdAt) > hourAgo).length;
    if (recentSends >= OTP_MAX_RESENDS_PER_HOUR)
      throw new ApiError("verify.err.resendLimit", "rate_limited", { max: OTP_MAX_RESENDS_PER_HOUR });
    return { me, c, masked: channel === "phone" ? maskPhone(destination) : maskEmail(lowered) };
  });

  const code = generateCode();
  const salt = uid();
  const otpHash = await hashOtp(code, salt);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();
  const recordId = uid();
  const t = now();

  const cfg = getVerificationProvider(channel);
  const delivered = await sendOtp(cfg, destination, code, channel);
  // A failed send must never leave a contact looking verified, and must drop the code.
  const outcome = transact((db) => {
    const me = sessionUser(db);
    need(me === prep.me, "err.unauthenticated", "unauthenticated");
    const v = findVerification(db, me);
    const c = channel === "phone" ? v.phone : v.email;
    if (!delivered.ok) {
      db.otps = db.otps.filter((o) => o.userId !== me || o.channel !== channel);
      c.status = "pending";
      c.note = delivered.message;
      c.lastSentAt = undefined;
      c.attempts = 0;
      touchVerification(v);
      audit(db, me, me, "otp_failed_send", delivered.message, { destination: prep.masked });
      return { error: new ApiError(delivered.message, "provider_error") };
    }
    db.otps = db.otps.filter((o) => o.userId !== me || o.channel !== channel);
    db.otps.push({ id: recordId, userId: me, channel, destination: lowered, otpHash, salt, expiresAt, attempts: 0, attemptsAt: [], createdAt: t, sentAt: t });
    c.status = "pending";
    c.attempts = 0;
    c.lastSentAt = t;
    c.masked = prep.masked;
    c.note = undefined;
    v.trust = trustOf(v);
    touchVerification(v);
    audit(db, me, me, "otp_requested", "verify.ev.otpRequested", { destination: prep.masked, ttl: OTP_TTL_MINUTES });
    return { masked: prep.masked };
  });
  if (outcome.error) throw outcome.error;

  // Only the explicitly-labelled demo channel surfaces the code; real gateways never do.
  const demoCode = cfg.type === "demo" ? code : undefined;
  return { masked: outcome.masked!, delivered: true, channel, demoCode };
}

function getVerificationProvider(channel: "phone" | "email"): ProviderConfig {
  return read().verifyConfig[channel];
}

/** Verifies a submitted code: expiry, attempt limit and single-use are enforced here. */
export async function verifyContactCode(channel: "phone" | "email", codeRaw: string) {
  const code = codeRaw.trim();
  if (!code) throw new ApiError("verify.err.codeRequired", "invalid");
  if (!/^\d{6}$/.test(code)) throw new ApiError("verify.err.codeFormat", "invalid");

  const prep = transact((db) => {
    const me = sessionUser(db);
    const v = findVerification(db, me);
    const c = channel === "phone" ? v.phone : v.email;
    if (c.status === "verified") throw new ApiError("verify.err.alreadyVerified", "conflict");
    const record = db.otps.find((o) => o.userId === me && o.channel === channel);
    if (!record) throw new ApiError("verify.err.noCode", "not_found");
    if (isExpired(record)) throw new ApiError("verify.err.codeExpired", "expired");
    return { me, c, record, remaining: Math.max(OTP_MAX_ATTEMPTS - record.attempts, 0) };
  });

  const ok = await verifyCode(code, prep.record.salt, prep.record.otpHash);

  const outcome = transact((db) => {
    const me = sessionUser(db);
    need(me === prep.me, "err.unauthenticated", "unauthenticated");
    const v = findVerification(db, me);
    const c = channel === "phone" ? v.phone : v.email;
    const record = db.otps.find((o) => o.id === prep.record.id && o.userId === me && o.channel === channel);
    need(record && !isExpired(record), "verify.err.codeExpired", "expired");
    need(record.attempts < OTP_MAX_ATTEMPTS, "verify.err.attemptsExhausted", "rate_limited");
    record.attempts++;
    record!.attemptsAt.push(Date.now());
    if (!ok) {
      if (record!.attempts >= OTP_MAX_ATTEMPTS) {
        db.otps = db.otps.filter((o) => o.id !== prep.record.id);
        c.status = "rejected";
        c.note = "verify.err.attemptsExhausted";
        c.attempts = record!.attempts;
        touchVerification(v);
        audit(db, me, me, "otp_attempts_exhausted", "verify.err.attemptsExhausted", { max: OTP_MAX_ATTEMPTS, destination: c.masked });
      } else {
        c.attempts = record!.attempts;
        touchVerification(v);
        audit(db, me, me, "otp_expired", "verify.ev.attemptFailed", { remaining: Math.max(OTP_MAX_ATTEMPTS - record!.attempts, 0), destination: c.masked });
      }
      return { error: new ApiError("verify.err.codeWrong", "invalid", { remaining: Math.max(OTP_MAX_ATTEMPTS - record!.attempts, 0) }) };
    }
    db.otps = db.otps.filter((o) => o.id !== prep.record.id);
    c.status = "verified";
    c.at = now();
    c.attempts = record!.attempts;
    c.note = undefined;
    v.trust = trustOf(v);
    touchVerification(v);
    audit(db, me, me, "otp_verified", channel === "phone" ? "verify.ev.phoneVerified" : "verify.ev.emailVerified", { destination: c.masked });
    return { contact: c };
  });
  if (outcome.error) throw outcome.error;
  return outcome.contact!;
}

/** Submits business evidence for moderator review. No identity documents are accepted. */
export function submitBusinessEvidence(evidence: BusinessEvidence) {
  const businessName = clean(evidence.businessName, 120);
  const ownerName = clean(evidence.ownerName, 80);
  const location = clean(evidence.location, 120);
  const description = clean(evidence.description, 600);
  need(businessName.length >= 2, "verify.err.businessName");
  need(ownerName.length >= 2, "verify.err.ownerName");
  need(BUSINESS_TYPES.includes(evidence.businessType as never), "verify.err.businessType");
  need(location.length >= 3, "verify.err.businessLocation");
  need(description.length >= 10, "verify.err.businessDesc");
  const udyam = clean(evidence.udyamNumber, 10).replace(/[^0-9]/g, "");
  if (udyam) need(UDYAM_RE.test(udyam), "verify.err.udyamFormat");
  const docs = evidence.documents
    .map((d) => ({ title: clean(d.title, 80), type: d.type, value: clean(d.value, 4000) }))
    .filter((d) => d.title)
    .slice(0, 6);
  return transact((db) => {
    const me = sessionUser(db);
    const v = findVerification(db, me);
    if (v.business.status === "verified") throw new ApiError("verify.err.businessVerified", "conflict");
    v.business = {
      status: "pending",
      submittedAt: now(),
      reviewedAt: undefined,
      reviewedBy: undefined,
      rejectionReason: undefined,
      rejectionVars: undefined,
      evidence: { businessType: evidence.businessType, businessName, ownerName, udyamNumber: udyam, location, description, documents: docs },
    };
    v.trust = trustOf(v);
    touchVerification(v);
    audit(db, me, me, "business_submitted", "verify.ev.businessSubmitted", { businessType: evidence.businessType });
    notify(db, me, "verification", "notif.verificationReceived", { type: "business" }, "/verification");
    return v.business;
  });
}

/** Own submission for the owner; the pending queue for reviewers. */
export function getBusinessEvidence() {
  const db = read();
  const me = sessionUser(db);
  const u = db.users.find((x) => x.id === me)!;
  if (u.role !== "admin") {
    const v = findVerification(db, me);
    return {
      reviewer: false as const,
      evidence: v.business.evidence ?? null,
      status: v.business.status,
      submittedAt: v.business.submittedAt,
      rejectionReason: v.business.rejectionReason,
      rejectionVars: v.business.rejectionVars,
      reviewedAt: v.business.reviewedAt,
    };
  }
  const submissions = db.verifications
    .filter((x) => x.business.status !== "not_started" && x.business.evidence)
    .map((x) => {
      const owner = db.profiles.find((p) => p.userId === x.userId);
      return {
        userId: x.userId,
        status: x.business.status,
        submittedAt: x.business.submittedAt,
        evidence: x.business.evidence,
        rejectionReason: x.business.rejectionReason,
        rejectionVars: x.business.rejectionVars,
        ownerName: owner?.fullName ?? "—",
      };
    })
    .filter((s) => s.status === "pending")
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
  return { reviewer: true as const, submissions };
}

function reviewerOnly(db: DB): ID {
  return adminOnly(db);
}

/** Reviewer action on submitted business evidence. */
export function reviewBusinessEvidence(userId: ID, decision: "approve" | "reject", reason?: string) {
  const reasonText = reason?.trim() ?? "";
  if (decision === "reject") need(reasonText.length >= 5, "verify.err.rejectReason");
  return transact((db) => {
    const me = reviewerOnly(db);
    const v = findVerification(db, userId);
    need(v.business.status === "pending", "verify.err.notPending", "conflict");
    v.business.status = decision === "approve" ? "verified" : "rejected";
    v.business.reviewedAt = now();
    v.business.reviewedBy = me;
    if (decision === "reject") {
      v.business.rejectionReason = "verify.business.rejected";
      v.business.rejectionVars = { reason: reasonText };
      v.business.evidence = undefined; // evidence not retained for rejected submissions
    }
    v.trust = trustOf(v);
    touchVerification(v);
    audit(db, userId, me, "business_reviewed", decision === "approve" ? "verify.ev.businessApproved" : "verify.ev.businessRejected", {
      businessType: v.business.evidence?.businessType ?? "other",
      reason: reasonText,
    });
    notify(db, userId, "verification", decision === "approve" ? "community.verificationApproved" : "notif.verificationRejected", { type: "business", reason: reasonText }, "/verification");
    return v.business.status;
  });
}

/**
 * Identity verification submission.
 *
 * The member declares who they are with a masked reference to a government identity document.
 * Nothing sensitive is stored: only the name, a masked reference, and a note. Completion requires
 * a genuine reviewer approval — a submitted form never becomes a verified badge.
 */
export function submitIdentityVerification(input: { fullName: string; idReference: string; note: string }) {
  const fullName = clean(input.fullName, 80);
  const idReference = clean(input.idReference, 40);
  const note = clean(input.note, 500);
  need(fullName.length >= 2, "verify.err.identityName");
  need(idReference.length >= 3, "verify.err.identityReference");
  need(note.length >= 10, "verify.err.identityNote");
  return transact((db) => {
    const me = sessionUser(db);
    const v = findVerification(db, me);
    const cfg = db.verifyConfig.identity;
    need(cfg.type !== "none", "verify.err.identityUnavailable");
    if (v.identity.status === "verified") throw new ApiError("verify.err.identityVerified", "conflict");
    v.identity = {
      status: "pending",
      note: undefined,
      submission: { fullName, idReference: maskIdentityReference(idReference), note },
      submittedAt: now(),
      reviewedAt: undefined,
      reviewedBy: undefined,
      rejectionReason: undefined,
      rejectionVars: undefined,
    };
    v.trust = trustOf(v);
    touchVerification(v);
    audit(db, me, me, "identity_submitted", "verify.ev.identitySubmitted", { provider: cfg.label });
    notify(db, me, "verification", "notif.verificationReceived", { type: "identity" }, "/verification");
    return v.identity;
  });
}

/** Masks an identity reference so only the tail is retained. */
function maskIdentityReference(ref: string) {
  const t = ref.trim();
  if (t.length <= 4) return "****";
  return `${t.slice(0, 2)}***${t.slice(-4)}`;
}

/** Reviewer action on a submitted identity declaration. */
export function reviewIdentityVerification(userId: ID, decision: "approve" | "reject", reason?: string) {
  const reasonText = reason?.trim() ?? "";
  if (decision === "reject") need(reasonText.length >= 5, "verify.err.rejectReason");
  return transact((db) => {
    const me = reviewerOnly(db);
    const v = findVerification(db, userId);
    need(v.identity.status === "pending", "verify.err.identityNotPending", "conflict");
    v.identity.status = decision === "approve" ? "verified" : "rejected";
    v.identity.reviewedAt = now();
    v.identity.reviewedBy = me;
    if (decision === "approve") {
      v.identity.at = now();
      v.identity.note = undefined;
      v.identity.rejectionReason = undefined;
      v.identity.rejectionVars = undefined;
    } else {
      v.identity.rejectionReason = "verify.identity.rejected";
      v.identity.rejectionVars = { reason: reasonText };
    }
    v.trust = trustOf(v);
    touchVerification(v);
    audit(db, userId, me, "identity_reviewed", decision === "approve" ? "verify.ev.identityApproved" : "verify.ev.identityRejected", {
      provider: db.verifyConfig.identity.label,
      reason: reasonText,
    });
    notify(db, userId, "verification", decision === "approve" ? "community.verificationApproved" : "notif.verificationRejected", { type: "identity", reason: reasonText }, "/verification");
    return v.identity.status;
  });
}

/** Own identity declaration for the owner; the pending queue for reviewers. */
export function getIdentityEvidence() {
  const db = read();
  const me = sessionUser(db);
  const u = db.users.find((x) => x.id === me)!;
  if (u.role !== "admin") {
    const v = findVerification(db, me);
    return {
      reviewer: false as const,
      submission: v.identity.submission ?? null,
      status: v.identity.status,
      rejectionReason: v.identity.rejectionReason,
      rejectionVars: v.identity.rejectionVars,
      reviewedAt: v.identity.reviewedAt,
    };
  }
  const submissions = db.verifications
    .filter((x) => x.identity.status === "pending" && x.identity.submission)
    .map((x) => {
      const owner = db.profiles.find((p) => p.userId === x.userId);
      return {
        userId: x.userId,
        status: x.identity.status,
        submittedAt: x.identity.submittedAt,
        submission: x.identity.submission,
        ownerName: owner?.fullName ?? "—",
      };
    })
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
  return { reviewer: true as const, submissions };
}

/** Privacy-safe trust indicators for a member — never contact details or evidence. */
export function getPublicVerification(userId: ID): PublicVerification {
  const db = read();
  const v = db.verifications.find((x) => x.userId === userId);
  if (!v) return { phoneVerified: false, emailVerified: false, businessVerified: false, identityVerified: false, completedExchanges: 0, trust: "new" };
  return {
    phoneVerified: v.phone.status === "verified",
    emailVerified: v.email.status === "verified",
    businessVerified: v.business.status === "verified",
    identityVerified: v.identity.status === "verified",
    completedExchanges: v.completedExchanges,
    trust: trustOf(v),
  };
}

/** Platform provider configuration. A clearly-labelled configuration capability, logged. */
export function updateProviderConfig(channel: "phone" | "email", config: Partial<ProviderConfig>) {
  const type = config.type ?? "none";
  need(["none", "http", "demo"].includes(type), "verify.err.providerType");
  if (type === "http") {
    need(typeof config.endpoint === "string" && config.endpoint.length > 0, "verify.err.providerEndpoint");
    need((config.apiToken ?? "").length > 0, "verify.err.providerToken");
  }
  return transact((db) => {
    const me = sessionUser(db);
    db.verifyConfig = {
      ...db.verifyConfig,
      [channel]: {
        channel,
        type: type as ProviderConfig["type"],
        endpoint: clean(config.endpoint ?? "", 200),
        apiToken: clean(config.apiToken ?? "", 200),
        label: clean(config.label ?? "", 60) || (type === "demo" ? "Demo" : "HTTP"),
      },
    };
    audit(db, me, me, "role_changed", "verify.ev.providerChanged", { channel, type });
    return db.verifyConfig[channel];
  });
}

/**
 * Role checks. Only the administrator role (provisioned from secure build-time credentials)
 * can review submissions. Ordinary users can never grant themselves this role.
 */
export function isAdmin() {
  const db = read();
  const me = sessionUser(db);
  return db.users.find((x) => x.id === me)?.role === "admin";
}

/** Alias kept for the verification service, which gates on the reviewer role. */
export function isReviewer() {
  return isAdmin();
}

/** Enforces that only an administrator may perform a review action. */
function adminOnly(db: DB): ID {
  const me = sessionUser(db);
  need(db.users.find((x) => x.id === me)!.role === "admin", "verify.err.reviewerOnly", "forbidden");
  return me;
}

/**
 * Admin review queue: every pending submission, business and identity, in one place.
 * Requires the admin role; throws for ordinary users.
 */
export function getAdminReviewQueue() {
  const db = read();
  adminOnly(db);
  const business = db.verifications
    .filter((v) => ["pending", "verified", "rejected"].includes(v.business.status) && (v.business.submittedAt || v.business.reviewedAt || v.business.evidence))
    .map((v) => {
      const p = db.profiles.find((pr) => pr.userId === v.userId);
      return {
        userId: v.userId,
        type: "business" as const,
        submittedAt: v.business.submittedAt ?? v.business.reviewedAt,
        reviewedAt: v.business.reviewedAt,
        status: v.business.status,
        ownerName: p?.fullName ?? "—",
        ownerUsername: p?.username ?? "",
        evidence: v.business.evidence,
        rejectionReason: v.business.rejectionVars?.reason ? String(v.business.rejectionVars.reason) : undefined,
      };
    });
  const identity = db.verifications
    .filter((v) => ["pending", "verified", "rejected"].includes(v.identity.status) && (v.identity.submittedAt || v.identity.reviewedAt || v.identity.submission))
    .map((v) => {
      const p = db.profiles.find((pr) => pr.userId === v.userId);
      return {
        userId: v.userId,
        type: "identity" as const,
        submittedAt: v.identity.submittedAt ?? v.identity.reviewedAt,
        reviewedAt: v.identity.reviewedAt,
        status: v.identity.status,
        ownerName: p?.fullName ?? "—",
        ownerUsername: p?.username ?? "",
        submission: v.identity.submission,
        rejectionReason: v.identity.rejectionVars?.reason ? String(v.identity.rejectionVars.reason) : undefined,
      };
    });
  const all = [...business, ...identity].sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
  const pending = all.filter((x) => x.status === "pending");
  return { pending, all };
}

/** Admin overview statistics calculated from real records. */
export function getAdminOverview() {
  const db = read();
  adminOnly(db);
  const totalUsers = db.users.length;
  const pending = db.verifications.filter(
    (v) => (v.business.status === "pending" && v.business.evidence) || (v.identity.status === "pending" && v.identity.submission),
  ).length;
  const approved = db.verifications.filter(
    (v) => (v.business.status === "verified") || (v.identity.status === "verified"),
  ).length;
  const rejected = db.verifications.filter(
    (v) => (v.business.status === "rejected") || (v.identity.status === "rejected"),
  ).length;
  const bizPending = db.verifications.filter((v) => v.business.status === "pending" && v.business.evidence).length;
  const idPending = db.verifications.filter((v) => v.identity.status === "pending" && v.identity.submission).length;
  const totalListings = db.listings.filter((l) => !l.deletedAt).length;
  const activeExchanges = db.exchanges.filter((x) => x.status === "active").length;
  const completedExchanges = db.exchanges.filter((x) => x.status === "completed").length;
  return { totalUsers, pending, approved, rejected, bizPending, idPending, totalListings, activeExchanges, completedExchanges };
}

/** Admin user list — no passwords, hashes, tokens, or OTPs. */
export function getAdminUsers(query = "", limit = 100) {
  const db = read();
  adminOnly(db);
  const q = query.trim().toLowerCase();
  const users = db.users
    .map((u) => {
      const p = db.profiles.find((x) => x.userId === u.id);
      const v = db.verifications.find((x) => x.userId === u.id);
      const listings = db.listings.filter((l) => l.ownerId === u.id && !l.deletedAt);
      return {
        userId: u.id,
        fullName: p?.fullName ?? "—",
        username: p?.username ?? "",
        email: u.email,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
        phoneVerified: v?.phone.status === "verified",
        emailVerified: v?.email.status === "verified",
        businessVerified: v?.business.status === "verified",
        identityVerified: v?.identity.status === "verified",
        trust: v ? trustOf(v) : "new" as const,
        listings: listings.length,
        activeOffers: listings.filter((l) => l.kind === "offer" && l.status === "active").length,
        openNeeds: listings.filter((l) => l.kind === "need" && l.status === "open").length,
      };
    })
    .filter((u) => !q || u.fullName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  return { users, total: db.users.length };
}

/** Suspend or activate an account (admin only). Logged. */
export function setAccountStatus(userId: ID, status: "active" | "suspended", reason?: string) {
  const reasonText = reason?.trim() ?? "";
  if (status === "suspended") need(reasonText.length >= 5, "verify.err.rejectReason");
  return transact((db) => {
    const me = adminOnly(db);
    const u = db.users.find((x) => x.id === userId);
    need(u, "err.memberGone", "not_found");
    need(u!.role !== "admin", "verify.err.cannotSuspendAdmin", "forbidden");
    need(u!.status !== status, "verify.err.statusUnchanged", "conflict");
    u!.status = status;
    audit(db, userId, me, "role_changed", status === "suspended" ? "verify.ev.accountSuspended" : "verify.ev.accountActivated", { reason: reasonText });
    return u!.status;
  });
}

/** Full review history for the admin dashboard (approved and rejected). */
export function getAdminReviewHistory(limit = 50) {
  const db = read();
  adminOnly(db);
  return db.verifyEvents
    .filter((e) => ["business_reviewed", "identity_reviewed"].includes(e.type))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((e) => {
      const owner = db.profiles.find((p) => p.userId === e.userId);
      return { ...e, ownerName: owner?.fullName ?? "—" };
    });
}

/* ------------------------------------------------------------------ */
/* listing moderation                                                  */
/* ------------------------------------------------------------------ */

/** Listings awaiting moderation (reviewers only). */
export function getListingReviewQueue() {
  const db = read();
  reviewerOnly(db);
  return db.listings
    .filter((l) => !l.deletedAt && l.status === "pending_review")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((l) => {
      const p = db.profiles.find((x) => x.userId === l.ownerId);
      const v = findVerification(db, l.ownerId);
      return {
        listing: l,
        ownerName: p?.fullName ?? "—",
        ownerUsername: p?.username ?? "",
        contactVerified: contactVerified(v),
        businessVerified: v.business.status === "verified",
      };
    });
}

/** Reviewer action on a listing awaiting moderation. */
export function reviewListing(listingId: ID, decision: "approve" | "reject", reason?: string) {
  const reasonText = reason?.trim() ?? "";
  if (decision === "reject") need(reasonText.length >= 5, "verify.err.rejectReason");
  return transact((db) => {
    const me = reviewerOnly(db);
    const l = db.listings.find((x) => x.id === listingId && !x.deletedAt);
    need(l && l.status === "pending_review", "verify.err.notPendingReview", "conflict");
    // A moderator cannot publish a listing whose owner is not fully verified.
    if (decision === "approve") requireVerified(db, l.ownerId, { businessClaimed: l.businessClaimed, category: l.category });
    l.status = decision === "approve" ? (l.kind === "offer" ? "active" : "open") : "rejected";
    l.reviewedBy = me;
    l.reviewedAt = now();
    l.updatedAt = now();
    if (decision === "approve") {
      l.reviewReason = undefined;
      l.reviewReasonVars = undefined;
    } else {
      l.reviewReason = "verify.listing.rejected";
      l.reviewReasonVars = { reason: reasonText };
    }
    const v = findVerification(db, l.ownerId);
    const ownerName = db.profiles.find((p) => p.userId === l.ownerId)?.fullName ?? "—";
    audit(
      db, l.ownerId, me, decision === "approve" ? "listing_approved" : "listing_rejected",
      decision === "approve" ? "verify.ev.listingApproved" : "verify.ev.listingRejected",
      { title: l.title, ownerName, reason: reasonText },
    );
    touchVerification(v);
    return l.status;
  });
}

/** Owner action after a rejection; re-runs the policy so resubmission is reviewed again. */
export function resubmitListing(listingId: ID) {
  return transact((db) => {
    const me = sessionUser(db);
    const l = db.listings.find((x) => x.id === listingId && !x.deletedAt);
    need(l && l.ownerId === me, "err.notYourListing", "forbidden");
    need(l.status === "rejected", "verify.err.notRejected", "conflict");
    requireVerified(db, me, { businessClaimed: l.businessClaimed, category: l.category });
    l.status = l.kind === "offer" ? "active" : "open";
    l.reviewReason = undefined;
    l.reviewReasonVars = undefined;
    l.reviewedBy = undefined;
    l.reviewedAt = undefined;
    audit(db, me, me, "listing_resubmitted", "verify.ev.resubmittedPublished", { title: l.title });
    l.updatedAt = now();
    return l;
  });
}

/* ------------------------------------------------------------------ */
/* saved listings                                                      */
/* ------------------------------------------------------------------ */

export function getSavedIds(): Set<ID> {
  const db = read();
  const me = getSessionUserId();
  return new Set(db.saved.filter((s) => s.userId === me).map((s) => s.listingId));
}

export function toggleSave(listingId: ID): boolean {
  return transact((db) => {
    const me = sessionUser(db);
    const existing = db.saved.find((s) => s.userId === me && s.listingId === listingId);
    if (existing) {
      db.saved = db.saved.filter((s) => s !== existing);
      return false;
    }
    const l = db.listings.find((x) => x.id === listingId);
    need(l && isPubliclyVisible(l), "err.saveUnavailable", "not_found");
    need(l.ownerId !== me, "err.saveOwn");
    db.saved.push({ id: uid(), userId: me, listingId, createdAt: now() });
    return true;
  });
}

export function getSaved() {
  const db = read();
  const me = sessionUser(db);
  return db.saved
    .filter((s) => s.userId === me)
    .map((s: SavedListing) => {
      const l = db.listings.find((x) => x.id === s.listingId);
      const state: "available" | "deleted" | "closed" = !l || l.deletedAt ? "deleted" : isPubliclyVisible(l) ? "available" : "closed";
      return { saved: s, listing: l && !l.deletedAt ? l : l ? { ...l, images: [] } : null, owner: l ? memberOf(db, l.ownerId) : null, state };
    });
}

/* ------------------------------------------------------------------ */
/* exchanges / collaborations                                          */
/* ------------------------------------------------------------------ */

export interface ProposalInput {
  recipientId: ID;
  listingId?: ID;
  offeredListingId?: ID;
  iProvide: string;
  iReceive: string;
  message: string;
  targetDate: string;
}

export function proposeExchange(input: ProposalInput) {
  const iProvide = input.iProvide.trim();
  const iReceive = input.iReceive.trim();
  const message = input.message.trim();
  need(iProvide || iReceive, "err.proposalEmpty");
  lengthCheck(iProvide, LIMITS.details);
  lengthCheck(iReceive, LIMITS.details);
  lengthCheck(message, LIMITS.message);
  need(!input.targetDate || !isNaN(Date.parse(input.targetDate)), "err.invalidDate");
  return transact((db) => {
    const me = sessionUser(db);
    need(input.recipientId !== me, "err.proposeSelf");
    need(db.users.some((u) => u.id === input.recipientId), "err.memberGone", "not_found");
    need(!blockedBetween(db, me, input.recipientId), "err.cannotContact", "forbidden");
    let listing: Listing | undefined;
    if (input.listingId) {
      listing = db.listings.find((l) => l.id === input.listingId);
      need(listing && isPubliclyVisible(listing), "err.listingClosed", "conflict");
      need(listing.ownerId === input.recipientId, "err.listingNotOwned");
    }
    if (input.offeredListingId) {
      const own = db.listings.find((l) => l.id === input.offeredListingId);
      need(own && own.ownerId === me && isPubliclyVisible(own), "err.offeredInvalid");
    }
    const dup = db.exchanges.find(
      (x) => ["pending", "active"].includes(x.status) && x.requesterId === me && x.recipientId === input.recipientId && (x.listingId ?? null) === (input.listingId ?? null)
    );
    need(!dup, dup?.status === "pending" ? "err.dupPending" : "err.dupActive", "duplicate");
    const t = now();
    const x: Exchange = {
      id: uid(),
      requesterId: me,
      recipientId: input.recipientId,
      listingId: input.listingId,
      offeredListingId: input.offeredListingId,
      title: listing?.title ?? `${nameOf(db, me)} ↔ ${nameOf(db, input.recipientId)}`,
      category: listing?.category ?? "Other",
      message,
      commitments: [
        { userId: me, description: iProvide, progress: "not_started" },
        { userId: input.recipientId, description: iReceive, progress: "not_started" },
      ],
      targetDate: input.targetDate,
      status: "pending",
      delivery: { required: false, method: "", status: "not_started", date: "", reference: "" },
      createdAt: t,
      updatedAt: t,
    };
    db.exchanges.push(x);
    logEvent(db, { exchangeId: x.id, audience: [me, input.recipientId], actorId: me, type: "request_created", key: "ev.created", vars: { name: nameOf(db, me), title: x.title } });
    notify(db, input.recipientId, "exchange", "notif.request", { name: nameOf(db, me), title: x.title }, `/exchange/${x.id}`);
    return x;
  });
}

function participantExchange(db: DB, id: ID) {
  const me = sessionUser(db);
  const x = db.exchanges.find((e) => e.id === id);
  need(x, "err.exchangeNotFound", "not_found");
  need(x.requesterId === me || x.recipientId === me, "err.notParticipant", "forbidden");
  return { me, x, other: x.requesterId === me ? x.recipientId : x.requesterId };
}

function touch(x: Exchange) {
  x.updatedAt = now();
}

export function respondToRequest(id: ID, decision: "accept" | "decline") {
  return transact((db) => {
    const { me, x, other } = participantExchange(db, id);
    need(x.recipientId === me, "err.onlyRecipient", "forbidden");
    need(x.status === "pending", "err.notPending", "conflict");
    x.status = decision === "accept" ? "active" : "declined";
    x.respondedAt = now();
    touch(x);
    if (decision === "accept") {
      for (const lid of [x.listingId, x.offeredListingId]) {
        const l = db.listings.find((l) => l.id === lid);
        if (l && l.kind === "need" && (l.status === "open" || l.status === "matched")) {
          l.status = "in_progress";
          l.updatedAt = now();
        }
      }
    }
    logEvent(db, { exchangeId: x.id, audience: [me, other], actorId: me, type: decision === "accept" ? "request_accepted" : "request_declined", key: decision === "accept" ? "ev.accepted" : "ev.declined", vars: { name: nameOf(db, me), title: x.title } });
    notify(db, other, "exchange", decision === "accept" ? "notif.accepted" : "notif.declined", { name: nameOf(db, me), title: x.title }, `/exchange/${x.id}`);
    return x;
  });
}

export function withdrawRequest(id: ID) {
  return transact((db) => {
    const { me, x, other } = participantExchange(db, id);
    need(x.requesterId === me, "err.onlyRequester", "forbidden");
    need(x.status === "pending", "err.notPending", "conflict");
    x.status = "withdrawn";
    touch(x);
    logEvent(db, { exchangeId: x.id, audience: [me, other], actorId: me, type: "request_withdrawn", key: "ev.withdrawn", vars: { name: nameOf(db, me), title: x.title } });
    notify(db, other, "exchange", "notif.withdrew", { name: nameOf(db, me), title: x.title }, `/exchange/${x.id}`);
  });
}

export function cancelExchange(id: ID, reason: string) {
  return transact((db) => {
    const { me, x, other } = participantExchange(db, id);
    need(x.status === "active", x.status === "completed" ? "err.completedNoCancel" : "err.notActive", "conflict");
    x.status = "cancelled";
    x.cancelledAt = now();
    x.cancelledBy = me;
    x.cancelReason = reason.trim().slice(0, 500);
    touch(x);
    logEvent(db, { exchangeId: x.id, audience: [me, other], actorId: me, type: "exchange_cancelled", key: "ev.cancelled", vars: { name: nameOf(db, me) }, body: x.cancelReason });
    notify(db, other, "exchange", "notif.cancelled", { name: nameOf(db, me), title: x.title }, `/collaborations/${x.id}`);
  });
}

function myCommitment(x: Exchange, me: ID) {
  const c = x.commitments.find((c) => c.userId === me);
  need(c && c.description, "err.noCommitment");
  return c;
}

export function setMyProgress(id: ID, progress: Extract<CommitmentProgress, "not_started" | "in_progress">) {
  return transact((db) => {
    const { me, x, other } = participantExchange(db, id);
    need(x.status === "active", "err.notActive", "conflict");
    const c = myCommitment(x, me);
    need(c.progress === "not_started" || c.progress === "in_progress", "err.alreadySubmitted", "conflict");
    if (c.progress === progress) return;
    c.progress = progress;
    touch(x);
    logEvent(db, { exchangeId: x.id, audience: [me, other], actorId: me, type: "progress_changed", key: progress === "in_progress" ? "ev.progress.in_progress" : "ev.progress.not_started", vars: { name: nameOf(db, me) } });
  });
}

export function submitWork(id: ID, note: string, link: string) {
  const n = note.trim();
  need(n.length >= 3, "err.describeDelivery");
  lengthCheck(n, 1000);
  need(!link.trim() || /^https?:\/\/\S+$/.test(link.trim()), "err.linkFormat");
  return transact((db) => {
    const { me, x, other } = participantExchange(db, id);
    need(x.status === "active", "err.notActive", "conflict");
    const c = myCommitment(x, me);
    need(c.progress !== "ready" && c.progress !== "confirmed", "err.alreadySubmitted", "duplicate");
    c.progress = "ready";
    c.submission = { note: n, link: link.trim(), at: now() };
    touch(x);
    logEvent(db, { exchangeId: x.id, audience: [me, other], actorId: me, type: "work_submitted", key: "ev.submitted", vars: { name: nameOf(db, me) }, body: n });
    notify(db, other, "exchange", "notif.waitingConfirm", { name: nameOf(db, me), title: x.title }, `/collaborations/${x.id}`);
  });
}

export function reviewSubmission(id: ID, decision: "confirm" | "revise", note = "") {
  return transact((db) => {
    const { me, x, other } = participantExchange(db, id);
    need(x.status === "active", "err.notActive", "conflict");
    const c = x.commitments.find((c) => c.userId === other);
    need(c && c.progress === "ready", "err.nothingToConfirm", "conflict");
    if (decision === "confirm") {
      c.progress = "confirmed";
      c.confirmedAt = now();
      logEvent(db, { exchangeId: x.id, audience: [me, other], actorId: me, type: "commitment_confirmed", key: "ev.confirmed", vars: { name: nameOf(db, me), other: nameOf(db, other) } });
      const required = x.commitments.filter((k) => k.description);
      if (required.every((k) => k.progress === "confirmed")) {
        x.status = "completed";
        x.completedAt = now();
        logEvent(db, { exchangeId: x.id, audience: [me, other], actorId: me, type: "exchange_completed", key: "ev.completed", vars: { title: x.title } });
        notify(db, other, "exchange", "notif.completed", { title: x.title }, `/collaborations/${x.id}`);
      } else notify(db, other, "exchange", "notif.confirmedPart", { name: nameOf(db, me), title: x.title }, `/collaborations/${x.id}`);
    } else {
      need(note.trim().length >= 3, "err.explainRevision");
      c.progress = "in_progress";
      c.feedback = { note: note.trim().slice(0, 1000), at: now() };
      logEvent(db, { exchangeId: x.id, audience: [me, other], actorId: me, type: "revision_requested", key: "ev.revision", vars: { name: nameOf(db, me) }, body: c.feedback.note });
      notify(db, other, "exchange", "notif.revisions", { name: nameOf(db, me), title: x.title }, `/collaborations/${x.id}`);
    }
    touch(x);
  });
}

export function updateDelivery(id: ID, d: Delivery) {
  need(d.method.length <= 120 && d.reference.length <= 200, "err.tooLong");
  return transact((db) => {
    const { me, x, other } = participantExchange(db, id);
    need(x.status === "active", "err.notActive", "conflict");
    x.delivery = { required: d.required, method: d.method.trim(), status: d.status, date: d.date, reference: d.reference.trim(), updatedAt: now(), updatedBy: me };
    touch(x);
    logEvent(db, { exchangeId: x.id, audience: [me, other], actorId: me, type: "delivery_updated", key: "ev.delivery", vars: { name: nameOf(db, me) } });
    notify(db, other, "exchange", "community.collaborationUpdate", { name: nameOf(db, me), title: x.title }, `/collaborations/${x.id}`);
  });
}

export function addProgressNote(id: ID, text: string) {
  const t = text.trim();
  need(t.length >= 2, "err.writeUpdate");
  lengthCheck(t, 1000);
  return transact((db) => {
    const { me, x, other } = participantExchange(db, id);
    need(x.status === "active", "err.notActive", "conflict");
    touch(x);
    logEvent(db, { exchangeId: x.id, audience: [me, other], actorId: me, type: "progress_note", key: "ev.note", vars: { name: nameOf(db, me) }, body: t });
    notify(db, other, "exchange", "community.collaborationUpdate", { name: nameOf(db, me), title: x.title }, `/collaborations/${x.id}`);
  });
}

export function proposeAmendment(id: ID, mine: string, theirs: string, targetDate: string) {
  return transact((db) => {
    const { me, x, other } = participantExchange(db, id);
    need(x.status === "active", "err.notActive", "conflict");
    need(!x.amendment, "err.amendmentPending", "duplicate");
    need(mine.trim() || theirs.trim(), "err.amendmentNeedsCommitment");
    x.amendment = { byUserId: me, commitments: [{ userId: me, description: mine.trim().slice(0, LIMITS.details) }, { userId: other, description: theirs.trim().slice(0, LIMITS.details) }], targetDate, createdAt: now() };
    touch(x);
    logEvent(db, { exchangeId: x.id, audience: [me, other], actorId: me, type: "amendment_proposed", key: "ev.amendProposed", vars: { name: nameOf(db, me) } });
    notify(db, other, "exchange", "notif.amendment", { name: nameOf(db, me), title: x.title }, `/collaborations/${x.id}`);
  });
}

export function respondAmendment(id: ID, accept: boolean) {
  return transact((db) => {
    const { me, x, other } = participantExchange(db, id);
    need(x.amendment, "err.noAmendment", "conflict");
    const a = x.amendment;
    need(a.byUserId !== me, "err.waitingOther", "forbidden");
    if (accept) {
      for (const nc of a.commitments) {
        const c = x.commitments.find((k) => k.userId === nc.userId);
        if (c && c.description !== nc.description) {
          c.description = nc.description;
          if (c.progress === "ready" || c.progress === "confirmed") c.progress = "in_progress";
        }
      }
      x.targetDate = a.targetDate;
    }
    x.amendment = undefined;
    touch(x);
    logEvent(db, { exchangeId: x.id, audience: [me, other], actorId: me, type: accept ? "amendment_accepted" : "amendment_rejected", key: accept ? "ev.amendAccepted" : "ev.amendDeclined", vars: { name: nameOf(db, me) } });
    notify(db, other, "exchange", accept ? "notif.amendAccepted" : "notif.amendDeclined", { name: nameOf(db, me), title: x.title }, `/collaborations/${x.id}`);
  });
}

export function createMilestone(exchangeId: ID, m: { title: string; description: string; dueDate: string }) {
  const title = m.title.trim();
  need(title.length >= 2, "err.milestoneTitle");
  lengthCheck(title, 100);
  return transact((db) => {
    const { me, x, other } = participantExchange(db, exchangeId);
    need(x.status === "active", "err.notActive", "conflict");
    const t = now();
    db.milestones.push({ id: uid(), exchangeId, title, description: m.description.trim().slice(0, 500), dueDate: m.dueDate, status: "not_started", createdBy: me, updatedBy: me, createdAt: t, updatedAt: t });
    touch(x);
    logEvent(db, { exchangeId, audience: [me, other], actorId: me, type: "milestone_created", key: "ev.msCreated", vars: { name: nameOf(db, me), title } });
  });
}

export function updateMilestone(id: ID, status: MilestoneStatus) {
  return transact((db) => {
    const m = db.milestones.find((k) => k.id === id);
    need(m, "err.milestoneNotFound", "not_found");
    const { me, x, other } = participantExchange(db, m.exchangeId);
    need(x.status === "active", "err.notActive", "conflict");
    need(["not_started", "in_progress", "completed"].includes(status), "err.invalid");
    if (m.status === status) return;
    m.status = status;
    m.updatedBy = me;
    m.updatedAt = now();
    touch(x);
    logEvent(db, { exchangeId: x.id, audience: [me, other], actorId: me, type: "milestone_updated", key: `ev.ms.${status}` as Key, vars: { name: nameOf(db, me), title: m.title } });
    notify(db, other, "exchange", "community.collaborationUpdate", { name: nameOf(db, me), title: x.title }, `/collaborations/${x.id}`);
  });
}

export type ExchangeView = Exchange & { requester: PublicMember; recipient: PublicMember; other: PublicMember; role: "requester" | "recipient"; awaiting: boolean; awaitingMe: boolean };

function view(db: DB, x: Exchange, me: ID): ExchangeView {
  const other = x.requesterId === me ? x.recipientId : x.requesterId;
  const awaiting = x.status === "active" && x.commitments.some((c) => c.progress === "ready");
  return {
    ...x,
    requester: memberOf(db, x.requesterId),
    recipient: memberOf(db, x.recipientId),
    other: memberOf(db, other),
    role: x.requesterId === me ? "requester" : "recipient",
    awaiting,
    awaitingMe: x.status === "active" && x.commitments.some((c) => c.userId === other && c.progress === "ready"),
  };
}

export function getMyExchanges(): ExchangeView[] {
  const db = read();
  const me = sessionUser(db);
  return db.exchanges.filter((x) => x.requesterId === me || x.recipientId === me).map((x) => view(db, x, me)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getExchangeDetail(id: ID) {
  const db = read();
  const me = sessionUser(db);
  const x = db.exchanges.find((e) => e.id === id);
  if (!x) return { error: "not_found" as const };
  if (x.requesterId !== me && x.recipientId !== me) return { error: "forbidden" as const };
  const lref = (lid?: ID) => {
    const l = db.listings.find((k) => k.id === lid);
    return l ? { id: l.id, title: l.title, kind: l.kind, status: l.status, available: isPubliclyVisible(l) || l.ownerId === me, deleted: !!l.deletedAt } : null;
  };
  return {
    error: null,
    me,
    exchange: view(db, x, me),
    listing: lref(x.listingId),
    offeredListing: lref(x.offeredListingId),
    milestones: db.milestones.filter((m) => m.exchangeId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) as Milestone[],
    events: db.events.filter((e) => e.exchangeId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    reviews: eligibleReviews(db).filter((r) => r.exchangeId === id),
    conversationId: db.conversations.find((c) => c.contextType === "exchange" && c.contextId === id)?.id,
  };
}

/* ------------------------------------------------------------------ */
/* activity & notifications                                            */
/* ------------------------------------------------------------------ */

export function getActivity(limit = 20): ActivityEvent[] {
  const db = read();
  const me = sessionUser(db);
  return db.events.filter((e) => e.audience.includes(me)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export function getNotificationInbox(limit = 30, offset = 0) {
  const db = read();
  const me = sessionUser(db);
  const all = db.notifications.filter((n) => n.userId === me).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const size = Math.max(1, Math.min(500, Math.floor(Number.isFinite(limit) ? limit : 30)));
  const start = Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0));
  return { items: all.slice(start, start + size), unread: all.filter((n) => !n.readAt).length, total: all.length, hasMore: all.length > start + size };
}

export function getNotifications() { return getNotificationInbox().items; }

export async function markNotificationsRead(ids?: ID[]) {
  return exclusiveWrite(() => transact((db) => {
    const me = sessionUser(db);
    need(ids === undefined || (Array.isArray(ids) && ids.every((id) => typeof id === "string")), "err.invalid");
    const selected = ids ? new Set(ids) : null;
    const timestamp = now();
    db.notifications.forEach((n) => {
      if (n.userId === me && !n.readAt && (!selected || selected.has(n.id))) n.readAt = timestamp;
    });
  }));
}

/* ------------------------------------------------------------------ */
/* messaging                                                           */
/* ------------------------------------------------------------------ */

export async function openConversation(otherId: ID, contextType: ContextType = "none", contextId?: ID): Promise<ID> {
  return exclusiveWrite(() => transact((db) => {
    const me = sessionUser(db);
    need(otherId !== me, "err.messageSelf");
    need(db.users.some((u) => u.id === otherId), "err.memberGone", "not_found");
    need(db.users.some((u) => u.id === otherId && u.status !== "suspended"), "community.memberUnavailable", "forbidden");
    need(["none", "listing", "exchange"].includes(contextType), "err.invalidContext");
    need(!blockedBetween(db, me, otherId), "err.cannotContact", "forbidden");
    if (contextType === "listing") {
      const l = db.listings.find((x) => x.id === contextId);
      need(l && (l.ownerId === me || l.ownerId === otherId) && (isPubliclyVisible(l) || l.ownerId === me), "err.invalidContext");
    } else if (contextType === "exchange") {
      const x = db.exchanges.find((e) => e.id === contextId);
      need(x && [x.requesterId, x.recipientId].includes(me) && [x.requesterId, x.recipientId].includes(otherId), "err.invalidContext", "forbidden");
    } else contextId = undefined;
    const pair = [me, otherId].sort() as [ID, ID];
    const key = `${pair[0]}|${pair[1]}|${contextType}|${contextId ?? ""}`;
    const existing = db.conversations.find((c) => c.participantIds.length === 2 && c.participantIds.includes(me) && c.participantIds.includes(otherId) && c.contextType === contextType && (c.contextId ?? "") === (contextId ?? ""));
    if (existing) return existing.id;
    const t = now();
    const c: Conversation = { id: uid(), key, participantIds: pair, contextType, contextId, createdAt: t, lastMessageAt: t };
    db.conversations.push(c);
    return c.id;
  }));
}

function memberConversation(db: DB, id: ID) {
  const me = sessionUser(db);
  const c = db.conversations.find((x) => x.id === id);
  need(c && c.participantIds.includes(me), "err.conversationNotFound", "forbidden");
  return { me, c, other: c.participantIds[0] === me ? c.participantIds[1] : c.participantIds[0] };
}

export async function sendMessage(conversationId: ID, bodyRaw: string, clientId: string): Promise<Message> {
  need(typeof bodyRaw === "string", "err.messageEmpty");
  need(typeof clientId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(clientId), "err.invalid");
  const body = bodyRaw.replace(/\r/g, "").trim();
  need(body.length > 0, "err.messageEmpty");
  lengthCheck(body, LIMITS.message);
  return exclusiveWrite(() => transact((db) => {
    const { me, c, other } = memberConversation(db, conversationId);
    need(!blockedBetween(db, me, other), "err.cannotContact", "forbidden");
    need(db.users.some((u) => u.id === other && u.status !== "suspended"), "community.memberUnavailable", "forbidden");
    const dupe = db.messages.find((m) => m.id === clientId);
    if (dupe) {
      need(dupe.conversationId === conversationId && dupe.senderId === me && dupe.body === body, "community.retryConflict", "conflict");
      return dupe;
    }
    const recent = db.messages.filter((m) => m.senderId === me && Date.now() - Date.parse(m.createdAt) < 60_000).length;
    need(recent < 20, "err.rateLimited", "rate_limited");
    const m: Message = { id: clientId, conversationId, senderId: me, body, createdAt: now() };
    db.messages.push(m);
    c.lastMessageAt = m.createdAt;
    notify(db, other, "message", "notif.message", { name: nameOf(db, me), preview: body.slice(0, 60) + (body.length > 60 ? "…" : "") }, `/messages/${c.id}`, c.id);
    return m;
  }));
}

export async function markConversationRead(conversationId: ID, throughMessageId?: ID) {
  return exclusiveWrite(() => transact((db) => {
    const { me } = memberConversation(db, conversationId);
    const history = orderedMessages(db, conversationId);
    const index = throughMessageId ? history.findIndex((m) => m.id === throughMessageId) : history.length - 1;
    need(!throughMessageId || index >= 0, "err.invalid");
    const timestamp = now();
    history.slice(0, index + 1).forEach((m) => {
      if (m.senderId !== me && !m.readAt) m.readAt = timestamp;
    });
    // A message that arrived after the visible snapshot must remain unread.
    if (!history.some((m) => m.senderId !== me && !m.readAt)) {
      db.notifications.forEach((n) => {
        if (n.userId === me && n.kind === "message" && n.refId === conversationId && !n.readAt) n.readAt = timestamp;
      });
    }
  }));
}

function orderedMessages(db: DB, conversationId: ID) {
  return db.messages.filter((m) => m.conversationId === conversationId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function contextLabel(db: DB, c: Conversation, me: ID): { key: Key; vars?: Vars; link: string | null; unavailable: boolean } | null {
  if (c.contextType === "listing") {
    const l = db.listings.find((x) => x.id === c.contextId);
    if (!l) return { key: "ctx.listingRemoved", link: null, unavailable: true };
    const ok = isPubliclyVisible(l) || l.ownerId === me;
    return { key: l.kind === "offer" ? "ctx.offer" : "ctx.need", vars: { title: l.title }, link: ok ? `/listing/${l.id}` : null, unavailable: !ok };
  }
  if (c.contextType === "exchange") {
    const x = db.exchanges.find((e) => e.id === c.contextId);
    if (!x) return { key: "ctx.exchangeUnavailable", link: null, unavailable: true };
    return { key: x.status === "pending" ? "ctx.request" : "ctx.collab", vars: { title: x.title }, link: `/collaborations/${x.id}`, unavailable: false };
  }
  return null;
}

export function getConversations() {
  const db = read();
  const me = sessionUser(db);
  return db.conversations
    .filter((c) => c.participantIds.includes(me))
    .map((c) => {
      const msgs = orderedMessages(db, c.id);
      const last = msgs[msgs.length - 1];
      const otherId = c.participantIds[0] === me ? c.participantIds[1] : c.participantIds[0];
      return {
        conversation: c,
        other: memberOf(db, otherId),
        last,
        unread: msgs.filter((m) => m.senderId !== me && !m.readAt).length,
        context: contextLabel(db, c, me),
        blocked: blockedBetween(db, me, otherId) || !db.users.some((u) => u.id === otherId && u.status !== "suspended"),
        blockedByMe: db.blocks.some((b) => b.blockerId === me && b.blockedId === otherId),
      };
    })
    .filter((x) => x.last || x.conversation.createdAt) // include newly opened chats
    .sort((a, b) => b.conversation.lastMessageAt.localeCompare(a.conversation.lastMessageAt));
}

/**
 * Member directory search for starting conversations.
 * Searches every registered member by full name or username (case-insensitive, trimmed).
 * Email is never searched or returned. Excludes the signed-in member and blocked members;
 * does NOT require an existing conversation or published listings.
 */
export function searchMembers(query: string, limit = 20) {
  const db = read();
  const me = sessionUser(db);
  need(typeof query === "string", "err.invalid");
  const normalize = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
  const q = normalize(query).replace(/^@/, "").trim();
  need(q.length <= 120, "err.maxLength", "invalid", { max: 120 });
  const maxResults = Math.min(50, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 20)));
  if (!q) return [];
  const terms = q.split(/\s+/);
  return db.profiles
    .filter((p) => p.userId !== me && db.users.some((u) => u.id === p.userId && u.status !== "suspended") && !blockedBetween(db, me, p.userId))
    .map((p) => {
      const name = normalize(p.fullName);
      const user = normalize(p.username);
      const hay = `${name} ${user}`;
      if (!terms.every((t) => hay.includes(t))) return null;
      const rank = user === q ? 0 : user.startsWith(q) || name.startsWith(q) ? 1 : 2;
      return { rank, member: memberOf(db, p.userId) };
    })
    .filter((x): x is { rank: number; member: PublicMember } => x !== null)
    .sort((a, b) => a.rank - b.rank || a.member.fullName.localeCompare(b.member.fullName))
    .slice(0, maxResults)
    .map((x) => ({
      ...x.member,
      conversationId: db.conversations.find((c) => c.contextType === "none" && c.participantIds.includes(me) && c.participantIds.includes(x.member.userId))?.id,
    }));
}

export function getMessages(conversationId: ID, limit: number) {
  const db = read();
  memberConversation(db, conversationId);
  const all = orderedMessages(db, conversationId);
  const size = Math.min(5000, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 50)));
  return { messages: all.slice(-size), hasMore: all.length > size };
}

export function unreadMessageCount() {
  const db = read();
  const me = currentUserId();
  if (!me) return 0;
  const mine = new Set(db.conversations.filter((c) => c.participantIds.includes(me)).map((c) => c.id));
  return db.messages.filter((m) => mine.has(m.conversationId) && m.senderId !== me && !m.readAt).length;
}

export function setBlocked(otherId: ID, blocked: boolean) {
  transact((db) => {
    const me = sessionUser(db);
    need(otherId !== me, "err.invalid");
    db.blocks = db.blocks.filter((b) => !(b.blockerId === me && b.blockedId === otherId));
    if (blocked) db.blocks.push({ blockerId: me, blockedId: otherId, createdAt: now() });
  });
}

export function report(targetType: "review" | "user", targetId: ID, reason: string) {
  need(typeof reason === "string", "err.reportReason");
  const r = reason.trim();
  need(r.length >= 5, "err.reportReason");
  lengthCheck(r, 500);
  need(targetType === "review" || targetType === "user", "err.invalid");
  transact((db) => {
    const me = sessionUser(db);
    const exists = targetType === "review" ? eligibleReviews(db).some((review) => review.id === targetId) : db.users.some((u) => u.id === targetId);
    need(exists, "err.invalid", "not_found");
    need(!db.reports.some((x) => x.reporterId === me && x.targetType === targetType && x.targetId === targetId), "err.alreadyReported", "duplicate");
    db.reports.push({ id: uid(), reporterId: me, targetType, targetId, reason: r.slice(0, 500), createdAt: now() });
  });
}

/* ------------------------------------------------------------------ */
/* reviews                                                             */
/* ------------------------------------------------------------------ */

export async function submitReview(exchangeId: ID, rating: number, commentRaw: string): Promise<Review> {
  need(typeof commentRaw === "string", "err.invalid");
  const comment = commentRaw.trim();
  need(Number.isInteger(rating) && rating >= 1 && rating <= 5, "err.rating");
  need(comment.length >= LIMITS.reviewMin, "err.reviewMin", "invalid", { min: LIMITS.reviewMin });
  lengthCheck(comment, LIMITS.review);
  return exclusiveWrite(() => transact((db) => {
    const { me, x, other } = participantExchange(db, exchangeId);
    need(me !== other, "community.reviewSelf", "forbidden");
    need(qualifiesForReview(x), "err.reviewNotCompleted", "forbidden");
    need(db.users.some((u) => u.id === other), "err.memberGone", "not_found");
    need(!db.reviews.some((r) => r.exchangeId === exchangeId && r.reviewerId === me && r.recipientId === other), "err.reviewDuplicate", "duplicate");
    need(db.reviews.filter((r) => r.reviewerId === me && Date.now() - Date.parse(r.createdAt) < 60_000).length < 5, "err.rateLimited", "rate_limited");
    const timestamp = now();
    const r: Review = { id: uid(), exchangeId, reviewerId: me, recipientId: other, rating, comment, createdAt: timestamp, updatedAt: timestamp };
    db.reviews.push(r);
    logEvent(db, { exchangeId, audience: [other], actorId: me, type: "review_received", key: "ev.review", vars: { name: nameOf(db, me), rating } });
    const username = db.profiles.find((p) => p.userId === other)?.username;
    notify(db, other, "review", "notif.review", { name: nameOf(db, me), title: x.title }, username ? `/u/${encodeURIComponent(username)}?tab=reviews` : "/reviews", r.id);
    return r;
  }));
}

export function getMyReviewData() {
  const db = read();
  const me = sessionUser(db);
  const completed = db.exchanges.filter((x) => qualifiesForReview(x) && (x.requesterId === me || x.recipientId === me));
  const reviews = eligibleReviews(db);
  return {
    received: reviews.filter((r) => r.recipientId === me).map((r) => ({ ...r, member: memberOf(db, r.reviewerId), exchangeTitle: db.exchanges.find((x) => x.id === r.exchangeId)?.title ?? "" })),
    given: reviews.filter((r) => r.reviewerId === me).map((r) => ({ ...r, member: memberOf(db, r.recipientId), exchangeTitle: db.exchanges.find((x) => x.id === r.exchangeId)?.title ?? "" })),
    pending: completed
      .filter((x) => !db.reviews.some((r) => r.exchangeId === x.id && r.reviewerId === me))
      .map((x) => ({ exchange: x, other: memberOf(db, x.requesterId === me ? x.recipientId : x.requesterId) })),
    summary: ratingSummary(db, me),
    completedCount: completed.length,
    reportedIds: new Set(db.reports.filter((r) => r.reporterId === me && r.targetType === "review").map((r) => r.targetId)),
  };
}

/* ------------------------------------------------------------------ */
/* matching input (server-side shape)                                  */
/* ------------------------------------------------------------------ */

export function getMatchInput() {
  const db = read();
  const me = sessionUser(db);
  const myProfile = db.profiles.find((p) => p.userId === me);
  const mine = db.listings.filter((l) => l.ownerId === me && isPubliclyVisible(l));
  const others = new Map<ID, { profile?: Profile; offers: Listing[]; needs: Listing[]; publicLocation?: string }>();
  for (const l of db.listings) {
    if (l.ownerId === me || !isPubliclyVisible(l) || blockedBetween(db, me, l.ownerId)) continue;
    if (!others.has(l.ownerId)) {
      const p = db.profiles.find((x) => x.userId === l.ownerId);
      others.set(l.ownerId, { profile: p, offers: [], needs: [], publicLocation: p?.visibility.location ? p.location : l.location || undefined });
    }
    const o = others.get(l.ownerId)!;
    (l.kind === "offer" ? o.offers : o.needs).push(l);
  }
  return {
    me,
    myProfile,
    myOffers: mine.filter((l) => l.kind === "offer"),
    myNeeds: mine.filter((l) => l.kind === "need"),
    others,
    exchanges: db.exchanges.filter((x) => x.requesterId === me || x.recipientId === me),
    members: new Map([...others.keys()].map((id) => [id, memberOf(db, id)])),
  };
}

/* ------------------------------------------------------------------ */
/* personal QR codes & friend connections                              */
/* ------------------------------------------------------------------ */

export type RelationshipState = "self" | "blocked" | "none" | "outgoing_pending" | "incoming_pending" | "friends";

function connectionBetween(db: DB, a: ID, b: ID): Connection | undefined {
  const matches = db.connections.filter(
    (c) => (c.requesterId === a && c.recipientId === b) || (c.requesterId === b && c.recipientId === a),
  );
  return (
    matches.find((c) => c.status === "accepted") ??
    matches.find((c) => c.status === "pending") ??
    matches.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0]
  );
}

function relationshipFor(db: DB, me: ID, otherId: ID): { status: RelationshipState; connectionId?: ID } {
  if (me === otherId) return { status: "self" };
  if (blockedBetween(db, me, otherId)) return { status: "blocked" };
  const c = connectionBetween(db, me, otherId);
  if (!c || c.status === "rejected") return { status: "none" };
  if (c.status === "accepted") return { status: "friends", connectionId: c.id };
  return {
    status: c.requesterId === me ? "outgoing_pending" : "incoming_pending",
    connectionId: c.id,
  };
}

function baseAppUrl() {
  if (typeof window === "undefined") return "https://skillswap.rural/";
  const { origin, pathname } = window.location;
  if (origin && origin !== "null" && /^https?:\/\//i.test(origin)) return `${origin}${pathname}`;
  return "https://skillswap.rural/";
}

/** Ensures the signed-in member has a persisted, unique public QR token. */
export async function ensureMyQrToken(): Promise<string> {
  const db = read();
  const me = sessionUser(db);
  const existing = db.profiles.find((p) => p.userId === me)?.qrToken;
  if (existing) return existing;
  return exclusiveWrite(() =>
    transact((d) => {
      const uidMe = sessionUser(d);
      const p = d.profiles.find((x) => x.userId === uidMe);
      need(p, "err.profileNotFound", "not_found");
      if (!p.qrToken) {
        let candidate = makeQrToken();
        while (d.profiles.some((other) => other.qrToken === candidate)) candidate = makeQrToken();
        p.qrToken = candidate;
      }
      return p.qrToken;
    }),
  );
}

export function getMyQrIdentity() {
  const db = read();
  const me = sessionUser(db);
  const p = db.profiles.find((x) => x.userId === me);
  need(p, "err.profileNotFound", "not_found");
  const base = baseAppUrl();
  const qrToken = p.qrToken ?? "";
  return {
    userId: me,
    fullName: p.fullName,
    username: p.username,
    occupation: p.occupation,
    avatar: p.avatar,
    qrToken,
    qrPayload: qrToken ? `${base}#/scan-qr?code=${encodeURIComponent(qrToken)}` : "",
    profileUrl: `${base}#/u/${encodeURIComponent(p.username)}`,
  };
}

const QR_TOKEN_RE = /^ssr_[a-z0-9]{12,64}$/i;

function parseQrInput(rawInput: string): { kind: "token" | "username"; value: string } | null {
  if (typeof rawInput !== "string") return null;
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 512) return null;

  if (QR_TOKEN_RE.test(trimmed)) return { kind: "token", value: trimmed.toLowerCase() };

  // Extract route fragment from SkillSwap Rural links (hash or path), rejecting arbitrary URLs.
  let routePart = trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    if (!/^https?:\/\//i.test(trimmed)) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.hash.startsWith("#/")) {
        routePart = parsed.hash.slice(1);
      } else if (parsed.pathname.startsWith("/u/") || parsed.pathname.startsWith("/scan-qr")) {
        routePart = `${parsed.pathname}${parsed.search}`;
      } else {
        return null;
      }
    } catch {
      return null;
    }
  } else if (trimmed.startsWith("#/")) {
    routePart = trimmed.slice(1);
  }

  if (routePart.startsWith("/scan-qr")) {
    const qIndex = routePart.indexOf("?");
    if (qIndex < 0) return null;
    const params = new URLSearchParams(routePart.slice(qIndex + 1));
    const code = (params.get("code") ?? "").trim().toLowerCase();
    return QR_TOKEN_RE.test(code) ? { kind: "token", value: code } : null;
  }

  const userMatch = routePart.match(/^\/u\/([a-z0-9_]{3,24})(?:[/?#]|$)/i);
  if (userMatch) return { kind: "username", value: userMatch[1].toLowerCase() };

  return null;
}

/** Validates a scanned QR payload or connection token without creating any request or message. */
export function resolveQrPayload(rawInput: string) {
  const db = read();
  const me = sessionUser(db);
  const parsed = parseQrInput(rawInput);
  need(parsed, "scan.err.invalidCode", "invalid");

  const profile =
    parsed.kind === "token"
      ? db.profiles.find((p) => (p.qrToken ?? "").toLowerCase() === parsed.value)
      : db.profiles.find((p) => p.username.toLowerCase() === parsed.value);

  const user = profile ? db.users.find((u) => u.id === profile.userId && u.status !== "suspended") : undefined;
  need(profile && user, "scan.err.notFound", "not_found");
  need(!blockedBetween(db, me, profile.userId), "err.cannotContact", "forbidden");

  const isSelf = profile.userId === me;
  return {
    isSelf,
    member: memberOf(db, profile.userId),
    bio: profile.visibility.bio || isSelf ? profile.bio : "",
    skills: (profile.visibility.skills || isSelf ? profile.skills : []).slice(0, 6),
    connection: relationshipFor(db, me, profile.userId),
  };
}

export function getConnectionState(otherUserId: ID) {
  const db = read();
  const me = sessionUser(db);
  need(db.users.some((u) => u.id === otherUserId), "err.memberGone", "not_found");
  return relationshipFor(db, me, otherUserId);
}

export function getMyConnections() {
  const db = read();
  const me = sessionUser(db);
  const activeUser = (id: ID) => db.users.some((u) => u.id === id && u.status !== "suspended") && !blockedBetween(db, me, id);

  const friends = db.connections
    .filter((c) => c.status === "accepted" && (c.requesterId === me || c.recipientId === me))
    .map((c) => {
      const otherId = c.requesterId === me ? c.recipientId : c.requesterId;
      return { connection: c, otherId };
    })
    .filter((x) => activeUser(x.otherId))
    .sort((a, b) => b.connection.updatedAt.localeCompare(a.connection.updatedAt))
    .map((x) => ({ connectionId: x.connection.id, since: x.connection.respondedAt ?? x.connection.updatedAt, member: memberOf(db, x.otherId) }));

  const incoming = db.connections
    .filter((c) => c.status === "pending" && c.recipientId === me && activeUser(c.requesterId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => ({ connectionId: c.id, createdAt: c.createdAt, member: memberOf(db, c.requesterId) }));

  const outgoing = db.connections
    .filter((c) => c.status === "pending" && c.requesterId === me && activeUser(c.recipientId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => ({ connectionId: c.id, createdAt: c.createdAt, member: memberOf(db, c.recipientId) }));

  return { friends, incoming, outgoing };
}

export async function sendFriendRequest(targetUserId: ID): Promise<Connection> {
  return exclusiveWrite(() =>
    transact((db) => {
      const me = sessionUser(db);
      need(typeof targetUserId === "string" && targetUserId.length > 0, "err.invalid");
      need(targetUserId !== me, "err.friendSelf", "invalid");
      const target = db.users.find((u) => u.id === targetUserId);
      need(target, "err.memberGone", "not_found");
      need(target.status !== "suspended", "community.memberUnavailable", "forbidden");
      need(!blockedBetween(db, me, targetUserId), "err.cannotContact", "forbidden");

      const recent = db.connections.filter((c) => c.requesterId === me && Date.now() - Date.parse(c.createdAt) < 60_000).length;
      need(recent < 20, "err.rateLimited", "rate_limited");

      const existing = connectionBetween(db, me, targetUserId);
      if (existing?.status === "accepted") throw new ApiError("err.alreadyFriends", "duplicate");
      if (existing?.status === "pending") {
        throw new ApiError(
          existing.requesterId === me ? "err.friendRequestPending" : "err.friendRequestIncoming",
          existing.requesterId === me ? "duplicate" : "conflict",
        );
      }

      const t = now();
      let record: Connection;
      if (existing && existing.status === "rejected") {
        existing.requesterId = me;
        existing.recipientId = targetUserId;
        existing.status = "pending";
        existing.createdAt = t;
        existing.updatedAt = t;
        existing.respondedAt = undefined;
        record = existing;
      } else {
        record = { id: uid(), requesterId: me, recipientId: targetUserId, status: "pending", createdAt: t, updatedAt: t };
        db.connections.push(record);
      }

      const myUsername = db.profiles.find((p) => p.userId === me)?.username;
      notify(
        db,
        targetUserId,
        "connection",
        "notif.friendRequest",
        { name: nameOf(db, me) },
        myUsername ? `/u/${encodeURIComponent(myUsername)}` : "/qr-code",
        record.id,
      );
      return record;
    }),
  );
}

export async function respondFriendRequest(otherUserId: ID, decision: "accept" | "reject"): Promise<Connection> {
  need(decision === "accept" || decision === "reject", "err.invalid");
  return exclusiveWrite(() =>
    transact((db) => {
      const me = sessionUser(db);
      need(otherUserId !== me, "err.invalid");
      const pending = db.connections.find(
        (c) => c.status === "pending" && c.requesterId === otherUserId && c.recipientId === me,
      );
      need(pending, "err.friendRequestNotFound", "not_found");
      need(!blockedBetween(db, me, otherUserId), "err.cannotContact", "forbidden");

      const t = now();
      pending.status = decision === "accept" ? "accepted" : "rejected";
      pending.respondedAt = t;
      pending.updatedAt = t;

      if (decision === "accept") {
        const myUsername = db.profiles.find((p) => p.userId === me)?.username;
        notify(
          db,
          otherUserId,
          "connection",
          "notif.friendAccepted",
          { name: nameOf(db, me) },
          myUsername ? `/u/${encodeURIComponent(myUsername)}` : "/messages",
          pending.id,
        );
      }
      return pending;
    }),
  );
}

export async function cancelFriendRequest(otherUserId: ID): Promise<void> {
  return exclusiveWrite(() =>
    transact((db) => {
      const me = sessionUser(db);
      const pending = db.connections.find(
        (c) => c.status === "pending" && c.requesterId === me && c.recipientId === otherUserId,
      );
      need(pending, "err.friendRequestNotFound", "not_found");
      db.connections = db.connections.filter((c) => c.id !== pending.id);
    }),
  );
}
