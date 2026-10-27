import type { DB, UserRole, ProviderConfig, IdentityProviderConfig } from "./types";

/**
 * Persistent client-side data store.
 *
 * This project is a static React/Vite build with no server or PostgreSQL instance,
 * so the browser's localStorage is the persistence layer. All reads/writes go
 * through `transact`, which re-reads storage and broadcasts successful commits.
 * Messaging/review operations additionally use Web Locks to coordinate tabs.
 * This is not a server security boundary or cross-device database connection.
 *
 * The service layer in `api.ts` is the only module that should call `transact`;
 * swapping this file for real HTTP calls would not require UI changes.
 */

const KEY = "skillswap-rural.db.v1";
const SESSION_KEY = "skillswap-rural.session.v1";

const DEFAULT_PROVIDER = (channel: "phone" | "email"): ProviderConfig => ({ channel, type: "demo", endpoint: "", apiToken: "", label: "Demo" });

/**
 * Identity verification defaults to the reviewer-approved manual workflow: a member submits a
 * declaration and a reviewer must genuinely approve it. `none` would mean no compliant channel
 * exists — in that case publishing is blocked rather than silently skipped.
 */
const DEFAULT_IDENTITY: IdentityProviderConfig = { channel: "identity", type: "manual", endpoint: "", apiToken: "", label: "Manual review" };

const DEFAULT_VERIFY_CONFIG = {
  phone: DEFAULT_PROVIDER("phone"),
  email: DEFAULT_PROVIDER("email"),
  identity: DEFAULT_IDENTITY,
  requiredBusinessCategories: [] as string[],
};

const empty = (): DB => ({
  users: [],
  profiles: [],
  listings: [],
  exchanges: [],
  milestones: [],
  events: [],
  conversations: [],
  messages: [],
  notifications: [],
  saved: [],
  reviews: [],
  blocks: [],
  reports: [],
  connections: [],
  verifications: [],
  otps: [],
  verifyEvents: [],
  verifyConfig: structuredClone(DEFAULT_VERIFY_CONFIG),
});

export class ApiError extends Error {
  code: string;
  vars?: Record<string, string | number>;
  /** `message` is a translation key (e.g. "err.notActive"); the UI translates it. */
  constructor(message: string, code = "error", vars?: Record<string, string | number>) {
    super(message);
    this.code = code;
    this.vars = vars;
  }
}

let cache: DB | null = null;
let lastRaw: string | null | undefined;
let version = 0;
const listeners = new Set<() => void>();
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("skillswap-rural") : null;

/**
 * One-way, backward-compatible migration. Older records are filled in with safe defaults;
 * nothing is dropped, renamed or retyped. Runs at every read, so it also heals records
 * written before this feature existed.
 */
function migrate(db: DB): DB {
  const out = empty();
  out.users = db.users.map((u) => ({ ...u, role: (u.role === "reviewer" || u.role === "admin" ? u.role : "member") as UserRole, status: (u.status === "suspended" ? "suspended" : "active") as "active" | "suspended" }));
  out.profiles = db.profiles.map((p) => ({ ...p, visibility: { ...p.visibility }, prefs: { ...p.prefs }, portfolio: p.portfolio ?? [] }));
  out.listings = db.listings.map((l) => ({ ...l, businessClaimed: !!l.businessClaimed }));
  out.exchanges = db.exchanges;
  out.milestones = db.milestones;
  out.events = db.events;
  out.conversations = db.conversations;
  out.messages = db.messages;
  out.notifications = db.notifications;
  out.saved = db.saved;
  out.reviews = db.reviews;
  out.blocks = db.blocks;
  out.reports = db.reports;
  out.connections = db.connections ?? [];
  out.otps = db.otps ?? [];
  out.verifyEvents = db.verifyEvents ?? [];
  out.verifyConfig = {
    ...DEFAULT_VERIFY_CONFIG,
    ...db.verifyConfig,
    phone: { ...DEFAULT_VERIFY_CONFIG.phone, ...db.verifyConfig.phone },
    email: { ...DEFAULT_VERIFY_CONFIG.email, ...db.verifyConfig.email },
    identity: { ...DEFAULT_VERIFY_CONFIG.identity, ...db.verifyConfig.identity },
    requiredBusinessCategories: db.verifyConfig.requiredBusinessCategories ?? [],
  };
  out.verifications = db.verifications
    .map((v) => ({ ...v, completedExchanges: v.completedExchanges ?? 0 }));
  // Recreate a verification record for any member that has none.
  for (const u of out.users) {
    if (!out.verifications.some((v) => v.userId === u.id))
      out.verifications.push({
        userId: u.id,
        phone: { status: "not_started", masked: "", attempts: 0 },
        email: { status: "not_started", masked: "", attempts: 0 },
        business: { status: "not_started" },
        identity: { status: "not_started" },
        completedExchanges: out.exchanges.filter((x) => x.status === "completed" && (x.requesterId === u.id || x.recipientId === u.id)).length,
        trust: "new",
        updatedAt: now(),
      });
  }
  return out;
}

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    lastRaw = raw;
    if (!raw) return empty();
    return migrate({ ...empty(), ...(JSON.parse(raw) as Partial<DB>) });
  } catch {
    throw new ApiError("err.dbUnavailable", "db_unavailable");
  }
}

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function read(): DB {
  if (!cache) cache = load();
  return cache;
}

