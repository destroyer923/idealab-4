import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ApiError, getVersion, refreshStore, subscribe } from "./db";
import { hasKey, translate, useLang, type Key } from "./i18n";

/** Re-runs a data query whenever the store changes (in this tab or any other). */
export function useQuery<T>(fn: () => T | Promise<T>, deps: unknown[] = []) {
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);
  const [retry, setRetry] = useState(0);
  const lang = useLang(); // re-translate error messages when the language changes
  const [result, setResult] = useState<{ data?: T; error: string | null }>({ data: undefined, error: null });

  useEffect(() => {
    let active = true;
    try {
      const value = fn();
      const isPromise = value !== null && typeof value === "object" && "then" in value && typeof (value as Promise<T>).then === "function";
      if (isPromise) {
        setResult({ data: undefined, error: null });
        (value as Promise<T>)
          .then((data) => {
            if (active) setResult({ data, error: null });
          })
          .catch((e: unknown) => {
            if (!active) return;
            const key = e instanceof ApiError && hasKey(e.message) ? (e.message as Key) : "err.generic";
            setResult({ data: undefined, error: translate(key, e instanceof ApiError ? e.vars : undefined, lang) });
          });
        return () => { active = false; };
      }
      setResult({ data: value as T, error: null });
    } catch (e) {
      const key = e instanceof ApiError && hasKey(e.message) ? (e.message as Key) : "err.generic";
      setResult({ data: undefined, error: translate(key, e instanceof ApiError ? e.vars : undefined, lang) });
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, lang, retry, ...deps]);

  const refetch = useCallback(() => {
    refreshStore(true);
    setRetry((n) => n + 1);
  }, []);
  return { ...result, refetch };
}

/** One app-level fallback for missed storage broadcasts, paused when the tab is hidden. */
export function useStoreSync() {
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") refreshStore();
    };
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
}

export function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useMediaQuery(q: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(q).matches,
    () => false
  );
}
