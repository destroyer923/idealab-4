import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronsLeft, ChevronsRight, LogOut, Settings, Sprout, UserRound, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { Link, navigate, useLocation } from "@/lib/router";
import { useQuery } from "@/lib/hooks";
import { getMe, logout, unreadMessageCount } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { NAV_GROUPS, isActive } from "./nav";
import { Avatar, focusRing } from "./ui";

export function Logo({ collapsed }: { collapsed?: boolean }) {
  const t = useT();
  return (
    <Link to="/dashboard" className={cn("flex min-w-0 items-center gap-2.5", focusRing)} aria-label={t("shell.goDashboard")}>
      <span className="grid h-7 w-7 shrink-0 place-items-center bg-[#541B2B] text-[#FFF8F0]">
        <Sprout className="h-4 w-4" aria-hidden strokeWidth={1.75} />
      </span>
      {!collapsed && (
        <span className="min-w-0 overflow-hidden whitespace-nowrap">
          <span className="block font-display text-[15px] font-semibold leading-tight text-[#541B2B]">SkillSwap Rural</span>
          <span className="block text-[9.5px] font-semibold uppercase leading-tight tracking-[0.16em] text-[#8a3b44]">{t("shell.brandTagline")}</span>
        </span>
      )}
    </Link>
  );
}

function AccountMenu({ collapsed }: { collapsed: boolean }) {
  const { data } = useQuery(() => getMe());
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  const name = data?.profile.fullName ?? t("shell.account");
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("shell.accountMenu", { name })}
        className={cn("flex w-full items-center gap-2.5 py-2 text-left transition-colors hover:text-[#541B2B]", focusRing, collapsed && "justify-center")}
      >
        <Avatar name={name} src={data?.profile.avatar} size={30} className="ring-1 ring-[#E9DFDC]" />
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-slate-800">{name}</span>
            <span className="block truncate text-[11px] text-slate-500">{data?.profile.username ? `@${data.profile.username}` : ""}</span>
          </span>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-50 mb-2 w-56 animate-[pop_.14s_ease-out] border border-[#E9DFDC] bg-white py-1 shadow-lg">
          {data && <p className="truncate border-b border-[#E9DFDC] px-3 pb-2 pt-1.5 text-[11px] text-slate-500">{data.email}</p>}
          {[
            { to: "/profile", label: t("nav.profile"), icon: UserRound },
            { to: "/settings", label: t("nav.settings"), icon: Settings },
          ].map((i) => (
            <Link key={i.to} to={i.to} role="menuitem" onClick={() => setOpen(false)} className={cn("flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-[#FFF8F0] hover:text-[#541B2B]", focusRing)}>
              <i.icon className="h-4 w-4" aria-hidden strokeWidth={1.75} /> {i.label}
            </Link>
          ))}
          <button
            role="menuitem"
            onClick={() => {
              logout();
              navigate("/");
            }}
            className={cn("mt-1 flex w-full items-center gap-2.5 border-t border-[#E9DFDC] px-3 py-2 text-[13px] text-[#B42335] hover:bg-[#B42335]/5", focusRing)}
          >
            <LogOut className="h-4 w-4" aria-hidden strokeWidth={1.75} /> {t("nav.logout")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Narrow, typographic navigation rail — hairline dividers, small labels, thin active marker. */
export function SidebarContent({ collapsed, onToggle, onNavigate, mobile }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void; mobile?: boolean }) {
  const { path } = useLocation();
  const { data: unread } = useQuery(() => unreadMessageCount());
  const t = useT();
  return (
    <div className="flex h-full flex-col bg-white">
      <div className={cn("flex h-16 shrink-0 items-center gap-2 border-b border-[#E9DFDC] px-5", collapsed && "justify-center px-0")}>
        {!collapsed && <Logo />}
        {collapsed && (
          <>
            <Logo collapsed />
            <span className="sr-only">SkillSwap Rural</span>
          </>
        )}
        {onToggle && !collapsed && (
          <button
            onClick={onToggle}
            aria-label={t(mobile ? "shell.closeNav" : "shell.collapse")}
            aria-expanded={mobile ? true : !collapsed}
            className={cn("ml-auto grid h-7 w-7 place-items-center text-slate-400 transition-colors hover:text-[#541B2B]", focusRing)}
          >
            {mobile ? <X className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        )}
      </div>
      {onToggle && collapsed && !mobile && (
        <button onClick={onToggle} aria-label={t("shell.expand")} aria-expanded={false} className={cn("mx-auto mt-3 grid h-7 w-7 place-items-center text-slate-400 transition-colors hover:text-[#541B2B]", focusRing)}>
          <ChevronsRight className="h-4 w-4" />
        </button>
      )}

      <nav aria-label={t("shell.mainNav")} className={cn("flex-1 px-3 py-2 [scrollbar-width:thin]", collapsed ? "overflow-visible" : "overflow-y-auto overflow-x-hidden")}>
        {NAV_GROUPS.map((g, gi) => (
          <Fragment key={g.label}>
            <p className={cn("px-2 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-slate-400", gi > 0 ? "pt-5" : "pt-3", collapsed && "sr-only")}>{t(g.label)}</p>
            {collapsed && gi > 0 && <div className="mx-auto my-3 h-px w-6 bg-[#E9DFDC]" aria-hidden />}
            <ul className="space-y-px" role="list">
              {g.items.map((item) => {
                const active = isActive(item, path);
                const count = item.badge === "unreadMessages" ? unread ?? 0 : 0;
                return (
                  <li key={item.to} className="group/item relative">
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      aria-label={collapsed ? `${t(item.label)}${count ? `, ${count} ${t("shell.unread")}` : ""}` : undefined}
                      className={cn(
                        "relative flex h-9 items-center gap-2.5 px-2 text-[13px] transition-colors duration-150",
                        focusRing,
                        collapsed && "justify-center px-0",
                        active ? "font-semibold text-[#541B2B]" : "font-medium text-slate-600 hover:text-[#541B2B]"
                      )}
                    >
                      {active && <span className="absolute -left-3 top-1.5 bottom-1.5 w-[2px] bg-[#541B2B]" aria-hidden />}
                      <item.icon className={cn("h-[17px] w-[17px] shrink-0", active ? "text-[#541B2B]" : "text-slate-400 group-hover/item:text-[#8a3b44]")} aria-hidden strokeWidth={1.75} />
                      {!collapsed && <span className="truncate">{t(item.label)}</span>}
                      {count > 0 &&
                        (collapsed ? (
                          <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-[#541B2B]" aria-hidden />
                        ) : (
                          <span className="ml-auto text-[11px] font-semibold tabular-nums text-[#8a3b44]">{count > 99 ? "99+" : count}</span>
                        ))}
                    </Link>
                    {collapsed && (
                      <span role="tooltip" className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap bg-[#29232A] px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/item:opacity-100 group-focus-within/item:opacity-100">
                        {t(item.label)}
                        {count > 0 && ` · ${count} ${t("shell.unread")}`}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Fragment>
        ))}
      </nav>

      <div className={cn("shrink-0 border-t border-[#E9DFDC] px-3 py-2", collapsed && "px-2")}>
        <AccountMenu collapsed={collapsed} />
      </div>
    </div>
  );
}
