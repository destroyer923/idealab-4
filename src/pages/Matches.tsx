import { useEffect, useMemo, useState } from "react";
import { PAGE_IMAGES } from "@/lib/images";
import { ArrowRight, ArrowRightLeft, ClipboardList, Clock, FilterX, Handshake, Info, Lightbulb, MapPin, PlusCircle, Sparkles, UserRound, Users } from "lucide-react";
import { cn } from "@/utils/cn";
import { getSavedIds } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { L, useI18n } from "@/lib/i18n";
import { useMatches } from "@/lib/useMatches";
import { KIND_HINT_KEY, KIND_KEY, MATCH_WEIGHTS, explainMatch, factorKey, strengthKey, type MatchCandidate, type PairMatch } from "@/lib/match";
import { Link, useLocation } from "@/lib/router";
import type { PublicMember } from "@/lib/types";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, LinkButton, Modal, PageHeader, SectionTitle, Select, Skeleton, focusRing } from "@/components/ui";
import { ListingCard, MessageButton, ProposeExchangeDialog, SaveButton } from "@/components/listing";
import { ExchangeStatusBadge } from "./Exchange";

function ScoreRing({ score }: { score: number }) {
  const { t, num } = useI18n();
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-12 w-12 shrink-0 place-items-center" title={t("mt.scoreTitle", { n: num(score) })}>
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={r} fill="none" stroke="#F6E7E5" strokeWidth="4" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={score >= 70 ? "#541B2B" : score >= 45 ? "#8f3a4c" : "#E8A6A1"} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <span className="text-sm font-semibold tabular-nums text-slate-800" aria-hidden>{num(score)}</span>
      <span className="sr-only">{t("mt.scoreTitle", { n: num(score) })}</span>
    </div>
  );
}

const kindTone = (k: MatchCandidate["kind"]) => (k === "mutual" ? "green" : k === "potential" ? "sky" : "slate") as "green" | "sky" | "slate";

function MatchCard({ c, m, onOpen, onPropose }: { c: MatchCandidate; m: PublicMember; onOpen: () => void; onPropose: () => void }) {
  const { t } = useI18n();
  const busy = !!c.existing && ["pending", "active"].includes(c.existing.status);
  return (
    <Card className={cn("flex h-full flex-col border-t-2 p-5 transition-colors", c.kind === "mutual" ? "border-t-[#541B2B]" : "border-t-[#E9DFDC] hover:border-t-[#E8A6A1]")}>
      <div className="flex items-start gap-3">
        <Avatar name={m.fullName} src={m.avatar} size={46} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{m.fullName}</p>
          <p className="truncate text-xs text-slate-500">{m.occupation || (c.categories[0] ? t(L.cat(c.categories[0])) : t("common.member"))}</p>
          {m.location && <p className="flex items-center gap-1 truncate text-xs text-slate-400"><MapPin className="h-3 w-3" />{m.location}</p>}
        </div>
        <ScoreRing score={c.score} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge tone={kindTone(c.kind)} icon={c.kind === "mutual" ? ArrowRightLeft : ArrowRight}>{t(KIND_KEY[c.kind])}</Badge>
        <span className="text-[11px] text-slate-400">{t("match.strengthLine", { strength: t(strengthKey(c.score)) })}</span>
        {c.existing && <ExchangeStatusBadge status={c.existing.status} />}
      </div>
      <div className="mt-3 space-y-1.5 text-sm">
        {c.theyHelpMe[0] && <p className="line-clamp-2 break-words border-l-2 border-[#541B2B] px-2.5 py-1 text-slate-700"><span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8a3b44]">{t("mt.theyOffer")} · </span>{c.theyHelpMe[0].offer.title}</p>}
        {c.iHelpThem[0] && <p className="line-clamp-2 break-words border-l-2 border-[#E8A6A1] px-2.5 py-1 text-slate-700"><span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8a3b44]">{t("mt.theyNeed")} · </span>{c.iHelpThem[0].need.title}</p>}
      </div>
      <p className="mt-3 flex gap-2 text-xs leading-relaxed text-slate-600"><Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /><span className="line-clamp-3">{explainMatch(t, c)}</span></p>
      {c.categories.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{c.categories.slice(0, 3).map((k) => <span key={k} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{t(L.cat(k))}</span>)}</div>}
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <Button variant="secondary" size="sm" className="flex-1" onClick={onOpen}>{t("mt.viewMatch")}</Button>
        <Button size="sm" className="flex-1" icon={Handshake} onClick={onPropose} disabled={busy}>{c.existing?.status === "pending" ? t("mt.pending") : c.existing?.status === "active" ? t("mt.active") : t("common.propose")}</Button>
      </div>
    </Card>
  );
}

