import { useState } from "react";
import { ArrowLeft, Ban, CalendarDays, Clock, Handshake, Inbox, Layers, MapPin, Pencil, RefreshCw, Tag, Wifi } from "lucide-react";
import { getListing, getListingResponses, getSavedIds } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { L, useI18n } from "@/lib/i18n";
import { Link } from "@/lib/router";
import { cn } from "@/utils/cn";
import { Avatar, Button, Card, EmptyState, ErrorState, LinkButton, errMsg, focusRing, toast } from "@/components/ui";
import { TrustBadges } from "@/components/trust";
import { resubmitListing, listingReviewReason } from "@/lib/api";
import { KindBadge, MessageButton, ProposeExchangeDialog, SaveButton, StatusBadge } from "@/components/listing";
import { ExchangeStatusBadge } from "./Exchange";

export default function ListingDetail({ id }: { id: string }) {
  const { t, ago, date } = useI18n();
  const res = useQuery(() => getListing(id), [id]);
  const saved = useQuery(() => getSavedIds());
  const responses = useQuery(() => (res.data?.isOwner ? getListingResponses(id) : []), [id, res.data?.isOwner]);
  const [img, setImg] = useState(0);
  const [propose, setPropose] = useState(false);

  if (res.error) return <ErrorState message={res.error} />;
  if (!res.data || !res.data.listing) {
    const closed = res.data?.unavailable === "closed";
    return (
      <EmptyState icon={Ban} title={closed ? t("listing.unavailableTitle") : t("listing.notFoundTitle")} body={closed ? t("listing.unavailableBody") : t("listing.notFoundBody")}>
        <LinkButton to="/explore">{t("nav.explore")}</LinkButton>
      </EmptyState>
    );
  }

  const { listing: l, owner, isOwner } = res.data;
  const back = isOwner ? (l.kind === "offer" ? "/offers" : "/needs") : "/explore";
  const isOffer = l.kind === "offer";

  return (
    <div className="mx-auto max-w-5xl">
      <Link to={back} className={cn("mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-emerald-700", focusRing)}>
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <Card className="overflow-hidden">
            {l.images.length > 0 && (
              <div>
                <img src={l.images[img]} alt={t("listing.imageAlt", { title: l.title, n: img + 1 })} className="aspect-[16/9] w-full object-cover" />
                {l.images.length > 1 && (
                  <div className="flex gap-2 p-3">
                    {l.images.map((src, i) => (
                      <button key={i} onClick={() => setImg(i)} aria-label={t("listing.showImage", { n: i + 1 })} aria-pressed={i === img} className={cn("h-14 w-20 overflow-hidden rounded-lg ring-2", i === img ? "ring-emerald-500" : "ring-transparent", focusRing)}>
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="p-6">
              <div className="flex flex-wrap items-center gap-2">
                <KindBadge kind={l.kind} />
                {isOwner && <StatusBadge listing={l} />}
                <span className="text-xs text-slate-400">{t(L.cat(l.category))} · {t(L.type(l.type))}</span>
              </div>
              <h1 className="display mt-2 break-words text-[34px] font-semibold text-[#541B2B]">{l.title}</h1>
              <p className="mt-3 whitespace-pre-line break-words text-sm leading-relaxed text-slate-600">{l.description}</p>

              {l.status === "pending_review" && (
                <div className="mt-4 border-l-2 border-[#A45A16] bg-[#A45A16]/5 p-4 text-sm text-[#A45A16]">
                  {t("verify.listingReviewing")}
                  {listingReviewReason(l) && <> — {t(listingReviewReason(l)!.key, listingReviewReason(l)!.vars)}</>}
                </div>
              )}
              {l.status === "rejected" && (
                <div className="mt-4 border-l-2 border-[#B42335] bg-[#B42335]/5 p-4 text-sm text-[#B42335]">
                  {t("verify.listingRejected")}
                  {listingReviewReason(l)?.vars?.reason && <> — {t("verify.listingRejectedDetail", { reason: listingReviewReason(l)!.vars!.reason })}</>}
                  {isOwner && (
                    <div className="mt-2">
                      <Button size="sm" variant="soft" icon={RefreshCw} onClick={() => { try { resubmitListing(l.id); toast.success(t("ml.resubmit")); } catch (e) { toast.error(errMsg(e)); } }}>{t("ml.resubmit")}</Button>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className={cn("border-l-2 p-4", isOffer ? "border-[#541B2B] bg-[#FFF8F0]" : "border-[#A45A16] bg-amber-50/60")}>
                  <p className={cn("text-[11px] font-semibold uppercase tracking-wide", isOffer ? "text-emerald-700" : "text-amber-700")}>{t(isOffer ? "listing.theyProvide" : "listing.theyNeed")}</p>
                  <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{l.details}</p>
                </div>
                <div className="border-l-2 border-[#E9DFDC] bg-[#FFF8F0] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t(isOffer ? "listing.inReturn" : "listing.canOffer")}</p>
                  <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{l.exchangePref || <span className="text-slate-400">{t("common.notSpecified")}</span>}</p>
                </div>
              </div>
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                {[
                  { i: MapPin, k: t("listing.field.location"), v: l.location },
                  { i: Wifi, k: t("listing.field.mode"), v: l.mode ? t(L.mode(l.mode)) : "" },
                  { i: Clock, k: t("listing.field.availability"), v: l.availability },
                  { i: Layers, k: t("listing.field.quantity"), v: l.quantity },
                  { i: CalendarDays, k: t("listing.field.posted"), v: date(l.createdAt) },
                ]
                  .filter((x) => x.v)
                  .map(({ i: I, k, v }) => (
                    <div key={k} className="flex items-start gap-2">
                      <I className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      <div className="min-w-0"><dt className="text-xs text-slate-400">{k}</dt><dd className="break-words text-slate-700">{v}</dd></div>
                    </div>
                  ))}
              </dl>
              {l.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  {l.tags.map((tag) => <span key={tag} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">#{tag}</span>)}
                </div>
              )}
            </div>
          </Card>

          {isOwner && (
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><Inbox className="h-4 w-4 text-emerald-600" /> {t("listing.responses")}</h2>
              {!responses.data?.length ? (
                <p className="text-sm text-slate-500">
                  {t("listing.noResponses")} <Link to="/matches" className="font-medium text-emerald-700 hover:underline">{t("listing.checkMatches")}</Link>
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {responses.data.map(({ exchange: x, other }) => (
                    <li key={x.id}>
                      <Link to={`/exchange/${x.id}`} className={cn("flex flex-wrap items-center gap-3 py-3 hover:bg-slate-50/60", focusRing)}>
                        <Avatar name={other.fullName} src={other.avatar} size={34} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{other.fullName}</p>
                          <p className="truncate text-xs text-slate-500">{x.message || x.commitments[0].description}</p>
                        </div>
                        <ExchangeStatusBadge status={x.status} />
                        <span className="text-xs text-slate-400">{ago(x.createdAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {owner && (
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <Avatar name={owner.fullName} src={owner.avatar} size={48} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{owner.fullName}</p>
                  <p className="truncate text-sm text-slate-500">{owner.occupation || (owner.username ? `@${owner.username}` : "")}</p>
                  {owner.location && <p className="flex items-center gap-1 text-xs text-slate-400"><MapPin className="h-3 w-3" />{owner.location}</p>}
              {owner.verification && <TrustBadges v={owner.verification} className="mt-2" />}
              {owner.verification && <TrustBadges v={owner.verification} className="mt-2" />}
                </div>
              </div>
              {owner.username && <LinkButton to={`/u/${owner.username}`} variant="secondary" size="sm" className="mt-4 w-full">{t("common.viewProfile")}</LinkButton>}
            </Card>
          )}
          <Card className="space-y-2 p-5">
            {isOwner ? (
              <>
                <p className="text-sm text-slate-500">{t("listing.yours")}</p>
                <LinkButton to={`/${isOffer ? "offers" : "needs"}/${l.id}/edit`} icon={Pencil} className="w-full">{t("listing.edit")}</LinkButton>
              </>
            ) : (
              <>
                <Button icon={Handshake} className="w-full" onClick={() => setPropose(true)}>{t("common.proposeExchange")}</Button>
                <MessageButton userId={l.ownerId} contextType="listing" contextId={l.id} label={t("common.messageOwner")} className="w-full" />
                <SaveButton listingId={l.id} saved={saved.data?.has(l.id) ?? false} withLabel className="w-full" />
                <p className="pt-1 text-xs text-slate-400">{t("listing.proposalNote")}</p>
              </>
            )}
          </Card>
        </aside>
      </div>
      {propose && owner && <ProposeExchangeDialog open onClose={() => setPropose(false)} recipient={owner} listing={l} />}
    </div>
  );
}
