import { randomUUID } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { isDuplicateKeyError, normalizeEmail, registrationAccountExists, verifyPasswordAndUpgrade } from "../auth/password.js";
import { UserModel } from "../models/User.js";

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const PASSWORD_MAX_LENGTH = 128;

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return secret;
}

function makeToken(userId: string, secret: string): string {
  return jwt.sign({ userId }, secret, { expiresIn: "1d" });
}

function requestBody(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function publicUser(user: {
  id: string;
  email: string;
  role: string;
  status: string;
  profile: unknown;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    profile: user.profile,
  };
}

router.post("/register", async (req, res) => {
  try {
    const secret = jwtSecret();
    const body = requestBody(req.body);
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const language = body.language === "en" || body.language === "hi" || body.language === "mr"
      ? body.language
      : "en";

    if (email.length > 254 || !EMAIL_RE.test(email)) {
      res.status(400).json({ code: "invalid_email", message: "Invalid email address" });
      return;
    }
    if (fullName.length < 2 || fullName.length > 80) {
      res.status(400).json({ code: "invalid_full_name", message: "Enter a name between 2 and 80 characters" });
      return;
    }
    if (!USERNAME_RE.test(username)) {
      res.status(400).json({ code: "invalid_username", message: "Username must be 3 to 24 letters, numbers, or underscores" });
      return;
    }
    if (password.length < 8 || password.length > PASSWORD_MAX_LENGTH) {
      res.status(400).json({ code: "invalid_password", message: "Password must be between 8 and 128 characters" });
      return;
    }

    const existing = await registrationAccountExists(
      (filter) => UserModel.findOne(filter).select("_id").exec(),
      email,
      username,
    );
    if (existing) {
      res.status(409).json({ code: "account_exists", message: "Email or username is already registered" });
      return;
    }

    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await UserModel.create({
      id,
      email,
      passwordHash,
      role: "member",
      status: "active",
      profile: {
        userId: id,
        fullName,
        username,
        language,
        qrToken: randomUUID(),
      },
    });

    res.status(201).json({
      token: makeToken(user.id, secret),
      user: publicUser(user),
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      res.status(409).json({ code: "account_exists", message: "Email or username is already registered" });
      return;
    }
    console.error("Registration error:", error);
    res.status(500).json({ code: "server_error", message: "Registration failed" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const secret = jwtSecret();
    const body = requestBody(req.body);
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (email.length > 254 || !EMAIL_RE.test(email) || password.length === 0 || password.length > PASSWORD_MAX_LENGTH) {
      res.status(401).json({ code: "invalid_credentials", message: "Invalid email or password" });
      return;
    }

    const user = await UserModel.findOne({ email }).select("+passwordHash +salt");
    if (!user || !(await verifyPasswordAndUpgrade(password, user))) {
      res.status(401).json({ code: "invalid_credentials", message: "Invalid email or password" });
      return;
    }
    if (user.status !== "active") {
      res.status(403).json({ code: "account_suspended", message: "Account is suspended" });
      return;
    }

    res.json({
      token: makeToken(user.id, secret),
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ code: "server_error", message: "Login failed" });
  }
});

export default router;
