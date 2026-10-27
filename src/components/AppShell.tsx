import { useEffect, useState, type ReactNode } from "react";
import { Menu, Search } from "lucide-react";
import { cn } from "@/utils/cn";
import { navigate, useLocation } from "@/lib/router";
import { Logo, SidebarContent } from "./Sidebar";
import { focusRing } from "./ui";
import { useT } from "@/lib/i18n";
import { NotificationBell } from "./NotificationBell";

const COLLAPSE_KEY = "skillswap-rural.sidebar-collapsed";

function GlobalSearch() {
  const [q, setQ] = useState("");
  const t = useT();
  return (
    <form
      role="search"
      className="relative hidden w-full max-w-md md:block"
      onSubmit={(e) => {
        e.preventDefault();
        navigate(`/explore${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
      }}
    >
      <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a3b44]" aria-hidden />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={t("shell.searchLabel")}
        placeholder={t("shell.searchPlaceholder")}
        className="h-9 w-full border-b border-[#E9DFDC] bg-transparent pl-7 pr-3 text-[13px] placeholder:text-slate-400 transition focus:border-[#541B2B] focus:outline-none"
      />
    </form>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const [drawer, setDrawer] = useState(false);
  const { path } = useLocation();
  const t = useT();
  useEffect(() => localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"), [collapsed]);
  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    if (!drawer) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", k);
      document.body.style.overflow = "";
    };
  }, [drawer]);
  const isMessages = path.startsWith("/messages");

  return (
    <div className="min-h-screen bg-cream">
      <a href="#main" className="sr-only z-[90] bg-[#541B2B] px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        {t("shell.skip")}
      </a>
      {/* Desktop sidebar */}
      <aside className={cn("fixed inset-y-0 left-0 z-40 hidden border-r border-[#E9DFDC] bg-white transition-[width] duration-300 ease-[cubic-bezier(.2,.7,.2,1)] lg:block", collapsed ? "w-[64px]" : "w-[232px]")}>
        <div className="relative h-full">
          <SidebarContent collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-[fade_.2s] bg-slate-900/40" onClick={() => setDrawer(false)} aria-hidden />
          <aside role="dialog" aria-modal="true" aria-label={t("shell.navigation")} className="absolute inset-y-0 left-0 w-[264px] max-w-[84vw] animate-[slidein_.25s_ease-out] border-r border-[#E9DFDC] bg-white shadow-2xl">
            <SidebarContent collapsed={false} mobile onToggle={() => setDrawer(false)} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className={cn("transition-none lg:transition-[padding] lg:duration-300 lg:ease-[cubic-bezier(.2,.7,.2,1)]", collapsed ? "lg:pl-[64px]" : "lg:pl-[232px]")}>
        <header className="sticky top-0 z-30 border-b border-[#E9DFDC] bg-[#FFF8F0]/90 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-10">
            <button onClick={() => setDrawer(true)} aria-label={t("shell.openNav")} aria-expanded={drawer} className={cn("grid h-9 w-9 shrink-0 place-items-center border border-[#E9DFDC] bg-white text-[#541B2B] lg:hidden", focusRing)}>
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1 md:flex-none lg:hidden">
              <Logo />
            </div>
            <GlobalSearch />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button onClick={() => navigate("/explore")} aria-label={t("shell.search")} className={cn("grid h-9 w-9 place-items-center border border-[#E9DFDC] bg-white text-[#541B2B] md:hidden", focusRing)}>
                <Search className="h-[18px] w-[18px]" />
              </button>
              <NotificationBell />
            </div>
          </div>
        </header>
        <main id="main" className={cn("mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10", isMessages ? "py-4" : "py-8 sm:py-10")}>
          {children}
        </main>
      </div>
    </div>
  );
}
