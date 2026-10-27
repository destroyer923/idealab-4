/**
 * Illustrative photography (Pexels licence — free to use, no attribution required).
 * Used ONLY for non-personal visuals: hero slides, page banners and category fallbacks
 * for listings that have no photo of their own. Never presented as a member's own work.
 * All images come from one host (images.pexels.com) and are requested at the size needed.
 */
import type { Key } from "@/locales/en";

const px = (id: number, w = 1200, h = 630, ext = "jpeg") =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.${ext}?auto=compress&cs=tinysrgb&fit=crop&w=${w}&h=${h}`;

export const photo = { px };

/** Category → photo id. Stored category values stay English. */
const CATEGORY_PHOTO: Record<string, number> = {
  Agriculture: 20527451,
  "Food & Produce": 15741144,
  Design: 4219134,
  Technology: 4226272,
  Marketing: 5410115,
  Photography: 17094508,
  Transport: 29125191,
  Handicrafts: 8207644,
  Education: 11580455,
  "Construction & Repair": 5484718,
  Livestock: 37955471,
  "Health & Wellness": 20689437,
  "Finance & Admin": 6331260,
  Other: 17091890,
};

export function categoryImage(category: string, w = 640, h = 360) {
  return px(CATEGORY_PHOTO[category] ?? CATEGORY_PHOTO.Other, w, h);
}

export interface Slide {
  id: string;
  image: number;
  /** Translation keys */
  title: Key;
  body: Key;
  cta: Key;
  alt: Key;
  to: string;
}

export const HERO_SLIDES: Slide[] = [
  { id: "farm", image: 20527453, title: "hero.farm.title", body: "hero.farm.body", cta: "hero.farm.cta", alt: "hero.farm.alt", to: "/explore" },
  { id: "craft", image: 28382914, title: "hero.craft.title", body: "hero.craft.body", cta: "hero.craft.cta", alt: "hero.craft.alt", to: "/offers/new" },
  { id: "design", image: 5428644, title: "hero.design.title", body: "hero.design.body", cta: "hero.design.cta", alt: "hero.design.alt", to: "/needs/new" },
  { id: "shop", image: 17870116, title: "hero.shop.title", body: "hero.shop.body", cta: "hero.shop.cta", alt: "hero.shop.alt", to: "/exchange" },
  { id: "transport", image: 29057942, title: "hero.transport.title", body: "hero.transport.body", cta: "hero.transport.cta", alt: "hero.transport.alt", to: "/explore" },
  { id: "together", image: 4350060, title: "hero.together.title", body: "hero.together.body", cta: "hero.together.cta", alt: "hero.together.alt", to: "/matches" },
];

/** Decorative page-banner photos (alt="" — purely decorative). */
export const PAGE_IMAGES = {
  explore: px(20527455, 900, 500),
  matches: px(4350065, 900, 500),
  exchange: px(15741144, 900, 500),
  offers: px(20445201, 900, 500),
  needs: px(5410067, 900, 500),
  collaborations: px(5410115, 900, 500),
  saved: px(17091890, 900, 500),
  reviews: px(27730151, 900, 500),
  auth: px(20527451, 1400, 1800),
};
