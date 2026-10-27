import { useMemo, useState } from "react";
import { PAGE_IMAGES } from "@/lib/images";
import { ArrowDownLeft, ArrowUpRight, Check, CheckCircle2, Clock3, Compass, Eye, FilterX, Handshake, Hourglass, Inbox, Package, Undo2, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { getMyExchanges, respondToRequest, withdrawRequest, type ExchangeView } from "@/lib/api";
import { useDebounced, useQuery } from "@/lib/hooks";
import { L, useI18n, useT, type Key } from "@/lib/i18n";
import { Link } from "@/lib/router";
import type { ExchangeStatus } from "@/lib/types";
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, LinkButton, PageHeader, SearchInput, Select, Tabs, errMsg, focusRing, toast, type Tone } from "@/components/ui";

const TONE: Record<ExchangeStatus, Tone> = { pending: "amber", declined: "red", withdrawn: "slate", active: "green", completed: "lime", cancelled: "slate" };

export function ExchangeStatusBadge({ status, awaiting }: { status: ExchangeStatus; awaiting?: boolean }) {
  const t = useT();
  if (awaiting) return <Badge tone="sky" icon={Hourglass}>{t("x.awaiting")}</Badge>;
  return <Badge tone={TONE[status]}>{t(L.xstatus(status))}</Badge>;
}

export function Commitments({ x, compact }: { x: ExchangeView; compact?: boolean }) {
  const t = useT();
  return (
    <div className={cn("grid gap-2", compact ? "sm:grid-cols-2" : "md:grid-cols-2")}>
      {x.commitments.map((c) => {
        const who = c.userId === x.requesterId ? x.requester : x.recipient;
        const isMe = c.userId !== x.other.userId;
        return (
          <div key={c.userId} className="bg-[#FFF8F0] px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{isMe ? t("x.youProvide") : t("x.theyProvide", { name: who.fullName.split(" ")[0] })}</p>
            <p className={cn("break-words text-sm text-slate-700", compact && "line-clamp-2")}>{c.description || <span className="text-slate-400">{t("x.nothingOneWay")}</span>}</p>
          </div>
        );
      })}
    </div>
  );
}