/** Commit only successful synchronous operations. Failed writes leave memory and disk unchanged. */
export function transact<T>(fn: (db: DB) => T): T {
  const db = load();
  const result = fn(db);
  if (result && typeof (result as { then?: unknown }).then === "function") {
    throw new Error("Asynchronous callbacks are not supported by transact");
  }
  try {
    const raw = JSON.stringify(db);
    localStorage.setItem(KEY, raw);
    lastRaw = raw;
  } catch {
    throw new ApiError("err.quota", "quota");
  }
  cache = db;
  emit();
  channel?.postMessage("changed");
  return result;
}

/** Coordinate message/review writes across tabs where Web Locks is available. */
export async function exclusiveWrite<T>(fn: () => T): Promise<T> {
  const account = getSessionUserId();
  const run = () => {
    if (!account || account !== getSessionUserId()) throw new ApiError("err.unauthenticated", "unauthenticated");
    return fn();
  };
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`${KEY}.write`, { mode: "exclusive" }, run);
  }
  return run();
}

/** Storage-event fallback. No writes, notifications, or session changes during refresh. */
export function refreshStore(force = false) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!force && raw === lastRaw) return;
    lastRaw = raw;
  } catch {
    // Subscribers will receive a translated read error on their next query.
  }
  cache = null;
  emit();
}

function externalChange() {
  cache = null;
  emit();
}

channel?.addEventListener("message", externalChange);
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === null) externalChange();
  });
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getVersion() {
  return version;
}

/**
 * Session is per browser tab (sessionStorage), so two different accounts can be signed in
 * side by side in two tabs — previously a single shared key made every tab switch to the
 * most recently signed-in account. localStorage only remembers the last account so that a
 * newly opened tab starts signed in; it never changes the account of an already open tab.
 */
const LAST_KEY = SESSION_KEY + ".last";
function tabStore(): Storage | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function getSessionUserId(): string | null {
  const tab = tabStore();
  const own = tab?.getItem(SESSION_KEY);
  if (own) return own;
  if (tab?.getItem(SESSION_KEY + ".out")) return null; // this tab explicitly signed out
  const last = localStorage.getItem(LAST_KEY) ?? localStorage.getItem(SESSION_KEY); // legacy key
  if (last) tab?.setItem(SESSION_KEY, last);
  return last;
}

export function setSessionUserId(id: string | null) {
  const tab = tabStore();
  const prev = getSessionUserId();
  if (id) {
    tab?.setItem(SESSION_KEY, id);
    tab?.removeItem(SESSION_KEY + ".out");
    localStorage.setItem(LAST_KEY, id);
  } else {
    tab?.removeItem(SESSION_KEY);
    tab?.setItem(SESSION_KEY + ".out", "1");
    if (localStorage.getItem(LAST_KEY) === prev) localStorage.removeItem(LAST_KEY);
  }
  localStorage.removeItem(SESSION_KEY); // retire the old shared key
  cache = null; // never reuse data loaded for the previous account
  emit();
}

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export const now = () => new Date().toISOString();
