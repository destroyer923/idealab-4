import { ApiError, exclusiveWrite, getSessionUserId, now, read, setSessionUserId, transact, uid } from "./db";
import { CATEGORIES, LIMITS } from "./constants";
import { isLang, setVisitorLang, translate, visitorLang } from "./i18n";
import type { Key } from "@/locales/en";
import { validateListingContent } from "../../server/src/listing/validation";
import type {
  ActivityEvent, AppNotification, CommitmentProgress, Connection, Conversation, ContextType, DB, Delivery, EventType, Exchange,
  ID, Listing, ListingKind, Message, Milestone, MilestoneStatus, Profile, PublicMember, Review, SavedListing, Skill, User, UserRole, Vars,
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
    };
  return {
    userId,
    fullName: p.fullName,
    username: p.username,
    occupation: p.occupation,
    avatar: p.avatar,
    location: p.visibility.location && p.location ? p.location : undefined,
  };
}

export function isPubliclyVisible(l: Listing) {
  if (l.deletedAt) return false;
  if (l.status === "pending_review" || l.status === "rejected") return false;
  return l.kind === "offer" ? l.status === "active" : l.status === "open" || l.status === "matched";
}

function listingForUi(listing: Listing): Listing {
  return listing.status === "pending_review" || listing.status === "rejected"
    ? { ...listing, status: "draft" }
    : listing;
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
const API_BASE_URL =
  (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL?.replace(/\/+$/, "") ||
  "http://localhost:5000";
const AUTH_TOKEN_KEY = "skillswap-rural.auth-token.v1";

type AuthResponse = {
  token: string;
  user: {
    id: ID;
    email: string;
    role: UserRole;
    status: "active" | "suspended";
    profile: Omit<Profile, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string };
  };
};

async function authenticate(
  endpoint: "register" | "login",
  input: Record<string, string>,
): Promise<AuthResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiError("err.generic", "network_error");
  }

  let payload: AuthResponse | { code?: string };
  try {
    const decoded: unknown = await response.json();
    if (typeof decoded !== "object" || decoded === null) {
      throw new Error("Invalid authentication response");
    }
    payload = decoded as AuthResponse | { code?: string };
  } catch {
    throw new ApiError("err.generic", "invalid_server_response");
  }
  if (!response.ok) {
    const code = "code" in payload ? payload.code : undefined;
    const message =
      code === "invalid_email" ? "err.invalidEmail"
        : code === "invalid_full_name" ? "err.fullNameRequired"
          : code === "invalid_username" ? "err.usernameFormat"
            : code === "invalid_password" ? "err.passwordLength"
              : code === "account_exists" ? "err.emailTaken"
                : code === "invalid_credentials" ? "err.badCredentials"
                  : code === "account_suspended" ? "err.accountSuspended"
                    : "err.generic";
    throw new ApiError(message, response.status === 401 ? "unauthenticated" : "server_error");
  }
  if (!("token" in payload) || !payload.token || !payload.user?.id || !payload.user.profile) {
    throw new ApiError("err.generic", "invalid_server_response");
  }
  return payload;
}

function cacheAuthenticatedUser(user: AuthResponse["user"]) {
  const timestamp = now();
  const profile: Profile = {
    userId: user.id,
    fullName: user.profile.fullName,
    username: user.profile.username,
    bio: user.profile.bio ?? "",
    occupation: user.profile.occupation ?? "",
    roles: user.profile.roles ?? [],
    location: user.profile.location ?? "",
    languages: user.profile.languages ?? [],
    skills: user.profile.skills ?? [],
    interests: user.profile.interests ?? [],
    collabTypes: user.profile.collabTypes ?? [],
    availability: user.profile.availability ?? "",
    avatar: user.profile.avatar,
    cover: user.profile.cover,
    portfolio: user.profile.portfolio ?? [],
    visibility: user.profile.visibility ?? { bio: true, location: false, skills: true, portfolio: true },
    prefs: user.profile.prefs ?? { messages: true, exchanges: true, reviews: true },
    qrToken: user.profile.qrToken,
    language: isLang(user.profile.language) ? user.profile.language : "en",
    createdAt: user.profile.createdAt ?? timestamp,
    updatedAt: user.profile.updatedAt ?? timestamp,
  };

  transact((db) => {
    const localUser: User = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      passwordHash: "",
      salt: "",
      createdAt: timestamp,
    };
    const userIndex = db.users.findIndex((entry) => entry.id === user.id);
    if (userIndex === -1) db.users.push(localUser);
    else db.users[userIndex] = { ...db.users[userIndex], ...localUser };

    const profileIndex = db.profiles.findIndex((entry) => entry.userId === user.id);
    if (profileIndex === -1) db.profiles.push(profile);
    else db.profiles[profileIndex] = { ...db.profiles[profileIndex], ...profile };
  });
  setSessionUserId(user.id);
  setVisitorLang(profile.language ?? "en");
}

