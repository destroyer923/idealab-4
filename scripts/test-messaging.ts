/**
 * Cross-account messaging test: two browser tabs (separate sessionStorage, shared
 * localStorage — exactly how two tabs of one browser behave), running the real data layer.
 *
 * Run: npx esbuild scripts/test-messaging.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/m.mjs && node /tmp/m.mjs
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
const throwsKey = async (fn: () => unknown, key: string, m: string) => {
  try {
    await fn();
    ok(false, m + " (did not throw)");
  } catch (e) {
    ok(e instanceof ApiError && e.message === key, `${m} → ${e instanceof Error ? e.message : e}`);
  }
};
const persisted = () => JSON.parse(shared["skillswap-rural.db.v1"]); // what is actually stored

/** Completes phone + email verification and submits an identity declaration. */
async function verifyAccount(phone: string, email: string) {
  const p = await api.requestVerificationCode("phone", phone);
  await api.verifyContactCode("phone", p.demoCode!);
  const e = await api.requestVerificationCode("email", email);
  await api.verifyContactCode("email", e.demoCode!);
  api.submitIdentityVerification({ fullName: "Test User", idReference: "AA-1111-2222", note: "Aadhaar card, pending review." });
  return api.currentUserId()!;
}

// Setup: two real accounts registered in two tabs, neither has any listings.
useTab(tabA);
await api.register({ email: "asha@x.in", password: "password1", fullName: "Asha Kulkarni", username: "asha_k" });
const A = api.currentUserId()!;
useTab(tabB);
await api.register({ email: "bilal@x.in", password: "password2", fullName: "Bilal Shaikh", username: "bilal" });
const B = api.currentUserId()!;

console.log("\nRegression check for the original bug (shared session):");
useTab(tabA);
ok(api.currentUserId() === A, "Tab A is still Account A after Account B signs in in Tab B");
useTab(tabB);
ok(api.currentUserId() === B, "Tab B is Account B");
useTab({});
ok(api.currentUserId() === B, "A newly opened tab starts as the last signed-in account");

console.log("\nTest 1 — Find a member (no listings, never messaged):");
useTab(tabA);
ok(api.searchMembers("bilal").some((m) => m.userId === B), "A finds B by username");
ok(api.searchMembers("  SHAIKH ").some((m) => m.userId === B), "case-insensitive, trimmed, partial name match");
ok(api.searchMembers("@bil").some((m) => m.userId === B), "leading @ and partial username");
ok(!api.searchMembers("asha").some((m) => m.userId === A), "A does not appear in A's own results");
ok(api.searchMembers("bilal@x.in").length === 0 && api.searchMembers("x.in").length === 0, "email is never searchable (privacy)");
ok(api.searchMembers("   ").length === 0, "empty query returns nothing");
ok(api.searchMembers("zzzz").length === 0, "no match returns an empty list (UI shows 'No members found')");
ok(!("email" in api.searchMembers("bilal")[0]), "results contain no email field");

console.log("\nTest 2 — Start a conversation and send:");
const conv = await api.openConversation(B);
await api.sendMessage(conv, "Hi Bilal, can you help with packaging?", "msg-1");
const stored = persisted();
ok(stored.conversations.some((c: { id: string; participantIds: string[] }) => c.id === conv && c.participantIds.includes(A) && c.participantIds.includes(B)), "conversation persisted with both participants");
ok(stored.messages.some((m: { id: string; senderId: string; conversationId: string }) => m.id === "msg-1" && m.senderId === A && m.conversationId === conv), "message persisted with sender = authenticated A");
ok(api.searchMembers("bilal")[0].conversationId === conv, "search result now shows the existing conversation");

console.log("\nTest 3 — B receives and replies (separate tab):");
useTab(tabB);
const bList = api.getConversations();
ok(bList.some((c) => c.conversation.id === conv && c.other.userId === A), "conversation appears in B's list with A as the other participant");
ok(api.unreadMessageCount() === 1, "B has 1 unread message");
ok(api.getNotifications().some((n) => n.key === "notif.message"), "B got a new-message notification");
const bMsgs = api.getMessages(conv, 50).messages;
ok(bMsgs.length === 1 && bMsgs[0].senderId === A, "B sees A's message with the correct sender");
await api.markConversationRead(conv);
ok(api.unreadMessageCount() === 0, "opening the conversation marks it read for B");
await api.sendMessage(conv, "Yes Asha, happy to help!", "msg-2");
useTab(tabA);
const aMsgs = api.getMessages(conv, 50).messages;
ok(aMsgs.length === 2 && aMsgs[1].senderId === B, "A sees B's reply");
ok(aMsgs[0].readAt !== undefined, "A's message shows as read");

