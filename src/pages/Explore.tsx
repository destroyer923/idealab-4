import { useEffect, useMemo, useState } from "react";
import { PAGE_IMAGES } from "@/lib/images";
import { ArrowRight, ClipboardList, Compass, FilterX, Handshake, Lightbulb, PlusCircle, SearchX, SlidersHorizontal, Sparkles } from "lucide-react";
import { cn } from "@/utils/cn";
import { getPublicListings, getSavedIds } from "@/lib/api";
import { CATEGORIES, MODES } from "@/lib/constants";
import { useDebounced, useQuery } from "@/lib/hooks";
import { L, useI18n } from "@/lib/i18n";
import { useMatches } from "@/lib/useMatches";
import { KIND_KEY, explainMatch } from "@/lib/match";
import { Link, useLocation } from "@/lib/router";
import { Avatar, Badge, Button, Chip, EmptyState, ErrorState, LinkButton, PageHeader, SearchInput, SectionTitle, Select, Skeleton, Tabs, focusRing } from "@/components/ui";
import { ListingCard } from "@/components/listing";

const PAGE = 24;

export default function Explore() {
  const { t, tn, num } = useI18n();
  const { query } = useLocation();
  const qParam = query.get("q") ?? "";
  const [q, setQ] = useState(qParam);
  useEffect(() => setQ(qParam), [qParam]);
  const dq = useDebounced(q.trim().toLowerCase());
  const [tab, setTab] = useState<"all" | "offer" | "need">("all");
  const catParam = query.get("cat");
  const [cat, setCat] = useState(catParam && (CATEGORIES as readonly string[]).includes(catParam) ? catParam : "All");
  useEffect(() => {
    if (catParam && (CATEGORIES as readonly string[]).includes(catParam)) setCat(catParam);
  }, [catParam]);
  const [loc, setLoc] = useState("");
  const [mode, setMode] = useState("");
  const [compatible, setCompatible] = useState(false);
  const [sort, setSort] = useState<"newest" | "updated">("newest");
  const [limit, setLimit] = useState(PAGE);
  const [showFilters, setShowFilters] = useState(false);

  const listings = useQuery(() => getPublicListings());
  const saved = useQuery(() => getSavedIds());
  const matches = useMatches();

  const compatibleIds = useMemo(() => {
    const s = new Set<string>();
    matches.data?.candidates.forEach((c) => {
      c.theyHelpMe.forEach((p) => s.add(p.offer.id));
      c.iHelpThem.forEach((p) => !p.need.viaPreference && s.add(p.need.id));
    });
    return s;
  }, [matches.data]);

  const locations = useMemo(() => [...new Set((listings.data ?? []).map((x) => x.listing.location).filter(Boolean))].sort(), [listings.data]);
  const hasModes = (listings.data ?? []).some((x) => x.listing.mode);

  const filtered = useMemo(() => {
    let r = listings.data ?? [];
    if (dq) {
      const terms = dq.split(/\s+/);
      r = r.filter(({ listing: l, owner }) => {
        // Search both the stored English category/type values and their translated labels.
        const hay = [l.title, l.description, l.details, l.exchangePref, l.category, t(L.cat(l.category)), l.type, t(L.type(l.type)), l.tags.join(" "), owner.fullName, owner.username, owner.occupation].join(" ").toLowerCase();
        return terms.every((term) => hay.includes(term));
      });
    }
    if (cat !== "All") r = r.filter((x) => x.listing.category === cat);
    if (loc) r = r.filter((x) => x.listing.location === loc);
    if (mode) r = r.filter((x) => x.listing.mode === mode || (mode !== "both" && x.listing.mode === "both"));
    if (compatible) r = r.filter((x) => compatibleIds.has(x.listing.id));
    return [...r].sort((a, b) => (sort === "newest" ? b.listing.createdAt.localeCompare(a.listing.createdAt) : b.listing.updatedAt.localeCompare(a.listing.updatedAt)));
  }, [listings.data, dq, cat, loc, mode, compatible, compatibleIds, sort, t]);

  const counts = { all: filtered.length, offer: filtered.filter((x) => x.listing.kind === "offer").length, need: filtered.filter((x) => x.listing.kind === "need").length };
  const shown = tab === "all" ? filtered : filtered.filter((x) => x.listing.kind === tab);
  const active = Boolean(dq || cat !== "All" || loc || mode || compatible);
  const clear = () => (setQ(""), setCat("All"), setLoc(""), setMode(""), setCompatible(false), setLimit(PAGE));
  useEffect(() => setLimit(PAGE), [dq, cat, loc, mode, compatible, tab]);

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    (listings.data ?? []).forEach((x) => m.set(x.listing.category, (m.get(x.listing.category) ?? 0) + 1));
    return m;
  }, [listings.data]);

  return (
    <div>
      <PageHeader title={t("nav.explore")} subtitle={t("explore.subtitle")} image={PAGE_IMAGES.explore} eyebrow={t("shell.brandTagline")}>
        <LinkButton to="/offers/new" icon={PlusCircle}>{t("action.postOffer")}</LinkButton>
        <LinkButton to="/needs/new" variant="secondary" icon={ClipboardList}>{t("action.postNeed")}</LinkButton>
      </PageHeader>

      <div className="mb-8 border-b border-[#E9DFDC] pb-5">
        <div className="flex flex-col gap-3 md:flex-row">
          <SearchInput className="flex-1" value={q} onChange={setQ} label={t("explore.searchLabel")} placeholder={t("explore.searchPh")} />
          <div className="flex gap-2">
            <Button variant="secondary" icon={SlidersHorizontal} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} className="md:hidden">
              {t("common.filters")}
            </Button>
            <Select aria-label={t("common.sort")} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-auto">
              <option value="newest">{t("common.newestFirst")}</option>
              <option value="updated">{t("common.recentlyUpdated")}</option>
            </Select>
          </div>
        </div>
        <div className={cn("mt-3 grid gap-3 sm:grid-cols-3", !showFilters && "hidden md:grid")}>
          <Select aria-label={t("explore.locationLabel")} value={loc} onChange={(e) => setLoc(e.target.value)} disabled={!locations.length}>
            <option value="">{locations.length ? t("common.anyLocation") : t("common.noLocations")}</option>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
          <Select aria-label={t("explore.modeLabel")} value={mode} onChange={(e) => setMode(e.target.value)} disabled={!hasModes}>
            <option value="">{t("explore.anyAvailability")}</option>
            {MODES.map((k) => <option key={k} value={k}>{t(L.mode(k))}</option>)}
          </Select>
          <label className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition", compatible ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600", !matches.data?.hasListings && "cursor-not-allowed opacity-60")}>
            <input type="checkbox" className="h-4 w-4 shrink-0 accent-emerald-600" checked={compatible} disabled={!matches.data?.hasListings} onChange={(e) => setCompatible(e.target.checked)} />
            {t("explore.complements")}
          </label>
        </div>
        <div className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label={t("explore.categories")}>
          <Chip active={cat === "All"} onClick={() => setCat("All")}>{t("common.all")}</Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
              {t(L.cat(c))}
              {catCounts.get(c) ? <span className="ml-1 opacity-60">{num(catCounts.get(c)!)}</span> : null}
            </Chip>
          ))}
        </div>
      </div>

      {!active && matches.data && (
        <section className="mb-8" aria-label={t("explore.potential")}>
          <SectionTitle
            title={t("explore.potential")}
            icon={Sparkles}
            action={matches.data.candidates.length > 0 && <Link to="/matches" className={cn("inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline", focusRing)}>{t("common.seeAll")} <ArrowRight className="h-3.5 w-3.5" /></Link>}
          />
          {matches.data.candidates.length === 0 ? (
            <div className="flex flex-col items-start gap-3 border-y border-[#E9DFDC] py-4 text-sm text-slate-600 sm:flex-row sm:items-center">
              <Lightbulb className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
              <p className="flex-1">{matches.data.hasListings ? t("explore.noCompBody") : t("explore.noListingsHint")}</p>
              {!matches.data.hasListings && <LinkButton to="/offers/new" size="sm" icon={PlusCircle}>{t("action.createOffer")}</LinkButton>}
            </div>
          ) : (
            <div className="grid gap-x-6 gap-y-5 border-y border-[#E9DFDC] py-5 md:grid-cols-3">
              {matches.data.candidates.slice(0, 3).map((c) => {
                const m = matches.data!.members.get(c.userId)!;
                return (
                  <Link key={c.userId} to={`/matches?focus=${c.userId}`} className={cn("group flex flex-col border-l-2 border-[#E9DFDC] pl-4 transition-colors hover:border-[#541B2B]", focusRing)}>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={m.fullName} src={m.avatar} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{m.fullName}</p>
                        <p className="truncate text-xs text-slate-500">{m.occupation || (c.categories[0] ? t(L.cat(c.categories[0])) : t("common.member"))}</p>
                      </div>
                      <Badge tone={c.kind === "mutual" ? "green" : "sky"}>{t(KIND_KEY[c.kind])}</Badge>
                    </div>
                    <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-slate-600">{explainMatch(t, c)}</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><Handshake className="h-3.5 w-3.5" /> {t("explore.viewMatch")}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="list-title">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="list-title" className="text-base font-semibold text-slate-900">{active ? t("explore.results") : t("explore.recent")}</h2>
            <span className="text-sm text-slate-500" aria-live="polite">{tn("count.listings", shown.length)}</span>
            {active && (
              <button onClick={clear} className={cn("inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline", focusRing)}>
                <FilterX className="h-3.5 w-3.5" /> {t("common.clearFilters")}
              </button>
            )}
          </div>
          <Tabs label={t("explore.typeLabel")} value={tab} onChange={setTab} tabs={[{ value: "all", label: t("common.all"), count: counts.all }, { value: "offer", label: t("common.offers"), count: counts.offer }, { value: "need", label: t("common.needs"), count: counts.need }]} />
        </div>

        {listings.error ? (
          <ErrorState message={listings.error} />
        ) : !listings.data ? (
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72" />)}</div>
        ) : listings.data.length === 0 ? (
          <EmptyState icon={Compass} title={t("explore.emptyTitle")} body={t("explore.emptyBody")}>
            <LinkButton to="/offers/new" icon={PlusCircle}>{t("action.postOffer")}</LinkButton>
            <LinkButton to="/needs/new" variant="secondary" icon={ClipboardList}>{t("action.postNeed")}</LinkButton>
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState icon={SearchX} title={t("explore.noResultsTitle")} body={t("explore.noResultsBody")}>
            <Button variant="secondary" icon={FilterX} onClick={clear}>{t("common.clearFilters")}</Button>
          </EmptyState>
        ) : (
          <>
            <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {shown.slice(0, limit).map(({ listing, owner }) => (
                <li key={listing.id}>
                  <ListingCard listing={listing} owner={owner} saved={saved.data?.has(listing.id) ?? false} highlight={compatibleIds.has(listing.id) ? t("explore.complementsYou") : undefined} />
                </li>
              ))}
            </ul>
            {shown.length > limit && (
              <div className="mt-6 flex justify-center">
                <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>{t("common.loadMore", { n: num(shown.length - limit) })}</Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
