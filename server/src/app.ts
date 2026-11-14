
import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";
import authRouter from "./routes/auth.js";
import profileRouter from "./routes/profile.js";
import listingRouter from "./routes/listing.js";
import verificationRouter from "./routes/verification.js";

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/listing", listingRouter);
app.use("/api/verification", verificationRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", message: "SkillSwap Rural API is running" });
});

async function startServer() {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`🚀 API running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Backend startup failed:", error);
    process.exit(1);
  }
}

void startServer();
