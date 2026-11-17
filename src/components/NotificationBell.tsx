import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, Check, Handshake, MessageCircle, Star, UserPlus, X } from "lucide-react";
import { getNotificationInbox, markNotificationsRead } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { dyn, useI18n } from "@/lib/i18n";
import { navigate } from "@/lib/router";
import { cn } from "@/utils/cn";
import { Button, ErrorState, Spinner, errMsg, focusRing } from "./ui";

export function NotificationBell() {
  const { t, ago, num } = useI18n();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const inbox = useQuery(() => getNotificationInbox(30, page * 30), [page]);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const unread = inbox.data?.unread ?? 0;
  const icons = { message: MessageCircle, exchange: Handshake, review: Star, connection: UserPlus, verification: Bell };

  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const mark = async (ids?: string[], link?: string) => {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      await markNotificationsRead(ids);
      if (link && /^\/(messages|collaborations|exchange|listing|u|reviews|profile|dashboard|qr-code|scan-qr)(\/|\?|$)/.test(link)) {
        close();
        navigate(link);
      }
    } catch (e) { setActionError(errMsg(e)); }
    finally { setBusy(false); }
  };

  return (
    <div ref={ref} className="relative">
      <button ref={trigger} type="button" onClick={() => { setOpen(!open); setPage(0); }}
        aria-label={`${t("shell.notifications")}${unread ? `, ${t("shell.unreadCount", { n: num(unread) })}` : ""}`}
        aria-expanded={open} aria-haspopup="dialog" aria-controls="notification-inbox"
        className={cn("relative grid h-9 w-9 place-items-center border border-[#E9DFDC] bg-white text-[#541B2B] hover:border-[#541B2B]", focusRing)}>
        <Bell className="h-[18px] w-[18px]" aria-hidden />
        {!inbox.error && unread > 0 && <span aria-hidden className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#541B2B] px-1 text-[10px] font-semibold text-white ring-2 ring-[#FFF8F0]">{unread > 99 ? "99+" : num(unread)}</span>}
      </button>
      {open && (
        <section id="notification-inbox" role="dialog" aria-label={t("community.notificationsPanel")} aria-busy={busy}
          className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] animate-[pop_.15s_ease-out] border border-[#E9DFDC] bg-white shadow-xl">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9DFDC] px-4 py-3">
            <h2 className="text-sm font-semibold text-[#541B2B]">{t("shell.notifications")}</h2>
            <div className="flex items-center gap-3">
              {unread > 0 && <button type="button" disabled={busy} onClick={() => void mark()} className={cn("text-xs font-semibold text-[#541B2B] underline underline-offset-4 disabled:opacity-50", focusRing)}>{t("shell.markAllRead")}</button>}
              <button type="button" aria-label={t("common.close")} onClick={close} className={cn("p-1 text-slate-500", focusRing)}><X className="h-4 w-4" /></button>
            </div>
          </header>
          {actionError && <div className="p-3"><ErrorState message={actionError} /></div>}
          {inbox.error ? <div className="p-4"><ErrorState message={t("community.notificationsError")} onRetry={inbox.refetch} /></div>
            : !inbox.data ? <Spinner />
            : inbox.data.total === 0 ? <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-sm text-slate-500"><BellOff className="h-6 w-6 text-slate-300" aria-hidden />{t("shell.noNotifications")}</div>
            : <>
              <ul className="max-h-[min(65dvh,440px)] overflow-y-auto" aria-live="polite">
                {inbox.data.items.map((n) => {
                  const Icon = icons[n.kind] ?? Bell;
                  return <li key={n.id} className={cn("flex items-start border-b border-[#E9DFDC] last:border-0", !n.readAt && "bg-[#F6E7E5]/40")}>
                    <button type="button" disabled={busy} onClick={() => void mark([n.id], n.link)} className={cn("flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left hover:bg-[#FFF8F0] disabled:opacity-60", focusRing)}>
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#8a3b44]" aria-hidden />
                      <span className="min-w-0"><span className={cn("block break-words text-sm text-slate-700", !n.readAt && "font-medium")}>{dyn(t, n.key, n.vars, n.text)}</span><time dateTime={n.createdAt} className="mt-1 block text-xs text-slate-500">{ago(n.createdAt)}</time></span>
                    </button>
                    {!n.readAt && <button type="button" disabled={busy} aria-label={t("community.markRead")} title={t("community.markRead")} onClick={() => void mark([n.id])} className={cn("mr-2 mt-2 p-2 text-[#541B2B] hover:bg-white", focusRing)}><Check className="h-3.5 w-3.5" /></button>}
                  </li>;
                })}
              </ul>
              {(page > 0 || inbox.data.hasMore) && <footer className="flex items-center justify-between gap-3 border-t border-[#E9DFDC] px-4 py-3">
                <Button variant="ghost" size="sm" disabled={page === 0 || busy} onClick={() => setPage((p) => p - 1)}>{t("common.back")}</Button>
                <Button variant="ghost" size="sm" disabled={!inbox.data.hasMore || busy} onClick={() => setPage((p) => p + 1)}>{t("community.moreNotifications")}</Button>
              </footer>}
            </>}
        </section>
      )}
    </div>
  );
}