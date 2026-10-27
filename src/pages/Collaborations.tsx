import { useMemo, useState } from "react";
import { PAGE_IMAGES } from "@/lib/images";
import { Ban, CheckCircle2, Compass, FilterX, Handshake, Hourglass, Star, Users } from "lucide-react";
import { cn } from "@/utils/cn";
import { getMyExchanges, type ExchangeView } from "@/lib/api";
import { read } from "@/lib/db";
import { useDebounced, useQuery } from "@/lib/hooks";
import { L, useI18n, type Key } from "@/lib/i18n";
import { Button, EmptyState, ErrorState, LinkButton, PageHeader, SearchInput, Select, Tabs, focusRing } from "@/components/ui";
import { MessageButton } from "@/components/listing";
import { ExchangeCard } from "./Exchange";

type Tab = "active" | "awaiting" | "completed" | "cancelled";
const TABS: Tab[] = ["active", "awaiting", "completed", "cancelled"];

export default function Collaborations() {
  const { t, tn, num, date } = useI18n();
  const res = useQuery(() => {
    const db = read();
    return getMyExchanges()
      .filter((x) => ["active", "completed", "cancelled"].includes(x.status))
      .map((x) => {
        const ms = db.milestones.filter((m) => m.exchangeId === x.id);
        const reviewed = db.reviews.some((r) => r.exchangeId === x.id && r.reviewerId !== x.other.userId);
        return { x, msTotal: ms.length, msDone: ms.filter((m) => m.status === "completed").length, reviewed };
      });
  });
  const [tab, setTab] = useState<Tab>("active");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim().toLowerCase());
  const [cat, setCat] = useState("");
  const [range, setRange] = useState("all");

  const all = useMemo(() => res.data ?? [], [res.data]);
  const inTab = (x: ExchangeView, tb: Tab) => (tb === "active" ? x.status === "active" && !x.awaiting : tb === "awaiting" ? x.awaiting : x.status === tb);
  const cats = [...new Set(all.map((r) => r.x.category))].sort();
  const list = useMemo(() => {
    let r = all.filter((i) => inTab(i.x, tab));
    if (cat) r = r.filter((i) => i.x.category === cat);
    if (range !== "all") r = r.filter((i) => Date.now() - Date.parse(i.x.updatedAt) < Number(range) * 86400_000);
    if (dq) r = r.filter((i) => `${i.x.title} ${i.x.other.fullName} ${i.x.other.username}`.toLowerCase().includes(dq));
    return r;
  }, [all, tab, cat, range, dq]);
  const filtersOn = !!cat || range !== "all" || !!dq;
  const clear = () => (setCat(""), setRange("all"), setQ(""));
  const c = (tb: Tab) => all.filter((i) => inTab(i.x, tb)).length;

  return (
    <div>
      <PageHeader title={t("co.title")} subtitle={t("co.subtitle")} image={PAGE_IMAGES.collaborations} />
      {res.error ? (
        <ErrorState message={res.error} />
      ) : (
        <>
          <div className="mb-8 grid grid-cols-3 border-y border-[#E9DFDC]">
            {[
              { tb: "active" as Tab, icon: Handshake },
              { tb: "awaiting" as Tab, icon: Hourglass },
              { tb: "completed" as Tab, icon: CheckCircle2 },
            ].map((s) => (
              <button key={s.tb} onClick={() => setTab(s.tb)} className={cn("border-r border-[#E9DFDC] px-4 py-5 text-left transition-colors last:border-r-0 hover:bg-white", tab === s.tb && "bg-white", focusRing)}>
                <s.icon className="h-3.5 w-3.5 text-[#8a3b44]" strokeWidth={1.75} />
                <p className="display mt-2 text-[30px] font-semibold tabular-nums text-[#541B2B]">{num(c(s.tb))}</p>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">{t(`co.tab.${s.tb}` as Key)}</p>
              </button>
            ))}
          </div>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs label={t("co.statusLabel")} value={tab} onChange={setTab} tabs={TABS.map((v) => ({ value: v, label: t(`co.tab.${v}` as Key), count: c(v) }))} />
            <div className="flex flex-col gap-2 sm:flex-row">
              <SearchInput value={q} onChange={setQ} label={t("co.searchLabel")} placeholder={t("co.searchPh")} className="sm:w-56" />
              <Select aria-label={t("listing.field.category")} value={cat} onChange={(e) => setCat(e.target.value)} className="sm:w-40" disabled={!cats.length}>
                <option value="">{t("common.allCategories")}</option>
                {cats.map((k) => <option key={k} value={k}>{t(L.cat(k))}</option>)}
              </Select>
              <Select aria-label={t("co.lastActivity")} value={range} onChange={(e) => setRange(e.target.value)} className="sm:w-40">
                <option value="all">{t("common.anyTime")}</option>
                <option value="7">{t("common.last7")}</option>
                <option value="30">{t("common.last30")}</option>
                <option value="90">{t("common.last90")}</option>
              </Select>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-slate-500" aria-live="polite">
            {tn("count.collaborations", list.length)}
            {filtersOn && <button onClick={clear} className={cn("inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline", focusRing)}><FilterX className="h-3.5 w-3.5" />{t("common.clearFilters")}</button>}
          </div>
          {list.length === 0 ? (
            filtersOn ? (
              <EmptyState icon={FilterX} title={t("co.noMatchTitle")} body={t("co.noMatchBody")}><Button variant="secondary" onClick={clear}>{t("common.clearFilters")}</Button></EmptyState>
            ) : (
              <EmptyState icon={tab === "cancelled" ? Ban : tab === "awaiting" ? Hourglass : Users} title={t(`co.empty.${tab}.title` as Key)} body={t(`co.empty.${tab}.body` as Key)}>
                {tab === "active" && <><LinkButton to="/exchange" variant="secondary">{t("co.viewRequests")}</LinkButton><LinkButton to="/explore" icon={Compass}>{t("nav.explore")}</LinkButton></>}
              </EmptyState>
            )
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {list.map(({ x, msDone, msTotal, reviewed }) => (
                <div key={x.id}>
                  <ExchangeCard
                    x={x}
                    to={`/collaborations/${x.id}`}
                    actions={
                      <>
                        <MessageButton userId={x.other.userId} contextType="exchange" contextId={x.id} size="sm" variant="ghost" label={t("cd.openMessages")} />
                        {x.awaitingMe && <LinkButton to={`/collaborations/${x.id}`} size="sm" icon={CheckCircle2}>{t("co.confirm")}</LinkButton>}
                        {x.status === "active" && !x.awaitingMe && <LinkButton to={`/collaborations/${x.id}`} size="sm" variant="soft">{t("co.update")}</LinkButton>}
                        {x.status === "completed" && !reviewed && <LinkButton to={`/collaborations/${x.id}`} size="sm" variant="soft" icon={Star}>{t("co.review")}</LinkButton>}
                        {x.targetDate && <span className="ml-auto text-[11px] text-slate-400">{t("co.deadline", { date: date(x.targetDate) })}</span>}
                      </>
                    }
                  />
                  {msTotal > 0 && (
                    <div className="border border-t-0 border-[#E9DFDC] bg-white px-5 pb-3 pt-3">
                      <div className="flex justify-between text-[11px] text-slate-500"><span>{t("ms.title")}</span><span>{num(msDone)}/{num(msTotal)}</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={t("ms.progressLabel")} aria-valuenow={msDone} aria-valuemin={0} aria-valuemax={msTotal}><div className="h-full rounded-full bg-emerald-500" style={{ width: `${(msDone / msTotal) * 100}%` }} /></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
