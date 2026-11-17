import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { test } from "node:test";
import { ListingModel } from "../src/models/Listing.js";
import { ProfileModel } from "../src/models/Profile.js";
import { UserModel } from "../src/models/User.js";
import profileRouter from "../src/routes/profile.js";

function replaceMethod(target: object, key: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  };
}

await test("profile routes enforce user identity and respect public visibility settings", async () => {
  const secret = "isolated-profile-route-test-secret";
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  const users = new Map([
    ["user-a", {
      id: "user-a",
      email: "a@example.test",
      role: "member",
      status: "active",
      profile: {
        userId: "user-a",
        fullName: "User A",
        username: "user_a",
        bio: "Private biography",
        location: "Private location",
        skills: ["Private skill"],
        portfolio: [{ title: "Private project" }],
        visibility: { bio: false, location: false, skills: false, portfolio: false },
        prefs: { messages: false, exchanges: true, reviews: false },
        qrToken: "non-secret-test-qr-token",
      },
    }],
    ["user-b", {
      id: "user-b",
      email: "b@example.test",
      role: "member",
      status: "active",
      profile: {
        userId: "user-b",
        fullName: "User B",
        username: "user_b",
        bio: "User B biography",
        location: "Hidden by default",
        skills: [],
        portfolio: [],
        visibility: { bio: true, skills: true, portfolio: true },
      },
    }],
  ]);
  let userProfileWrites = 0;
  let profileWrites = 0;

  const restore = [
    replaceMethod(UserModel, "findOne", (filter: Record<string, unknown>) => {
      let user = typeof filter.id === "string" ? users.get(filter.id) : undefined;
      if (typeof filter["profile.username"] === "string") {
        user = [...users.values()].find((candidate) => candidate.profile.username === filter["profile.username"]);
      }
      return Object.assign(user ?? {}, {
        select: async () => user,
        lean: async () => user,
      });
    }),
    replaceMethod(UserModel, "updateOne", async (filter: { id: string }, update: { $set: { profile: Record<string, unknown> } }) => {
      const user = users.get(filter.id);
      if (user) user.profile = update.$set.profile;
      userProfileWrites++;
      return { matchedCount: user ? 1 : 0 };
    }),
    replaceMethod(ProfileModel, "findOne", () => ({ lean: async () => null })),
    replaceMethod(ProfileModel, "updateOne", async () => {
      profileWrites++;
      return { matchedCount: 1 };
    }),
    replaceMethod(ListingModel, "find", () => ({ lean: async () => [] })),
  ];

  const app = express();
  app.use(express.json());
  app.use("/api/profile", profileRouter);
  const server = createServer(app);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const tokenA = jwt.sign({ userId: "user-a" }, secret);
    const tokenB = jwt.sign({ userId: "user-b" }, secret);
    const request = (path: string, method: string, token: string, body?: unknown) => fetch(
      `http://127.0.0.1:${address.port}/api/profile${path}`,
      {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );

    const currentProfile = await request("/me", "GET", tokenB);
    assert.equal(currentProfile.status, 200);
    assert.equal((await currentProfile.json()).profile.userId, "user-b");

    const attemptedCrossUserUpdate = await request("/me", "PATCH", tokenB, {
      userId: "user-a",
      fullName: "Changed by user B",
    });
    assert.equal(attemptedCrossUserUpdate.status, 200);
    assert.equal(users.get("user-a")?.profile.fullName, "User A");
    assert.equal(users.get("user-b")?.profile.fullName, "Changed by user B");
    assert.equal(userProfileWrites, 1);
    assert.equal(profileWrites, 1);

    const publicProfileResponse = await request("/user_a", "GET", tokenB);
    assert.equal(publicProfileResponse.status, 200);
    const publicProfile = (await publicProfileResponse.json()).profile;
    assert.equal(publicProfile.bio, "");
    assert.equal(publicProfile.location, "");
    assert.deepEqual(publicProfile.skills, []);
    assert.deepEqual(publicProfile.portfolio, []);
    assert.equal("prefs" in publicProfile, false);

    const defaultVisibilityProfile = await request("/user_b", "GET", tokenA);
    assert.equal(defaultVisibilityProfile.status, 200);
    assert.equal((await defaultVisibilityProfile.json()).profile.location, "");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const restoreMethod of restore.reverse()) restoreMethod();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
