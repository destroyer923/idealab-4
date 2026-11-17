import type { DB, Listing, ListingKind } from "../src/lib/types";

type TestUser = {
  id: string;
  email: string;
  password: string;
  fullName: string;
  username: string;
  language?: string;
};

const users = new Map<string, TestUser>();
const listings = new Map<string, Listing>();
let nextId = 0;

export function resetMockAuthApi() {
  users.clear();
  listings.clear();
  nextId = 0;
}

export function installMockAuthApi() {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname;
    const endpoint = path.split("/").at(-1);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    if (path === "/api/listing/me" && init?.method !== "POST") {
      const ownerId = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer test-token-/, "");
      const kind = parsedUrl.searchParams.get("kind");
      return new Response(JSON.stringify([...listings.values()].filter((listing) => listing.ownerId === ownerId && listing.kind === kind)), { status: 200 });
    }
    if (path === "/api/listing/public" && (init?.method ?? "GET") === "GET") {
      const storage = globalThis.localStorage?.getItem("skillswap-rural.db.v1");
      const db = storage ? JSON.parse(storage) as DB : null;
      const api = db ? await import("../src/lib/api") : null;
      const publicListings = [...listings.values()].filter((listing) => ["active", "open", "matched"].includes(listing.status));
      return new Response(JSON.stringify(publicListings.map((listing) => ({
        ...listing,
        owner: db && api ? api.memberOf(db, listing.ownerId) : undefined,
      }))), { status: 200 });
    }
    if (path.startsWith("/api/listing/") && (init?.method ?? "GET") === "POST") {
      const kind = endpoint as ListingKind;
      const ownerId = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer test-token-/, "") ?? "";
      const timestamp = new Date().toISOString();
      const listing = {
        ...body,
        id: `test-listing-${listings.size + 1}`,
        ownerId,
        kind,
        status: body.publish === true ? (kind === "offer" ? "active" : "open") : "draft",
        createdAt: timestamp,
        updatedAt: timestamp,
      } as Listing;
      listings.set(listing.id, listing);
      const storage = globalThis.localStorage?.getItem("skillswap-rural.db.v1");
      if (storage) {
        const db = JSON.parse(storage) as DB;
        db.listings.push(listing);
        globalThis.localStorage.setItem("skillswap-rural.db.v1", JSON.stringify(db));
      }
      return new Response(JSON.stringify(listing), { status: 201 });
    }
    if (path.startsWith("/api/listing/") && (init?.method ?? "GET") === "GET") {
      const listing = listings.get(endpoint ?? "");
      if (!listing) return new Response(JSON.stringify({ code: "not_found" }), { status: 404 });
      const api = await import("../src/lib/api");
      const storage = globalThis.localStorage?.getItem("skillswap-rural.db.v1");
      const db = storage ? JSON.parse(storage) as DB : null;
      return new Response(JSON.stringify({
        listing,
        owner: db ? api.memberOf(db, listing.ownerId) : { userId: listing.ownerId, fullName: "", username: "", occupation: "" },
        isOwner: false,
        unavailable: null,
      }), { status: 200 });
    }
    if (path.startsWith("/api/profile/") && (init?.method ?? "GET") === "GET") {
      const username = decodeURIComponent(endpoint ?? "").toLowerCase();
      const storage = globalThis.localStorage?.getItem("skillswap-rural.db.v1");
      if (!storage) return new Response(JSON.stringify({ code: "not_found" }), { status: 404 });
      const db = JSON.parse(storage) as DB;
      const profile = db.profiles.find((item) => item.username.toLowerCase() === username);
      if (!profile) return new Response(JSON.stringify({ code: "not_found" }), { status: 404 });
      const api = await import("../src/lib/api");
      const reviews = db.reviews.filter((review) => review.recipientId === profile.userId).map((review) => {
        const exchange = db.exchanges.find((item) => item.id === review.exchangeId);
        return {
          ...review,
          reviewer: api.memberOf(db, review.reviewerId),
          verifiedExchange: exchange ? api.qualifiesForReview(exchange) : false,
          canOpenExchange: api.currentUserId() === review.reviewerId || api.currentUserId() === review.recipientId,
        };
      });
      const listingsForProfile = db.listings.filter((listing) => listing.ownerId === profile.userId && !listing.deletedAt);
      return new Response(JSON.stringify({
        member: api.memberOf(db, profile.userId),
        profile,
        offers: listingsForProfile.filter((listing) => listing.kind === "offer"),
        needs: listingsForProfile.filter((listing) => listing.kind === "need"),
        reviews,
        rating: api.ratingSummary(db, profile.userId),
        completedExchanges: db.exchanges.filter((exchange) =>
          exchange.status === "completed" && [exchange.requesterId, exchange.recipientId].includes(profile.userId)
        ).length,
      }), { status: 200 });
    }
    if (endpoint !== "register" && endpoint !== "login") {
      return new Response(JSON.stringify({ code: "not_found" }), { status: 404 });
    }

    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = users.get(email);
    if (endpoint === "login" && (!user || user.password !== password)) {
      return new Response(JSON.stringify({ code: "invalid_credentials" }), { status: 401 });
    }
    if (endpoint === "register" && user) {
      return new Response(JSON.stringify({ code: "account_exists" }), { status: 409 });
    }

    const authenticated = user ?? {
      id: `test-user-${++nextId}`,
      email,
      password,
      fullName: typeof body.fullName === "string" ? body.fullName : "Test Member",
      username: typeof body.username === "string" ? body.username : `test_${nextId}`,
      language: typeof body.language === "string" ? body.language : "en",
    };
    if (!user) users.set(email, authenticated);
    const timestamp = new Date().toISOString();
    return new Response(JSON.stringify({
      token: `test-token-${authenticated.id}`,
      user: {
        id: authenticated.id,
        email: authenticated.email,
        role: "member",
        status: "active",
        profile: {
          userId: authenticated.id,
          fullName: authenticated.fullName,
          username: authenticated.username,
          language: authenticated.language,
          qrToken: `ssr_${authenticated.id.replace(/[^a-z0-9]/gi, "").toLowerCase().padEnd(16, "0")}`,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    }), { status: endpoint === "register" ? 201 : 200 });
  };
}
