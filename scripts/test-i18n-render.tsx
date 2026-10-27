/**
 * End-to-end multilingual render test.
 * Seeds real data through the app's data layer, then server-renders every route of <App/>
 * in en / hi / mr and verifies: no leftover English UI words (user content excluded),
 * no raw translation keys, no unfilled {placeholders}. Also tests persistence & dynamic text.
 *
 * Run: npx esbuild scripts/test-i18n-render.tsx --bundle --platform=node --format=esm --alias:@=./src --jsx=automatic --outfile=/tmp/t.mjs && node /tmp/t.mjs
 */
const store: Record<string, string> = {};
const g = globalThis as any;
g.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = String(v)), removeItem: (k: string) => void delete store[k] };
const tab: Record<string, string> = {};
g.sessionStorage = { getItem: (k: string) => tab[k] ?? null, setItem: (k: string, v: string) => void (tab[k] = String(v)), removeItem: (k: string) => void delete tab[k] };
g.window = { location: { hash: "" }, addEventListener() {}, removeEventListener() {}, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
g.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };

const { renderToString } = await import("react-dom/server");
const { createElement } = await import("react");
const api = await import("../src/lib/api");
const i18n = await import("../src/lib/i18n");
const db = await import("../src/lib/db");
const { ApiError } = db;
const { computeMatches, explainMatch } = await import("../src/lib/match");
const { default: App } = await import("../src/App");

let pass = 0;
let fail = 0;
const ok = (c: unknown, m: string) => (c ? pass++ : (fail++, console.log("  ✗ " + m)));

/* ---------------- seed ---------------- */
const USER_TEXT: string[] = [];
const u = (s: string) => (USER_TEXT.push(s), s);

/**
 * Completes mandatory verification for an account: phone OTP, email code, then a submitted
 * identity declaration approved by a reviewer.
 */
async function verify(me: string) {
  const p = await api.requestVerificationCode("phone", "+91 9876543210");
  await api.verifyContactCode("phone", p.demoCode!);
  const e = await api.requestVerificationCode("email", api.getMe().email);
  await api.verifyContactCode("email", e.demoCode!);
  api.submitIdentityVerification({ fullName: api.getMe().profile.fullName, idReference: "AA-9999-8888", note: "Aadhaar card, pending review." });
  // the test harness grants reviewer access so the submission can be approved
  db.transact((state) => { state.users.find((u) => u.id === me)!.role = "admin"; });
  api.reviewIdentityVerification(me, "approve");
}
const base = { availability: "", mode: "" as const, quantity: "", images: [] as string[] };

i18n.setVisitorLang("hi"); // visitor picks Hindi before registering
await api.register({ email: "priya@x.in", password: "password2", fullName: u("Priya Shah"), username: u("priya"), language: i18n.visitorLang() });
ok(i18n.getLang() === "hi", "registration adopts visitor language (hi)");
const priya = api.currentUserId()!;
await verify(priya);
const pOffer = api.createListing("offer", { ...base, title: u("Packaging and logo design"), category: "Design", type: "Service", description: u("I design product packaging, labels and logos for small brands."), details: u("Packaging design, logo design, labels"), exchangePref: u("Organic vegetables or produce"), location: u("Nashik"), tags: [u("design")] }, true);
api.createListing("need", { ...base, title: u("Organic vegetables for my family"), category: "Food & Produce", type: "Physical Resource / Product", description: u("Looking for a regular supply of fresh organic vegetables."), details: u("Organic vegetables weekly"), exchangePref: "", location: "", tags: [] }, true);
api.logout();

i18n.setVisitorLang("en");
await api.register({ email: "sam@x.in", password: "password3", fullName: u("Sameer Kale"), username: u("sameer") });
const sameer = api.currentUserId()!;
await verify(sameer);
const sOffer = api.createListing("offer", { ...base, title: u("Product photography"), category: "Photography", type: "Service", description: u("Clean product photos for online shops and catalogues."), details: u("Product photography with lighting"), exchangePref: u("Organic products"), location: "", tags: [] }, true);
api.logout();

