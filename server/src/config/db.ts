
import mongoose from "mongoose";

export async function connectDB(): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    throw new Error("Production MongoDB connections are disabled in test mode");
  }

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is missing from server/.env");
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });

  console.log("✅ MongoDB Atlas connected successfully");
}
