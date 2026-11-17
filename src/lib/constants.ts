import {
  LISTING_CATEGORIES,
  LISTING_NEED_TYPES,
  LISTING_OFFER_TYPES,
} from "../../server/src/listing/validation";

/**
 * Stored values (database enums). Never translate these — display labels come from
 * the i18n dictionaries via `L.*` helpers in `@/lib/i18n`.
 */
export const CATEGORIES = LISTING_CATEGORIES;
export const OFFER_TYPES = LISTING_OFFER_TYPES;
export const NEED_TYPES = LISTING_NEED_TYPES;
export const COLLAB_TYPES = ["Skill swap", "Resource exchange", "Mentoring", "Joint project", "Bulk buying", "Shared transport"] as const;

export const MODES = ["remote", "in_person", "both"] as const;
export const DELIVERY_STATUSES = ["not_started", "dispatched", "handed_over", "received"] as const;
export const PROGRESS_STEPS = ["not_started", "in_progress", "ready", "confirmed"] as const;
export const OFFER_STATUSES = ["draft", "active", "inactive"] as const;
export const NEED_STATUSES = ["draft", "open", "matched", "in_progress", "fulfilled", "paused"] as const;
export const EXCHANGE_STATUSES = ["pending", "declined", "withdrawn", "active", "completed", "cancelled"] as const;
export const SKILL_LEVELS = ["beginner", "intermediate", "expert"] as const;
export const MILESTONE_STATUSES = ["not_started", "in_progress", "completed"] as const;

export const LIMITS = {
  title: 100,
  description: 1500,
  details: 800,
  pref: 500,
  short: 120,
  message: 2000,
  bio: 500,
  review: 1000,
  reviewMin: 10,
  imagesPerListing: 4,
  imageBytes: 5 * 1024 * 1024,
};
