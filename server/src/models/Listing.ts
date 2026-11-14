import mongoose, { Schema } from "mongoose";

const listingSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    ownerId: { type: String, required: true, index: true },
    kind: { type: String, enum: ["offer", "need"], required: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true },
    type: { type: String, required: true },
    description: { type: String, required: true },
    details: { type: String, default: "" },
    exchangePref: { type: String, default: "" },
    location: { type: String, default: "" },
    availability: { type: String, default: "" },
    mode: { type: String, enum: ["", "remote", "in_person", "both"], default: "" },
    quantity: { type: String, default: "" },
    tags: { type: [String], default: [] },
    images: { type: [String], default: [] },
    status: {
      type: String,
      enum: [
        "draft",
        "pending_review",
        "active",
        "inactive",
        "rejected",
        "open",
        "matched",
        "in_progress",
        "fulfilled",
        "paused",
      ],
      default: "draft",
    },
    businessClaimed: { type: Boolean, default: false },
    reviewReason: { type: String, default: undefined },
    reviewReasonVars: { type: Schema.Types.Mixed, default: undefined },
    reviewedBy: { type: String, default: undefined },
    reviewedAt: { type: String, default: undefined },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
    deletedAt: { type: String, default: undefined },
  },
  { timestamps: false },
);

export const ListingModel =
  mongoose.models.SkillSwapListing ?? mongoose.model("SkillSwapListing", listingSchema);
