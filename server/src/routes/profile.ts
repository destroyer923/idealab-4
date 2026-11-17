import { Router } from "express";
import { z } from "zod";
import { ListingModel } from "../models/Listing.js";
import { ProfileModel } from "../models/Profile.js";
import { UserModel } from "../models/User.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();

const profilePatchSchema = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  username: z.string().trim().min(3).max(24).regex(/^[a-z0-9_]+$/).optional(),
  bio: z.string().max(1200).optional(),
  occupation: z.string().max(200).optional(),
  roles: z.array(z.string()).optional(),
  location: z.string().max(200).optional(),
  languages: z.array(z.string()).optional(),
  skills: z.array(z.any()).optional(),
  interests: z.array(z.string()).optional(),
  collabTypes: z.array(z.string()).optional(),
  availability: z.string().max(200).optional(),
  avatar: z.string().optional(),
  cover: z.string().optional(),
  portfolio: z.array(z.any()).optional(),
  visibility: z.object({
    bio: z.boolean().optional(),
    location: z.boolean().optional(),
    skills: z.boolean().optional(),
    portfolio: z.boolean().optional(),
  }).optional(),
  prefs: z.object({
    messages: z.boolean().optional(),
    exchanges: z.boolean().optional(),
    reviews: z.boolean().optional(),
  }).optional(),
  language: z.enum(["en", "hi", "mr"]).optional(),
});

function sanitizeProfile(profile: Record<string, unknown>) {
  const next = { ...profile };
  if (typeof next.avatar === "string" && next.avatar.length === 0) next.avatar = undefined;
  if (typeof next.cover === "string" && next.cover.length === 0) next.cover = undefined;
  return next;
}

function sanitizePublicProfile(profile: Record<string, unknown>) {
  const next = sanitizeProfile(profile);
  const visibility = (profile.visibility ?? {}) as Record<string, unknown>;
  if (visibility?.bio === false) next.bio = "";
  if (visibility.location !== true) next.location = "";
  if (visibility?.skills === false) next.skills = [];
  if (visibility?.portfolio === false) next.portfolio = [];
  delete next.prefs;
  return next;
}

router.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await UserModel.findOne({ id: req.user!.id }).lean();
    if (!user) {
      res.status(404).json({ code: "not_found", message: "Profile not found" });
      return;
    }

    const profile = user.profile ?? await ProfileModel.findOne({ userId: req.user!.id }).lean();
    res.json({
      email: user.email,
      profile: sanitizeProfile(profile ?? {}),
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ code: "server_error", message: "Failed to load profile" });
  }
});

router.patch("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parse = profilePatchSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ code: "invalid_profile", message: "Profile payload is invalid" });
      return;
    }

    const meId = req.user!.id;
    const next = parse.data;
    const existing = await UserModel.findOne({ id: meId });
    if (!existing) {
      res.status(404).json({ code: "not_found", message: "Profile not found" });
      return;
    }

    const profile = {
      ...(existing.profile ?? {}),
      ...sanitizeProfile(next as Record<string, unknown>),
      updatedAt: new Date().toISOString(),
    };

    if (next.username) {
      const usernameTaken = await UserModel.findOne({ id: { $ne: meId }, "profile.username": next.username.toLowerCase() }).select("id");
      if (usernameTaken) {
        res.status(409).json({ code: "username_taken", message: "Username is already taken" });
        return;
      }
      profile.username = next.username.toLowerCase();
    }

    await UserModel.updateOne({ id: meId }, { $set: { profile } });
    await ProfileModel.updateOne(
      { userId: meId },
      { $set: profile },
      { upsert: true },
    );

    res.json({ profile });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ code: "server_error", message: "Failed to update profile" });
  }
});

router.get("/check-username", async (req, res) => {
  try {
    const username = typeof req.query.username === "string" ? req.query.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      res.json({ available: false });
      return;
    }

    const match = await UserModel.findOne({ "profile.username": username }).select("id");
    res.json({ available: !match });
  } catch (error) {
    console.error("Username check error:", error);
    res.status(500).json({ code: "server_error", message: "Username validation failed" });
  }
});

router.get("/:username", async (req, res) => {
  try {
    const username = req.params.username.trim().toLowerCase();
    const user = await UserModel.findOne({ "profile.username": username }).lean();
    if (!user) {
      res.status(404).json({ code: "not_found", message: "Profile not found" });
      return;
    }
    const profile = user.profile ?? await ProfileModel.findOne({ userId: user.id }).lean();
    const listings = await ListingModel.find({
      ownerId: user.id,
      status: { $in: ["active", "open", "matched"] },
      deletedAt: { $exists: false },
    }).lean();
    res.json({
      isMe: false,
      member: {
        userId: user.id,
        fullName: profile?.fullName ?? user.profile?.fullName ?? "",
        username: profile?.username ?? user.profile?.username ?? "",
        occupation: profile?.occupation ?? user.profile?.occupation ?? "",
        avatar: profile?.avatar ?? user.profile?.avatar,
      },
      profile: sanitizePublicProfile(profile ?? user.profile ?? {}),
      offers: listings.filter((listing) => listing.kind === "offer"),
      needs: listings.filter((listing) => listing.kind === "need"),
      reviews: [],
      rating: { count: 0, average: null, distribution: [0, 0, 0, 0, 0] },
      completedExchanges: 0,
    });
  } catch (error) {
    console.error("Public profile fetch error:", error);
    res.status(500).json({ code: "server_error", message: "Failed to load public profile" });
  }
});

export default router;
