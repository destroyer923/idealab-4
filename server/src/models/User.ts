import mongoose, { Schema } from "mongoose";

const profileSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    username: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 24,
      unique: true,
    },
    bio: { type: String, default: "" },
    occupation: { type: String, default: "" },
    roles: { type: [String], default: [] },
    location: { type: String, default: "" },
    languages: { type: [String], default: [] },
    skills: { type: [Schema.Types.Mixed], default: [] },
    interests: { type: [String], default: [] },
    collabTypes: { type: [String], default: [] },
    availability: { type: String, default: "" },
    avatar: { type: String, default: undefined },
    cover: { type: String, default: undefined },
    portfolio: { type: [Schema.Types.Mixed], default: [] },
    visibility: {
      type: Schema.Types.Mixed,
      default: () => ({ bio: true, location: false, skills: true, portfolio: true }),
    },
    prefs: {
      type: Schema.Types.Mixed,
      default: () => ({ messages: true, exchanges: true, reviews: true }),
    },
    qrToken: { type: String, required: true },
    language: { type: String, enum: ["en", "hi", "mr"], default: "en" },
  },
  { timestamps: true },
);

const userSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    salt: { type: String, select: false },
    role: {
      type: String,
      enum: ["member", "reviewer", "admin"],
      default: "member",
    },
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
    },
    profile: { type: profileSchema, required: true },
  },
  { timestamps: true },
);

export const UserModel =
  mongoose.models.SkillSwapUser ??
  mongoose.model("SkillSwapUser", userSchema);
