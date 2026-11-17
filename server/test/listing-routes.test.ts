import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { test } from "node:test";
import { ListingModel } from "../src/models/Listing.js";
import { UserModel } from "../src/models/User.js";
import listingRouter from "../src/routes/listing.js";

function replaceMethod(target: object, key: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  };
}

await test("listing routes reject bypass attempts before persistence and retain edit/delete behavior", async () => {
  const secret = "isolated-listing-route-test-secret";
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  const listing = {
    id: "listing-1",
    ownerId: "user-1",
    kind: "offer",
    status: "draft",
    title: "Basic computer lessons",
    category: "Education",
    type: "Service",
    description: "asdfasdfasdf",
    details: "Beginner-friendly lessons",
    exchangePref: "",
    location: "",
    availability: "",
    mode: "",
    quantity: "",
    tags: [],
    images: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    save: async () => { saves++; },
  };
  let creates = 0;
  let updates = 0;
  let saves = 0;
  const restore = [
    replaceMethod(UserModel, "findOne", (filter: { id: string }) => ({
      select: async () => ({ id: filter.id, email: `${filter.id}@example.test`, role: "member", status: "active" }),
    })),
    replaceMethod(ListingModel, "findOne", async (filter: { ownerId?: string }) =>
      filter.ownerId === listing.ownerId ? listing : null,
    ),
    replaceMethod(ListingModel, "create", async (input: Record<string, unknown>) => {
      creates++;
      return input;
    }),
    replaceMethod(ListingModel, "findOneAndUpdate", async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
      updates++;
      return { ...listing, ...update.$set };
    }),
  ];

  const app = express();
  app.use(express.json());
  app.use("/api/listing", listingRouter);
  const server = createServer(app);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const token = jwt.sign({ userId: "user-1" }, secret);
    const otherUserToken = jwt.sign({ userId: "user-2" }, secret);
    const send = (path: string, method: string, body?: unknown, requestToken: string | null = token) => fetch(`http://127.0.0.1:${address.port}/api/listing${path}`, {
      method,
      headers: {
        ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const valid = {
      title: "Basic computer lessons",
      category: "Education",
      type: "Service",
      description: "I can teach basic computer skills including MS Word and Excel to beginners",
      details: "Beginner-friendly lessons",
      publish: true,
    };

    const invalidCreate = await send("/need", "POST", { ...valid, description: "asdfasdfasdf" });
    assert.equal(invalidCreate.status, 400);
    assert.equal((await invalidCreate.json()).message, "err.repetitiveContent");
    assert.equal(creates, 0);

    const created = await send("/need", "POST", valid);
    assert.equal(created.status, 201);
    assert.equal((await created.json()).status, "open");
    assert.equal(creates, 1);

    const invalidEdit = await send("/listing-1", "PUT", { ...valid, description: "vnhsiruhezuyb" });
    assert.equal(invalidEdit.status, 400);
    assert.equal((await invalidEdit.json()).message, "err.descriptionWords");
    assert.equal(updates, 0);

    const invalidPublish = await send("/listing-1/status", "PATCH", { status: "active" });
    assert.equal(invalidPublish.status, 400);
    assert.equal((await invalidPublish.json()).message, "err.repetitiveContent");
    assert.equal(saves, 0);

    const edited = await send("/listing-1", "PUT", valid);
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).description, valid.description);
    assert.equal(updates, 1);

    const deleted = await send("/listing-1", "DELETE");
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).status, "archived");
    assert.equal(updates, 2);

    const otherUserEdit = await send("/listing-1", "PUT", valid, otherUserToken);
    assert.equal(otherUserEdit.status, 404);
    const otherUserPublish = await send("/listing-1/status", "PATCH", { status: "active" }, otherUserToken);
    assert.equal(otherUserPublish.status, 404);
    const otherUserDelete = await send("/listing-1", "DELETE", undefined, otherUserToken);
    assert.equal(otherUserDelete.status, 404);
    assert.equal(updates, 2);

    const missingToken = await send("/me", "GET", undefined, null);
    assert.equal(missingToken.status, 401);
    const invalidToken = await send("/me", "GET", undefined, "invalid-token");
    assert.equal(invalidToken.status, 401);
    const expiredToken = jwt.sign({ userId: "user-1" }, secret, { expiresIn: -1 });
    const expired = await send("/me", "GET", undefined, expiredToken);
    assert.equal(expired.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const restoreMethod of restore.reverse()) restoreMethod();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
