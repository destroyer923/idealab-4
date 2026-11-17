import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { TEST_DATABASE_NAME } from "../../src/config/testDb.js";
import { connectIsolatedTestDatabase } from "./setup.js";

before(async () => {
  await connectIsolatedTestDatabase();
});

after(async () => {
  await mongoose.disconnect();
});

test("MongoDB integration connection is isolated to the test database", () => {
  assert.equal(mongoose.connection.name, TEST_DATABASE_NAME);
});
