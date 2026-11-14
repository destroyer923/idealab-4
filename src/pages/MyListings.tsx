import { useMemo, useState } from "react";
import { PAGE_IMAGES } from "@/lib/images";
import { ClipboardList, Eye, FilterX, HandHeart, Inbox, Pencil, PlusCircle, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/utils/cn";
import { allowedTransitions, deleteListing, getMyListings, resubmitListing, responseCount, setListingStatus } from "@/lib/api";
import { read } from "@/lib/db";
import { CATEGORIES, NEED_STATUSES, OFFER_STATUSES } from "@/lib/constants";
import { useDebounced, useQuery } from "@/lib/hooks";
import { L, useI18n, type Key } from "@/lib/i18n";
import type { Listing, ListingKind } from "@/lib/types";
import { Button, ConfirmDialog, EmptyState, ErrorState, LinkButton, PageHeader, SearchInput, Select, Tabs, errMsg, focusRing, toast } from "@/components/ui";
import { ListingCard, StatusBadge } from "@/components/listing";

const ACTION: Record<string, Key> = {
  "offer:active": "ml.publish",
  "offer:pending_review": "ml.reviewing",
  "offer:rejected": "ml.resubmit",
  "offer:inactive": "ml.deactivate",
  "need:pending_review": "ml.reviewing",
  "need:rejected": "ml.resubmit",
  "need:open": "ml.reopen",
  "need:matched": "ml.markMatched",
  "need:in_progress": "ml.markInProgress",
  "need:paused": "ml.pause",
  "need:fulfilled": "ml.markFulfilled",
};
const CONFIRMABLE = new Set(["offer:inactive", "need:paused", "need:fulfilled", "offer:pending_review", "need:pending_review"]);

function StatusActions({ l, onDelete, onChanged }: { l: Listing; onDelete: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const [pending, setPending] = useState<string | null>(null);
  const change = async (to: string) => {
    if (to === "rejected") return;
    try {
      await setListingStatus(l.id, to);
      toast.success(t("ml.statusUpdated", { status: t(L.status(l.kind, to)) }));
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    }
    setPending(null);
  };
  const base = l.kind === "offer" ? "/offers" : "/needs";
  const ck = pending ? `${l.kind}:${pending}` : "";
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
      <LinkButton to={`/listing/${l.id}`} variant="ghost" size="sm" icon={Eye}>{t("common.view")}</LinkButton>
      <LinkButton to={`${base}/${l.id}/edit`} variant="ghost" size="sm" icon={Pencil}>{t("common.edit")}</LinkButton>
      {allowedTransitions(l).map((to) => {
        const label = l.kind === "offer" && to === "active" && l.status === "inactive" ? t("ml.reactivate") : l.kind === "need" && to === "open" && l.status === "draft" ? t("ml.publish") : t(ACTION[`${l.kind}:${to}`]);
        return (
          <Button key={to} size="sm" variant={to === "active" || to === "open" ? "soft" : "ghost"} onClick={() => (CONFIRMABLE.has(`${l.kind}:${to}`) ? setPending(to) : change(to))}>
            {label}
          </Button>
        );
      })}
      <Button size="sm" variant="ghost" icon={Trash2} className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={onDelete} aria-label={t("ml.deleteAria", { title: l.title })}>{t("common.delete")}</Button>
      {l.status === "rejected" && (
        <Button size="sm" variant="soft" icon={RefreshCw} onClick={async () => { try { await resubmitListing(l.id); onChanged(); } catch (e) { toast.error(errMsg(e)); } }}>{t("ml.resubmit")}</Button>
      )}
      {pending && (
        <ConfirmDialog open onClose={() => setPending(null)} onConfirm={() => change(pending)} title={t(`ml.c.${ck}.title` as Key)} body={t(`ml.c.${ck}.body` as Key)} confirmLabel={t(`ml.c.${ck}.label` as Key)} />
      )}
    </div>
  );
}

export default function MyListings({ kind }: { kind: ListingKind }) {
  const { t, tn, num, date } = useI18n();
  const isOffer = kind === "offer";
  const k = (offer: Key, need: Key) => t(isOffer ? offer : need);
  const res = useQuery(async () => {
    const ls = await getMyListings(kind);
    const db = read();
    return ls.map((l) => ({ l, responses: responseCount(db, l.id) }));
  }, [kind]);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim().toLowerCase());
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState<"updated" | "newest">("updated");
  const [del, setDel] = useState<Listing | null>(null);

  const all = res.data ?? [];
  const statuses: string[] = isOffer ? [...OFFER_STATUSES.filter((s) => s !== "draft"), "draft"] : [...NEED_STATUSES.filter((s) => s !== "draft"), "draft"];
  const label = (s: string) => {
    if (s === "draft") return t("ml.tab.draft");
    if (s === "pending_review") return t("ml.tab.pending_review");
    if (s === "rejected") return t("ml.tab.rejected");
    return isOffer ? t(`ml.tab.${s}` as Key) : t(L.status("need", s));
  };
  const count = (s: string) => all.filter((x) => x.l.status === s).length;

  const list = useMemo(() => {
    let r = all;
    if (tab !== "all") r = r.filter((x) => x.l.status === tab);
    if (cat) r = r.filter((x) => x.l.category === cat);
    if (dq) r = r.filter((x) => `${x.l.title} ${x.l.description} ${x.l.details}`.toLowerCase().includes(dq));
    return [...r].sort((a, b) => (sort === "newest" ? b.l.createdAt.localeCompare(a.l.createdAt) : b.l.updatedAt.localeCompare(a.l.updatedAt)));
  }, [all, tab, cat, dq, sort]);
  const filtersOn = tab !== "all" || !!cat || !!dq;
  const clear = () => (setTab("all"), setCat(""), setQ(""));

  return (
    <div>
      <PageHeader title={k("nav.offers", "nav.needs")} subtitle={k("ml.offersSubtitle", "ml.needsSubtitle")} image={isOffer ? PAGE_IMAGES.offers : PAGE_IMAGES.needs}>
        <LinkButton to={isOffer ? "/offers/new" : "/needs/new"} icon={PlusCircle}>{k("lf.createOffer", "action.postNeed")}</LinkButton>
      </PageHeader>

      {res.error ? (
        <ErrorState message={res.error} />
      ) : all.length === 0 ? (
        <EmptyState icon={isOffer ? HandHeart : ClipboardList} title={k("ml.noOffersTitle", "ml.noNeedsTitle")} body={k("ml.noOffersBody", "ml.noNeedsBody")}>
          <LinkButton to={isOffer ? "/offers/new" : "/needs/new"} icon={PlusCircle}>{k("ml.firstOffer", "ml.firstNeed")}</LinkButton>
        </EmptyState>
      ) : (
        <>
          <div className={cn("mb-8 grid border-y border-[#E9DFDC]", isOffer ? "grid-cols-3" : "grid-cols-3 md:grid-cols-6")}>
            {statuses.map((s) => (
              <button key={s} onClick={() => setTab(s)} className={cn("border-r border-[#E9DFDC] px-3 py-4 text-left transition-colors last:border-r-0 hover:bg-white", tab === s && "bg-white", focusRing)}>
                <p className="display text-[26px] font-semibold tabular-nums text-[#541B2B]">{num(count(s))}</p>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label(s)}</p>
              </button>
            ))}
          </div>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs label={t("ml.statusFilter")} value={tab} onChange={setTab} tabs={[{ value: "all", label: t("common.all"), count: all.length }, ...statuses.map((s) => ({ value: s, label: label(s), count: count(s) }))]} />
            <div className="flex flex-col gap-2 sm:flex-row">
              <SearchInput value={q} onChange={setQ} label={k("ml.searchOffers", "ml.searchNeeds")} placeholder={k("ml.searchPhOffer", "ml.searchPhNeed")} className="sm:w-56" />
              <Select aria-label={t("listing.field.category")} value={cat} onChange={(e) => setCat(e.target.value)} className="sm:w-44">
                <option value="">{t("common.allCategories")}</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{t(L.cat(c))}</option>)}
              </Select>
              <Select aria-label={t("common.sort")} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="sm:w-44">
                <option value="updated">{t("common.recentlyUpdated")}</option>
                <option value="newest">{t("common.newest")}</option>
              </Select>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-slate-500" aria-live="polite">
            {tn("count.listings", list.length)}
            {filtersOn && <button onClick={clear} className={cn("inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline", focusRing)}><FilterX className="h-3.5 w-3.5" />{t("common.clearFilters")}</button>}
          </div>
          {list.length === 0 ? (
            <EmptyState icon={FilterX} title={t("ml.noMatchTitle")} body={t("ml.noMatchBody")}><Button variant="secondary" onClick={clear}>{t("common.clearFilters")}</Button></EmptyState>
          ) : (
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map(({ l, responses }) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  showOwner={false}
                  footer={
                    <>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <StatusBadge listing={l} />
                        <span>{t("ml.updated", { date: date(l.updatedAt) })}</span>
                        {responses > 0 && <span className="inline-flex items-center gap-1"><Inbox className="h-3 w-3" />{tn("count.proposals", responses)}</span>}
                      </div>
                      {!isOffer && l.exchangePref && <p className="mt-2 line-clamp-1 break-words text-xs text-slate-500"><b>{t("lf.canOffer")}</b> {l.exchangePref}</p>}
                      <StatusActions l={l} onDelete={() => setDel(l)} onChanged={res.refetch} />
                    </>
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
      {del && (
        <ConfirmDialog
          open
          onClose={() => setDel(null)}
          tone="danger"
          title={t("ml.deleteTitle", { title: del.title })}
          body={t("ml.deleteBody")}
          confirmLabel={t("common.delete")}
          onConfirm={async () => {
            try {
              const r = await deleteListing(del.id);
              toast.success(r === "archived" ? t("ml.archivedToast") : t("ml.deletedToast"));
              res.refetch();
            } catch (e) {
              toast.error(errMsg(e));
            }
            setDel(null);
          }}
        />
      )}
    </div>
  );
}
