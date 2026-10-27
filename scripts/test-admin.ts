/** Local service regression only. No PostgreSQL, real provider or secure admin bootstrap exists here. */
import assert from "node:assert/strict";
import { test } from "node:test";

const data = new Map<string, string>();
const sessions = [new Map<string, string>(), new Map<string, string>()];
const storage = (map: Map<string, string>) => ({ getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } });
const global = globalThis as any;
global.localStorage = storage(data);
global.sessionStorage = storage(sessions[0]);
Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });
const api = await import("../src/lib/api");
const store = await import("../src/lib/db");
const admin = await import("../src/lib/admin");
const as = (index: number) => { global.sessionStorage = storage(sessions[index]); store.refreshStore(true); };
const rejects = (key: string) => (error: unknown) => error instanceof store.ApiError && error.message === key;

await test("browser bootstrap cannot mint an administrator or switch the current account", async () => {
  await api.register({ fullName: "Leon", username: "anupam_dev", email: "shuklaanupam2008@gmail.com", password: "isolated-test-password-123", role: "admin" } as any);
  assert.equal(api.isAdmin(), false, "the intended name and email are not authorization");
  assert.equal(admin.hasAdminCredentials(), false);
  const before = api.currentUserId();
  await assert.rejects(admin.provisionAdmin(), rejects("community.serverRequired"));
  assert.equal(api.currentUserId(), before);
  assert.equal((store as any).grantAdminRole, undefined);
});

await test("an existing admin role can review without bypassing other mandatory checks", async () => {
  const adminId = api.currentUserId()!;
  // Isolated fixture for an already provisioned role, never a browser-facing role endpoint.
  store.transact((db) => { db.users.find((u) => u.id === adminId)!.role = "admin"; });
  as(1);
  await api.register({ fullName: "Test Member", username: "ordinary_member", email: "member@example.test", password: "isolated-test-password-456" });
  const memberId = api.currentUserId()!;
  api.submitBusinessEvidence({ businessType: "farmer", businessName: "Test Farm", ownerName: "Test Member", udyamNumber: "", location: "Nashik", description: "Seasonal vegetable farming", documents: [] });
  api.submitIdentityVerification({ fullName: "Test Member", idReference: "test-reference", note: "Isolated test declaration only." });
  assert.throws(() => api.getAdminReviewQueue(), rejects("verify.err.reviewerOnly"));
  assert.throws(() => api.reviewBusinessEvidence(memberId, "approve"), rejects("verify.err.reviewerOnly"));
  as(0);
  assert.equal(api.isAdmin(), true);
  assert.equal(api.getAdminReviewQueue().pending.length, 2);
  api.reviewBusinessEvidence(memberId, "approve");
  assert.throws(() => api.reviewBusinessEvidence(memberId, "approve"), rejects("verify.err.notPending"));
  api.reviewIdentityVerification(memberId, "reject", "Please provide the required information.");
  as(1);
  const verification = api.getVerification().verification;
  assert.equal(verification.business.status, "verified");
  assert.equal(verification.identity.status, "rejected");
  assert.equal(api.getPublishEligibility().ok, false);
  assert.equal(api.getNotifications().filter((n) => n.kind === "verification").length, 2);
  const input = { title: "Member offer", category: "Agriculture", type: "Skill", description: "A valid, sufficiently detailed farming offer.", details: "Growing vegetables", exchangePref: "", location: "", availability: "", mode: "" as const, quantity: "", tags: [], images: [] };
  assert.throws(() => api.createListing("offer", input, true), rejects("verify.err.publishBlocked"));
  assert.throws(() => api.createListing("need", input, true), rejects("verify.err.publishBlocked"));
  const draft = api.createListing("offer", input, false);
  assert.equal(draft.status, "draft");
  as(0);
  const users = api.getAdminUsers().users;
  for (const field of ["passwordHash", "salt", "apiToken", "otpHash", "evidence"]) assert.ok(!Object.keys(users[0]).includes(field));
  api.setAccountStatus(memberId, "suspended", "A test administrative suspension.");
  assert.throws(() => api.setAccountStatus(adminId, "suspended", "A test reason."), rejects("verify.err.cannotSuspendAdmin"));
  as(1);
  assert.equal(api.currentUserId(), null);
  assert.throws(() => api.getMe(), rejects("err.accountSuspended"));
  await assert.rejects(api.login("member@example.test", "isolated-test-password-456"), rejects("err.accountSuspended"));
  as(0); api.setAccountStatus(memberId, "active");
  as(1); await api.login("member@example.test", "isolated-test-password-456");
  assert.equal(api.getMyListings("offer")[0].id, draft.id);
  assert.equal(store.read().users.length, 2);
});