function PairRow({ p, direction }: { p: PairMatch; direction: "theyHelpMe" | "iHelpThem" }) {
  const { t, num } = useI18n();
  const right = direction === "theyHelpMe" ? (p.need.viaPreference ? "mt.yourWant" : "mt.yourNeed") : p.need.viaPreference ? "mt.theirWant" : "mt.theirNeed";
  return (
    <li className="grid items-center gap-2 border-l-2 border-[#E9DFDC] bg-[#FFF8F0] p-3 text-sm sm:grid-cols-[1fr_auto_1fr]">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase text-slate-500">{t(direction === "theyHelpMe" ? "mt.theirOffer" : "mt.yourOffer")}</p>
        <p className="break-words text-slate-800">{p.offer.title}</p>
      </div>
      <div className="flex items-center gap-1 text-xs text-emerald-700"><ArrowRight className="h-3.5 w-3.5" /> {num(Math.round(p.score * 100))}%</div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase text-slate-500">{t(right)}</p>
        <p className="break-words text-slate-800">{p.need.title}</p>
      </div>
      {p.shared.length > 0 && <p className="break-words text-[11px] text-slate-500 sm:col-span-3">{t("mt.shared", { words: p.shared.slice(0, 6).join(", ") })}</p>}
    </li>
  );
}

