/**
 * Real application service tests using isolated browser-storage fixtures.
 * These are NOT PostgreSQL or server-authorization tests: that backend is absent.
 * Run with scripts/run-community-checks.mjs.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

class MemoryStorage {
  records = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.records.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("Injected persistence failure");
    this.records.set(key, String(value));
  }
  removeItem(key: string) { this.records.delete(key); }
}

const global = globalThis as unknown as { localStorage: MemoryStorage; sessionStorage: MemoryStorage };
global.localStorage = new MemoryStorage();
global.sessionStorage = new MemoryStorage();
Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
const api = await import("../src/lib/api");
const store = await import("../src/lib/db");
const i18n = await import("../src/lib/i18n");
const adminModule = await import("../src/lib/admin");
const DB_KEY = "skillswap-rural.db.v1";
const expected = (key: string) => (e: unknown) => e instanceof store.ApiError && e.message === key;

async function accounts() {
  global.localStorage = new MemoryStorage();
  store.refreshStore(true);
  const tabs = { a: new MemoryStorage(), b: new MemoryStorage(), outsider: new MemoryStorage(), admin: new MemoryStorage() };
  const ids = {} as Record<keyof typeof tabs, string>;
  const names = { a: "Asha Kulkarni", b: "Bilal Shaikh", outsider: "Chitra Patil", admin: "Test Administrator" };
  for (const key of Object.keys(tabs) as (keyof typeof tabs)[]) {
    global.sessionStorage = tabs[key];
    await api.register({ email: `${key}@example.test`, fullName: names[key], username: `${key}_member`, password: `test-only-${key}-password` });
    ids[key] = api.currentUserId()!;
  }
  // Models an already provisioned role. Test-only fixture, never imported by the app.
  store.transact((db) => { db.users.find((u) => u.id === ids.admin)!.role = "admin"; });
  const as = (key: keyof typeof tabs) => { global.sessionStorage = tabs[key]; store.refreshStore(true); };
  as("a");
  return { tabs, ids, as, persisted: () => JSON.parse(global.localStorage.getItem(DB_KEY)!) as ReturnType<typeof store.read> };
}

const input = {
  title: "Fresh vegetables for design", category: "Agriculture", type: "Physical Resource",
  description: "Fresh seasonal vegetables available for a community exchange.", details: "Ten kilograms of vegetables",
  exchangePref: "", location: "", availability: "", mode: "" as const, quantity: "", tags: [], images: [],
};

async function completeExchange(f: Awaited<ReturnType<typeof accounts>>) {
  f.as("a");
  const x = api.proposeExchange({ recipientId: f.ids.b, iProvide: "Organic vegetables", iReceive: "Packaging design", message: "Original user-written proposal", targetDate: "" });
  f.as("b"); api.respondToRequest(x.id, "accept");
  f.as("a"); api.submitWork(x.id, "My original delivery note", "");
  f.as("b"); api.reviewSubmission(x.id, "confirm"); api.submitWork(x.id, "My original design note", "");
  f.as("a"); api.reviewSubmission(x.id, "confirm");
  return x.id;
}

await test("member discovery searches registered accounts without listings", async () => {
  const f = await accounts();
  assert.equal(api.getMyListings("offer").length, 0);
  assert.equal(api.searchMembers("  sHaIkH ")[0].userId, f.ids.b);
  assert.equal(api.searchMembers("@B_MEM")[0].userId, f.ids.b);
  assert.equal(api.searchMembers("Bilal   Shaikh")[0].userId, f.ids.b);
  assert.deepEqual(api.searchMembers("@"), []);
  assert.deepEqual(api.searchMembers("not-a-real-member"), []);
  assert.deepEqual(api.searchMembers("a@example.test"), []);
  assert.deepEqual(api.searchMembers("asha"), []);
  const publicFields = Object.keys(api.searchMembers("bilal")[0]);
  for (const field of ["email", "passwordHash", "salt", "evidence", "role"]) assert.ok(!publicFields.includes(field));
  api.setBlocked(f.ids.b, true);
  assert.deepEqual(api.searchMembers("bilal"), []);
  api.setBlocked(f.ids.b, false);
  f.as("admin"); api.setAccountStatus(f.ids.b, "suspended", "A reason for the fixture suspension");
  f.as("a"); assert.deepEqual(api.searchMembers("bilal"), []);
  await assert.rejects(api.openConversation(f.ids.b), expected("community.memberUnavailable"));
});

await test("two accounts exchange, read, refresh and reopen the same conversation", async () => {
  const f = await accounts();
  const [id, duplicate] = await Promise.all([api.openConversation(f.ids.b), api.openConversation(f.ids.b)]);
  assert.equal(id, duplicate);
  assert.equal(api.getConversations().length, 1, "empty conversations remain discoverable");
  const first = await api.sendMessage(id, "Asha's original message", "message-one");
  assert.equal(first.senderId, f.ids.a);
  await api.sendMessage(id, "Asha's original message", "message-one");
  assert.equal(f.persisted().messages.length, 1);
  assert.equal(api.getNotificationInbox().total, 0, "sender is not notified");
  f.as("b");
  assert.equal(api.getConversations()[0].other.userId, f.ids.a);
  assert.equal(api.unreadMessageCount(), 1);
  assert.equal(api.getNotificationInbox().unread, 1);
  assert.equal(api.getNotificationInbox().items[0].link, `/messages/${id}`);
  const notificationId = api.getNotificationInbox().items[0].id;
  await api.markNotificationsRead([notificationId]);
  assert.equal(api.unreadMessageCount(), 1, "reading an alert does not read the conversation");
  await api.markConversationRead(id, first.id);
  assert.equal(api.unreadMessageCount(), 0);
  await api.sendMessage(id, "Bilal's original reply", "message-two");
  f.as("a");
  assert.equal(api.getMessages(id, 50).messages[1].senderId, f.ids.b);
  assert.ok(api.getMessages(id, 50).messages[0].readAt);
  api.logout();
  await api.login("a@example.test", "test-only-a-password");
  store.refreshStore(true);
  assert.deepEqual(api.getMessages(id, 50).messages.map((m) => m.body), ["Asha's original message", "Bilal's original reply"]);
  assert.equal(await api.openConversation(f.ids.b), id);
  f.as("b"); assert.equal(api.currentUserId(), f.ids.b, "another tab's login does not replace this identity");
  assert.equal(await api.openConversation(f.ids.a), id);
});

await test("private messages, scoped idempotency keys, failed sends and unread snapshots", async () => {
  const f = await accounts();
  const ab = await api.openConversation(f.ids.b);
  await api.sendMessage(ab, "This is private to A and B", "private-id");
  const ac = await api.openConversation(f.ids.outsider);
  await assert.rejects(api.sendMessage(ac, "This is private to A and B", "private-id"), expected("community.retryConflict"));
  await assert.rejects(api.sendMessage(ab, "Changed payload with same key", "private-id"), expected("community.retryConflict"));
  f.as("outsider");
  assert.throws(() => api.getMessages(ab, 50), expected("err.conversationNotFound"));
  await assert.rejects(api.sendMessage(ab, "Intrusion", "intrusion"), expected("err.conversationNotFound"));
  await assert.rejects(api.markConversationRead(ab), expected("err.conversationNotFound"));
  assert.deepEqual(api.getNotifications(), []);
  f.as("a");
  const snapshot = global.localStorage.getItem(DB_KEY);
  await assert.rejects(api.sendMessage(ab, "  ", "empty"), expected("err.messageEmpty"));
  await assert.rejects(api.sendMessage(ab, null as unknown as string, "null"), expected("err.messageEmpty"));
  await assert.rejects(api.sendMessage(ab, "x".repeat(2001), "long"), expected("err.maxLength"));
  assert.equal(global.localStorage.getItem(DB_KEY), snapshot, "validation failures leave records unchanged");
  global.localStorage.failWrites = true;
  await assert.rejects(api.sendMessage(ab, "Will retry", "retry-id"), expected("err.quota"));
  global.localStorage.failWrites = false;
  assert.equal(global.localStorage.getItem(DB_KEY), snapshot, "message and notification rollback together");
  await api.sendMessage(ab, "Will retry", "retry-id");
  await api.sendMessage(ab, "Will retry", "retry-id");
  f.as("b");
  assert.equal(api.getNotificationInbox().unread, 1, "one unread alert per conversation");
  await api.markConversationRead(ab, "private-id");
  assert.equal(api.unreadMessageCount(), 1, "messages beyond the viewed snapshot remain unread");
  assert.equal(api.getNotificationInbox().unread, 1);
  await api.markConversationRead(ab, "retry-id");
  assert.equal(api.getNotificationInbox().unread, 0);
});

await test("notification pagination and ownership with existing notification records", async () => {
  const f = await accounts();
  store.transact((db) => {
    for (let i = 0; i < 37; i++) db.notifications.push({ id: `notice-${i}`, userId: f.ids.b, kind: "exchange", text: "", key: "notif.completed", vars: { title: `Existing collaboration ${i}` }, link: "/collaborations", createdAt: new Date(Date.now() - i * 1000).toISOString() });
    db.notifications.push({ id: "other-notice", userId: f.ids.outsider, kind: "review", text: "", key: "notif.review", vars: { name: "Asha", title: "Existing exchange" }, link: "/reviews", createdAt: new Date().toISOString() });
  });
  f.as("b");
  assert.equal(api.getNotifications().length, 30);
  assert.equal(api.getNotificationInbox().unread, 37);
  assert.equal(api.getNotificationInbox(30, 30).items.length, 7);
  await api.markNotificationsRead(["notice-36", "other-notice"]);
  assert.equal(api.getNotificationInbox().unread, 36);
  f.as("outsider"); assert.equal(api.getNotificationInbox().unread, 1);
  f.as("b"); await api.markNotificationsRead();
  store.refreshStore(true);
  assert.equal(api.getNotificationInbox().unread, 0);
  assert.equal(api.getNotificationInbox().total, 37, "read never deletes history");
});

await test("reviews use real completion rules, consistent aggregates and profile eligibility", async () => {
  const f = await accounts();
  assert.deepEqual(api.getProfileReviewEligibility(f.ids.b).pending, []);
  const pending = api.proposeExchange({ recipientId: f.ids.b, iProvide: "Goods", iReceive: "", message: "", targetDate: "" });
  await assert.rejects(api.submitReview(pending.id, 5, "Too early to review"), expected("err.reviewNotCompleted"));
  f.as("b"); api.respondToRequest(pending.id, "decline");
  f.as("a");
  const exchange = await completeExchange(f);
  assert.equal(api.getProfileReviewEligibility(f.ids.b).pending[0].id, exchange);
  await assert.rejects(api.submitReview(exchange, 0, "Invalid rating test"), expected("err.rating"));
  await assert.rejects(api.submitReview(exchange, 6, "Invalid rating test"), expected("err.rating"));
  await assert.rejects(api.submitReview(exchange, 3.5, "Invalid rating test"), expected("err.rating"));
  await assert.rejects(api.submitReview(exchange, 5, null as unknown as string), expected("err.invalid"));
  await assert.rejects(api.submitReview(exchange, 5, "short"), expected("err.reviewMin"));
  await assert.rejects(api.submitReview(exchange, 5, "x".repeat(1001)), expected("err.maxLength"));
  const comment = "The designs were late, but the work was useful.";
  const review = await api.submitReview(exchange, 2, comment);
  assert.equal(review.reviewerId, f.ids.a);
  assert.equal(review.recipientId, f.ids.b);
  assert.equal(api.getProfileReviewEligibility(f.ids.b).pending.length, 0);
  const profile = api.getPublicProfile("b_member")!;
  assert.equal(profile.reviews[0].comment, comment);
  assert.equal(profile.reviews[0].verifiedExchange, true);
  assert.deepEqual(profile.rating, { count: 1, average: 2, distribution: [0, 1, 0, 0, 0] });
  await assert.rejects(api.submitReview(exchange, 5, "Duplicate review should not save"), expected("err.reviewDuplicate"));
  f.as("b");
  assert.equal(api.getMyReviewData().summary.average, 2);
  assert.ok(api.getNotifications().some((n) => n.kind === "review" && n.link === "/u/b_member?tab=reviews"));
  await api.submitReview(exchange, 4, "Good vegetables, thank you for the exchange.");
  f.as("outsider");
  await assert.rejects(api.submitReview(exchange, 5, "Unauthorized review attempt"), expected("err.notParticipant"));
  assert.equal(api.getPublicProfile("b_member")!.reviews[0].canOpenExchange, false);
  api.report("review", review.id, "Please investigate this review fairly.");
  assert.equal(api.getPublicProfile("b_member")!.rating.average, 2, "reporting never removes a negative review");
  assert.throws(() => api.report("review", "missing-id", "A report for a missing review"), expected("err.invalid"));
  assert.equal((api as unknown as Record<string, unknown>).deleteReview, undefined, "no arbitrary review-deletion API");
  f.as("a"); api.logout(); await api.login("a@example.test", "test-only-a-password");
  assert.equal(api.getPublicProfile("b_member")!.reviews[0].comment, comment);
  for (const lang of ["en", "hi", "mr"] as const) {
    api.setLanguage(lang);
    assert.equal(api.getPublicProfile("b_member")!.reviews[0].comment, comment, "user content never translated");
    assert.ok(i18n.translate("community.completedReview", undefined, lang));
  }
});

await test("failed review storage creates neither review nor alert, concurrent retries cannot duplicate", async () => {
  const f = await accounts();
  const exchange = await completeExchange(f);
  const before = global.localStorage.getItem(DB_KEY);
  global.localStorage.failWrites = true;
  await assert.rejects(api.submitReview(exchange, 5, "Reliable work and a good exchange."), expected("err.quota"));
  global.localStorage.failWrites = false;
  assert.equal(global.localStorage.getItem(DB_KEY), before);
  const results = await Promise.allSettled([api.submitReview(exchange, 5, "Reliable work and a good exchange."), api.submitReview(exchange, 5, "Reliable work and a good exchange.")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.persisted().reviews.length, 1);
  f.as("b"); assert.equal(api.getNotificationInbox().items.filter((n) => n.kind === "review").length, 1);
});

await test("ineligible legacy reviews do not inflate reputation; all records are retained", async () => {
  const f = await accounts();
  const x = await completeExchange(f);
  const real = await api.submitReview(x, 1, "The exchange did not meet expectations.");
  store.transact((db) => {
    db.reviews.push({ ...real, id: "orphan-review", exchangeId: "unknown" });
    db.reviews.push({ ...real, id: "duplicate-review", rating: 5, createdAt: "2099-01-01T00:00:00.000Z" });
    db.reviews.push({ ...real, id: "self-review", reviewerId: f.ids.b });
  });
  assert.equal(f.persisted().reviews.length, 4);
  assert.equal(api.getPublicProfile("b_member")!.rating.count, 1);
  assert.equal(api.getPublicProfile("b_member")!.rating.average, 1);
});

await test("failed transactions roll back; existing verification failure attempts still persist", async () => {
  const f = await accounts();
  const before = global.localStorage.getItem(DB_KEY);
  assert.throws(() => store.transact((db) => { db.users.length = 0; throw new Error("Abort"); }));
  assert.equal(global.localStorage.getItem(DB_KEY), before);
  assert.equal(store.read().users.length, 4);
  // Exercise the existing local OTP test path only. This is not a real provider test.
  const challenge = await api.requestVerificationCode("phone", "+919876543210");
  const wrong = challenge.demoCode === "000000" ? "111111" : "000000";
  await assert.rejects(api.verifyContactCode("phone", wrong), expected("verify.err.codeWrong"));
  assert.equal(api.getVerification().verification.phone.attempts, 1);
  assert.equal(api.getVerification().verification.phone.status, "pending");
  assert.throws(() => api.createListing("offer", input, true), expected("verify.err.publishBlocked"));
  assert.throws(() => api.createListing("need", { ...input, type: "Skill" }, true), expected("verify.err.publishBlocked"));
  const draft = api.createListing("offer", input, false);
  assert.equal(draft.status, "draft");
  f.as("b"); assert.throws(() => api.updateListing(draft.id, input), expected("err.notYourListing"));
});

await test("no page-load administrator login or production role-grant export", async () => {
  const f = await accounts();
  assert.equal((store as unknown as Record<string, unknown>).grantAdminRole, undefined);
  assert.equal(adminModule.hasAdminCredentials(), false);
  await assert.rejects(adminModule.provisionAdmin(), expected("community.serverRequired"));
  assert.equal(api.currentUserId(), f.ids.a);
  assert.throws(() => api.getAdminUsers(), expected("verify.err.reviewerOnly"));
  assert.throws(() => api.reviewIdentityVerification(f.ids.a, "approve"), expected("verify.err.reviewerOnly"));
  const app = readFileSync("src/App.tsx", "utf8");
  assert.ok(!app.includes("provisionAdmin"));
  assert.ok(app.includes("<AppShell key={me}>"), "private React state resets on account changes");
});

await test("verification decisions notify only their recipient and never imply all checks passed", async () => {
  const f = await accounts();
  api.updatePrefs({ messages: true, exchanges: false, reviews: true });
  api.submitBusinessEvidence({ businessType: "farmer", businessName: "Test Farm", ownerName: "Asha Kulkarni", udyamNumber: "", location: "Nashik", description: "Farm producing seasonal vegetables", documents: [] });
  assert.equal(api.getNotificationInbox().total, 0, "no noisy self-notification for submitting a form");
  f.as("b"); assert.throws(() => api.reviewBusinessEvidence(f.ids.a, "approve"), expected("verify.err.reviewerOnly"));
  f.as("admin"); api.reviewBusinessEvidence(f.ids.a, "approve");
  f.as("a");
  assert.equal(api.getVerification().verification.business.status, "verified");
  assert.equal(api.getPublishEligibility().ok, false, "phone, email and identity are still required");
  const notice = api.getNotificationInbox().items[0];
  assert.equal(notice.key, "community.verificationApproved");
  for (const language of ["hi", "mr"] as const) {
    const t = i18n.makeI18n(language).t;
    const text = i18n.dyn(t, notice.key, notice.vars, notice.text);
    assert.ok(/[\u0900-\u097f]/.test(text));
    assert.ok(!text.includes("{type}"));
  }
  f.as("b"); assert.equal(api.getNotificationInbox().total, 0);
  f.as("admin"); assert.equal(api.getNotificationInbox().total, 0);
});

await test("suspension prevents existing sessions from reading or sending private data", async () => {
  const f = await accounts();
  const conversation = await api.openConversation(f.ids.b);
  await api.sendMessage(conversation, "Before suspension", "before-suspension");
  f.as("admin"); api.setAccountStatus(f.ids.a, "suspended", "An authorized fixture suspension");
  f.as("a");
  assert.equal(api.currentUserId(), null);
  assert.throws(() => api.getNotifications(), expected("err.accountSuspended"));
  assert.throws(() => api.getMessages(conversation, 50), expected("err.accountSuspended"));
  await assert.rejects(api.sendMessage(conversation, "After suspension", "after-suspension"), expected("err.accountSuspended"));
  f.as("b"); assert.equal(api.getMessages(conversation, 50).messages.length, 1, "history retained");
});
