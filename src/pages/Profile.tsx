import { useEffect, useState } from "react";
import { BadgeCheck, Briefcase, CalendarDays, ClipboardList, Clock, EyeOff, ExternalLink, Globe, HandHeart, Handshake, Languages, MapPin, Pencil, PlusCircle, Settings, ShieldBan, Star, UserX } from "lucide-react";
import { cn } from "@/utils/cn";
import { getMe, getPublicProfile, getSavedIds } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { L, useI18n, type Key } from "@/lib/i18n";
import { useLocation } from "@/lib/router";
import type { Profile } from "@/lib/types";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, LinkButton, Spinner, Tabs, focusRing } from "@/components/ui";
import { TrustBadges, TrustLevel } from "@/components/trust";
import { ProfileReviews } from "@/components/ProfileReviews";
import { ConnectionActions } from "@/components/ConnectionActions";
import { ListingCard, MessageButton, ProposeExchangeDialog } from "@/components/listing";

export function profileCompletion(p: Profile) {
  const checks: { ok: boolean; key: Key }[] = [
    { ok: !!p.avatar, key: "pf.c.photo" },
    { ok: p.bio.length >= 20, key: "pf.c.bio" },
    { ok: !!p.occupation, key: "pf.c.occupation" },
    { ok: !!p.location, key: "pf.c.location" },
    { ok: p.skills.length > 0, key: "pf.c.skill" },
    { ok: p.languages.length > 0, key: "pf.c.languages" },
    { ok: !!p.availability, key: "pf.c.availability" },
    { ok: p.collabTypes.length > 0 || p.interests.length > 0, key: "pf.c.interests" },
  ];
  return { pct: Math.round((checks.filter((c) => c.ok).length / checks.length) * 100), missing: checks.filter((c) => !c.ok).map((c) => c.key) };
}

