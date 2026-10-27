import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const getPath = () => window.location.hash.replace(/^#/, "") || "/";
const sub = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function useLocation() {
  const full = useSyncExternalStore(sub, getPath, getPath);
  const [path, query = ""] = full.split("?");
  return { path, query: new URLSearchParams(query), full };
}

export function navigate(to: string) {
  if (getPath() !== to) window.location.hash = to;
  window.scrollTo({ top: 0 });
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={`#${to}`}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (!e.defaultPrevented && !e.metaKey && !e.ctrlKey) window.scrollTo({ top: 0 });
      }}
      {...rest}
    />
  );
}