export function ExchangeCard({ x, actions, to }: { x: ExchangeView; actions?: React.ReactNode; to: string }) {
  const { t, ago } = useI18n();
  const incoming = x.role === "recipient";
  return (
    <Card className="border-l-2 border-l-[#E9DFDC] p-4 transition-colors hover:border-l-[#541B2B] sm:p-5">
      <div className="flex items-start gap-3">
        <Avatar name={x.other.fullName} src={x.other.avatar} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={to} className={cn("min-w-0 break-words font-semibold text-slate-900 hover:text-emerald-800", focusRing)}>{x.title}</Link>
            <ExchangeStatusBadge status={x.status} awaiting={x.awaiting} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">{incoming ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}{t(incoming ? "x.from" : "x.to", { name: x.other.fullName })}</span>
            <span>·</span><span>{t(L.cat(x.category))}</span><span>·</span>
            <time dateTime={x.updatedAt}>{t("x.updated", { time: ago(x.updatedAt) })}</time>
          </p>
        </div>
      </div>
      <div className="mt-3"><Commitments x={x} compact /></div>
      {x.message && x.status === "pending" && <p className="mt-2 line-clamp-2 break-words rounded-xl border border-slate-100 px-3 py-2 text-sm italic text-slate-600">“{x.message}”</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <LinkButton to={to} variant="secondary" size="sm" icon={Eye}>{t("common.viewDetails")}</LinkButton>
        {actions}
      </div>
    </Card>
  );
}

export function RequestActions({ x }: { x: ExchangeView }) {
  const t = useT();
  const [confirm, setConfirm] = useState<null | "decline" | "withdraw">(null);
  if (x.status !== "pending") return null;
  const run = (fn: () => void, msg: string) => {
    try {
      fn();
      toast.success(msg);
    } catch (e) {
      toast.error(errMsg(e));
    }
    setConfirm(null);
  };
  return (
    <>
      {x.role === "recipient" ? (
        <>
          <Button size="sm" icon={Check} onClick={() => run(() => respondToRequest(x.id, "accept"), t("x.acceptedToast"))}>{t("x.accept")}</Button>
          <Button size="sm" variant="ghost" icon={X} onClick={() => setConfirm("decline")}>{t("x.decline")}</Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" icon={Undo2} onClick={() => setConfirm("withdraw")}>{t("x.withdraw")}</Button>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "decline" ? t("x.declineTitle") : t("x.withdrawTitle")}
        body={confirm === "decline" ? t("x.declineBody", { name: x.other.fullName }) : t("x.withdrawBody", { name: x.other.fullName })}
        confirmLabel={confirm === "decline" ? t("x.decline") : t("x.withdraw")}
        tone="danger"
        onConfirm={() => run(() => (confirm === "decline" ? respondToRequest(x.id, "decline") : withdrawRequest(x.id)), confirm === "decline" ? t("x.declinedToast") : t("x.withdrawnToast"))}
      />
    </>
  );
}

type Tab = "requests" | "active" | "completed" | "history";
type Filter = "all" | "incoming" | "outgoing" | "awaiting" | "declined" | "withdrawn" | "cancelled";

export default function ResourceExchange() {
  const { t, tn, num } = useI18n();
  const res = useQuery(() => getMyExchanges());
  const [tab, setTab] = useState<Tab>("requests");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim().toLowerCase());
  const [sort, setSort] = useState<"updated" | "newest">("updated");

  const all = res.data ?? [];
  const inTab = (x: ExchangeView, tb: Tab) =>
    tb === "requests" ? x.status === "pending" : tb === "active" ? x.status === "active" : tb === "completed" ? x.status === "completed" : ["declined", "withdrawn", "cancelled", "completed"].includes(x.status);

  const list = useMemo(() => {
    let r = all.filter((x) => inTab(x, tab));
    if (filter === "incoming") r = r.filter((x) => x.role === "recipient");
    if (filter === "outgoing") r = r.filter((x) => x.role === "requester");
    if (filter === "awaiting") r = r.filter((x) => x.awaiting);
    if (["declined", "withdrawn", "cancelled"].includes(filter)) r = r.filter((x) => x.status === filter);
    if (dq) r = r.filter((x) => `${x.title} ${x.other.fullName} ${x.other.username}`.toLowerCase().includes(dq));
    return [...r].sort((a, b) => (sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)));
  }, [all, tab, filter, dq, sort]);

  const summary = [
    { label: t("x.sum.incoming"), value: all.filter((x) => x.status === "pending" && x.role === "recipient").length, icon: ArrowDownLeft, go: () => (setTab("requests"), setFilter("incoming")) },
    { label: t("x.sum.outgoing"), value: all.filter((x) => x.status === "pending" && x.role === "requester").length, icon: ArrowUpRight, go: () => (setTab("requests"), setFilter("outgoing")) },
    { label: t("x.sum.active"), value: all.filter((x) => x.status === "active").length, icon: Handshake, go: () => (setTab("active"), setFilter("all")) },
    { label: t("x.awaiting"), value: all.filter((x) => x.awaiting).length, icon: Clock3, go: () => (setTab("active"), setFilter("awaiting")) },
    { label: t("x.sum.completed"), value: all.filter((x) => x.status === "completed").length, icon: CheckCircle2, go: () => (setTab("completed"), setFilter("all")) },
  ];
  const filtersFor: Record<Tab, Filter[]> = {
    requests: ["all", "incoming", "outgoing"],
    active: ["all", "incoming", "outgoing", "awaiting"],
    completed: ["all", "incoming", "outgoing"],
    history: ["all", "incoming", "outgoing", "declined", "withdrawn", "cancelled"],
  };
  const filtersActive = filter !== "all" || dq;
  const clear = () => (setFilter("all"), setQ(""));

  return (
    <div>
      <PageHeader title={t("nav.exchange")} subtitle={t("x.subtitle")} image={PAGE_IMAGES.exchange} />
      {res.error ? (
        <ErrorState message={res.error} />
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 border-y border-[#E9DFDC] md:grid-cols-5">
            {summary.map((s) => (
              <button key={s.label} onClick={s.go} className={cn("border-b border-r border-[#E9DFDC] px-4 py-5 text-left transition-colors last:border-r-0 hover:bg-white md:border-b-0", focusRing)}>
                <s.icon className="h-3.5 w-3.5 text-[#8a3b44]" aria-hidden strokeWidth={1.75} />
                <p className="display mt-2 text-[30px] font-semibold tabular-nums text-[#541B2B]">{num(s.value)}</p>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">{s.label}</p>
              </button>
            ))}
          </div>

          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs
              label={t("x.sections")}
              value={tab}
              onChange={(tb) => (setTab(tb), setFilter("all"))}
              tabs={(["requests", "active", "completed", "history"] as Tab[]).map((v) => ({ value: v, label: t(`x.tab.${v}` as Key), count: all.filter((x) => inTab(x, v)).length }))}
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <SearchInput value={q} onChange={setQ} label={t("x.searchLabel")} placeholder={t("x.searchPh")} className="sm:w-60" />
              <Select aria-label={t("common.filter")} value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="sm:w-48">
                {filtersFor[tab].map((f) => <option key={f} value={f}>{t(`x.f.${f}` as Key)}</option>)}
              </Select>
              <Select aria-label={t("common.sort")} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="sm:w-44">
                <option value="updated">{t("common.recentlyUpdated")}</option>
                <option value="newest">{t("common.newest")}</option>
              </Select>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-slate-500" aria-live="polite">
            {tn("count.results", list.length)}
            {filtersActive && (
              <button onClick={clear} className={cn("inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline", focusRing)}>
                <FilterX className="h-3.5 w-3.5" /> {t("common.clearFilters")}
              </button>
            )}
          </div>

          {list.length === 0 ? (
            filtersActive ? (
              <EmptyState icon={FilterX} title={t("x.noMatchTitle")} body={t("x.noMatchBody")}>
                <Button variant="secondary" onClick={clear}>{t("common.clearFilters")}</Button>
              </EmptyState>
            ) : (
              <EmptyState icon={tab === "requests" ? Inbox : Package} title={t(`x.empty.${tab}.title` as Key)} body={t(`x.empty.${tab}.body` as Key)}>
                <LinkButton to="/explore" variant="secondary" icon={Compass}>{t("nav.explore")}</LinkButton>
                <LinkButton to="/matches" icon={Handshake}>{t("x.viewMatches")}</LinkButton>
              </EmptyState>
            )
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {list.map((x) => <ExchangeCard key={x.id} x={x} to={`/exchange/${x.id}`} actions={<RequestActions x={x} />} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
