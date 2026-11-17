import { useMemo, useSyncExternalStore } from "react";
import { getSessionUserId, read, subscribe as dbSubscribe } from "./db";
import en, { type Key } from "@/locales/en";
import hi from "@/locales/hi";
import mr from "@/locales/mr";

/**
 * Single application-wide translation system.
 *
 * Language source of truth:
 *  - signed-in user → `profile.language` (persisted with the account)
 *  - signed-out visitor → localStorage (`skillswap-rural.lang`)
 * Every component reads the language through `useI18n()` / `useT()`, which subscribe
 * to both sources, so a change re-renders the whole tree immediately without a reload.
 *
 * Only interface text is translated. User-generated content (listing text, bios,
 * messages, review comments, notes) is always shown exactly as written.
 */

export type { Key };
export type Lang = "en" | "hi" | "mr";
export type Vars = Record<string, string | number>;

export const LANGUAGES: { value: Lang; native: string; english: string; badge: string }[] = [
  { value: "en", native: "English", english: "English", badge: "Aa" },
  { value: "hi", native: "हिन्दी", english: "Hindi", badge: "हि" },
  { value: "mr", native: "मराठी", english: "Marathi", badge: "म" },
];

export const DICT: Record<Lang, Record<Key, string>> = { en, hi, mr };

/** Latin digits are kept in every language so numbers, dates and inputs stay consistent. */
const LOCALE: Record<Lang, string> = { en: "en-IN", hi: "hi-IN-u-nu-latn", mr: "mr-IN-u-nu-latn" };

export const LANG_STORAGE_KEY = "skillswap-rural.lang";
export const isLang = (v: unknown): v is Lang => v === "en" || v === "hi" || v === "mr";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function visitorLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(v) ? v : "en";
  } catch {
    return "en";
  }
}

export function setVisitorLang(l: Lang) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, l);
  } catch {
    /* storage unavailable — language still applies for this session via profile */
  }
  emit();
}

export function getLang(): Lang {
  try {
    const id = getSessionUserId();
    if (id) {
      const p = read().profiles.find((x) => x.userId === id);
      if (p && isLang(p.language)) return p.language;
    }
  } catch {
    /* fall back to visitor preference */
  }
  return visitorLang();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === LANG_STORAGE_KEY) emit();
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const off = dbSubscribe(cb);
  return () => {
    listeners.delete(cb);
    off();
  };
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

const enMap = en as Record<string, string>;
export const hasKey = (k: string) => Object.prototype.hasOwnProperty.call(enMap, k);

export function translate(key: Key, vars?: Vars, lang: Lang = getLang()): string {
  const raw = (DICT[lang] as Record<string, string>)[key] ?? enMap[key] ?? key.slice(key.indexOf(".") + 1);
  return vars ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m)) : raw;
}

/** Display-label keys for stored enum values (stored values never change). */
export const L = {
  cat: (v: string) => `cat.${v}` as Key,
  type: (v: string) => `type.${v}` as Key,
  status: (kind: string, v: string) => `status.${kind}.${v}` as Key,
  mode: (v: string) => `mode.${v}` as Key,
  progress: (v: string) => `progress.${v}` as Key,
  delivery: (v: string) => `delivery.${v}` as Key,
  xstatus: (v: string) => `xstatus.${v}` as Key,
  level: (v: string) => `level.${v}` as Key,
  ms: (v: string) => `ms.s.${v}` as Key,
  collab: (v: string) => `collab.${v}` as Key,
};

export function makeI18n(lang: Lang) {
  const locale = LOCALE[lang];
  const nf = new Intl.NumberFormat(locale);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const t = (key: Key, vars?: Vars) => translate(key, vars, lang);
  const num = (n: number) => nf.format(n);
  /** Plural helper: looks up `${base}.one` / `${base}.other` with {n}. */
  const tn = (base: string, n: number, vars?: Vars) => translate(`${base}.${n === 1 ? "one" : "other"}` as Key, { n: num(n), ...vars }, lang);
  const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : "");
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const dateTime = (iso: string) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  const ago = (iso: string) => {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 45) return t("time.justNow");
    if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
    if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
    if (s < 86400 * 7) return rtf.format(-Math.round(s / 86400), "day");
    return date(iso);
  };
  const greeting = () => {
    const h = new Date().getHours();
    return t(h < 12 ? "greet.morning" : h < 17 ? "greet.afternoon" : "greet.evening");
  };
  return { lang, locale, t, tn, num, date, time, dateTime, day, ago, greeting };
}

export type I18n = ReturnType<typeof makeI18n>;

export function useI18n(): I18n {
  const lang = useLang();
  return useMemo(() => makeI18n(lang), [lang]);
}

export const useT = () => useI18n().t;

/** Render a persisted system message (notification / activity) stored as key + vars. */
export function dyn(t: I18n["t"], key: string | undefined, vars: Vars | undefined, fallback: string) {
  if (key?.startsWith(["notif", "verification"].join("."))) return t("community.legacyVerificationNotice");
  return key && hasKey(key) ? t(key as Key, vars) : fallback;
}
