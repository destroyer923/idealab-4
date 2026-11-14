import { useMemo, useState } from "react";
import { ArrowRight, Bookmark, BookmarkCheck, Clock, HandHeart, Loader2, MapPin, MessageCircle, Search, Send } from "lucide-react";
import { cn } from "@/utils/cn";
import { Link, navigate } from "@/lib/router";
import { useQuery } from "@/lib/hooks";
import { getMyListings, openConversation, proposeExchange, toggleSave } from "@/lib/api";
import { LIMITS } from "@/lib/constants";
import { L, useI18n, useT } from "@/lib/i18n";
import { categoryImage } from "@/lib/images";
import type { Listing, PublicMember } from "@/lib/types";
import { Avatar, Badge, Button, Field, Input, Modal, Select, Textarea, errMsg, focusRing, toast, type Tone } from "./ui";
import { TrustBadges } from "./trust";

export const kindTone = (k: Listing["kind"]): Tone => (k === "offer" ? "green" : "amber");

export function StatusBadge({ listing: l }: { listing: Listing }) {
  const t = useT();
  const tone: Tone = ["active", "open"].includes(l.status) ? "green" : l.status === "matched" ? "sky" : l.status === "in_progress" ? "violet" : l.status === "fulfilled" ? "lime" : l.status === "draft" ? "slate" : "amber";
  return <Badge tone={tone}>{t(L.status(l.kind, l.status))}</Badge>;
}

export function KindBadge({ kind, className }: { kind: Listing["kind"]; className?: string }) {
  const t = useT();
  return <span className={cn("inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]", kind === "offer" ? "bg-[#541B2B] text-white" : "bg-[#A45A16] text-white", className)}>{t(kind === "offer" ? "listing.offer" : "listing.need")}</span>;
}

export function SaveButton({ listingId, saved, className, withLabel }: { listingId: string; saved: boolean; className?: string; withLabel?: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const label = saved ? t("listing.unsave") : t("listing.save");
  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={saved}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setBusy(true);
        try {
          const now = toggleSave(listingId);
          toast.success(
            now ? t("listing.savedToast") : t("listing.removedToast"),
            now
              ? undefined
              : {
                  label: t("common.undo"),
                  run: () => {
                    try {
                      toggleSave(listingId);
                    } catch (er) {
                      toast.error(errMsg(er));
                    }
                  },
                }
          );
        } catch (er) {
          toast.error(errMsg(er));
        } finally {
          setBusy(false);
        }
      }}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold transition-colors",
        focusRing,
        withLabel ? "h-10 border px-3" : "h-8 w-8",
        saved ? "bg-[#541B2B] text-white" : "bg-white/90 text-[#541B2B] hover:bg-white",
        withLabel && (saved ? "border-[#541B2B]" : "border-[#541B2B]/30"),
        className
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
      {withLabel && (saved ? t("listing.saved") : t("listing.saveShort"))}
    </button>
  );
}

export function MessageButton({ userId, contextType = "none", contextId, label, size = "md", variant = "secondary", className }: { userId: string; contextType?: "none" | "listing" | "exchange"; contextId?: string; label?: string; size?: "sm" | "md"; variant?: "secondary" | "soft" | "ghost"; className?: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      icon={MessageCircle}
      loading={busy}
      className={className}
      onClick={async (e) => {
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        try {
          const id = await openConversation(userId, contextType, contextId);
          navigate(`/messages/${id}`);
        } catch (er) {
          toast.error(errMsg(er));
          setBusy(false);
        }
      }}
    >
      {label ?? t("common.message")}
    </Button>
  );
}

