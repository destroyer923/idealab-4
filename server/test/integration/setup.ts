import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { connectTestDB } from "../../src/config/testDb.js";

const testEnvPath = fileURLToPath(new URL("../../server/.env.test", import.meta.url));

export async function connectIsolatedTestDatabase(): Promise<void> {
  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = "";
  delete process.env.MONGODB_TEST_URI;

  const result = config({ path: testEnvPath, override: true, quiet: true });
  if (result.error) {
    throw new Error("Unable to load the MongoDB integration test environment file");
  }

  await connectTestDB();
}