function MatchDetail({ c, m, saved, onClose, onPropose }: { c: MatchCandidate; m: PublicMember; saved: Set<string>; onClose: () => void; onPropose: () => void }) {
  const { t, num } = useI18n();
  const first = m.fullName.split(" ")[0];
  const theirListings = [...new Map(c.theyHelpMe.map((p) => [p.offer.id, p.offer])).values()];
  return (
    <Modal open onClose={onClose} size="xl" title={t("mt.detailTitle", { name: m.fullName })} description={t(KIND_HINT_KEY[c.kind])}>
      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0 space-y-5">
          <p className="border-l-2 border-[#E8A6A1] bg-[#FFF8F0] p-3 text-sm text-[#461623]">{explainMatch(t, c)}</p>
          {c.theyHelpMe.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">{t("mt.howHelpYou", { name: first })}</h3>
              <ul className="space-y-2">{c.theyHelpMe.slice(0, 4).map((p, i) => <PairRow key={i} p={p} direction="theyHelpMe" />)}</ul>
            </section>
          )}
          {c.iHelpThem.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">{t("mt.howHelpThem", { name: first })}</h3>
              <ul className="space-y-2">{c.iHelpThem.slice(0, 4).map((p, i) => <PairRow key={i} p={p} direction="iHelpThem" />)}</ul>
            </section>
          )}
          {theirListings.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">{t("mt.relevant")}</h3>
              <div className="grid gap-3 sm:grid-cols-2">{theirListings.slice(0, 2).map((l) => <ListingCard key={l.id} listing={l} showOwner={false} saved={saved.has(l.id)} />)}</div>
            </section>
          )}
        </div>
        <aside className="space-y-4">
          <div className="border border-[#E9DFDC] p-4">
            <div className="flex items-center gap-3"><ScoreRing score={c.score} /><div><p className="text-sm font-semibold text-slate-900">{t("match.strengthLine", { strength: t(strengthKey(c.score)) })}</p><p className="text-xs text-slate-500">{t("mt.outOf100")}</p></div></div>
            <ul className="mt-4 space-y-2.5">
              {c.factors.map((f) => {
                const core = f.key === "theyMeetMyNeeds" || f.key === "iMeetTheirNeeds";
                const used = f.available || core;
                return (
                  <li key={f.key} className={cn(!used && "opacity-50")}>
                    <div className="flex justify-between gap-2 text-xs"><span className="text-slate-600">{t(factorKey(f.key))}</span><span className="shrink-0 tabular-nums text-slate-500">{used ? t("mt.weight", { pct: num(Math.round(f.value * 100)), w: num(f.weight) }) : t("mt.noData")}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${f.value * 100}%` }} /></div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{t("mt.factorNote")}</p>
          </div>
          {c.existing && <div className="border border-[#E9DFDC] p-4 text-sm"><p className="mb-1 text-xs text-slate-500">{t("mt.existing")}</p><ExchangeStatusBadge status={c.existing.status} /><Link to={`/exchange/${c.existing.id}`} className="mt-2 block break-words font-medium text-emerald-700 hover:underline">{c.existing.title}</Link></div>}
          <div className="space-y-2">
            <Button className="w-full" icon={Handshake} onClick={onPropose} disabled={!!c.existing && ["pending", "active"].includes(c.existing.status)}>{t("common.proposeExchange")}</Button>
            <MessageButton userId={c.userId} contextType={c.theyHelpMe[0] ? "listing" : "none"} contextId={c.theyHelpMe[0]?.offer.id} className="w-full" />
            {m.username && <LinkButton to={`/u/${m.username}`} variant="ghost" icon={UserRound} className="w-full">{t("common.viewProfile")}</LinkButton>}
            {c.theyHelpMe[0] && <SaveButton listingId={c.theyHelpMe[0].offer.id} saved={saved.has(c.theyHelpMe[0].offer.id)} withLabel className="w-full" />}
          </div>
        </aside>
      </div>
    </Modal>
  );
}

export default function Matches() {
  const { t, num } = useI18n();
  const { query } = useLocation();
  const res = useMatches();
  const saved = useQuery(() => getSavedIds());
  const [type, setType] = useState<"all" | "mutual" | "potential" | "one_way">("all");
  const [cat, setCat] = useState("");
  const [loc, setLoc] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [sort, setSort] = useState<"score" | "newest">("score");
  const focus = query.get("focus");
  const [openId, setOpenId] = useState<string | null>(focus);
  const [proposeId, setProposeId] = useState<string | null>(null);
  useEffect(() => setOpenId(focus), [focus]);

  const d = res.data;
  const all = useMemo(() => d?.candidates ?? [], [d]);
  const cats = useMemo(() => [...new Set(all.flatMap((c) => c.categories))].sort(), [all]);
  const locs = useMemo(() => [...new Set(all.map((c) => d?.members.get(c.userId)?.location).filter(Boolean) as string[])].sort(), [all, d]);

  const filtered = useMemo(() => {
    let r = all;
    if (type !== "all") r = r.filter((c) => c.kind === type);
    if (cat) r = r.filter((c) => c.categories.includes(cat));
    if (loc) r = r.filter((c) => d?.members.get(c.userId)?.location === loc);
    if (minScore) r = r.filter((c) => c.score >= minScore);
    return [...r].sort((a, b) => (sort === "newest" ? b.latestListingAt.localeCompare(a.latestListingAt) : b.score - a.score));
  }, [all, type, cat, loc, minScore, sort, d]);

  const filtersOn = type !== "all" || !!cat || !!loc || minScore > 0 || sort !== "score";
  const clear = () => (setType("all"), setCat(""), setLoc(""), setMinScore(0), setSort("score"));

  const best = filtered.slice(0, 3);
  const rest = filtered.slice(3);
  const mutualRest = rest.filter((c) => c.kind === "mutual");
  const otherRest = rest.filter((c) => c.kind !== "mutual");

  const recent = useMemo(() => {
    if (!d) return [];
    const cutoff = Date.now() - 14 * 86400_000;
    const seen = new Map<string, { l: PairMatch["offer"]; owner: PublicMember }>();
    all.forEach((c) => c.theyHelpMe.forEach((p) => Date.parse(p.offer.createdAt) > cutoff && seen.set(p.offer.id, { l: p.offer, owner: d.members.get(c.userId)! })));
    return [...seen.values()].sort((a, b) => b.l.createdAt.localeCompare(a.l.createdAt)).slice(0, 3);
  }, [all, d]);

  const openC = all.find((c) => c.userId === openId);
  const proposeC = all.find((c) => c.userId === proposeId);

  const grid = (list: MatchCandidate[]) => (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {list.map((c) => <MatchCard key={c.userId} c={c} m={d!.members.get(c.userId)!} onOpen={() => setOpenId(c.userId)} onPropose={() => setProposeId(c.userId)} />)}
    </div>
  );

  return (
    <div>
      <PageHeader title={t("nav.matches")} subtitle={t("mt.subtitle")} image={PAGE_IMAGES.matches} />
      <div className="mb-8 flex max-w-3xl gap-3 border-l-2 border-[#E8A6A1] py-1 pl-4 text-[13px] leading-relaxed text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <p>{t("mt.how", { a: num(MATCH_WEIGHTS.theyMeetMyNeeds), b: num(MATCH_WEIGHTS.iMeetTheirNeeds), c: num(MATCH_WEIGHTS.categoryRelevance), d: num(MATCH_WEIGHTS.location) })}</p>
      </div>

      {res.error ? (
        <ErrorState message={res.error} />
      ) : !d ? (
        <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72" />)}</div>
      ) : !d.hasListings ? (
        <EmptyState icon={ClipboardList} title={t("mt.noListingsTitle")} body={t("mt.noListingsBody")}>
          <LinkButton to="/offers/new" icon={PlusCircle}>{t("action.createOffer")}</LinkButton>
          <LinkButton to="/needs/new" variant="secondary" icon={ClipboardList}>{t("action.postNeed")}</LinkButton>
          <LinkButton to="/explore" variant="ghost">{t("nav.explore")}</LinkButton>
        </EmptyState>
      ) : all.length === 0 ? (
        <EmptyState icon={Users} title={t("mt.noMatchesTitle")} body={d.communitySize === 0 ? t("mt.noCommunity") : t("mt.noComplement")}>
          <LinkButton to="/offers" variant="secondary">{t("mt.improve")}</LinkButton>
          <LinkButton to="/explore">{t("mt.exploreAll")}</LinkButton>
        </EmptyState>
      ) : (
        <>
          <div className="mb-6 grid gap-3 border-y border-[#E9DFDC] py-4 sm:grid-cols-2 lg:grid-cols-5">
            <Select aria-label={t("mt.typeLabel")} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="all">{t("mt.type.all")}</option>
              <option value="mutual">{t("mt.type.mutual")}</option>
              <option value="potential">{t("mt.type.potential")}</option>
              <option value="one_way">{t("mt.type.oneWay")}</option>
            </Select>
            <Select aria-label={t("listing.field.category")} value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">{t("common.allCategories")}</option>
              {cats.map((c) => <option key={c} value={c}>{t(L.cat(c))}</option>)}
            </Select>
            <Select aria-label={t("listing.field.location")} value={loc} onChange={(e) => setLoc(e.target.value)} disabled={!locs.length}>
              <option value="">{locs.length ? t("common.anyLocation") : t("mt.noPublicLoc")}</option>
              {locs.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
            <Select aria-label={t("mt.strengthLabel")} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
              <option value={0}>{t("mt.anyStrength")}</option>
              <option value={45}>{t("mt.good")}</option>
              <option value={70}>{t("mt.strongOnly")}</option>
            </Select>
            <Select aria-label={t("common.sort")} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="score">{t("mt.sortScore")}</option>
              <option value="newest">{t("mt.sortNewest")}</option>
            </Select>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-500" aria-live="polite">
            {t("mt.count", { shown: num(filtered.length), total: num(all.length) })}
            {filtersOn && <button onClick={clear} className={cn("inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline", focusRing)}><FilterX className="h-3.5 w-3.5" />{t("common.clearFilters")}</button>}
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={FilterX} title={t("mt.noFilterTitle")} body={t("mt.noFilterBody")}><Button variant="secondary" onClick={clear}>{t("common.clearFilters")}</Button></EmptyState>
          ) : (
            <div className="space-y-10">
              <section><SectionTitle title={t("mt.best")} icon={Sparkles} />{grid(best)}</section>
              {mutualRest.length > 0 && <section><SectionTitle title={t("mt.moreMutual")} icon={ArrowRightLeft} />{grid(mutualRest)}</section>}
              {otherRest.length > 0 && <section><SectionTitle title={t("mt.other")} icon={ArrowRight} /><p className="-mt-2 mb-3 text-xs text-slate-500">{t("mt.otherHint")}</p>{grid(otherRest)}</section>}
              {recent.length > 0 && !filtersOn && (
                <section>
                  <SectionTitle title={t("mt.recent")} icon={Clock} />
                  <p className="-mt-2 mb-3 text-xs text-slate-500">{t("mt.recentHint")}</p>
                  <div className="grid gap-4 md:grid-cols-3">{recent.map(({ l, owner }) => <ListingCard key={l.id} listing={l} owner={owner} saved={saved.data?.has(l.id) ?? false} />)}</div>
                </section>
              )}
            </div>
          )}
        </>
      )}

      {openC && d && <MatchDetail c={openC} m={d.members.get(openC.userId)!} saved={saved.data ?? new Set()} onClose={() => setOpenId(null)} onPropose={() => (setProposeId(openC.userId), setOpenId(null))} />}
      {proposeC && d && (
        <ProposeExchangeDialog
          open
          onClose={() => setProposeId(null)}
          recipient={d.members.get(proposeC.userId)!}
          listing={proposeC.theyHelpMe[0]?.offer}
          suggestedProvide={proposeC.iHelpThem[0] ? `${proposeC.iHelpThem[0].offer.title}: ${proposeC.iHelpThem[0].offer.details}` : undefined}
        />
      )}
    </div>
  );
}