export async function register(input: { email: string; password: string; fullName: string; username: string; language?: string }) {
  const email = clean(input.email, 120).toLowerCase();
  const fullName = clean(input.fullName, 80);
  const username = clean(input.username, 24).toLowerCase();
  need(EMAIL_RE.test(email), "err.invalidEmail");
  need(fullName.length >= 2, "err.fullNameRequired");
  lengthCheck(fullName, 80);
  need(USERNAME_RE.test(username), "err.usernameFormat");
  need(input.password.length >= 8, "err.passwordLength");
  const result = await authenticate("register", {
    email,
    password: input.password,
    fullName,
    username,
    language: isLang(input.language) ? input.language : visitorLang(),
  });
  sessionStorage.setItem(AUTH_TOKEN_KEY, result.token);
  cacheAuthenticatedUser(result.user);
}

export async function login(emailRaw: string, password: string) {
  const email = clean(emailRaw, 120).toLowerCase();
  const result = await authenticate("login", { email, password });
  sessionStorage.setItem(AUTH_TOKEN_KEY, result.token);
  cacheAuthenticatedUser(result.user);
}

export function logout() {
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
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

export async function getMe(): Promise<{ profile: Profile; email: string }> {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) throw new ApiError("err.unauthenticated", "unauthenticated");

  const response = await fetch(`${API_BASE_URL}/api/profile/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload && typeof payload === "object" && "code" in payload ? String((payload as { code?: string }).code) : undefined;
    throw new ApiError(code === "unauthenticated" ? "err.unauthenticated" : "err.profileNotFound", response.status === 401 ? "unauthenticated" : "not_found");
  }
  if (!payload || typeof payload !== "object" || !("profile" in payload)) {
    throw new ApiError("err.profileNotFound", "not_found");
  }
  const profile = payload.profile as Partial<Profile> & { createdAt?: string; updatedAt?: string };
  return {
    email: typeof payload.email === "string" ? payload.email : "",
    profile: {
      userId: profile.userId ?? getSessionUserId() ?? "",
      fullName: profile.fullName ?? "",
      username: profile.username ?? "",
      bio: profile.bio ?? "",
      occupation: profile.occupation ?? "",
      roles: profile.roles ?? [],
      location: profile.location ?? "",
      languages: profile.languages ?? [],
      skills: profile.skills ?? [],
      interests: profile.interests ?? [],
      collabTypes: profile.collabTypes ?? [],
      availability: profile.availability ?? "",
      avatar: profile.avatar,
      cover: profile.cover,
      portfolio: profile.portfolio ?? [],
      visibility: profile.visibility ?? { bio: true, location: false, skills: true, portfolio: true },
      prefs: profile.prefs ?? { messages: true, exchanges: true, reviews: true },
      qrToken: profile.qrToken ?? "",
      language: isLang(profile.language) ? profile.language : "en",
      createdAt: profile.createdAt ?? now(),
      updatedAt: profile.updatedAt ?? now(),
    },
  };
}

export async function isUsernameAvailable(username: string) {
  const u = username.trim().toLowerCase();
  if (!USERNAME_RE.test(u)) return false;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/profile/check-username?username=${encodeURIComponent(u)}`);
  } catch {
    throw new ApiError("err.generic", "network_error");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError("err.generic", "server_error");
  if (!payload || typeof payload !== "object" || !("available" in payload) || typeof payload.available !== "boolean") {
    throw new ApiError("err.generic", "invalid_server_response");
  }
  return payload.available;
}

