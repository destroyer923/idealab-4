import assert from "node:assert/strict";
import { test } from "node:test";
import { connectDB } from "../src/config/db.js";
import { connectTestDB, validateTestMongoUri } from "../src/config/testDb.js";

test("test MongoDB URI must target the isolated database", () => {
  const uri = "mongodb+srv://cluster.example.test/skillswap_rural_test?retryWrites=true";
  assert.ok(validateTestMongoUri(uri));
});

test("test MongoDB URI validation rejects missing, malformed, and other database targets", () => {
  assert.throws(() => validateTestMongoUri(undefined), /MONGODB_TEST_URI is required/);
  assert.throws(() => validateTestMongoUri("not-a-mongodb-uri"), /valid MongoDB URI/);
  assert.throws(
    () => validateTestMongoUri("mongodb+srv://cluster.example.test/production"),
    /must target the isolated test database/,
  );
});

test("test connector does not fall back to MONGODB_URI", async () => {
  const previousTestUri = process.env.MONGODB_TEST_URI;
  const previousProductionUri = process.env.MONGODB_URI;
  delete process.env.MONGODB_TEST_URI;
  process.env.MONGODB_URI = "mongodb+srv://cluster.example.test/production";

  try {
    await assert.rejects(connectTestDB(), /MONGODB_TEST_URI is required/);
  } finally {
    if (previousTestUri === undefined) delete process.env.MONGODB_TEST_URI;
    else process.env.MONGODB_TEST_URI = previousTestUri;
    if (previousProductionUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previousProductionUri;
  }
});

test("production connector is disabled in test mode before reading production configuration", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousProductionUri = process.env.MONGODB_URI;
  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = "mongodb+srv://cluster.example.test/production";

  try {
    await assert.rejects(connectDB(), /disabled in test mode/);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousProductionUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previousProductionUri;
  }
});