await api.register({ email: "raj@x.in", password: "password1", fullName: u("Raj Patil"), username: u("raj") });
const raj = api.currentUserId()!;
await verify(raj);
const rOffer = api.createListing("offer", { ...base, title: u("Fresh Organic Vegetables"), category: "Agriculture", type: "Physical Resource", description: u("Seasonal vegetables grown with organic practices on my farm."), details: u("Organic vegetables, tomatoes, spinach"), exchangePref: u("Packaging design for my products"), location: u("Nashik"), tags: [u("organic")] }, true);
api.createListing("need", { ...base, title: u("Packaging design for organic produce"), category: "Design", type: "Skill", description: u("Need attractive packaging and labels for my vegetable boxes."), details: u("Packaging design and logo"), exchangePref: u("Organic vegetables"), location: "", tags: [] }, true);
api.createListing("offer", { ...base, title: u("Tractor day loan"), category: "Agriculture", type: "Equipment Loan", description: u("Tractor available for a day on weekends nearby."), details: u("Tractor"), exchangePref: "", location: "", tags: [] }, false);
api.toggleSave(pOffer.id);
api.toggleSave(sOffer.id);
const conv = await api.openConversation(priya, "listing", pOffer.id);
await api.sendMessage(conv, u("Hello Priya, interested in packaging?"), "m1");
api.logout();

// Priya proposes to Raj (active, later), plus a completed exchange with reviews
await api.login("priya@x.in", "password2");
const x1 = api.proposeExchange({ recipientId: raj, listingId: rOffer.id, iProvide: u("Packaging design for 2 boxes"), iReceive: u("10 kg vegetables"), message: u("Hi Raj!"), targetDate: "2030-01-15" });
await api.sendMessage(conv, u("Yes, happy to help!"), "m2");
api.logout();
await api.login("raj@x.in", "password1");
api.respondToRequest(x1.id, "accept");
api.createMilestone(x1.id, { title: u("First draft"), description: u("Initial sketches"), dueDate: "2030-01-05" });
api.updateDelivery(x1.id, { required: true, method: u("Market pickup"), status: "dispatched", date: "2030-01-10", reference: u("Box A") });
api.addProgressNote(x1.id, u("Harvest starts Monday"));
api.logout();
await api.login("priya@x.in", "password2");
api.submitWork(x1.id, u("Sent final packaging files"), "https://drive.example.com/f");
api.logout();
// completed exchange from Sameer → Raj
await api.login("sam@x.in", "password3");
const x2 = api.proposeExchange({ recipientId: raj, listingId: rOffer.id, iProvide: u("Photos of 5 products"), iReceive: u("Vegetable box"), message: "", targetDate: "" });
api.logout();
await api.login("raj@x.in", "password1");
api.respondToRequest(x2.id, "accept");
api.submitWork(x2.id, u("Delivered the vegetable box"), "");
api.logout();
await api.login("sam@x.in", "password3");
api.reviewSubmission(x2.id, "confirm");
api.submitWork(x2.id, u("Shared the photo set"), "");
api.logout();
await api.login("raj@x.in", "password1");
api.reviewSubmission(x2.id, "confirm");
await api.submitReview(x2.id, 5, u("Great photos, delivered on time."));
api.logout();
await api.login("sam@x.in", "password3");
await api.submitReview(x2.id, 4, u("Fresh vegetables, thank you."));
api.setListingStatus(sOffer.id, "inactive"); // Raj's saved listing becomes unavailable
const x3 = api.proposeExchange({ recipientId: raj, iProvide: u("Help with marketing"), iReceive: "", message: u("Can we talk?"), targetDate: "" });
api.logout();