export type ProfileInput = Pick<Profile, "fullName" | "username" | "bio" | "occupation" | "roles" | "location" | "languages" | "skills" | "interests" | "collabTypes" | "availability" | "avatar" | "cover" | "portfolio" | "visibility">;

export async function updateProfile(input: ProfileInput) {
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

  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) throw new ApiError("err.unauthenticated", "unauthenticated");

  const response = await fetch(`${API_BASE_URL}/api/profile/me`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      fullName,
      username,
      bio,
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
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload && typeof payload === "object" && "code" in payload ? String((payload as { code?: string }).code) : undefined;
    const message = code === "username_taken" ? "err.usernameTaken" : code === "invalid_profile" ? "err.usernameFormat" : "err.profileNotFound";
    throw new ApiError(message, response.status === 409 ? "conflict" : response.status === 401 ? "unauthenticated" : "server_error");
  }

  const nextProfile = (payload as { profile?: Partial<Profile> }).profile ?? {};
  const me = getSessionUserId() ?? "";
  transact((db) => {
    const user = db.users.find((u) => u.id === me);
    if (user) user.email = user.email;
    const profile = {
      userId: me,
      fullName: nextProfile.fullName ?? input.fullName,
      username: nextProfile.username ?? input.username,
      bio: nextProfile.bio ?? input.bio,
      occupation: nextProfile.occupation ?? input.occupation,
      roles: nextProfile.roles ?? input.roles,
      location: nextProfile.location ?? input.location,
      languages: nextProfile.languages ?? input.languages,
      skills: nextProfile.skills ?? input.skills,
      interests: nextProfile.interests ?? input.interests,
      collabTypes: nextProfile.collabTypes ?? input.collabTypes,
      availability: nextProfile.availability ?? input.availability,
      avatar: nextProfile.avatar ?? input.avatar,
      cover: nextProfile.cover ?? input.cover,
      portfolio: nextProfile.portfolio ?? input.portfolio,
      visibility: nextProfile.visibility ?? input.visibility,
      prefs: nextProfile.prefs ?? { messages: true, exchanges: true, reviews: true },
      qrToken: nextProfile.qrToken ?? "",
      language: isLang(nextProfile.language) ? nextProfile.language : "en",
      createdAt: nextProfile.createdAt ?? now(),
      updatedAt: nextProfile.updatedAt ?? now(),
    };
    const index = db.profiles.findIndex((entry) => entry.userId === me);
    if (index === -1) db.profiles.push(profile as Profile);
    else db.profiles[index] = { ...db.profiles[index], ...profile };
  });
  return (payload as { profile?: Partial<Profile> }).profile ?? {};
}

