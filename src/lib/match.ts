import type { Exchange, ID, Listing, Profile } from "./types";
import type { Key } from "@/locales/en";

/**
 * Transparent, rule-based matching (no external AI).
 *
 * Starting weights (configurable). Factors without reliable data on both sides
 * are dropped and the remaining weights are re-normalised so nobody is
 * penalised for leaving optional fields blank.
 */
export const MATCH_WEIGHTS = {
  theyMeetMyNeeds: 40,
  iMeetTheirNeeds: 35,
  categoryRelevance: 15,
  location: 10,
};

/** Minimum listing-pair similarity to count as "addresses a need". */
export const PAIR_THRESHOLD = 0.3;

const STOP = new Set(
  "the and for with you your our are can will from that this have has need needs want looking help some any all who what into about over more less very just also offer offers provide providing based using use per get etc i'd i'm would like".split(" ")
);

const SYNONYMS: Record<string, string> = {
  veggies: "vegetable",
  veg: "vegetable",
  vegetables: "vegetable",
  produce: "vegetable",
  fruits: "fruit",
  photos: "photo",
  photograph: "photo",
  photography: "photo",
  photographer: "photo",
  pictures: "photo",
  designer: "design",
  designing: "design",
  logos: "logo",
  website: "web",
  websites: "web",
  site: "web",
  developer: "develop",
  development: "develop",
  transportation: "transport",
  delivery: "transport",
  logistics: "transport",
  trucking: "transport",
  marketing: "market",
  farming: "farm",
  farmer: "farm",
  packaging: "package",
  packages: "package",
  pack: "package",
  teaching: "teach",
  tutoring: "teach",
  training: "teach",
  handmade: "handicraft",
  crafts: "handicraft",
  craft: "handicraft",
};

function stem(w: string) {
  if (SYNONYMS[w]) return SYNONYMS[w];
  let s = w;
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.length > 4 && s.endsWith("es")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return SYNONYMS[s] ?? s;
}

export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

const listingText = (l: Listing) => [l.title, l.details, l.type, l.tags.join(" ")].join(" ");

function similarity(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return { score: 0, shared: [] as string[] };
  const shared = [...a].filter((t) => b.has(t));
  return { score: shared.length / Math.sqrt(a.size * b.size), shared };
}

export interface PairMatch {
  need: { id: ID; title: string; category: string; ownerId: ID; viaPreference?: boolean };
  offer: Listing;
  score: number;
  shared: string[];
}

/** How well `offer` addresses a need described by text + category. */
function scorePair(needText: string, needCategory: string, offer: Listing) {
  const sim = similarity(tokenize(needText), tokenize(listingText(offer)));
  const textScore = Math.min(1, sim.score * 1.6);
  const cat = needCategory && needCategory === offer.category ? 1 : 0;
  // Category agreement alone is not enough — require some textual overlap.
  const score = sim.shared.length ? 0.7 * textScore + 0.3 * cat : 0;
  return { score: Math.min(1, score), shared: sim.shared };
}

