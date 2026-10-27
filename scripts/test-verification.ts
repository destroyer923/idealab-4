/**
 * Mandatory verification test.
 * Two browser tabs (separate sessionStorage, shared localStorage), real data layer.
 *
 * Run: npx esbuild scripts/test-verification.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/v.mjs && node /tmp/v.mjs
 */
type Store = Record<string, string>;
const mk = (s: Store) => ({ getItem: (k: string) => s[k] ?? null, setItem: (k: string, v: string) => void (s[k] = String(v)), removeItem: (k: string) => void delete s[k] });
const shared: Store = {};
const tabA: Store = {};
const tabB: Store = {};
const g = globalThis as any;
g.localStorage = mk(shared);
const useTab = (t: Store) => (g.sessionStorage = mk(t));
useTab(tabA);

const api = await import("../src/lib/api");
const db = await import("../src/lib/db");
const { ApiError } = db;

let pass = 0;
let fail = 0;
const ok = (c: unknown, m: string) => (c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.log("  ✗ " + m)));
/** Works for sync functions (asserts immediately) and async ones (awaited). */
function throwsCode(fn: () => unknown, code: string, m: string): void | Promise<void> {
  try {
    const r = fn();
    if (r && typeof (r as Promise<void>).then === "function") {
      return (r as Promise<unknown>)
        .then(() => ok(false, m + " (did not throw)"))
        .catch((e) => ok(e instanceof ApiError && e.code === code, `${m} → ${e instanceof Error ? `${e.message} (${(e as ApiError).code})` : e}`));
    }
    ok(false, m + " (did not throw)");
  } catch (e) {
    ok(e instanceof ApiError && e.code === code, `${m} → ${e instanceof Error ? `${e.message} (${(e as ApiError).code})` : e}`);
  }
}
const listingInput = (title: string, over: Partial<Record<string, unknown>> = {}) => ({
  title,
  category: "Design",
  type: "Service",
  description: "This listing needs a description that is long enough to pass validation checks.",
  details: "Packaging design and branding work",
  exchangePref: "",
  location: "",
  availability: "",
  mode: "" as const,
  quantity: "",
  tags: [] as string[],
  images: [] as string[],
  ...over,
});

// ---- Setup -----------------------------------------------------------
console.log("Test 1 — An unverified user cannot publish:");
await api.register({ email: "unverified@x.in", password: "password1", fullName: "Unverified User", username: "unverified" });
const U = api.currentUserId()!;
ok(api.getVerification().verification.phone.status === "not_started", "phone starts as not_started");
ok(api.getVerification().verification.email.status === "not_started", "email starts as not_started");
ok(api.getVerification().verification.identity.status === "not_started", "identity starts as not_started");
throwsCode(() => api.createListing("offer", listingInput("Offer one"), true), "forbidden", "unverified user cannot publish an offer");
throwsCode(() => api.createListing("need", listingInput("Need one", { type: "Skill" }), true), "forbidden", "unverified user cannot publish a need");
ok(api.getMyListings("offer").length === 0, "no offer was stored");
ok(api.getMyListings("need").length === 0, "no need was stored");

console.log("\nTest 2 — Drafts are allowed but cannot be published:");
const draft = api.createListing("offer", listingInput("Draft offer"), false);
ok(draft.status === "draft", "draft saved as draft");
throwsCode(() => api.setListingStatus(draft.id, "active"), "forbidden", "draft cannot be published while unverified");
ok(api.getMyListings("offer").length === 1, "draft is stored");
throwsCode(() => api.updateListing(draft.id, listingInput("Draft offer", { businessClaimed: false }), true), "forbidden", "editing + publish is blocked while unverified");
ok(api.getMyListings("offer").length === 1, "no duplicate listing created");

console.log("\nTest 3 — Phone verified alone is still insufficient:");
const phone = await api.requestVerificationCode("phone", "+91 9876543210");
ok(phone.masked.includes("*"), "phone masked for display");
const code = phone.demoCode!;
ok(!!code && /^\d{6}$/.test(code), "demo code is 6 digits");
await api.verifyContactCode("phone", code);
ok(api.getVerification().verification.phone.status === "verified", "phone is verified");
ok(api.getVerification().verification.email.status === "not_started", "email still not_started");
throwsCode(() => api.createListing("offer", listingInput("Offer two"), true), "forbidden", "phone-only user cannot publish");

console.log("\nTest 4 — Email verified, identity pending is still insufficient:");
const email = await api.requestVerificationCode("email", "unverified@x.in");
await api.verifyContactCode("email", email.demoCode!);
ok(api.getVerification().verification.email.status === "verified", "email is verified");
ok(api.getVerification().eligibility.ok === false, "eligibility still not ok");
ok(
  api.getVerification().eligibility.missing.map((s) => s.channel).join() === "identity",
  "only identity missing",
  api.getVerification().eligibility.missing.map((s) => s.channel).join()
);
throwsCode(() => api.createListing("need", listingInput("Need two", { type: "Skill" }), true), "forbidden", "phone+email verified, identity pending → cannot publish a need");