export async function updatePrefs(prefs: Profile["prefs"]) {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) throw new ApiError("err.unauthenticated", "unauthenticated");
  const response = await fetch(`${API_BASE_URL}/api/profile/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ prefs }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const code = payload && typeof payload === "object" && "code" in payload ? String((payload as { code?: string }).code) : undefined;
    throw new ApiError(code === "unauthenticated" ? "err.unauthenticated" : "err.profileNotFound", response.status === 401 ? "unauthenticated" : "server_error");
  }
  const { profile } = await getMe();
  const userId = getSessionUserId();
  if (!userId) throw new ApiError("err.unauthenticated", "unauthenticated");
  transact((db) => {
    const stored = db.profiles.find((entry) => entry.userId === userId);
    if (stored) stored.prefs = { ...prefs };
    else db.profiles.push({ ...profile, prefs: { ...prefs } });
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

type PublicProfileReview = Review & {
  reviewer: PublicMember;
  verifiedExchange: boolean;
  canOpenExchange: boolean;
  reported?: boolean;
};

type PublicProfileResult = {
  profile: Profile;
  isMe: boolean;
  member: PublicMember;
  offers: Listing[];
  needs: Listing[];
  reviews: PublicProfileReview[];
  rating: { count: number; average: number | null; distribution?: number[] };
  completedExchanges: number;
  blocked?: boolean;
};

export async function getPublicProfile(username: string): Promise<PublicProfileResult | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/profile/${encodeURIComponent(username.toLowerCase())}`);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new ApiError("err.profileNotFound", "not_found");
    }
    const payload = await response.json();
    if (typeof payload !== "object" || payload === null || !("profile" in payload)) {
      throw new ApiError("err.profileNotFound", "invalid_server_response");
    }
    const result = payload as Omit<PublicProfileResult, "profile" | "member"> & {
      profile: Partial<Profile>;
      member?: Partial<PublicMember>;
    };
    const source = result.profile;
    const profile: Profile = {
      userId: source.userId ?? result.member?.userId ?? "",
      fullName: source.fullName ?? "",
      username: source.username ?? "",
      bio: source.bio ?? "",
      occupation: source.occupation ?? "",
      roles: source.roles ?? [],
      location: source.location ?? "",
      languages: source.languages ?? [],
      skills: source.skills ?? [],
      interests: source.interests ?? [],
      collabTypes: source.collabTypes ?? [],
      availability: source.availability ?? "",
      avatar: source.avatar,
      cover: source.cover,
      portfolio: source.portfolio ?? [],
      visibility: source.visibility ?? { bio: true, location: false, skills: true, portfolio: true },
      prefs: source.prefs ?? { messages: true, exchanges: true, reviews: true },
      qrToken: source.qrToken,
      language: isLang(source.language) ? source.language : "en",
      createdAt: source.createdAt ?? now(),
      updatedAt: source.updatedAt ?? now(),
    };
    const member: PublicMember = {
      userId: result.member?.userId ?? profile.userId,
      fullName: result.member?.fullName ?? profile.fullName,
      username: result.member?.username ?? profile.username,
      occupation: result.member?.occupation ?? profile.occupation,
      avatar: result.member?.avatar ?? profile.avatar,
      location: result.member?.location ?? profile.location,
    };
    return {
      ...result,
      member,
      isMe: profile.userId === getSessionUserId(),
      profile,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("err.profileNotFound", "not_found");
  }
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
}

export type FieldError = { key: Key; vars?: Vars };

export function validateListing(kind: ListingKind, input: ListingInput): Record<string, FieldError> {
  const e: Record<string, FieldError> = {};
  const max = (n: number): FieldError => ({ key: "err.maxLength", vars: { max: n } });
  const contentErrors = validateListingContent(input, kind);
  for (const [field, key] of Object.entries(contentErrors)) {
    e[field] = key === "err.maxLength"
      ? max(field === "title" ? LIMITS.title : field === "description" ? LIMITS.description : LIMITS.details)
      : { key };
  }
  if (input.exchangePref.trim().length > LIMITS.pref) e.exchangePref = max(LIMITS.pref);
  if (input.location.trim().length > LIMITS.short) e.location = max(LIMITS.short);
  if (input.availability.trim().length > LIMITS.short) e.availability = max(LIMITS.short);
  if (input.quantity.trim().length > LIMITS.short) e.quantity = max(LIMITS.short);
  if (input.images.length > LIMITS.imagesPerListing) e.images = { key: "err.imagesMax", vars: { n: LIMITS.imagesPerListing } };
  if (input.images.some((i) => !i.startsWith("data:image/"))) e.images = { key: "err.imagesInvalid" };
  return e;
}

/** Maps a listing's status to its English status value. */
export function publishedStatus(l: Listing) {
  return l.kind === "offer" ? "active" : "open";
}

