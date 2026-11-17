import { Router } from "express";
import { z } from "zod";
import { ListingModel } from "../models/Listing.js";
import { UserModel } from "../models/User.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { validateListingContent } from "../listing/validation.js";

const router = Router();

const listingSchema = z.object({
  title: z.string().trim(),
  category: z.string().trim(),
  type: z.string().trim(),
  description: z.string().trim(),
  details: z.string().trim(),
  exchangePref: z.string().trim().max(2000).optional().default(""),
  location: z.string().trim().max(200).optional().default(""),
  availability: z.string().trim().max(200).optional().default(""),
  mode: z.enum(["", "remote", "in_person", "both"]).optional().default(""),
  quantity: z.string().trim().max(200).optional().default(""),
  tags: z.array(z.string()).optional().default([]),
  images: z.array(z.string()).optional().default([]),
  publish: z.boolean().optional().default(false),
});

const statusTransitions: Record<string, string[]> = {
  "offer:draft": ["active"],
  "offer:pending_review": ["active", "inactive"],
  "offer:active": ["inactive"],
  "offer:inactive": ["active"],
  "offer:rejected": ["active", "draft"],
  "need:draft": ["open"],
  "need:pending_review": ["open", "paused"],
  "need:rejected": ["open", "draft"],
  "need:open": ["matched", "paused", "fulfilled"],
  "need:matched": ["open", "paused", "fulfilled", "in_progress"],
  "need:in_progress": ["fulfilled", "paused", "open"],
  "need:paused": ["open"],
  "need:fulfilled": ["open"],
};

function normalizeListing(input: z.infer<typeof listingSchema>, ownerId: string, kind: "offer" | "need") {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ownerId,
    kind,
    title: input.title.trim(),
    category: input.category,
    type: input.type,
    description: input.description.trim(),
    details: input.details.trim(),
    exchangePref: input.exchangePref.trim(),
    location: input.location.trim(),
    availability: input.availability.trim(),
    mode: input.mode,
    quantity: input.quantity.trim(),
    tags: [...new Set(input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 8),
    images: input.images.slice(0, 12),
    status: input.publish ? (kind === "offer" ? "active" : "open") : "draft",
    createdAt: now,
    updatedAt: now,
  };
}

function contentError(input: { title: string; category: string; type: string; description: string; details: string }, kind: "offer" | "need") {
  const errors = validateListingContent(input, kind);
  const first = Object.entries(errors)[0];
  if (!first) return undefined;
  const [field, message] = first;
  const max = field === "title" ? 100 : field === "description" ? 1500 : 800;
  return { message, vars: message === "err.maxLength" ? { max } : undefined };
}

function invalidListing(res: import("express").Response, message = "err.invalidListing", vars?: Record<string, number>) {
  res.status(400).json({ code: "invalid_listing", message, vars });
}

router.get("/public", async (_req, res) => {
  try {
    const items = await ListingModel.find({ status: { $in: ["active", "open", "matched"] }, deletedAt: { $exists: false } }).sort({ createdAt: -1 }).lean();
    const ownerIds = [...new Set(items.map((item) => item.ownerId))];
    const owners = await UserModel.find({ id: { $in: ownerIds } }).select("id profile").lean();
    const profiles = new Map(owners.map((owner) => [owner.id, owner.profile]));
    res.json(items.map((listing) => {
      const profile = profiles.get(listing.ownerId);
      return {
        ...listing,
        owner: {
          userId: listing.ownerId,
          fullName: profile?.fullName ?? "",
          username: profile?.username ?? "",
          occupation: profile?.occupation ?? "",
          avatar: profile?.avatar,
          location: profile?.visibility?.location ? profile.location : undefined,
        },
      };
    }));
  } catch (error) {
    console.error("List public listings error:", error);
    res.status(500).json({ code: "server_error", message: "Failed to load listings" });
  }
});

