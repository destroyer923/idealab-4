import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDown, ArrowLeft, Check, CheckCheck, Compass, Flag, Link2, Loader2, MessageCircle, MoreVertical, PenSquare, QrCode, RefreshCw, ScanLine, Send, ShieldBan, UserSearch, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { getConversations, getMessages, markConversationRead, openConversation, report, searchMembers, sendMessage, setBlocked } from "@/lib/api";
import { uid } from "@/lib/db";
import { LIMITS } from "@/lib/constants";
import { useDebounced, useQuery } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { Link, navigate } from "@/lib/router";
import { Avatar, Button, ConfirmDialog, EmptyState, ErrorState, LinkButton, Modal, SearchInput, Textarea, errMsg, focusRing, toast } from "@/components/ui";

function Chat({ id, me, onBack }: { id: string; me: string; onBack: () => void }) {
  const { t, time, day } = useI18n();
  const [limit, setLimit] = useState(50);
  const msgs = useQuery(() => getMessages(id, limit), [id, limit]);
  const convs = useQuery(() => getConversations());
  const info = convs.data?.find((c) => c.conversation.id === id);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<{ text: string; clientId: string; error: unknown } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const sendLock = useRef(false);
  const readLock = useRef(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const olderAnchor = useRef<{ height: number; top: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  const count = msgs.data?.messages.length ?? 0;

  const unread = info?.unread ?? 0;
  const latestId = msgs.data?.messages[msgs.data.messages.length - 1]?.id;

  const markViewed = async () => {
    const el = listRef.current;
    if (!el || !latestId || !unread || readLock.current || document.visibilityState !== "visible" || !document.hasFocus() || el.scrollHeight - el.scrollTop - el.clientHeight > 64) return;
    readLock.current = true;
    try {
      await markConversationRead(id, latestId);
      setReadError(null);
    } catch (e) { setReadError(errMsg(e)); }
    finally { readLock.current = false; }
  };

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (olderAnchor.current) {
      el.scrollTop = olderAnchor.current.top + el.scrollHeight - olderAnchor.current.height;
      olderAnchor.current = null;
    } else if (lastCount.current === 0 || atBottom) {
      el.scrollTop = el.scrollHeight;
    }
    lastCount.current = count;
  }, [latestId, count]);

  useEffect(() => {
    const mark = () => { void markViewed(); };
    mark();
    document.addEventListener("visibilitychange", mark);
    window.addEventListener("focus", mark);
    return () => { document.removeEventListener("visibilitychange", mark); window.removeEventListener("focus", mark); };
  }, [id, latestId, unread, atBottom]);

  useEffect(() => {
    if (!menu) return;
    const dismiss = (e: MouseEvent) => { if (!optionsRef.current?.contains(e.target as Node)) setMenu(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); optionsButton.current?.focus(); } };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", dismiss); document.removeEventListener("keydown", key); };
  }, [menu]);

  const doSend = async (body: string, clientId: string) => {
    if (sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    try {
      await sendMessage(id, body, clientId);
      setFailed(null);
      setText((current) => current.trim() === body.trim() ? "" : current);
      setAtBottom(true);
      requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });
    } catch (e) {
      setFailed({ text: body, clientId, error: e });
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  };
  const submit = () => {
    if (sendLock.current || !text.trim()) return;
    void doSend(text, failed?.text.trim() === text.trim() ? failed.clientId : uid());
  };

  if (msgs.error || convs.error) return <div className="p-6"><ErrorState message={msgs.error ?? convs.error!} onRetry={() => { msgs.refetch(); convs.refetch(); }} /><LinkButton to="/messages" variant="link">{t("msg.backInbox")}</LinkButton></div>;
  if (!info) return <div className="flex flex-1 items-center justify-center" role="status" aria-label={t("common.loading")}><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>;
  const { other, context, blocked, blockedByMe } = info;

  let lastDay = "";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <button onClick={onBack} aria-label={t("msg.back")} className={cn("grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 md:hidden", focusRing)}><ArrowLeft className="h-5 w-5" /></button>
        <Avatar name={other.fullName} src={other.avatar} size={38} />
        <div className="min-w-0 flex-1">
          {other.username ? <Link to={`/u/${other.username}`} className={cn("block truncate font-semibold text-slate-900 hover:text-emerald-700", focusRing)}>{other.fullName}</Link> : <p className="truncate font-semibold text-slate-500">{other.fullName}</p>}
          <p className="truncate text-xs text-slate-500">{other.occupation || (other.username ? `@${other.username}` : "")}</p>
        </div>
        <div ref={optionsRef} className="relative">
          <button ref={optionsButton} onClick={() => setMenu((m) => !m)} aria-label={t("msg.options")} aria-expanded={menu} aria-haspopup="menu" className={cn("grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100", focusRing)}><MoreVertical className="h-4 w-4" /></button>
          {menu && (
            <div role="menu" className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
              <button role="menuitem" onClick={() => (setMenu(false), setBlockOpen(true))} className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50", focusRing)}><ShieldBan className="h-4 w-4 shrink-0" />{blockedByMe ? t("msg.unblock") : t("msg.block")}</button>
              <button role="menuitem" onClick={() => (setMenu(false), setReportOpen(true))} className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50", focusRing)}><Flag className="h-4 w-4 shrink-0" />{t("msg.report")}</button>
            </div>
          )}
        </div>
      </div>
      {context && (
        <div className="flex items-center gap-2 border-b border-[#E9DFDC] bg-[#F6E7E5]/60 px-4 py-2 text-xs text-[#541B2B]">
          <Link2 className="h-3.5 w-3.5 shrink-0" />
          {context.link ? (
            <Link to={context.link} className="truncate font-medium hover:underline">{t(context.key, context.vars)}</Link>
          ) : (
            <span className="truncate">{t(context.key, context.vars)}{context.unavailable && context.vars ? ` ${t("ctx.unavailableSuffix")}` : ""}</span>
          )}
        </div>
      )}
      <div ref={listRef} onScroll={(e) => { const el = e.currentTarget; setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 64); }} className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-[#FFF8F0]/60 px-4 py-4" aria-live="polite" aria-label={t("msg.history")}>
        {msgs.data?.hasMore && (
          <div className="mb-3 flex justify-center"><Button size="sm" variant="secondary" onClick={() => { const el = listRef.current; if (el) olderAnchor.current = { height: el.scrollHeight, top: el.scrollTop }; setLimit((l) => l + 50); }}>{t("msg.loadOlder")}</Button></div>
        )}
        {count === 0 && <p className="py-10 text-center text-sm text-slate-500">{t("msg.sayHello", { name: other.fullName.split(" ")[0] })}</p>}
        {msgs.data?.messages.map((m) => {
          const mine = m.senderId === me;
          const d = new Date(m.createdAt).toDateString();
          const showDay = d !== lastDay;
          lastDay = d;
          return (
            <div key={m.id}>
              {showDay && <p className="my-3 text-center text-[11px] font-medium text-slate-400">{day(m.createdAt)}</p>}
              <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[82%] px-3.5 py-2 text-sm sm:max-w-[70%]", mine ? "bg-[#541B2B] text-white" : "border border-[#E9DFDC] bg-white text-slate-800")}>
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</p>
                  <p className={cn("mt-0.5 flex items-center justify-end gap-1 text-[10px]", mine ? "text-emerald-100" : "text-slate-400")}>
                    <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
                    {mine && (m.readAt ? <CheckCheck className="h-3 w-3" aria-label={t("msg.read")} /> : <Check className="h-3 w-3" aria-label={t("msg.sent")} />)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!atBottom && unread > 0 && <div className="flex justify-center border-t border-[#E9DFDC] py-2"><Button size="sm" variant="soft" icon={ArrowDown} onClick={() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; setAtBottom(true); }}>{t("community.newMessages")}</Button></div>}
      {readError && <div className="px-3"><ErrorState message={readError} onRetry={() => void markViewed()} /></div>}
      <div className="border-t border-slate-100 p-3">
        {blocked ? (
          <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-center text-sm text-slate-500">{blockedByMe ? t("msg.blockedByMe") : t("msg.blocked")}</p>
        ) : (
          <>
            {failed && (
              <div role="alert" className="mb-2 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> <span className="flex-1">{t("msg.notSent", { error: errMsg(failed.error) })}</span>
                <button disabled={sending} onClick={() => void doSend(failed.text, failed.clientId)} className={cn("font-semibold underline", focusRing)}>{t("common.retry")}</button>
              </div>
            )}
            <form className="flex items-end gap-2" onSubmit={(e) => (e.preventDefault(), submit())}>
              <Textarea
                aria-label={t("msg.inputLabel", { name: other.fullName })}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                maxLength={LIMITS.message}
                rows={1}
                placeholder={t("msg.inputPh")}
                className="max-h-36 min-h-[44px] resize-none"
              />
              <Button type="submit" aria-label={sending ? t("community.messageSending") : t("msg.send")} disabled={!text.trim()} loading={sending} className="h-11 w-11 shrink-0 px-0">{!sending && <Send className="h-4 w-4" />}</Button>
            </form>
          </>
        )}
      </div>

      <ConfirmDialog
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        title={blockedByMe ? t("msg.unblockTitle", { name: other.fullName }) : t("msg.blockTitle", { name: other.fullName })}
        body={blockedByMe ? t("msg.unblockBody") : t("msg.blockBody")}
        confirmLabel={blockedByMe ? t("msg.unblockConfirm") : t("msg.blockConfirm")}
        tone={blockedByMe ? "primary" : "danger"}
        onConfirm={() => {
          try {
            setBlocked(other.userId, !blockedByMe);
            toast.success(blockedByMe ? t("msg.unblockedToast") : t("msg.blockedToast"));
          } catch (e) {
            toast.error(errMsg(e));
          }
          setBlockOpen(false);
        }}
      />
      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title={t("msg.reportTitle", { name: other.fullName })} size="sm">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); try { report("user", other.userId, reason); toast.success(t("msg.reportedToast")); setReportOpen(false); setReason(""); } catch (er) { toast.error(errMsg(er)); } }}>
          <Textarea aria-label={t("msg.reportPh")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("msg.reportPh")} />
          <p className="text-xs text-slate-400">{t("msg.reportNote")}</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setReportOpen(false)}>{t("common.cancel")}</Button><Button type="submit" variant="danger">{t("msg.reportSubmit")}</Button></div>
        </form>
      </Modal>
    </div>
  );
}