export async function createListing(kind: ListingKind, input: ListingInput, publish: boolean) {
  const errors = validateListing(kind, input);
  const first = Object.values(errors)[0];
  need(!first, first?.key ?? "err.invalid", "invalid", first?.vars);
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) throw new ApiError("err.unauthenticated", "unauthenticated");

  const response = await fetch(`${API_BASE_URL}/api/listing/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...input, publish }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = typeof payload === "object" && payload !== null ? payload as { code?: string; message?: string; vars?: Record<string, string | number> } : {};
    throw new ApiError(body.message ?? (body.code === "unauthenticated" ? "err.unauthenticated" : "err.generic"), body.code ?? "server_error", body.vars);
  }
  return payload as Listing;
}

export async function updateListing(id: ID, input: ListingInput, publish?: boolean) {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) throw new ApiError("err.unauthenticated", "unauthenticated");

  const response = await fetch(`${API_BASE_URL}/api/listing/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...input, publish: !!publish }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = typeof payload === "object" && payload !== null ? payload as { code?: string; message?: string; vars?: Record<string, string | number> } : {};
    throw new ApiError(body.message ?? (body.code === "unauthenticated" ? "err.unauthenticated" : "err.generic"), body.code ?? "server_error", body.vars);
  }
  return payload as Listing;
}

const TRANSITIONS: Record<string, string[]> = {
  "offer:draft": ["active"],
  "offer:pending_review": ["active", "inactive"],
  "offer:active": ["inactive"],
  "offer:inactive": ["active"],
  "offer:rejected": ["active", "draft"],
  "need:draft": ["open"],
  "need:pending_review": ["open", "paused"],
  "need:rejected": ["open", "draft"],
  "need:open": ["matched", "paused", "fulfilled"],
  "need:matched": ["open", "paused", "fulfilled", "in_progress"],
  "need:in_progress": ["fulfilled", "paused", "open"],
  "need:paused": ["open"],
  "need:fulfilled": ["open"],
};

export function allowedTransitions(l: Listing) {
  return TRANSITIONS[`${l.kind}:${l.status}`] ?? [];
}

export async function setListingStatus(id: ID, status: string) {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) throw new ApiError("err.unauthenticated", "unauthenticated");
  const response = await fetch(`${API_BASE_URL}/api/listing/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = typeof payload === "object" && payload !== null ? payload as { code?: string; message?: string; vars?: Record<string, string | number> } : {};
    throw new ApiError(body.message ?? "err.generic", body.code ?? "server_error", body.vars);
  }
  return payload as Listing;
}

/** Hard delete only when nothing references the listing; otherwise soft delete to preserve history. */
export async function deleteListing(id: ID) {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) throw new ApiError("err.unauthenticated", "unauthenticated");

  const response = await fetch(`${API_BASE_URL}/api/listing/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload && typeof payload === "object" && "code" in payload ? String((payload as { code?: string }).code) : undefined;
    throw new ApiError(code === "unauthenticated" ? "err.unauthenticated" : "err.generic", response.status === 401 ? "unauthenticated" : "server_error");
  }
  return payload.status === "archived" ? "archived" : "deleted";
}

export async function getMyListings(kind: ListingKind) {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) throw new ApiError("err.unauthenticated", "unauthenticated");
  const response = await fetch(`${API_BASE_URL}/api/listing/me?kind=${encodeURIComponent(kind)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new ApiError(response.status === 401 ? "err.unauthenticated" : "err.generic", response.status === 401 ? "unauthenticated" : "server_error");
  return ((await response.json()) as Listing[]).map(listingForUi);
}

export async function getListing(id: ID) {
  const response = await fetch(`${API_BASE_URL}/api/listing/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError("err.generic", "server_error");
  const payload = await response.json();
  const result = payload as { listing: Listing | null; owner: PublicMember; isOwner: boolean; unavailable: string | null };
  return {
    ...result,
    listing: result.listing ? listingForUi(result.listing) : null,
    isOwner: result.isOwner || result.listing?.ownerId === getSessionUserId(),
  };
}

/** Publicly discoverable listings by other members (excludes blocked members). */
export async function getPublicListings() {
  const response = await fetch(`${API_BASE_URL}/api/listing/public`);
  if (!response.ok) throw new ApiError("err.generic", "server_error");
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new ApiError("err.generic", "invalid_server_response");
  return payload.map((entry) => {
    const listing = entry as Listing & { owner?: PublicMember };
    return {
      listing,
      owner: listing.owner ?? { userId: listing.ownerId, fullName: "", username: "", occupation: "" },
    };
  });
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