console.log("\nTest 4 — Persistence (reload, sign out, sign in):");
// simulate a full reload: drop in-memory cache, re-read storage
(db as any).setSessionUserId(api.currentUserId());
ok(api.getMessages(conv, 50).messages.length === 2, "history intact after reload");
api.logout();
ok(api.currentUserId() === null, "Tab A signed out");
useTab(tabB);
ok(api.currentUserId() === B, "signing out in Tab A does not sign out Tab B");
useTab(tabA);
await api.login("asha@x.in", "password1");
ok(api.getMessages(conv, 50).messages.map((m) => m.id).join() === "msg-1,msg-2", "history intact after signing back in");

console.log("\nTest 5 — Duplicate prevention:");
const again = await Promise.all([api.openConversation(B), api.openConversation(B), api.openConversation(B)]);
ok(again.every((id) => id === conv), "reopening the same recipient reuses one conversation");
useTab(tabB);
ok(await api.openConversation(A) === conv, "B opening A also reuses the same conversation");
await api.sendMessage(conv, "dup?", "msg-3");
await api.sendMessage(conv, "dup?", "msg-3");
ok(api.getMessages(conv, 50).messages.filter((m) => m.id === "msg-3").length === 1, "retrying a send with the same id doesn't duplicate");
ok(persisted().conversations.filter((c: { participantIds: string[]; contextType: string }) => c.contextType === "none" && c.participantIds.includes(A) && c.participantIds.includes(B)).length === 1, "exactly one direct conversation stored");

console.log("\nTest 6 — Security (third account):");
const tabC: Store = {};
useTab(tabC);
await api.register({ email: "chetan@x.in", password: "password3", fullName: "Chetan Rao", username: "chetan" });
await throwsKey(() => api.getMessages(conv, 50), "err.conversationNotFound", "C cannot read A↔B messages by conversation id");
await throwsKey(() => api.sendMessage(conv, "intrude", "x1"), "err.conversationNotFound", "C cannot post into A↔B");
await throwsKey(() => api.markConversationRead(conv), "err.conversationNotFound", "C cannot mark A↔B read");
ok(!api.getConversations().some((c) => c.conversation.id === conv), "A↔B is not in C's conversation list");
await throwsKey(() => api.openConversation(api.currentUserId()!), "err.messageSelf", "cannot message yourself");
useTab(tabA);
const last = api.getMessages(conv, 50).messages.at(-1)!;
ok(last.senderId === B, "sender id is always taken from the session, not the client");

console.log("\nTest 7 — Error handling:");
await throwsKey(() => api.sendMessage(conv, "   ", "x2"), "err.messageEmpty", "whitespace-only message rejected");
await throwsKey(() => api.sendMessage(conv, "x".repeat(2001), "x3"), "err.maxLength", "over-length message rejected");
await throwsKey(() => api.openConversation("not-a-user"), "err.memberGone", "unknown recipient rejected");
api.setBlocked(B, true);
ok(!api.searchMembers("bilal").length, "blocked member is hidden from search");
await throwsKey(() => api.sendMessage(conv, "hello?", "x4"), "err.cannotContact", "sending to a blocked member is refused");
api.setBlocked(B, false);
ok(api.searchMembers("bilal").length === 1, "unblocking restores search");

console.log("\nTest 8 — Regression (existing data and features):");
const before = persisted();
ok(before.messages.length === 3 && before.users.length === 3, "no messages or users lost");
// complete verification so the listing can be published
useTab(tabA);
await verifyAccount("+91 9876543210", "asha@x.in");
useTab(tabB);
// Test-only fixture for an already provisioned administrator.
db.transact((state) => { state.users.find((u) => u.id === B)!.role = "admin"; });
api.reviewIdentityVerification(A, "approve");
useTab(tabA);
const offer = api.createListing("offer", { title: "Packaging design", category: "Design", type: "Service", description: "Labels and boxes for small food brands.", details: "Packaging design", exchangePref: "", location: "", availability: "", mode: "", quantity: "", tags: [], images: [] }, true);
useTab(tabB);
const ctxConv = await api.openConversation(A, "listing", offer.id);
ok(ctxConv !== conv, "a listing-context conversation stays separate from the direct chat");
ok(api.proposeExchange({ recipientId: A, listingId: offer.id, iProvide: "Vegetables", iReceive: "Labels", message: "", targetDate: "" }).status === "pending", "exchange proposals still work");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
