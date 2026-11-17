import mongoose from "mongoose";

export const TEST_DATABASE_NAME = "skillswap_rural_test";

export function validateTestMongoUri(uri: string | undefined): string {
  if (!uri) {
    throw new Error("MONGODB_TEST_URI is required for MongoDB integration tests");
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error("MONGODB_TEST_URI must be a valid MongoDB URI for the isolated test database");
  }

  if (
    uri.trim() !== uri ||
    (parsed.protocol !== "mongodb:" && parsed.protocol !== "mongodb+srv:") ||
    !parsed.hostname ||
    parsed.pathname !== `/${TEST_DATABASE_NAME}` ||
    parsed.hash
  ) {
    throw new Error("MONGODB_TEST_URI must target the isolated test database");
  }

  return uri;
}

export async function connectTestDB(): Promise<void> {
  const uri = validateTestMongoUri(process.env.MONGODB_TEST_URI);

  try {
    await mongoose.connect(uri, {
      dbName: TEST_DATABASE_NAME,
      serverSelectionTimeoutMS: 10000,
    });
  } catch {
    throw new Error("Could not connect to the isolated MongoDB test database");
  }
}