/* ---------------- persistence & login transitions ---------------- */
i18n.setVisitorLang("en");
await api.login("priya@x.in", "password2");
ok(i18n.getLang() === "hi", "saved account language (hi) wins over visitor language (en) on login");
ok(i18n.visitorLang() === "hi", "visitor preference updated to the account language after login");
api.logout();
ok(i18n.getLang() === "hi", "language kept after logout");
i18n.setVisitorLang("mr");
await api.login("raj@x.in", "password1");
ok(i18n.getLang() === "en", "Raj's saved language (en) is not overwritten by visitor choice");
try {
  api.setLanguage("fr");
  ok(false, "server rejects unsupported language");
} catch (e) {
  ok(e instanceof ApiError && e.message === "err.unsupportedLanguage", "server rejects unsupported language");
}

/* ---------------- dynamic text in each language ---------------- */
const RAW_KEY = /\b(app|shell|nav|common|action|count|ui|cat|type|collab|status|mode|progress|delivery|xstatus|level|ms|err|ev|notif|ctx|match|auth|dash|explore|listing|propose|x|cd|dl|rv|tl|ov|mt|lf|ml|co|msg|sv|pf|pe|rp|st|time|greet)\.[a-z][A-Za-z_.:]*[a-z]\b/;
for (const L of ["en", "hi", "mr"] as const) {
  const T = i18n.makeI18n(L);
  // API errors
  for (const fn of [() => api.proposeExchange({ recipientId: raj, iProvide: "a", iReceive: "", message: "", targetDate: "" }), () => api.submitReview(x3.id, 9, "x"), () => api.toggleSave(rOffer.id)]) {
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof ApiError ? T.t(e.message as never, e.vars) : "";
      ok(msg && !RAW_KEY.test(msg) && !/\{\w+\}/.test(msg) && (L === "en" || /[\u0900-\u097F]/.test(msg)), `[${L}] API error translated: ${msg}`);
    }
  }
  // Notifications & events
  for (const n of api.getNotifications()) {
    const s = i18n.dyn(T.t, n.key, n.vars, n.text);
    ok(!/\{\w+\}/.test(s) && !RAW_KEY.test(s) && (L === "en" || /[\u0900-\u097F]/.test(s)), `[${L}] notification: ${s}`);
  }
  for (const e of api.getActivity(50)) {
    const s = i18n.dyn(T.t, e.key, e.vars, e.text);
    ok(!/\{\w+\}/.test(s) && (L === "en" || /[\u0900-\u097F]/.test(s)), `[${L}] activity: ${s}`);
  }
  // Match explanations
  for (const c of computeMatches(api.getMatchInput())) {
    const s = explainMatch(T.t, c);
    ok(!/\{\w+\}/.test(s) && (L === "en" || /[\u0900-\u097F]/.test(s)), `[${L}] match explanation: ${s}`);
  }
  // Locale formatting
  const d = T.date("2025-03-05T10:00:00Z");
  ok(L === "en" ? /Mar/.test(d) : /[\u0900-\u097F]/.test(d), `[${L}] date localized: ${d}`);
  ok(/\d/.test(d) && !/[०-९]/.test(d), `[${L}] digits stay Latin: ${d}`);
  ok(T.ago(new Date(Date.now() - 3 * 3600_000).toISOString()).length > 0, `[${L}] relative time`);
}

/* ---------------- render every route ---------------- */
const ALLOW = new Set(["SkillSwap", "Rural", "JPG", "PNG", "WebP", "MB", "HTTPS", "GPS", "Enter", "Shift", "https", "http", "English", "Hindi", "Marathi", "drive", "example", "com"]);
// User-generated content (shown untranslated by design): full + first names, emails, and
// keywords the matcher derives from members' own listing text.
for (const n of ["Priya", "Sameer", "Raj"]) USER_TEXT.push(n);
for (const c of computeMatches(api.getMatchInput())) [...c.theyHelpMe, ...c.iHelpThem].forEach((p) => p.shared.forEach((w) => USER_TEXT.push(w)));
const userText = [...new Set(USER_TEXT)].sort((a, b) => b.length - a.length);
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
function visibleText(html: string) {
  const attrs = [...html.matchAll(/\s(?:placeholder|aria-label|title|alt)="([^"]*)"/g)].map((m) => m[1]);
  const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ");
  return decode([text, ...attrs].join(" \n "));
}

