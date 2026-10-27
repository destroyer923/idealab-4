import { useState } from "react";
import {
  Activity, ArrowRight, ArrowRightLeft, Ban, CheckCircle2, ClipboardList, Compass, Flag, Handshake, Lightbulb, MapPin, MessageSquareText, Milestone,
  PackageCheck, PlusCircle, Send, Sparkles, Star, Truck, Undo2, Users, XCircle, type LucideIcon,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { getActivity, getConversations, getMe, getMyExchanges, getMyListings, getPublicListings, getSavedIds } from "@/lib/api";
import { CATEGORIES } from "@/lib/constants";
import { categoryImage } from "@/lib/images";
import { useQuery } from "@/lib/hooks";
import { useMatches } from "@/lib/useMatches";
import { KIND_KEY, explainMatch, type MatchCandidate } from "@/lib/match";
import { L, dyn, useI18n } from "@/lib/i18n";
import { Link } from "@/lib/router";
import type { EventType } from "@/lib/types";
import { Avatar, Button, EmptyState, ErrorState, LinkButton, SectionTitle, Skeleton, focusRing } from "@/components/ui";
import { HeroCarousel } from "@/components/HeroCarousel";
import { ListingCard, ListingImage, ProposeExchangeDialog } from "@/components/listing";

export const EVENT_ICON: Record<EventType, LucideIcon> = {
  request_created: Send,
  request_accepted: CheckCircle2,
  request_declined: XCircle,
  request_withdrawn: Undo2,
  progress_changed: Activity,
  work_submitted: PackageCheck,
  revision_requested: Flag,
  commitment_confirmed: CheckCircle2,
  exchange_completed: Sparkles,
  exchange_cancelled: Ban,
  milestone_created: Milestone,
  milestone_updated: Milestone,
  progress_note: MessageSquareText,
  delivery_updated: Truck,
  amendment_proposed: ArrowRightLeft,
  amendment_accepted: CheckCircle2,
  amendment_rejected: XCircle,
  review_received: Star,
};

/** Statistics as a typographic row — numbers and labels, divided by hairlines. */
function StatRow({ items }: { items: { label: string; value: number | undefined; to: string; hint: string }[] }) {
  const { num } = useI18n();
  return (
    <dl className="grid grid-cols-2 border-y border-[#E9DFDC] md:grid-cols-5">
      {items.map((s, i) => (
        <Link
          key={s.label}
          to={s.to}
          className={cn(
            "group border-[#E9DFDC] px-4 py-5 transition-colors hover:bg-white sm:px-5",
            focusRing,
            i % 2 === 0 && "border-r md:border-r",
            i < items.length - 2 && "border-b md:border-b-0",
            i > 0 && "md:border-l md:border-r-0"
          )}
        >
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">{s.label}</dt>
          <dd className="mt-1.5 flex items-baseline gap-2">
            <span className="display text-[34px] font-semibold text-[#541B2B]">{s.value === undefined ? <Skeleton className="inline-block h-7 w-9" /> : num(s.value)}</span>
            <ArrowRight className="h-3.5 w-3.5 text-transparent transition group-hover:translate-x-0.5 group-hover:text-[#8a3b44]" aria-hidden />
          </dd>
          <p className="mt-0.5 text-[11.5px] text-slate-400">{s.hint}</p>
        </Link>
      ))}
    </dl>
  );
}

/** Editorial match row: photo, who they are, what each side brings, why it fits. */
export function MatchPersonCard({ c, member, onPropose }: { c: MatchCandidate; member: { userId: string; fullName: string; username: string; occupation: string; avatar?: string; location?: string }; onPropose: () => void }) {
  const { t } = useI18n();
  const offer = c.theyHelpMe[0]?.offer;
  const theirNeed = c.iHelpThem[0]?.need;
  const busy = c.existing?.status === "pending" || c.existing?.status === "active";
  return (
    <article className="group grid gap-5 border-b border-[#E9DFDC] py-6 last:border-0 sm:grid-cols-[170px_1fr]">
      <div className="img-fallback relative hidden aspect-[4/3] overflow-hidden sm:block">
        {offer ? (
          <ListingImage listing={offer} className="transition-transform duration-700 group-hover:scale-105" w={360} h={270} />
        ) : (
          <img src={categoryImage(c.categories[0] ?? "Other", 360, 270)} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Avatar name={member.fullName} src={member.avatar} size={28} />
          <p className="font-display text-[19px] text-[#29232A]">{member.fullName}</p>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a3b44]">{t(KIND_KEY[c.kind])}</span>
        </div>
        <p className="mt-0.5 text-[12.5px] text-slate-500">
          {member.occupation || (offer ? t(L.cat(offer.category)) : t("common.member"))}
          {member.location && <> · <span className="inline-flex items-center gap-1"><MapPin className="inline h-3 w-3" aria-hidden />{member.location}</span></>}
        </p>

        <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {offer && (
            <div className="border-l-2 border-[#541B2B] pl-3">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8a3b44]">{t("match.canOffer")}</dt>
              <dd className="line-clamp-2 text-[13.5px] text-slate-700">{offer.title}</dd>
            </div>
          )}
          {theirNeed && (
            <div className="border-l-2 border-[#E8A6A1] pl-3">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8a3b44]">{t("match.needs")}</dt>
              <dd className="line-clamp-2 text-[13.5px] text-slate-700">{theirNeed.title}</dd>
            </div>
          )}
        </dl>

        <p className="mt-3 flex gap-2 text-[12.5px] leading-relaxed text-slate-500">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#E8A6A1]" aria-hidden />
          <span className="line-clamp-2">{explainMatch(t, c)}</span>
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Button size="sm" variant="primary" icon={Handshake} onClick={onPropose} disabled={busy}>
            {c.existing?.status === "pending" ? t("match.requestPending") : c.existing?.status === "active" ? t("match.inProgress") : t("common.proposeExchange")}
          </Button>
          {member.username && <LinkButton to={`/u/${member.username}`} variant="link" size="sm">{t("common.viewProfile")}</LinkButton>}
        </div>
      </div>
    </article>
  );
}