function MemberSearch({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 200);
  const pending = q !== dq;
  const res = useQuery(() => searchMembers(dq), [dq]);
  const [opening, setOpening] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const start = async (userId: string) => {
    if (opening) return;
    setOpening(userId);
    try {
      const id = await openConversation(userId); // reuses the existing conversation if there is one
      onClose();
      navigate(`/messages/${id}`);
    } catch (e) {
      toast.error(errMsg(e));
      setOpening(null);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-slate-100 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a3b44]"><UserSearch className="h-3.5 w-3.5" aria-hidden /> {t("msg.findMember")}</h2>
          <button onClick={onClose} aria-label={t("msg.closeSearch")} className={cn("grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100", focusRing)}><X className="h-4 w-4" /></button>
        </div>
        <div className="relative">
          <UserSearch className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a3b44]" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            aria-label={t("msg.findMemberLabel")}
            placeholder={t("msg.findMemberPh")}
            autoComplete="off"
            className="h-10 w-full border-b border-[#E9DFDC] bg-transparent pl-7 pr-3 text-sm placeholder:text-slate-400 focus:border-[#541B2B] focus:outline-none"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {pending ? (
          <p role="status" className="flex items-center justify-center gap-2 p-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{t("msg.searching")}</p>
        ) : !dq.trim() ? (
          <p className="p-6 text-center text-sm text-slate-500">{t("msg.searchHint")}</p>
        ) : res.error ? (
          <div className="p-4"><ErrorState message={`${t("msg.searchFailed")} ${res.error}`} onRetry={res.refetch} /></div>
        ) : !res.data?.length ? (
          <div className="p-6 text-center"><p className="text-sm font-semibold text-slate-800">{t("msg.noUsers")}</p><p className="mt-1 text-sm text-slate-500">{t("msg.noUsersBody")}</p></div>
        ) : (
          <ul>
            {res.data.map((m) => (
              <li key={m.userId}>
                <button onClick={() => start(m.userId)} disabled={!!opening} className={cn("flex w-full items-center gap-3 border-b border-[#E9DFDC] px-4 py-3 text-left transition-colors hover:bg-[#FFF8F0] disabled:opacity-60", focusRing)}>
                  <Avatar name={m.fullName} src={m.avatar} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">{m.fullName}</span>
                    <span className="block truncate text-xs text-slate-500">@{m.username}{m.occupation ? ` · ${m.occupation}` : ""}</span>
                  </span>
                  <span className="shrink-0 bg-[#F6E7E5] px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#541B2B]">
                    {opening === m.userId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : m.conversationId ? t("msg.openChat") : t("msg.startChat")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function Messages({ id, me }: { id?: string; me: string }) {
  const { t, ago, num } = useI18n();
  const convs = useQuery(() => getConversations());
  const [q, setQ] = useState("");
  const [finding, setFinding] = useState(false);
  const list = useMemo(() => {
    const terms = q.normalize("NFKC").trim().toLocaleLowerCase().replace(/^@/, "").split(/\s+/).filter(Boolean);
    return (convs.data ?? []).filter((c) => terms.every((term) => `${c.other.fullName} ${c.other.username}`.normalize("NFKC").toLocaleLowerCase().includes(term)));
  }, [convs.data, q]);
  const valid = id && convs.data?.some((c) => c.conversation.id === id);

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[480px] overflow-hidden border border-[#E9DFDC] bg-white">
      <aside className={cn("w-full min-w-0 shrink-0 flex-col border-r border-slate-100 md:flex md:w-72 xl:w-80", id ? "hidden" : "flex")} aria-label={t("msg.conversations")}>
        {finding ? (
          <MemberSearch onClose={() => setFinding(false)} />
        ) : (
        <>
        <div className="border-b border-slate-100 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h1 className="display min-w-0 text-[24px] font-semibold text-[#541B2B]">{t("nav.messages")}</h1>
            <div className="flex shrink-0 items-center gap-1">
              <LinkButton to="/qr-code" size="sm" variant="ghost" icon={QrCode} aria-label={t("nav.qrCode")} className="!px-2">
                <span className="sr-only">{t("nav.qrCode")}</span>
              </LinkButton>
              <LinkButton to="/scan-qr" size="sm" variant="ghost" icon={ScanLine} aria-label={t("nav.scanQr")} className="!px-2">
                <span className="sr-only">{t("nav.scanQr")}</span>
              </LinkButton>
              <Button size="sm" icon={PenSquare} aria-label={t("msg.newMessage")} className="shrink-0 !px-2" onClick={() => setFinding(true)}><span className="hidden xl:inline">{t("msg.newMessage")}</span></Button>
            </div>
          </div>
          <SearchInput value={q} onChange={setQ} label={t("msg.searchLabel")} placeholder={t("msg.searchPh")} />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {convs.error && <li className="p-4"><ErrorState message={convs.error} onRetry={convs.refetch} /></li>}
          {convs.data && list.length === 0 && (
            <li className="p-6 text-center text-sm text-slate-500">
              {q ? t("msg.noMatch") : <>{t("msg.empty")}<div className="mt-3 flex flex-wrap justify-center gap-2"><Button size="sm" icon={UserSearch} onClick={() => setFinding(true)}>{t("msg.findMember")}</Button><LinkButton to="/explore" size="sm" variant="secondary" icon={Compass}>{t("nav.explore")}</LinkButton></div></>}
            </li>
          )}
          {list.map((c) => (
            <li key={c.conversation.id}>
              <Link to={`/messages/${c.conversation.id}`} aria-current={c.conversation.id === id ? "true" : undefined} className={cn("flex gap-3 border-b border-[#E9DFDC] px-4 py-3 transition-colors", focusRing, c.conversation.id === id ? "bg-[#FFF8F0] shadow-[inset_2px_0_0_#541B2B]" : "hover:bg-[#FFF8F0]")}>
                <Avatar name={c.other.fullName} src={c.other.avatar} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("truncate text-sm", c.unread ? "font-semibold text-slate-900" : "font-medium text-slate-800")}>{c.other.fullName}</p>
                    <span className="shrink-0 text-[11px] text-slate-400">{c.last ? ago(c.last.createdAt) : t("msg.new")}</span>
                  </div>
                  {c.context && <p className="truncate text-[11px] text-emerald-700">{t(c.context.key, c.context.vars)}</p>}
                  <div className="flex items-center gap-2">
                    <p className={cn("min-w-0 flex-1 truncate text-xs", c.unread ? "font-medium text-slate-700" : "text-slate-500")}>{c.last ? (c.last.senderId === me ? t("msg.youPrefix", { text: c.last.body }) : c.last.body) : t("msg.noMessages")}</p>
                    {c.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#541B2B] px-1.5 text-[10px] font-semibold text-white" aria-label={t("shell.unreadCount", { n: c.unread })}>{num(c.unread)}</span>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <footer className="flex items-start gap-2 border-t border-[#E9DFDC] p-3 text-[11px] leading-relaxed text-slate-500"><span className="min-w-0 flex-1">{t("community.updateHint")}</span><button type="button" aria-label={t("community.refresh")} onClick={convs.refetch} className={cn("p-1 text-[#541B2B]", focusRing)}><RefreshCw className="h-3.5 w-3.5" /></button></footer>
        </>
        )}
      </aside>
      <section className={cn("min-w-0 flex-1 flex-col", id ? "flex" : "hidden md:flex")}>
        {id && valid ? (
          <Chat key={`${me}:${id}`} id={id} me={me} onBack={() => navigate("/messages")} />
        ) : id && convs.data ? (
          <div className="flex flex-1 items-center justify-center p-6"><EmptyState icon={MessageCircle} title={t("msg.notFoundTitle")} body={t("msg.notFoundBody")}><LinkButton to="/messages" variant="secondary">{t("msg.backInbox")}</LinkButton></EmptyState></div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6"><EmptyState icon={MessageCircle} title={t("msg.selectTitle")} body={t("msg.selectBody")} className="border-none bg-transparent" /></div>
        )}
      </section>
    </div>
  );
}