export function ListingCard({ listing, owner, saved, showOwner = true, footer, onOpen, highlight }: { listing: Listing; owner?: PublicMember | null; saved?: boolean; showOwner?: boolean; footer?: React.ReactNode; onOpen?: () => void; highlight?: string }) {
  const { t, ago } = useI18n();
  const isOffer = listing.kind === "offer";
  const open = onOpen ?? (() => navigate(`/listing/${listing.id}`));
  return (
    <article className="group relative flex h-full flex-col">
      <div className="img-fallback relative aspect-[4/3] overflow-hidden bg-[#F5EDE9]">
        <ListingImage listing={listing} className="transition-transform duration-700 ease-[cubic-bezier(.2,.7,.2,1)] group-hover:scale-[1.04]" />
        {highlight && <span className="absolute left-0 top-0 bg-[#541B2B] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-white">{highlight}</span>}
        {saved !== undefined && (
          <div className="absolute right-0 top-0">
            <SaveButton listingId={listing.id} saved={saved} />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col pt-3">
        <p className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em]">
          <span className={isOffer ? "text-[#541B2B]" : "text-[#A45A16]"}>{t(isOffer ? "listing.offer" : "listing.need")}</span>
          <span className="h-2.5 w-px bg-[#E9DFDC]" aria-hidden />
          <span className="truncate text-slate-500">{t(L.cat(listing.category))}</span>
        </p>
        <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-[#29232A]">
          <button onClick={open} className={cn("line-clamp-2 break-words text-left after:absolute after:inset-0 group-hover:text-[#541B2B] group-hover:underline group-hover:decoration-[#E8A6A1] group-hover:decoration-2 group-hover:underline-offset-4", focusRing)}>
            {listing.title}
          </button>
        </h3>
        <p className="mt-1.5 line-clamp-2 break-words text-[13px] leading-relaxed text-slate-500">{listing.details || listing.description}</p>

        {(listing.location || listing.availability) && (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-500">
            {listing.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden />{listing.location}</span>}
            {listing.availability && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden />{listing.availability}</span>}
          </p>
        )}

        <div className="mt-auto pt-3">
          {showOwner && owner && (
            <div className="relative z-10 flex items-center gap-2 border-t border-[#E9DFDC] pt-2.5">
              <Avatar name={owner.fullName} src={owner.avatar} size={22} />
              <div className="min-w-0 flex-1 text-[12px]">
                {owner.username ? (
                  <Link to={`/u/${owner.username}`} className={cn("truncate font-medium text-slate-700 hover:text-[#541B2B]", focusRing)}>{owner.fullName}</Link>
                ) : (
                  <span className="truncate text-slate-500">{owner.fullName}</span>
                )}
                <span className="text-slate-400"> · {owner.occupation || ago(listing.createdAt)}</span>
                {owner.verification && (
                  <TrustBadges v={owner.verification} className="mt-1" spacing="gap-x-2" />
                )}
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#541B2B]" aria-hidden />
            </div>
          )}
          {footer && <div className="relative z-10">{footer}</div>}
        </div>
      </div>
    </article>
  );
}

/** Listing photo, or a labelled category photo when the member hasn't uploaded one. */
export function ListingImage({ listing, className, w = 640, h = 340 }: { listing: Listing; className?: string; w?: number; h?: number }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const own = listing.images[0];
  if (failed) return <div className="img-fallback grid h-full w-full place-items-center">{listing.kind === "offer" ? <HandHeart className="h-8 w-8 text-[#E8A6A1]" aria-hidden /> : <Search className="h-8 w-8 text-[#E8A6A1]" aria-hidden />}</div>;
  return (
    <>
      <img src={own ?? categoryImage(listing.category, w, h)} alt="" width={w} height={h} loading="lazy" decoding="async" onError={() => setFailed(true)} className={cn("h-full w-full object-cover", className)} />
      {!own && <span className="absolute bottom-2 right-2 rounded-md bg-[#29232A]/55 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">{t("car.illustrative")}</span>}
    </>
  );
}

export function ListingThumb({ listing }: { listing: Listing }) {
  return (
    <div className="img-fallback relative h-full w-full overflow-hidden">
      <ListingImage listing={listing} w={240} h={240} />
    </div>
  );
}

/* Propose exchange ----------------------------------------------------- */

export function ProposeExchangeDialog({ open, onClose, recipient, listing, suggestedProvide, suggestedReceive }: { open: boolean; onClose: () => void; recipient: PublicMember; listing?: Listing; suggestedProvide?: string; suggestedReceive?: string }) {
  const t = useT();
  const { data: myOffers } = useQuery(async () => (open ? (await getMyListings("offer")).filter((l) => l.status === "active") : []), [open]);
  const initial = useMemo(() => {
    if (!listing) return { provide: suggestedProvide ?? "", receive: suggestedReceive ?? "" };
    return listing.kind === "offer"
      ? { provide: suggestedProvide ?? "", receive: suggestedReceive ?? listing.details }
      : { provide: suggestedProvide ?? listing.details, receive: suggestedReceive ?? listing.exchangePref };
  }, [listing, suggestedProvide, suggestedReceive]);
  const [offeredId, setOfferedId] = useState("");
  const [provide, setProvide] = useState(initial.provide);
  const [receive, setReceive] = useState(initial.receive);
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentId, setSentId] = useState<string | null>(null);
  const first = recipient.fullName.split(" ")[0];

  const close = () => {
    setSentId(null);
    setError("");
    onClose();
  };

  return (
    <Modal open={open} onClose={close} size="lg" title={t("propose.title", { name: recipient.fullName })} description={listing ? t("propose.about", { title: listing.title }) : t("propose.generic")}>
      {sentId ? (
        <div className="py-4 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-700">
            <Send className="h-5 w-5" />
          </div>
          <p className="font-semibold text-slate-900">{t("propose.sentTitle")}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{t("propose.sentBody", { name: recipient.fullName })}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="secondary" onClick={close}>{t("common.close")}</Button>
            <Button onClick={() => navigate(`/exchange/${sentId}`)}>{t("propose.viewRequest")}</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            if (!provide.trim() && !receive.trim()) return setError(t("err.proposalEmpty"));
            setBusy(true);
            try {
              const x = proposeExchange({ recipientId: recipient.userId, listingId: listing?.id, offeredListingId: offeredId || undefined, iProvide: provide, iReceive: receive, message, targetDate: target });
              toast.success(t("propose.sentToast"));
              setSentId(x.id);
            } catch (er) {
              setError(errMsg(er));
            } finally {
              setBusy(false);
            }
          }}
        >
          {(myOffers?.length ?? 0) > 0 && (
            <Field label={t("propose.linkOffer")} htmlFor="px-offer" hint={t("propose.linkOfferHint")}>
              <Select
                id="px-offer"
                value={offeredId}
                onChange={(e) => {
                  setOfferedId(e.target.value);
                  const o = myOffers?.find((x) => x.id === e.target.value);
                  if (o) setProvide(`${o.title}: ${o.details}`);
                }}
              >
                <option value="">{t("common.none")}</option>
                {myOffers?.map((o) => (
                  <option key={o.id} value={o.id}>{o.title}</option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("propose.provide")} htmlFor="px-provide" count={provide.length} max={LIMITS.details} hint={t("propose.provideHint")}>
              <Textarea id="px-provide" value={provide} onChange={(e) => setProvide(e.target.value)} placeholder={t("propose.providePh")} />
            </Field>
            <Field label={t("propose.receive", { name: first })} htmlFor="px-receive" count={receive.length} max={LIMITS.details} hint={t("propose.receiveHint")}>
              <Textarea id="px-receive" value={receive} onChange={(e) => setReceive(e.target.value)} placeholder={t("propose.receivePh")} />
            </Field>
          </div>
          <Field label={t("propose.message")} htmlFor="px-msg" count={message.length} max={LIMITS.message}>
            <Textarea id="px-msg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("propose.messagePh")} />
          </Field>
          <Field label={t("propose.targetDate")} htmlFor="px-date">
            <Input id="px-date" type="date" min={new Date().toISOString().slice(0, 10)} value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="secondary" onClick={close}>{t("common.cancel")}</Button>
            <Button type="submit" loading={busy} icon={Send}>{t("propose.send")}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