console.log("\nTest 5 — Wrong / expired codes never mark verified:");
// a dedicated account so the phone contact is still unverified
await api.register({ email: "otptest@x.in", password: "password3", fullName: "OTP Test User", username: "otptest" });
const T = api.currentUserId()!;
await throwsCode(() => api.verifyContactCode("phone", "000000"), "not_found", "code submitted with no code requested");
const tPhone = await api.requestVerificationCode("phone", "+91 9876543210");
await throwsCode(() => api.verifyContactCode("phone", "12"), "invalid", "malformed code rejected");
await throwsCode(() => api.verifyContactCode("phone", ""), "invalid", "empty code rejected");
await throwsCode(() => api.verifyContactCode("phone", "abcdef"), "invalid", "non-numeric code rejected");
await throwsCode(() => api.verifyContactCode("phone", "000000"), "invalid", "wrong code rejected");
ok(api.getVerification().verification.phone.status === "pending", "wrong code left phone pending, not verified");
throwsCode(() => api.createListing("offer", listingInput("Offer after wrong code"), true), "forbidden", "wrong code did not grant publish rights");
// exhaust the attempt budget: the rejection pre-check fires on the call after the max is reached
for (let i = 0; i < 6; i++) {
  if (api.getVerification().verification.phone.status === "rejected") break;
  try {
    await api.verifyContactCode("phone", "999999");
  } catch {
    /* expected */
  }
}
ok(api.getVerification().verification.phone.status === "rejected", "too many attempts marks phone rejected");
throwsCode(() => api.createListing("offer", listingInput("Offer after rejection"), true), "forbidden", "rejected phone blocks publishing");
await throwsCode(() => api.verifyContactCode("phone", tPhone.demoCode!), "not_found", "code cannot be reused after rejection");
ok(api.getVerification().verification.phone.status === "rejected", "phone stays rejected");

console.log("\nTest 6 — Identity must be genuinely approved by a reviewer:");
api.logout();
await api.login("unverified@x.in", "password1");
ok(api.currentUserId() === U, "back on the original account");
api.submitIdentityVerification({ fullName: "Unverified User", idReference: "AA-1234-5678", note: "Aadhaar card, district office verified." });
ok(api.getVerification().verification.identity.status === "pending", "identity is pending, not verified");
ok(api.getVerification().eligibility.ok === false, "submitting a form does not grant eligibility");
throwsCode(() => api.createListing("offer", listingInput("Offer three"), true), "forbidden", "pending identity does not allow publishing");
// a non-reviewer cannot approve their own identity
throwsCode(() => api.reviewIdentityVerification(U, "approve"), "forbidden", "a member cannot approve their own identity");
// the identity reference is masked in storage
const stored = JSON.parse(shared["skillswap-rural.db.v1"]);
const v0 = stored.verifications.find((x: { userId: string }) => x.userId === U)!;
ok(v0.identity.submission.idReference.includes("***"), "identity reference is masked in storage");
ok(!v0.identity.submission.idReference.includes("1234-5678"), "full reference not stored");

console.log("\nTest 7 — A fully verified user can publish both:");
// grant reviewer access in tab B, approve the identity
useTab(tabB);
await api.register({ email: "reviewer@x.in", password: "password2", fullName: "Reviewer Sharma", username: "reviewer" });
const R = api.currentUserId()!;
// Test-only fixture, not a production role-grant endpoint.
db.transact((state) => { state.users.find((u) => u.id === R)!.role = "admin"; });
ok(api.isReviewer(), "reviewer role granted");
api.reviewIdentityVerification(U, "approve");
useTab(tabA);
ok(api.getVerification().verification.identity.status === "verified", "identity approved by reviewer");
ok(api.getVerification().eligibility.ok === true, "eligibility now satisfied");
const offer = api.createListing("offer", listingInput("Verified offer"), true);
ok(offer.status === "active", "verified user can publish an offer");
const need = api.createListing("need", listingInput("Verified need", { type: "Skill" }), true);
ok(need.status === "open", "verified user can publish a need");
// draft publishing path also works
const d2 = api.createListing("offer", listingInput("Draft then publish"), false);
api.setListingStatus(d2.id, "active");
ok(api.getMyListings("offer").length === 3, "all offers stored");

console.log("\nTest 8 — Business claims require business verification:");
throwsCode(
  () => api.createListing("offer", listingInput("Business offer", { businessClaimed: true }), true),
  "forbidden",
  "claiming a business blocks publishing until business is verified"
);
api.submitBusinessEvidence({ businessType: "farmer", businessName: "Krishna Farm", ownerName: "Unverified User", udyamNumber: "1234567890", location: "Nashik", description: "Organic farming on 10 acres.", documents: [] });
ok(api.getVerification().verification.business.status === "pending", "business is pending, not verified");
throwsCode(() => api.createListing("offer", listingInput("Business offer 2", { businessClaimed: true }), true), "forbidden", "pending business blocks publishing");
// the reviewer can see the submission
useTab(tabB);
const ev = api.getBusinessEvidence();
ok(ev.reviewer && ev.submissions.length === 1, "reviewer sees the pending business evidence");
api.reviewBusinessEvidence(U, "approve");
useTab(tabA);
ok(api.getVerification().verification.business.status === "verified", "business verified by reviewer");
const bizOffer = api.createListing("offer", listingInput("Business offer 3", { businessClaimed: true }), true);
ok(bizOffer.status === "active", "business claim verified → can publish");

