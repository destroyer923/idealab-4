import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import bcrypt from "bcryptjs";
import { test } from "node:test";
import { createAuthRouter } from "../src/routes/auth.js";
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

async function withHttpServer(
  app: express.Express,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

await test("auth limits allow normal signup and login, then return consistent 429 responses", async () => {
  const secret = "isolated-rate-limit-test-secret";
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  const loginUser = {
    id: "rate-limit-user",
    email: "member@example.test",
    passwordHash: await bcrypt.hash("correct-password", 4),
    role: "member",
    status: "active",
    profile: { userId: "rate-limit-user", fullName: "Test User", username: "test_user" },
    set() {},
    async save() {},
  };
  const restore = [
    replaceMethod(UserModel, "findOne", (filter: Record<string, unknown>) => {
      const query = {
        select(selection: string) {
          if (selection === "_id") return { exec: async () => null };
          if (selection === "+passwordHash +salt") {
            return Promise.resolve(filter.email === loginUser.email ? loginUser : null);
          }
          return query;
        },
      };
      return query;
    }),
    replaceMethod(UserModel, "create", async (input: typeof loginUser & Record<string, unknown>) => ({
      ...input,
      passwordHash: String(input.passwordHash),
    })),
    replaceMethod(ListingModel, "find", () => ({
      sort() { return this; },
      lean: async () => [],
    })),
    replaceMethod(UserModel, "find", () => ({
      select() { return this; },
      lean: async () => [],
    })),
  ];

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/auth", createAuthRouter({
    login: { windowMs: 60_000, limit: 1 },
    register: { windowMs: 60_000, limit: 1 },
  }));
  app.use("/api/listing", listingRouter);

  try {
    await withHttpServer(app, async (baseUrl) => {
      const signupPayload = {
        email: "new@example.test",
        password: "valid-password",
        fullName: "New User",
        username: "new_user",
      };
      const signup = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signupPayload),
      });
      assert.equal(signup.status, 201);

      const blockedSignup = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...signupPayload, username: "new_user2" }),
      });
      assert.equal(blockedSignup.status, 429);
      assert.deepEqual(await blockedSignup.json(), {
        code: "rate_limited",
        message: "Too many requests. Please try again later.",
      });

      const loginPayload = { email: loginUser.email, password: "correct-password" };
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginPayload),
      });
      assert.equal(login.status, 200);

      const forwardedLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "203.0.113.42",
        },
        body: JSON.stringify(loginPayload),
      });
      assert.equal(forwardedLogin.status, 200);

      const repeatedLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "203.0.113.42",
        },
        body: JSON.stringify(loginPayload),
      });
      assert.equal(repeatedLogin.status, 429);
      assert.deepEqual(await repeatedLogin.json(), {
        code: "rate_limited",
        message: "Too many requests. Please try again later.",
      });

      const publicListings = await fetch(`${baseUrl}/api/listing/public`);
      assert.equal(publicListings.status, 200);
      assert.deepEqual(await publicListings.json(), []);
    });
  } finally {
    for (const restoreMethod of restore.reverse()) restoreMethod();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

await test("auth rate-limit counters reset after the configured window", async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "isolated-rate-limit-window-test-secret";
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter({
    login: { windowMs: 100, limit: 1 },
    register: { windowMs: 100, limit: 1 },
  }));

  try {
    await withHttpServer(app, async (baseUrl) => {
      const request = () => fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "invalid", password: "x" }),
      });

      assert.equal((await request()).status, 401);
      assert.equal((await request()).status, 429);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal((await request()).status, 401);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
