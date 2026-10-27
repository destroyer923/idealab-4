import { useMemo, useState } from "react";
import { PAGE_IMAGES } from "@/lib/images";
import { Bookmark, BookmarkX, Compass, FilterX, Handshake, UserRound } from "lucide-react";
import { cn } from "@/utils/cn";
import { getSaved, toggleSave } from "@/lib/api";
import { useDebounced, useQuery } from "@/lib/hooks";
import { L, useI18n } from "@/lib/i18n";
import type { Listing, PublicMember } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorState, LinkButton, PageHeader, SearchInput, Select, Tabs, errMsg, focusRing, toast } from "@/components/ui";
import { ListingCard, MessageButton, ProposeExchangeDialog } from "@/components/listing";

export default function Saved() {
  const { t, tn, date, locale } = useI18n();
  const res = useQuery(() => getSaved());
  const [tab, setTab] = useState<"all" | "offer" | "need">("all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim().toLowerCase());
  const [sort, setSort] = useState<"recent" | "az">("recent");
  const [propose, setPropose] = useState<{ l: Listing; owner: PublicMember } | null>(null);

  const all = useMemo(() => res.data ?? [], [res.data]);
  const searched = useMemo(
    () => (dq ? all.filter((x) => `${x.listing?.title ?? ""} ${x.listing?.description ?? ""} ${x.listing?.category ?? ""} ${x.listing ? t(L.cat(x.listing.category)) : ""}`.toLowerCase().includes(dq)) : all),
    [all, dq, t]
  );
  const list = useMemo(() => {
    const r = tab === "all" ? searched : searched.filter((x) => x.listing?.kind === tab);
    return [...r].sort((a, b) => (sort === "recent" ? b.saved.createdAt.localeCompare(a.saved.createdAt) : (a.listing?.title ?? "").localeCompare(b.listing?.title ?? "", locale)));
  }, [searched, tab, sort, locale]);

  const remove = (id: string) => {
    try {
      toggleSave(id);
      toast.success(t("listing.removedToast"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const goneBody = (l: Listing | null, state: string) =>
    state === "deleted" ? t("sv.deletedBody") : l?.status === "fulfilled" ? t("sv.fulfilledBody") : l?.status === "paused" ? t("sv.pausedBody") : t("sv.closedBody");

  return (
    <div>
      <PageHeader title={t("nav.saved")} subtitle={t("sv.subtitle")} image={PAGE_IMAGES.saved} />
      {res.error ? (
        <ErrorState message={res.error} />
      ) : all.length === 0 ? (
        <EmptyState icon={Bookmark} title={t("sv.emptyTitle")} body={t("sv.emptyBody")}>
          <LinkButton to="/explore" icon={Compass}>{t("nav.explore")}</LinkButton>
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs label={t("sv.typeLabel")} value={tab} onChange={setTab} tabs={[{ value: "all", label: t("sv.all"), count: searched.length }, { value: "offer", label: t("common.offers"), count: searched.filter((x) => x.listing?.kind === "offer").length }, { value: "need", label: t("common.needs"), count: searched.filter((x) => x.listing?.kind === "need").length }]} />
            <div className="flex flex-col gap-2 sm:flex-row">
              <SearchInput value={q} onChange={setQ} label={t("sv.searchLabel")} placeholder={t("sv.searchPh")} className="sm:w-64" />
              <Select aria-label={t("common.sort")} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="sm:w-44">
                <option value="recent">{t("sv.sortRecent")}</option>
                <option value="az">{t("sv.sortAz")}</option>
              </Select>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-slate-500" aria-live="polite">
            {tn("count.saved", list.length)}
            {dq && <button onClick={() => setQ("")} className={cn("inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline", focusRing)}><FilterX className="h-3.5 w-3.5" />{t("common.clearSearch")}</button>}
          </div>
          {list.length === 0 ? (
            <EmptyState icon={FilterX} title={t("sv.noMatchTitle")} body={t("sv.noMatchBody")}>
              <Button variant="secondary" onClick={() => (setQ(""), setTab("all"))}>{t("sv.showAll")}</Button>
            </EmptyState>
          ) : (
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map(({ saved, listing, owner, state }) =>
                state !== "available" || !listing ? (
                  <Card key={saved.id} className="flex flex-col border-[#E9DFDC] p-5">
                    <Badge tone="slate" icon={BookmarkX} className="self-start">{state === "deleted" ? t("sv.removedByOwner") : t("sv.unavailable")}</Badge>
                    <p className="mt-3 break-words font-semibold text-slate-700">{listing?.title ?? t("sv.listingRemoved")}</p>
                    <p className="mt-1 text-sm text-slate-500">{goneBody(listing, state)}</p>
                    <p className="mt-2 text-xs text-slate-400">{t("sv.savedOn", { date: date(saved.createdAt) })}</p>
                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      {owner?.username && <LinkButton to={`/u/${owner.username}`} size="sm" variant="secondary" icon={UserRound}>{t("sv.ownerProfile")}</LinkButton>}
                      <Button size="sm" variant="ghost" onClick={() => remove(saved.listingId)}>{t("common.remove")}</Button>
                    </div>
                  </Card>
                ) : (
                  <ListingCard
                    key={saved.id}
                    listing={listing}
                    owner={owner}
                    saved
                    footer={
                      <div className="mt-3 space-y-2">
                        <p className="text-[11px] text-slate-400">{t("sv.savedOn", { date: date(saved.createdAt) })}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <Button size="sm" icon={Handshake} onClick={() => owner && setPropose({ l: listing, owner })}>{t("common.propose")}</Button>
                          {owner && <MessageButton userId={owner.userId} contextType="listing" contextId={listing.id} size="sm" variant="ghost" label={t("common.messageOwner")} />}
                          <Button size="sm" variant="ghost" icon={BookmarkX} onClick={() => remove(listing.id)}>{t("common.remove")}</Button>
                        </div>
                      </div>
                    }
                  />
                )
              )}
            </div>
          )}
        </>
      )}
      {propose && <ProposeExchangeDialog open onClose={() => setPropose(null)} recipient={propose.owner} listing={propose.l} />}
    </div>
  );
}
