/**
 * Translation completeness check for SkillSwap Rural.
 *
 * Run:  npx esbuild scripts/check-i18n.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/check-i18n.mjs && node /tmp/check-i18n.mjs
 *
 * Checks:
 *  1. hi / mr contain exactly the English key set (also enforced by TypeScript).
 *  2. Placeholders ({name}, {n}, …) match the English text for every key.
 *  3. Hindi / Marathi values are non-empty and written in Devanagari.
 *  4. Every key-shaped string literal used in src/ exists in the English dictionary.
 *  5. Keys generated from stored enum values (categories, statuses, …) all exist.
 *  6. Plural keys used through tn() have both `.one` and `.other`.
 *  7. No hard-coded English UI text in JSX (text nodes and user-visible attributes).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "../src/locales/en";
import { BUSINESS_TYPES, PHONE_RE } from "../src/lib/verify";
import hi from "../src/locales/hi";
import mr from "../src/locales/mr";
import * as C from "../src/lib/constants";

const problems: string[] = [];
const enKeys = Object.keys(en);
const enMap = en as Record<string, string>;
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const DEVANAGARI = /[\u0900-\u097F]/;
// Values that legitimately contain no Devanagari (only placeholders / symbols).
const NO_SCRIPT_OK = new Set(["dash.greetingName", "rp.nStars"]);

for (const [name, dict] of [["hi", hi], ["mr", mr]] as const) {
  const d = dict as Record<string, string>;
  for (const k of enKeys) {
    if (!(k in d)) problems.push(`[${name}] missing key: ${k}`);
    else {
      if (!d[k].trim()) problems.push(`[${name}] empty value: ${k}`);
      if (ph(d[k]) !== ph(enMap[k])) problems.push(`[${name}] placeholder mismatch in ${k}: "${ph(enMap[k])}" vs "${ph(d[k])}"`);
      if (!NO_SCRIPT_OK.has(k) && !DEVANAGARI.test(d[k])) problems.push(`[${name}] not translated (no Devanagari): ${k} = "${d[k]}"`);
    }
  }
  for (const k of Object.keys(d)) if (!(k in enMap)) problems.push(`[${name}] extra key not in English: ${k}`);
}

// Gather source files
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const files = walk("src").filter((f) => !f.includes("/locales/"));
const NAMESPACES = new Set(enKeys.map((k) => k.split(".")[0]));

// 4. key-shaped string literals
let literalCount = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/["'`]([a-z]+)\.([A-Za-z0-9_.:]+)["'`]/g)) {
    const key = `${m[1]}.${m[2]}`;
    if (!NAMESPACES.has(m[1]) || m[2].endsWith(".")) continue;
    if (/\.(tsx?|css|json)$/.test(key) || key.startsWith("count.") && !/\.(one|other)$/.test(key)) continue;
    literalCount++;
    if (!(key in enMap)) problems.push(`[code] unknown key "${key}" in ${f}`);
  }
}

// 5. dynamic keys from stored values
const need = (k: string) => !(k in enMap) && problems.push(`[dynamic] missing key: ${k}`);
C.CATEGORIES.forEach((v) => need(`cat.${v}`));
[...C.OFFER_TYPES, ...C.NEED_TYPES].forEach((v) => need(`type.${v}`));
C.COLLAB_TYPES.forEach((v) => need(`collab.${v}`));
C.MODES.forEach((v) => need(`mode.${v}`));
C.PROGRESS_STEPS.forEach((v) => need(`progress.${v}`));
C.DELIVERY_STATUSES.forEach((v) => need(`delivery.${v}`));
C.EXCHANGE_STATUSES.forEach((v) => need(`xstatus.${v}`));
C.SKILL_LEVELS.forEach((v) => need(`level.${v}`));
C.MILESTONE_STATUSES.forEach((v) => { need(`ms.s.${v}`); need(`ev.ms.${v}`); });
C.OFFER_STATUSES.forEach((v) => need(`status.offer.${v}`));
C.NEED_STATUSES.forEach((v) => need(`status.need.${v}`));
BUSINESS_TYPES.forEach((v) => need(`verify.bizType.${v}`));
["phone", "email"].forEach((c) => { need(`verify.providerChannel.${c}`); need(`verify.providerType.${c}`); });
["not_started", "pending", "verified", "rejected", "unavailable"].forEach((v) => need(`verify.st.${v}`));
["requests", "active", "completed", "history"].forEach((v) => { need(`x.tab.${v}`); need(`x.empty.${v}.title`); need(`x.empty.${v}.body`); });
["all", "incoming", "outgoing", "awaiting", "declined", "withdrawn", "cancelled"].forEach((v) => need(`x.f.${v}`));
["active", "awaiting", "completed", "cancelled"].forEach((v) => { need(`co.tab.${v}`); need(`co.empty.${v}.title`); need(`co.empty.${v}.body`); });
["offer:inactive", "need:paused", "need:fulfilled", "offer:pending_review", "need:pending_review", "offer:rejected", "need:rejected"].forEach((v) =>
  ["title", "body", "label"].forEach((p) => need(`ml.c.${v}.${p}`))
);
["active", "inactive"].forEach((v) => need(`ml.tab.${v}`));
["theyMeetMyNeeds", "iMeetTheirNeeds", "categoryRelevance", "location"].forEach((v) => need(`match.factor.${v}`));
[1, 2, 3, 4, 5].forEach((v) => need(`ui.star.${v}`));
["bio", "location", "skills", "portfolio"].forEach((v) => need(`pe.vis.${v}`));
["in_progress", "not_started"].forEach((v) => need(`ev.progress.${v}`));
["business", "identity"].forEach((v) => need(`notif.type.${v}`));

// 6. plurals
for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/tn\("([a-z.]+)"/g)) { need(`${m[1]}.one`); need(`${m[1]}.other`); }

// 7. hard-coded English in JSX
const ALLOW = /^(SkillSwap Rural|SkillSwap|Rural|https?:\/\/.*|@.*|Aa|—|·|★|…)$/;
for (const f of files.filter((x) => x.endsWith(".tsx"))) {
  const src = readFileSync(f, "utf8");
  // Text nodes: >Some words<
  for (const m of src.matchAll(/>([^<>{}]*[A-Za-z]{3,}[^<>{}]*)</g)) {
    const text = m[1].trim();
    // Skip TypeScript fragments picked up between generics/ternaries (e.g. ") : !data ? (", "Date.now() - x").
    if (!text || ALLOW.test(text) || /[=;&|?(){}]|\w\.\w|^[:)]|\bvoid\b|\bPromise\b/.test(text)) continue;
    problems.push(`[hardcoded] text "${text}" in ${f}`);
  }
  // User-visible attributes with literal English
  for (const m of src.matchAll(/\b(placeholder|aria-label|title|label|alt|body|description|hint|confirmLabel)="([^"]*[A-Za-z]{3,}[^"]*)"/g)) {
    if (ALLOW.test(m[2])) continue;
    problems.push(`[hardcoded] ${m[1]}="${m[2]}" in ${f}`);
  }
}

console.log(`Keys: ${enKeys.length} (en) / ${Object.keys(hi).length} (hi) / ${Object.keys(mr).length} (mr)`);
console.log(`Key-shaped literals checked in source: ${literalCount}; files scanned: ${files.length}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  problems.forEach((p) => console.log(" - " + p));
  process.exit(1);
}
console.log("\n✓ Translation check passed: complete, consistent, no hard-coded UI strings found.");
