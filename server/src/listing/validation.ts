export const LISTING_CATEGORIES = [
  "Agriculture",
  "Food & Produce",
  "Design",
  "Technology",
  "Marketing",
  "Photography",
  "Transport",
  "Handicrafts",
  "Education",
  "Construction & Repair",
  "Livestock",
  "Health & Wellness",
  "Finance & Admin",
  "Other",
] as const;

export const LISTING_OFFER_TYPES = ["Skill", "Service", "Physical Resource", "Equipment Loan", "Knowledge / Training"] as const;
export const LISTING_NEED_TYPES = ["Skill", "Physical Resource / Product", "Transportation / Logistics", "Advice / Mentoring", "Service", "Equipment"] as const;

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 1500;
const DETAILS_MAX = 800;
const abusiveTerms = new Set(["asshole", "bastard", "bitch", "bullshit", "fuck", "fucking", "shit"]);

export type ListingValidationKey =
  | "err.titleShort"
  | "err.maxLength"
  | "err.category"
  | "err.type"
  | "err.descriptionShort"
  | "err.descriptionWords"
  | "err.repetitiveContent"
  | "err.abusiveContent"
  | "err.detailsNeed"
  | "err.detailsOffer";

export function validateListingContent(input: {
  title: string;
  category: string;
  type: string;
  description: string;
  details: string;
}, kind: "offer" | "need"): Partial<Record<"title" | "category" | "type" | "description" | "details", ListingValidationKey>> {
  const errors: Partial<Record<"title" | "category" | "type" | "description" | "details", ListingValidationKey>> = {};
  const title = input.title.trim();
  const description = input.description.trim();
  const details = input.details.trim();
  const validTypes: readonly string[] = kind === "offer" ? LISTING_OFFER_TYPES : LISTING_NEED_TYPES;

  if (title.length < 4) errors.title = "err.titleShort";
  else if (title.length > TITLE_MAX) errors.title = "err.maxLength";
  else if (hasSpamPattern(title)) errors.title = "err.repetitiveContent";
  else if (hasAbusiveLanguage(title)) errors.title = "err.abusiveContent";
  if (!LISTING_CATEGORIES.includes(input.category as typeof LISTING_CATEGORIES[number])) errors.category = "err.category";
  if (!validTypes.includes(input.type)) errors.type = "err.type";
  if (description.length > DESCRIPTION_MAX) errors.description = "err.maxLength";
  else if ([...description].length < 8) errors.description = "err.descriptionShort";
  else if (hasSpamPattern(description)) errors.description = "err.repetitiveContent";
  else if (!hasUsefulDescription(description)) errors.description = "err.descriptionWords";
  else if (hasAbusiveLanguage(description)) errors.description = "err.abusiveContent";

  if (details.length < 3) errors.details = kind === "need" ? "err.detailsNeed" : "err.detailsOffer";
  else if (details.length > DETAILS_MAX) errors.details = "err.maxLength";
  else if (hasSpamPattern(details)) errors.details = "err.repetitiveContent";
  else if (hasAbusiveLanguage(details)) errors.details = "err.abusiveContent";
  return errors;
}

function hasUsefulDescription(value: string): boolean {
  const words = value.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length >= 2 && words.filter((word) => [...word].length >= 2).length >= 2) return true;
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}]/u.test(value)
    && [...value.replace(/\s/gu, "")].length >= 8;
}

function hasSpamPattern(value: string): boolean {
  const normalized = value.normalize("NFKC").toLowerCase();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (/(.)\1{3,}/u.test(normalized)) return true;
  if (/\b(?:asdf|qwerty|zxcv|1234)(?:\w*)\b/u.test(normalized)) return true;
  if (words.some((word) => /(.{1,4})\1{2,}/u.test(word))) return true;
  if (words.length >= 4 && new Set(words).size / words.length < 0.5) return true;
  return false;
}

function hasAbusiveLanguage(value: string): boolean {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).some((word) => abusiveTerms.has(word));
}