router.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const kind = typeof req.query.kind === "string" ? req.query.kind : "offer";
    const items = await ListingModel.find({ ownerId: req.user!.id, kind, deletedAt: { $exists: false } }).sort({ updatedAt: -1 }).lean();
    res.json(items);
  } catch (error) {
    console.error("List my listings error:", error);
    res.status(500).json({ code: "server_error", message: "Failed to load your listings" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const listing = await ListingModel.findOne({ id: req.params.id }).lean();
    if (!listing) {
      res.status(404).json({ code: "not_found", message: "Listing not found" });
      return;
    }
    const user = await UserModel.findOne({ id: listing.ownerId }).select("profile").lean();
    const profile = user?.profile;
    res.json({
      listing,
      owner: {
        userId: listing.ownerId,
        fullName: profile?.fullName ?? "",
        username: profile?.username ?? "",
        occupation: profile?.occupation ?? "",
        avatar: profile?.avatar,
        location: profile?.visibility?.location ? profile.location : undefined,
      },
      isOwner: false,
      unavailable: null,
    });

  } catch (error) {
    console.error("Get listing error:", error);
    res.status(500).json({ code: "server_error", message: "Failed to load listing" });
  }
});

router.post("/:kind", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (req.params.kind !== "need" && req.params.kind !== "offer") {
      invalidListing(res, "err.type");
      return;
    }
    const kind = req.params.kind;
    const parsed = listingSchema.safeParse(req.body);
    if (!parsed.success) {
      invalidListing(res);
      return;
    }
    const contentIssue = contentError(parsed.data, kind);
    if (contentIssue) {
      invalidListing(res, contentIssue.message, contentIssue.vars);
      return;
    }

    const record = normalizeListing(parsed.data, req.user!.id, kind);
    const created = await ListingModel.create(record);
    res.status(201).json(created);
  } catch (error) {
    console.error("Create listing error:", error);
    res.status(500).json({ code: "server_error", message: "Failed to create listing" });
  }
});

router.put("/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = listingSchema.safeParse(req.body);
    if (!parsed.success) {
      invalidListing(res);
      return;
    }

    const current = await ListingModel.findOne({ id: req.params.id, ownerId: req.user!.id });
    if (!current) {
      res.status(404).json({ code: "not_found", message: "Listing not found" });
      return;
    }

    const contentIssue = contentError(parsed.data, current.kind);
    if (contentIssue) {
      invalidListing(res, contentIssue.message, contentIssue.vars);
      return;
    }

    const kind = current.kind;
    const next = normalizeListing(parsed.data, req.user!.id, kind);
    next.id = current.id;
    next.createdAt = current.createdAt;
    next.updatedAt = new Date().toISOString();

    const updated = await ListingModel.findOneAndUpdate({ id: req.params.id }, { $set: next }, { new: true });
    res.json(updated);
  } catch (error) {
    console.error("Update listing error:", error);
    res.status(500).json({ code: "server_error", message: "Failed to update listing" });
  }
});

router.patch("/:id/status", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = z.object({ status: z.string() }).strict().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_status", message: "err.statusConflict" });
      return;
    }
    const listing = await ListingModel.findOne({ id: req.params.id, ownerId: req.user!.id, deletedAt: { $exists: false } });
    if (!listing) {
      res.status(404).json({ code: "not_found", message: "err.listingGone" });
      return;
    }
    const nextStatus = parsed.data.status;
    if (!statusTransitions[`${listing.kind}:${listing.status}`]?.includes(nextStatus)) {
      res.status(409).json({ code: "invalid_transition", message: "err.statusConflict" });
      return;
    }
    if (nextStatus === "active" || nextStatus === "open") {
      const contentIssue = contentError(listing, listing.kind);
      if (contentIssue) {
        invalidListing(res, contentIssue.message, contentIssue.vars);
        return;
      }
    }
    listing.status = nextStatus as typeof listing.status;
    listing.updatedAt = new Date().toISOString();
    await listing.save();
    res.json(listing);
  } catch (error) {
    console.error("Update listing status error:", error);
    res.status(500).json({ code: "server_error", message: "err.generic" });
  }
});

router.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const current = await ListingModel.findOne({ id: req.params.id, ownerId: req.user!.id });
    if (!current) {
      res.status(404).json({ code: "not_found", message: "Listing not found" });
      return;
    }

    await ListingModel.findOneAndUpdate({ id: req.params.id }, { $set: { deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
    res.json({ status: "archived" });
  } catch (error) {
    console.error("Delete listing error:", error);
    res.status(500).json({ code: "server_error", message: "Failed to delete listing" });
  }
});

export default router;
