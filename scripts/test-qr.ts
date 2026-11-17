import assert from "node:assert/strict";
import { test } from "node:test";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { installMockAuthApi } from "./mock-test-auth";

class MemoryStorage {
  records = new Map<string, string>();
  getItem(key: string) {
    return this.records.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.records.set(key, String(value));
  }
  removeItem(key: string) {
    this.records.delete(key);
  }
}

const g = globalThis as unknown as { localStorage: MemoryStorage; sessionStorage: MemoryStorage };
g.localStorage = new MemoryStorage();
g.sessionStorage = new MemoryStorage();
Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });

installMockAuthApi();
const api = await import("../src/lib/api");
const store = await import("../src/lib/db");
const expected = (key: string) => (error: unknown) => error instanceof store.ApiError && error.message === key;
function resetEnv() {
  g.localStorage = new MemoryStorage();
  store.refreshStore(true);
  const tabs = { a: new MemoryStorage(), b: new MemoryStorage(), c: new MemoryStorage() };
  const as = (tab: keyof typeof tabs) => {
    g.sessionStorage = tabs[tab];
    store.refreshStore(true);
  };
  as("a");
  return { tabs, as };
}

await test("QR codes, connections, notifications, and messaging remain functional", async () => {
  const { as } = resetEnv();

  // 1. Two accounts receive distinct, persistent, non-sensitive QR codes.
  as("a");
  await api.register({ email: "asha@rural.test", fullName: "Asha Kulkarni", username: "asha_qr", password: "test-password-1" });
  const aId = api.currentUserId()!;
  await api.ensureMyQrToken();
  const qrA = api.getMyQrIdentity();

  as("b");
  await api.register({ email: "bilal@rural.test", fullName: "Bilal Shaikh", username: "bilal_qr", password: "test-password-2" });
  const bId = api.currentUserId()!;
  await api.ensureMyQrToken();
  const qrB = api.getMyQrIdentity();

  as("c");
  await api.register({ email: "chitra@rural.test", fullName: "Chitra Deshmukh", username: "chitra_qr", password: "test-password-3" });

  assert.notEqual(qrA.qrToken, qrB.qrToken, "distinct accounts receive distinct QR tokens");
  assert.notEqual(qrA.qrPayload, qrB.qrPayload, "distinct accounts receive distinct QR payloads");
  for (const secret of ["bilal@rural.test", "test-password-2", "passwordHash", "salt"]) {
    assert.equal(qrB.qrPayload.includes(secret), false, `QR payload never exposes ${secret}`);
  }

  // Persistence across logout, login, and refresh.
  as("b");
  api.logout();
  await api.login("bilal@rural.test", "test-password-2");
  store.refreshStore(true);
  assert.equal(api.getMyQrIdentity().qrToken, qrB.qrToken, "QR token persists across logout/login/refresh");

  // 2. Real QR encode -> pixel matrix -> jsQR decode -> resolveQrPayload round-trip!
  const qrMatrix = QRCode.create(qrB.qrPayload, { errorCorrectionLevel: "M" });
  const size = qrMatrix.modules.size;
  const scale = 4;
  const quiet = 4;
  const dim = (size + quiet * 2) * scale;
  const rgba = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (qrMatrix.modules.get(x, y)) {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = ((y + quiet) * scale + dy) * dim + ((x + quiet) * scale + dx);
            rgba[px * 4] = 0;
            rgba[px * 4 + 1] = 0;
            rgba[px * 4 + 2] = 0;
            rgba[px * 4 + 3] = 255;
          }
        }
      }
    }
  }
  const decoded = jsQR(rgba, dim, dim);
  assert.ok(decoded?.data, "jsQR decodes generated QR matrix");
  assert.equal(decoded!.data, qrB.qrPayload);

  // 3. Account A scans Account B's decoded QR payload: shows public profile without auto-sending a request.
  as("a");
  const preview = api.resolveQrPayload(decoded!.data);
  assert.equal(preview.isSelf, false);
  assert.equal(preview.member.userId, bId);
  assert.equal(preview.member.fullName, "Bilal Shaikh");
  assert.equal(preview.member.username, "bilal_qr");
  assert.equal("email" in (preview.member as Record<string, unknown>), false);
  assert.equal(preview.connection.status, "none", "scanning never auto-sends or auto-accepts a friend request");
  assert.equal(api.getConversations().length, 0, "scanning never creates fake conversations");

  // Invalid / malformed / unsupported QR codes are rejected safely.
  for (const invalid of ["", "   ", "not-a-qr-code", "https://evil.example/phish?code=ssr_fake1234567890", "ssr_unknown1234567890"]) {
    assert.throws(() => api.resolveQrPayload(invalid), (err: unknown) => err instanceof store.ApiError);
  }

  // Self-requests are prevented.
  await assert.rejects(api.sendFriendRequest(aId), expected("err.friendSelf"));

  // 4. Friend request creation, notification, duplicate & bidirectional protection, and persistence.
  await api.sendFriendRequest(bId);
  store.refreshStore(true);
  assert.equal(api.getConnectionState(bId).status, "outgoing_pending");
  await assert.rejects(api.sendFriendRequest(bId), expected("err.friendRequestPending"));

  as("b");
  assert.equal(api.getConnectionState(aId).status, "incoming_pending");
  assert.equal(api.getMyConnections().incoming[0].member.userId, aId);
  assert.ok(api.getNotifications().some((n) => n.kind === "connection" && n.key === "notif.friendRequest"), "recipient receives friend request notification");
  await assert.rejects(api.sendFriendRequest(aId), expected("err.friendRequestIncoming"));

  // Unauthorized third party cannot accept or reject A -> B request.
  as("c");
  await assert.rejects(api.respondFriendRequest(aId, "accept"), expected("err.friendRequestNotFound"));
  await assert.rejects(api.respondFriendRequest(bId, "reject"), expected("err.friendRequestNotFound"));

  // 5. Reject path + re-request + Accept path.
  as("b");
  await api.respondFriendRequest(aId, "reject");
  assert.equal(api.getConnectionState(aId).status, "none");

  as("a");
  assert.equal(api.getConnectionState(bId).status, "none");
  await api.sendFriendRequest(bId);
  await api.cancelFriendRequest(bId);
  assert.equal(api.getConnectionState(bId).status, "none", "requester can cancel their own pending request");
  await api.sendFriendRequest(bId);

  as("b");
  await api.respondFriendRequest(aId, "accept");
  assert.equal(api.getConnectionState(aId).status, "friends");
  assert.equal(api.getMyConnections().friends[0].member.userId, aId);

  as("a");
  assert.equal(api.getConnectionState(bId).status, "friends");
  assert.ok(api.getNotifications().some((n) => n.kind === "connection" && n.key === "notif.friendAccepted"), "requester receives friend acceptance notification");
  await assert.rejects(api.sendFriendRequest(bId), expected("err.alreadyFriends"));

  // 6. Connected friends open/reuse real conversation and exchange messages.
  const convA = await api.openConversation(bId);
  await api.sendMessage(convA, "Hello Bilal, glad we connected via QR!", "qr-msg-1");
  as("b");
  const convB = await api.openConversation(aId);
  assert.equal(convA, convB, "both connected friends share the same conversation");
  assert.equal(api.getMessages(convB, 20).messages[0].body, "Hello Bilal, glad we connected via QR!");
});