console.log("\nTest 9 — A reviewer cannot publish an unverified owner's listing:");
// the reviewer role is enough to review; they cannot publish without verification
useTab(tabB);
throwsCode(() => api.createListing("offer", listingInput("Reviewer offer"), true), "forbidden", "reviewer must verify before publishing their own listing");
// use the otptest account (phone rejected → unverified) as the listing owner
useTab(tabA);
api.logout();
await api.login("otptest@x.in", "password3");
const unverifiedDraft = api.createListing("offer", listingInput("Unverified draft"), false);
ok(unverifiedDraft.status === "draft", "unverified owner can still save a draft");
// force it into pending_review, then try to approve it as reviewer
useTab(tabB);
const forced = db.transact((d) => {
  const l = d.listings.find((x) => x.id === unverifiedDraft.id);
  l.status = "pending_review";
  return l.status;
});
ok(forced === "pending_review", "forced a draft into pending_review");
throwsCode(() => api.reviewListing(unverifiedDraft.id, "approve"), "forbidden", "reviewer cannot approve an unverified owner's listing");
useTab(tabA);
ok(api.getListing(unverifiedDraft.id).listing.status === "pending_review", "listing stayed in pending_review");

console.log("\nTest 10 — Identity is required for an unverified account:");
// the main account is now fully verified; use a fresh account to test the identity gate
api.logout();
await api.register({ email: "identity@x.in", password: "password5", fullName: "Identity Test", username: "idtest" });
ok(api.getVerification().verification.identity.status === "not_started", "fresh account identity is not_started");
throwsCode(() => api.createListing("offer", listingInput("Offer without identity"), true), "forbidden", "missing identity blocks publishing");
// submitting identity for review still does not grant publishing
api.submitIdentityVerification({ fullName: "Identity Test", idReference: "AA-0000-0001", note: "Aadhaar card, pending review." });
ok(api.getVerification().verification.identity.status === "pending", "identity is pending, not verified");
throwsCode(() => api.createListing("offer", listingInput("Offer with pending identity"), true), "forbidden", "pending identity blocks publishing");

console.log("\nTest 11 — Provider failure never grants verification:");
// otptest's phone is rejected; restore it to pending so a new code can be requested
useTab(tabA);
api.logout();
await api.login("otptest@x.in", "password3");
db.transact((d) => {
  const v = d.verifications.find((x) => x.userId === api.currentUserId());
  if (v) {
    v.phone.status = "pending";
    v.phone.attempts = 0;
    v.phone.lastSentAt = undefined;
  }
});
useTab(tabB);
api.updateProviderConfig("phone", { type: "http", endpoint: "https://gateway.invalid/send", apiToken: "sk_test" });
useTab(tabA);
const failed = await api.requestVerificationCode("phone", "+91 9876543210").catch(() => null);
ok(failed === null, "failed provider send throws instead of returning a code");
ok(api.getVerification().verification.phone.status !== "verified", "failed send did not mark phone verified");
throwsCode(() => api.createListing("offer", listingInput("Offer after failed send"), true), "forbidden", "failed provider send did not grant publish rights");
// restore demo channel
useTab(tabB);
api.updateProviderConfig("phone", { type: "demo" });

console.log("\nTest 12 — Existing data and other features still work:");
api.logout();
await api.login("unverified@x.in", "password1");
const before = JSON.parse(shared["skillswap-rural.db.v1"]);
ok(before.users.length === 4, `no users lost (${before.users.length} registered before the fresh account)`);
ok(before.listings.length >= 5, "all listings retained");
ok(before.exchanges.length === 0, "no exchanges lost");
ok(before.reviews.length === 0, "no reviews lost");
ok(before.messages.length === 0, "no messages lost");
// the published listing is still visible to other members
useTab(tabB);
await api.login("reviewer@x.in", "password2");
ok(api.getPublicListings().some((x) => x.listing.id === offer.id), "existing published listing still visible to others");
ok(api.getPublicListings().some((x) => x.listing.id === need.id), "existing published need still visible to others");
useTab(tabA);
// a fresh account can still register and log in
useTab(tabB);
await api.register({ email: "fresh@x.in", password: "password4", fullName: "Fresh Member", username: "fresh" });
api.logout();
await api.login("fresh@x.in", "password4");
ok(api.currentUserId() !== null, "new account can log in");
throwsCode(() => api.createListing("offer", listingInput("Fresh offer"), true), "forbidden", "new unverified account cannot publish");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