export function matchNeedToOffers(need: Listing, offers: Listing[]): PairMatch[] {
  return offers
    .map((o) => {
      const r = scorePair(`${need.title} ${need.details} ${need.tags.join(" ")}`, need.category, o);
      return { need: { id: need.id, title: need.title, category: need.category, ownerId: need.ownerId }, offer: o, ...r };
    })
    .filter((p) => p.score >= PAIR_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

/** Needs + optional "want in return" preferences on offers both describe what a person is looking for. */
function wantsOf(needs: Listing[], offers: Listing[]) {
  const wants: { id: ID; title: string; category: string; ownerId: ID; text: string; viaPreference?: boolean }[] = needs.map((n) => ({
    id: n.id,
    title: n.title,
    category: n.category,
    ownerId: n.ownerId,
    text: `${n.title} ${n.details} ${n.tags.join(" ")}`,
  }));
  for (const o of offers) {
    if (o.exchangePref.trim())
      wants.push({ id: o.id, title: o.exchangePref, category: "", ownerId: o.ownerId, text: o.exchangePref, viaPreference: true });
  }
  return wants;
}

function bestPairs(wants: ReturnType<typeof wantsOf>, offers: Listing[]): PairMatch[] {
  const pairs: PairMatch[] = [];
  for (const w of wants)
    for (const o of offers) {
      const r = scorePair(w.text, w.category, o);
      if (r.score >= PAIR_THRESHOLD) pairs.push({ need: { id: w.id, title: w.title, category: w.category, ownerId: w.ownerId, viaPreference: w.viaPreference }, offer: o, ...r });
    }
  return pairs.sort((a, b) => b.score - a.score);
}

export type MatchKind = "mutual" | "potential" | "one_way";

export interface Factor {
  key: keyof typeof MATCH_WEIGHTS;
  weight: number;
  value: number;
  available: boolean;
}

export interface MatchCandidate {
  userId: ID;
  kind: MatchKind;
  score: number; // 0–100, normalised over available factors
  factors: Factor[];
  theyHelpMe: PairMatch[];
  iHelpThem: PairMatch[];
  categories: string[];
  latestListingAt: string;
  existing?: Exchange;
  /** Translation key + values; user listing titles are passed through untranslated. */
  explanation: { key: Key; vars: Record<string, string> };
  sameArea: boolean;
}

export interface MatchInput {
  me: ID;
  myProfile?: Profile;
  myOffers: Listing[];
  myNeeds: Listing[];
  others: Map<ID, { profile?: Profile; offers: Listing[]; needs: Listing[]; publicLocation?: string }>;
  exchanges: Exchange[];
}

function categorySet(listings: Listing[], profile?: Profile, includeSkills = false) {
  const s = new Set(listings.map((l) => l.category));
  if (includeSkills && profile?.visibility.skills) profile.skills.forEach((k) => k.category && s.add(k.category));
  return s;
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / new Set([...a, ...b]).size;
}

const shorten = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function computeMatches(input: MatchInput): MatchCandidate[] {
  const { me, myProfile, myOffers, myNeeds, others, exchanges } = input;
  const myWants = wantsOf(myNeeds, myOffers);
  const myLoc = myProfile?.location ? tokenize(myProfile.location) : new Set<string>();
  const out: MatchCandidate[] = [];

  for (const [userId, o] of others) {
    if (userId === me) continue;
    const theyHelpMe = bestPairs(myWants, o.offers);
    const iHelpThem = bestPairs(wantsOf(o.needs, o.offers), myOffers);
    if (!theyHelpMe.length && !iHelpThem.length) continue;

    const a = theyHelpMe[0]?.score ?? 0;
    const b = iHelpThem[0]?.score ?? 0;

    const myNeedCats = categorySet(myNeeds);
    const theirNeedCats = categorySet(o.needs);
    const theirOfferCats = categorySet(o.offers, o.profile, true);
    const myOfferCats = categorySet(myOffers, myProfile, true);
    const catAvailable = (myNeedCats.size > 0 && theirOfferCats.size > 0) || (theirNeedCats.size > 0 && myOfferCats.size > 0);
    const catParts = [
      myNeedCats.size && theirOfferCats.size ? jaccard(myNeedCats, theirOfferCats) : null,
      theirNeedCats.size && myOfferCats.size ? jaccard(theirNeedCats, myOfferCats) : null,
    ].filter((x): x is number => x !== null);
    const catValue = catParts.length ? Math.max(...catParts) : 0;

    const theirLoc = o.publicLocation ? tokenize(o.publicLocation) : new Set<string>();
    const locAvailable = myLoc.size > 0 && theirLoc.size > 0;
    const locValue = locAvailable && [...myLoc].some((t) => theirLoc.has(t)) ? 1 : 0;

    const factors: Factor[] = [
      { key: "theyMeetMyNeeds", weight: MATCH_WEIGHTS.theyMeetMyNeeds, value: a, available: myWants.length > 0 },
      { key: "iMeetTheirNeeds", weight: MATCH_WEIGHTS.iMeetTheirNeeds, value: b, available: myOffers.length > 0 },
      { key: "categoryRelevance", weight: MATCH_WEIGHTS.categoryRelevance, value: catValue, available: catAvailable },
      { key: "location", weight: MATCH_WEIGHTS.location, value: locValue, available: locAvailable },
    ];
    // Normalise against the two core factors always (so one-way can never outrank a strong mutual), plus optional ones only when data exists.
    const denom = factors.filter((f) => f.key === "theyMeetMyNeeds" || f.key === "iMeetTheirNeeds" || f.available).reduce((s, f) => s + f.weight, 0);
    const num = factors.filter((f) => f.available || f.key === "theyMeetMyNeeds" || f.key === "iMeetTheirNeeds").reduce((s, f) => s + f.weight * f.value, 0);
    const score = Math.round((num / denom) * 100);

    const kind: MatchKind = a > 0 && b > 0 ? "mutual" : a > 0 ? "potential" : "one_way";
    const existing = exchanges
      .filter((x) => (x.requesterId === me && x.recipientId === userId) || (x.recipientId === me && x.requesterId === userId))
      .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0];

    const pick = (ps: PairMatch[]) => ps.find((p) => !p.need.viaPreference) ?? ps[0];
    const th = pick(theyHelpMe);
    const ih = pick(iHelpThem);
    const tOffer = th?.offer.title;
    const tNeed = ih?.need.title;
    const myN = th?.need.title;
    const myO = ih?.offer.title;
    const explanation: MatchCandidate["explanation"] =
      kind === "mutual"
        ? { key: "match.expl.mutual", vars: { theirOffer: shorten(tOffer!), myNeed: shorten(myN!), theirNeed: shorten(tNeed!), myOffer: shorten(myO!) } }
        : kind === "potential"
          ? { key: "match.expl.potential", vars: { theirOffer: shorten(tOffer!), myNeed: shorten(myN!) } }
          : { key: "match.expl.oneWay", vars: { theirNeed: shorten(tNeed!), myOffer: shorten(myO!) } };

    const allListings = [...o.offers, ...o.needs];
    out.push({
      userId,
      kind,
      score,
      factors,
      theyHelpMe,
      iHelpThem,
      categories: [...new Set([...theyHelpMe.map((p) => p.offer.category), ...iHelpThem.map((p) => p.offer.category), ...iHelpThem.map((p) => p.need.category)].filter(Boolean))],
      latestListingAt: allListings.map((l) => l.createdAt).sort().pop() ?? "",
      existing,
      explanation,
      sameArea: locAvailable && locValue === 1,
    });
  }
  return out.sort((x, y) => y.score - x.score || (x.kind === "mutual" ? -1 : 1));
}

export const strengthKey = (s: number): Key => (s >= 70 ? "match.strength.strong" : s >= 45 ? "match.strength.good" : "match.strength.fair");
export const KIND_KEY: Record<MatchKind, Key> = { mutual: "match.kind.mutual", potential: "match.kind.potential", one_way: "match.kind.one_way" };
export const KIND_HINT_KEY: Record<MatchKind, Key> = { mutual: "match.hint.mutual", potential: "match.hint.potential", one_way: "match.hint.one_way" };
export const factorKey = (k: Factor["key"]) => `match.factor.${k}` as Key;
export function explainMatch(t: (k: Key, v?: Record<string, string>) => string, c: MatchCandidate) {
  return t(c.explanation.key, c.explanation.vars) + (c.sameArea ? " " + t("match.expl.sameArea") : "");
}