export function PublicProfile({ username }: { username: string }) {
  const { t, tn, num, date } = useI18n();
  const { query } = useLocation();
  const showReviews = query.get("tab") === "reviews";
  const res = useQuery(() => getPublicProfile(username), [username]);
  const me = useQuery(() => getMe());
  const saved = useQuery(() => getSavedIds());
  const [tab, setTab] = useState<"offers" | "needs" | "reviews">(showReviews ? "reviews" : "offers");
  useEffect(() => { if (showReviews) setTab("reviews"); }, [showReviews]);
  const [propose, setPropose] = useState(false);

  if (res.error) return <ErrorState message={res.error} onRetry={res.refetch} />;
  if (res.data === undefined) return <Spinner />;
  if (res.data === null)
    return (
      <EmptyState icon={UserX} title={t("pf.notFoundTitle")} body={t("pf.notFoundBody")}>
        <LinkButton to="/explore">{t("nav.explore")}</LinkButton>
      </EmptyState>
    );
  const { profile: p, isMe, member, offers, needs, reviews, rating, completedExchanges, blocked } = res.data;
  const completion = isMe && me.data ? profileCompletion(me.data.profile) : null;
  const vis = me.data?.profile.visibility;
  const first = p.fullName.split(" ")[0];
  const hiddenIcon = <EyeOff className="h-3.5 w-3.5 text-slate-400" aria-label={t("pf.hidden")} />;

  return (
    <div className="mx-auto max-w-6xl">
      <Card className="overflow-hidden border-x-0 border-t-0">
        <div className="relative h-44 bg-[#541B2B] sm:h-64">
          {p.cover && <img src={p.cover} alt="" className="h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" aria-hidden />
        </div>
        <div className="px-5 pb-6 sm:px-8">
          <div className="relative z-10 -mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
            <Avatar name={p.fullName} src={p.avatar} size={104} className="ring-4" />
            <div className="flex flex-wrap gap-2">
              {isMe ? (
                <>
                  <LinkButton to="/profile/edit" icon={Pencil}>{t("pf.edit")}</LinkButton>
                  <LinkButton to="/settings" variant="secondary" icon={Settings}>{t("nav.settings")}</LinkButton>
                </>
              ) : blocked ? (
                <Badge tone="slate" icon={ShieldBan}>{t("pf.unavailable")}</Badge>
              ) : (
                <>
                  <ConnectionActions userId={member.userId} fullName={member.fullName} />
                  <Button icon={Handshake} onClick={() => setPropose(true)}>{t("common.proposeExchange")}</Button>
                  <MessageButton userId={member.userId} />
                  <Button variant="link" icon={Star} onClick={() => setTab("reviews")}>{t("rv.title")}</Button>
                </>
              )}
            </div>
          </div>
          <div className="mt-4 min-w-0">
            <h1 className="display break-words text-[34px] font-semibold text-[#541B2B]">{p.fullName}</h1>
            <p className="break-words text-sm text-slate-500">@{p.username}{p.occupation && <> · <span className="text-slate-700">{p.occupation}</span></>}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-500">
              {p.location && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{p.location}{isMe && !vis?.location && hiddenIcon}</span>}
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{t("pf.memberSince", { date: date(p.createdAt) })}</span>
              {p.languages.length > 0 && <span className="inline-flex items-center gap-1.5"><Languages className="h-4 w-4" />{p.languages.join(", ")}</span>}
              {p.availability && <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" />{p.availability}</span>}
            </div>
            {(res.data?.verification?.trust !== "new" || res.data?.verification?.completedExchanges > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <TrustLevel trust={res.data!.verification!.trust} />
                <TrustBadges v={res.data!.verification!} />
              </div>
            )}
            {p.roles.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{p.roles.map((r) => <Badge key={r} tone="green" icon={Briefcase}>{r}</Badge>)}</div>}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: t("pf.stat.offers"), value: num(offers.length), icon: HandHeart },
              { label: t("pf.stat.needs"), value: num(needs.length), icon: ClipboardList },
              { label: t("pf.stat.completed"), value: num(completedExchanges), icon: BadgeCheck },
              { label: rating.count ? tn("count.reviews", rating.count) : t("pf.noReviews"), value: rating.average !== null ? num(rating.average) : "—", icon: Star },
            ].map((s) => (
              <div key={s.label} className="border-l border-[#E9DFDC] px-3 py-1">
                <p className="display flex items-center gap-1.5 text-[26px] font-semibold tabular-nums text-[#541B2B]"><s.icon className="h-4 w-4 text-[#8a3b44]" strokeWidth={1.75} />{s.value}</p>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          {completion && completion.pct < 100 && (
            <Card className="p-5">
              <div className="flex items-center justify-between text-sm"><span className="font-semibold text-slate-900">{t("pf.completion")}</span><span className="font-semibold text-emerald-700">{num(completion.pct)}%</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={completion.pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("pf.completion")}><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-500" style={{ width: `${completion.pct}%` }} /></div>
              <p className="mt-3 text-xs text-slate-500">{t("pf.add", { items: completion.missing.map((k) => t(k)).join(", ") })}</p>
              <LinkButton to="/profile/edit" size="sm" variant="soft" className="mt-3">{t("pf.complete")}</LinkButton>
            </Card>
          )}
          <Card className="p-5">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">{t("pf.about")} {isMe && !vis?.bio && hiddenIcon}</h2>
            <p className="whitespace-pre-line break-words text-sm text-slate-600">{p.bio || <span className="text-slate-400">{isMe ? t("pf.addBio") : t("pf.noBio")}</span>}</p>
            {p.collabTypes.length > 0 && <><p className="mt-4 text-xs font-semibold text-slate-500">{t("pf.openTo")}</p><div className="mt-1 flex flex-wrap gap-1">{p.collabTypes.map((c) => <span key={c} className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">{t(L.collab(c))}</span>)}</div></>}
            {p.interests.length > 0 && <><p className="mt-3 text-xs font-semibold text-slate-500">{t("pf.interests")}</p><div className="mt-1 flex flex-wrap gap-1">{p.interests.map((c) => <span key={c} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{c}</span>)}</div></>}
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">{t("pf.skills")} {isMe && !vis?.skills && hiddenIcon}</h2>
            {p.skills.length === 0 ? (
              <p className="text-sm text-slate-400">{isMe ? t("pf.noSkillsMe") : t("pf.noSkills")}</p>
            ) : (
              <ul className="space-y-2.5">
                {p.skills.map((s) => (
                  <li key={s.id}>
                    <div className="flex flex-wrap items-center gap-1.5"><span className="break-words text-sm font-medium text-slate-800">{s.name}</span><Badge tone="slate">{t(L.cat(s.category))}</Badge>{s.level && <Badge tone="green">{t(L.level(s.level))}</Badge>}</div>
                    {s.description && <p className="mt-0.5 break-words text-xs text-slate-500">{s.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {p.portfolio.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">{t("pf.portfolio")} {isMe && !vis?.portfolio && hiddenIcon}</h2>
              <div className="grid grid-cols-2 gap-2">
                {p.portfolio.map((it) => (
                  <div key={it.id} className="overflow-hidden rounded-xl border border-slate-100">
                    {it.image && <img src={it.image} alt={it.title} className="aspect-square w-full object-cover" loading="lazy" />}
                    <div className="p-2">
                      <p className="truncate text-xs font-medium text-slate-700">{it.title}</p>
                      {it.link && <a href={it.link} target="_blank" rel="noopener noreferrer nofollow" className={cn("inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:underline", focusRing)}><ExternalLink className="h-3 w-3" />{t("pf.link")}</a>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="min-w-0">
          <Tabs label={t("pf.sections")} value={tab} onChange={setTab} className="mb-4" tabs={[{ value: "offers", label: t("common.offers"), count: offers.length }, { value: "needs", label: t("common.needs"), count: needs.length }, { value: "reviews", label: t("rv.title"), count: reviews.length }]} />
          {tab !== "reviews" ? (
            (tab === "offers" ? offers : needs).length === 0 ? (
              <EmptyState
                icon={tab === "offers" ? HandHeart : ClipboardList}
                title={t(tab === "offers" ? "pf.noPublicOffers" : "pf.noPublicNeeds")}
                body={isMe ? t(tab === "offers" ? "pf.myOffersHint" : "pf.myNeedsHint") : t(tab === "offers" ? "pf.theirOffersHint" : "pf.theirNeedsHint", { name: first })}
              >
                {isMe && <LinkButton to={tab === "offers" ? "/offers/new" : "/needs/new"} icon={PlusCircle}>{t(tab === "offers" ? "action.createOffer" : "action.postNeed")}</LinkButton>}
              </EmptyState>
            ) : (
              <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">{(tab === "offers" ? offers : needs).map((l) => <ListingCard key={l.id} listing={l} showOwner={false} saved={isMe ? undefined : saved.data?.has(l.id) ?? false} />)}</div>
            )
          ) : <ProfileReviews key={member.userId} member={member} reviews={reviews} rating={rating} isMe={isMe} />}
          {isMe && <p className="mt-6 flex items-start gap-1.5 text-xs text-slate-400"><Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t("pf.privacyNote")}</p>}
        </div>
      </div>
      {propose && <ProposeExchangeDialog open onClose={() => setPropose(false)} recipient={member} />}
    </div>
  );
}

export default function MyProfile() {
  const me = useQuery(() => getMe());
  if (me.error) return <ErrorState message={me.error} />;
  if (!me.data) return <Spinner />;
  return <PublicProfile username={me.data.profile.username} />;
}