const conversations = api.getConversations();
const routes = [
  "/dashboard", "/explore", `/listing/${pOffer.id}`, `/listing/${rOffer.id}`, `/listing/${sOffer.id}`, "/matches", `/matches?focus=${priya}`,
  "/exchange", `/exchange/${x1.id}`, `/exchange/${x3.id}`, "/offers", "/offers/new", `/offers/${rOffer.id}/edit`, "/needs", "/needs/new",
  "/collaborations", `/collaborations/${x1.id}`, `/collaborations/${x2.id}`, "/messages", `/messages/${conversations[0]?.conversation.id}`,
  "/qr-code", "/scan-qr",
  "/saved", "/profile", "/profile/edit", `/u/priya`, `/u/nobody`, "/reviews", "/settings", "/does-not-exist",
];

for (const L of ["en", "hi", "mr"] as const) {
  api.setLanguage(L);
  for (const r of routes) {
    g.window.location.hash = "#" + r;
    let html = "";
    try {
      html = renderToString(createElement(App));
    } catch (e) {
      ok(false, `[${L}] ${r} failed to render: ${(e as Error).message}`);
      continue;
    }
    let text = visibleText(html).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, " "); // user emails
    ok(!/\{\w+\}/.test(text), `[${L}] ${r} has no unfilled placeholders`);
    const raw = text.match(RAW_KEY);
    ok(!raw, `[${L}] ${r} has no raw keys${raw ? ` (found "${raw[0]}")` : ""}`);
    if (L !== "en") {
      for (const s of userText) text = text.split(s).join(" ");
      text = text.replace(/@\w+/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/\bssr_[a-z0-9]+\b/gi, " ");
      const leftovers = [...new Set((text.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => !ALLOW.has(w)))];
      ok(leftovers.length === 0, `[${L}] ${r} fully translated${leftovers.length ? ` — English left: ${leftovers.slice(0, 12).join(", ")}` : ""}`);
      ok(/[\u0900-\u097F]/.test(text), `[${L}] ${r} renders Devanagari`);
    }
  }
}

// Signed-out pages use the visitor language
api.logout();
for (const L of ["hi", "mr"] as const) {
  i18n.setVisitorLang(L);
  g.window.location.hash = "#/";
  const text = visibleText(renderToString(createElement(App)));
  const leftovers = [...new Set((text.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => !ALLOW.has(w)))];
  ok(leftovers.length === 0, `[${L}] sign-in page translated${leftovers.length ? ` — English left: ${leftovers.join(", ")}` : ""}`);
}

if (process.env.SHOW) {
  await api.login("raj@x.in", "password1");
  for (const L of ["hi", "mr"] as const) {
    const T = i18n.makeI18n(L);
    console.log(`\n=== ${L} ===`);
    api.getNotifications().slice(0, 3).forEach((n) => console.log("notif:", i18n.dyn(T.t, n.key, n.vars, n.text)));
    api.getActivity(3).forEach((e) => console.log("event:", i18n.dyn(T.t, e.key, e.vars, e.text), "·", T.ago(e.createdAt)));
    const c = computeMatches(api.getMatchInput())[0];
    if (c) console.log("match:", explainMatch(T.t, c));
    console.log("date:", T.date(new Date().toISOString()), "| plural:", T.tn("count.reviews", 1), "/", T.tn("count.reviews", 3));
    try { await api.submitReview(x3.id, 9, "x"); } catch (e) { console.log("error:", T.t((e as InstanceType<typeof ApiError>).message as never)); }
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