export default function Dashboard() {
  const { t, ago, greeting } = useI18n();
  const me = useQuery(() => getMe());
  const stats = useQuery(() => {
    const offers = getMyListings("offer");
    const needs = getMyListings("need");
    const ex = getMyExchanges();
    return {
      activeOffers: offers.filter((o) => o.status === "active").length,
      openNeeds: needs.filter((n) => ["open", "matched", "in_progress"].includes(n.status)).length,
      pending: ex.filter((x) => x.status === "pending" && x.role === "recipient").length,
      conversations: getConversations().filter((c) => c.last).length,
    };
  });
  const matches = useMatches();
  const activity = useQuery(() => getActivity(6));
  const community = useQuery(() => {
    const all = getPublicListings().sort((a, b) => b.listing.createdAt.localeCompare(a.listing.createdAt));
    return {
      offers: all.filter((x) => x.listing.kind === "offer").slice(0, 3),
      needs: all.filter((x) => x.listing.kind === "need").slice(0, 3),
      recent: all.slice(0, 6),
    };
  });
  const saved = useQuery(() => getSavedIds());
  const [propose, setPropose] = useState<MatchCandidate | null>(null);

  const first = me.data?.profile.fullName.split(" ")[0];
  const top = matches.data?.candidates.slice(0, 3) ?? [];

  return (
    <div className="space-y-16 pb-8">
      {/* Hero — bleeds to the edges of the content column */}
      <div className="rise -mx-4 -mt-8 sm:-mx-6 sm:-mt-10 lg:-mx-10">
        <HeroCarousel />
      </div>

      {/* Greeting + statistics as an editorial masthead */}
      <section aria-label={t("dash.statsLabel")} className="rise" style={{ animationDelay: "60ms" }}>
        <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a3b44]">{t("dash.eyebrow")}</p>
            <h1 className="display mt-2 text-[34px] font-semibold text-[#541B2B] sm:text-[44px]">{first ? t("dash.greetingName", { greeting: greeting(), name: first }) : `${greeting()}!`}</h1>
            <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-slate-500">{t("dash.welcomeBody")}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2">
            <LinkButton to="/explore" icon={Compass}>{t("nav.explore")}</LinkButton>
            <LinkButton to="/offers/new" variant="link" icon={PlusCircle}>{t("action.postOffer")}</LinkButton>
            <LinkButton to="/needs/new" variant="link" icon={ClipboardList}>{t("action.postNeed")}</LinkButton>
          </div>
        </div>
        {stats.error ? (
          <ErrorState message={stats.error} />
        ) : (
          <StatRow
            items={[
              { label: t("dash.stat.activeOffers"), value: stats.data?.activeOffers, to: "/offers", hint: t("dash.stat.activeOffersHint") },
              { label: t("dash.stat.openNeeds"), value: stats.data?.openNeeds, to: "/needs", hint: t("dash.stat.openNeedsHint") },
              { label: t("dash.stat.pending"), value: stats.data?.pending, to: "/exchange", hint: t("dash.stat.pendingHint") },
              { label: t("dash.stat.conversations"), value: stats.data?.conversations, to: "/messages", hint: t("dash.stat.conversationsHint") },
              { label: t("dash.stat.matches"), value: matches.data?.candidates.length, to: "/matches", hint: t("dash.stat.matchesHint") },
            ]}
          />
        )}
      </section>

      {/* Can Offer / Needs */}
      {community.data && (
        <div className="grid gap-x-12 gap-y-14 lg:grid-cols-2">
          {([
            { key: "offers", title: t("dash.offersTitle"), sub: t("dash.offersSub"), items: community.data.offers, empty: t("dash.noOffers"), post: "/offers/new", postLabel: t("action.postOffer") },
            { key: "needs", title: t("dash.needsTitle"), sub: t("dash.needsSub"), items: community.data.needs, empty: t("dash.noNeeds"), post: "/needs/new", postLabel: t("action.postNeed") },
          ] as const).map((sec) => (
            <section key={sec.key} aria-label={sec.title} className="min-w-0">
              <SectionTitle
                title={sec.title}
                sub={sec.sub}
                action={<Link to="/explore" className={cn("inline-flex items-center gap-1 font-semibold text-[#541B2B] link-underline", focusRing)}>{t("common.viewAll")}</Link>}
              />
              {sec.items.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-[13.5px] text-slate-500">{sec.empty}</p>
                  <LinkButton to={sec.post} variant="link" size="sm" className="mt-2">{sec.postLabel}</LinkButton>
                </div>
              ) : (
                <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3">
                  {sec.items.map(({ listing, owner }) => (
                    <li key={listing.id}>
                      <ListingCard listing={listing} owner={owner} saved={saved.data?.has(listing.id) ?? false} showOwner={false} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {/* Smart matches */}
      <section aria-label={t("dash.recommended")}>
        <SectionTitle
          title={t("dash.recommended")}
          sub={t("mt.subtitle")}
          action={<Link to="/matches" className={cn("inline-flex items-center gap-1 font-semibold text-[#541B2B] link-underline", focusRing)}>{t("dash.viewAllMatches")}</Link>}
        />
        {matches.error ? (
          <ErrorState message={matches.error} />
        ) : !matches.data ? (
          <div className="space-y-4">{[0, 1].map((i) => <Skeleton key={i} className="h-36" />)}</div>
        ) : top.length === 0 ? (
          <EmptyState
            icon={Users}
            title={matches.data.hasListings ? t("dash.noMatchesTitle") : t("dash.noListingsTitle")}
            body={matches.data.hasListings ? t("dash.noMatchesBody") : t("dash.noListingsBody")}
            className="border-t-0"
          >
            <LinkButton to="/offers/new" icon={PlusCircle}>{t("action.createOffer")}</LinkButton>
            <LinkButton to="/needs/new" variant="link" icon={ClipboardList}>{t("action.postNeed")}</LinkButton>
          </EmptyState>
        ) : (
          <div>
            {top.map((c) => (
              <MatchPersonCard key={c.userId} c={c} member={matches.data!.members.get(c.userId)!} onPropose={() => setPropose(c)} />
            ))}
          </div>
        )}
      </section>

      {/* Recently added — varied proportions */}
      {community.data && community.data.recent.length > 0 && (
        <section aria-label={t("explore.recent")}>
          <SectionTitle
            title={t("explore.recent")}
            action={<Link to="/explore" className={cn("inline-flex items-center gap-1 font-semibold text-[#541B2B] link-underline", focusRing)}>{t("common.viewAll")}</Link>}
          />
          <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {community.data.recent.map(({ listing, owner }, idx) => (
              <li key={listing.id} className={cn(idx === 0 && "sm:col-span-2 lg:col-span-1 lg:row-span-1")}>
                <ListingCard listing={listing} owner={owner} saved={saved.data?.has(listing.id) ?? false} highlight={idx === 0 ? ago(listing.createdAt) : undefined} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Categories */}
      <section aria-label={t("dash.categories")}>
        <SectionTitle title={t("dash.categories")} />
        <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] sm:mx-0 sm:px-0">
          {CATEGORIES.filter((c) => c !== "Other").map((c) => (
            <Link key={c} to={`/explore?cat=${encodeURIComponent(c)}`} className={cn("group w-[150px] shrink-0", focusRing)}>
              <span className="img-fallback block aspect-[3/4] overflow-hidden">
                <img src={categoryImage(c, 300, 400)} alt="" loading="lazy" decoding="async" width={150} height={200} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
              </span>
              <span className="mt-2 block text-[12.5px] font-semibold text-[#29232A] group-hover:text-[#541B2B]">{t(L.cat(c))}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Activity */}
      <section aria-label={t("dash.recentActivity")} className="grid gap-x-12 gap-y-10 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0">
          <SectionTitle
            title={t("dash.recentActivity")}
            action={<Link to="/exchange" className={cn("font-semibold text-[#541B2B] link-underline", focusRing)}>{t("common.viewAll")}</Link>}
          />
          {activity.error ? (
            <ErrorState message={activity.error} />
          ) : !activity.data?.length ? (
            <p className="py-6 text-[13.5px] text-slate-500">{t("dash.noActivityBody")}</p>
          ) : (
            <ul>
              {activity.data.map((e) => {
                const I = EVENT_ICON[e.type];
                return (
                  <li key={e.id} className="border-b border-[#E9DFDC] last:border-0">
                    <Link to={e.exchangeId ? `/collaborations/${e.exchangeId}` : "/reviews"} className={cn("flex items-baseline gap-3 py-3 transition-colors hover:text-[#541B2B]", focusRing)}>
                      <I className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-[#8a3b44]" aria-hidden strokeWidth={1.75} />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-slate-700">{dyn(t, e.key, e.vars, e.text)}</span>
                      <time dateTime={e.createdAt} className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-slate-400">{ago(e.createdAt)}</time>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="min-w-0">
          <SectionTitle title={t("dash.howTitle")} />
          <p className="text-[13.5px] leading-relaxed text-slate-600">{t("dash.howBody")}</p>
          <figure className="mt-4 border-l-2 border-[#E8A6A1] pl-4">
            <figcaption className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#8a3b44]">{t("dash.example")}</figcaption>
            <p className="mt-1 text-[13.5px] leading-relaxed text-slate-600">{t("dash.howExample")}</p>
          </figure>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
            <LinkButton to="/matches" variant="link" size="sm" icon={Handshake}>{t("dash.findMatches")}</LinkButton>
            <LinkButton to="/collaborations" variant="link" size="sm" icon={Users}>{t("action.viewCollaborations")}</LinkButton>
          </div>
        </aside>
      </section>

      {propose && matches.data && (
        <ProposeExchangeDialog
          open
          onClose={() => setPropose(null)}
          recipient={matches.data.members.get(propose.userId)!}
          listing={propose.theyHelpMe[0]?.offer ?? undefined}
          suggestedProvide={propose.iHelpThem[0] ? `${propose.iHelpThem[0].offer.title}: ${propose.iHelpThem[0].offer.details}` : undefined}
        />
      )}
    </div>
  );
}
