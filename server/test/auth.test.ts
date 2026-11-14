import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { isDuplicateKeyError, normalizeEmail, registrationAccountExists, verifyPasswordAndUpgrade } from "../src/auth/password.js";
import { isAdminRole } from "../../src/lib/roles.ts";

test("legacy PBKDF2 account login upgrades the existing hash to bcrypt", async () => {
  const password = "legacy-correct-password";
  const user = {
    passwordHash: pbkdf2Sync(password, "legacy-test-salt", 120_000, 32, "sha256").toString("hex"),
    salt: "legacy-test-salt",
    saved: false,
    async save() {
      this.saved = true;
    },
    set(_path: "salt", value: undefined) {
      this.salt = value;
    },
  };

  assert.equal(await verifyPasswordAndUpgrade(password, user), true);
  assert.equal(user.saved, true);
  assert.equal(user.salt, undefined);
  assert.match(user.passwordHash, /^\$2[aby]\$/);
  assert.equal(await bcrypt.compare(password, user.passwordHash), true);
});

test("incorrect legacy password does not alter the stored account", async () => {
  const user = {
    passwordHash: pbkdf2Sync("right-password", "legacy-test-salt", 120_000, 32, "sha256").toString("hex"),
    salt: "legacy-test-salt",
    saved: false,
    async save() {
      this.saved = true;
    },
    set(_path: "salt", value: undefined) {
      this.salt = value;
    },
  };

  assert.equal(await verifyPasswordAndUpgrade("wrong-password", user), false);
  assert.equal(user.saved, false);
  assert.equal(user.salt, "legacy-test-salt");
});

test("existing bcrypt account login remains supported", async () => {
  const password = "bcrypt-current-password";
  const user = {
    passwordHash: await bcrypt.hash(password, 4),
    saved: false,
    async save() {
      this.saved = true;
    },
    set(_path: "salt", _value: undefined) {},
  };

  assert.equal(await verifyPasswordAndUpgrade(password, user), true);
  assert.equal(user.saved, false);
});

test("duplicate registration finds an existing email case-insensitively", async () => {
  let queriedEmail = "";
  const exists = await registrationAccountExists(async (filter) => {
    queriedEmail = filter.$or[0].email;
    return { id: "preserved-account" };
  }, "  Admin@Example.test ", "other_user");

  assert.equal(normalizeEmail("  Admin@Example.test "), "admin@example.test");
  assert.equal(queriedEmail, "admin@example.test");
  assert.equal(exists, true);
});

test("duplicate key errors are recognized without mutating account data", () => {
  assert.equal(isDuplicateKeyError({ code: 11000 }), true);
  assert.equal(isDuplicateKeyError({ code: 11001 }), false);
  assert.equal(isDuplicateKeyError(new Error("duplicate")), false);
});

test("admin login accepts admins and rejects ordinary members", () => {
  assert.equal(isAdminRole("admin"), true);
  assert.equal(isAdminRole("member"), false);
  assert.equal(isAdminRole(undefined), false);
});
