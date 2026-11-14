import { useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Circle, ImagePlus, Loader2, Save, Send, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { cn } from "@/utils/cn";
import {
  createListing, getListing, updateListing, validateListing, type ListingInput,
} from "@/lib/api";
import { getPublishEligibility, getVerification } from "@/lib/verification-api";
import { CATEGORIES, LIMITS, MODES, NEED_TYPES, OFFER_TYPES } from "@/lib/constants";
import { useQuery } from "@/lib/hooks";
import { L, useI18n, type Key } from "@/lib/i18n";
import { processImage } from "@/lib/format";
import { Link, navigate } from "@/lib/router";
import type { Listing, ListingKind } from "@/lib/types";
import { Button, Card, EmptyState, Field, Input, LinkButton, Select, Textarea, errMsg, focusRing, toast } from "@/components/ui";
import { TrustBadges, TrustLevel } from "@/components/trust";

const emptyInput = (): ListingInput => ({ title: "", category: "", type: "", description: "", details: "", exchangePref: "", location: "", availability: "", mode: "", quantity: "", tags: [], images: [] });

function Section({ n, title, desc, children }: { n: number; title: string; desc?: string; children: React.ReactNode }) {
  const { num } = useI18n();
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center bg-[#541B2B] text-xs font-semibold text-white">{num(n)}</span>
        <div className="min-w-0"><h2 className="text-sm font-semibold text-slate-900">{title}</h2>{desc && <p className="text-xs text-slate-500">{desc}</p>}</div>
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function Form({ kind, existing }: { kind: ListingKind; existing?: Listing }) {
  const { t, num } = useI18n();
  const isOffer = kind === "offer";
  const k = (offer: Key, need: Key) => t(isOffer ? offer : need);
  const [f, setF] = useState<ListingInput>(() => (existing ? { ...existing } : emptyInput()));
  const [tagText, setTagText] = useState(existing?.tags.join(", ") ?? "");
  const [businessClaimed, setBusinessClaimed] = useState(!!existing?.businessClaimed);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<null | "draft" | "publish">(null);
  const [imgBusy, setImgBusy] = useState(0);
  const [imgError, setImgError] = useState("");
  const [serverError, setServerError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof ListingInput>(key: K, v: ListingInput[K]) => setF((p) => ({ ...p, [key]: v }));
  const input = { ...f, tags: tagText.split(",").map((x) => x.trim()).filter(Boolean) };
  const errors = validateListing(kind, input);
  const err = (key: string) => {
    const e = touched ? errors[key] : undefined;
    return e ? t(e.key, e.vars && Object.fromEntries(Object.entries(e.vars).map(([a, b]) => [a, typeof b === "number" ? num(b) : b]))) : undefined;
  };
  const base = isOffer ? "/offers" : "/needs";
  const isDraft = !existing || existing.status === "draft";
  const verQuery = useQuery(getVerification, []);
  const eligibilityQuery = useQuery(() => getPublishEligibility(businessClaimed, f.category), [businessClaimed, f.category]);
  const eligibility = eligibilityQuery.data ?? { ok: false, required: [], missing: [] };

  const submit = async (publish: boolean) => {
    setTouched(true);
    setServerError("");
    if (Object.keys(errors).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    if (publish && !eligibility.ok) {
      setServerError(t("verify.err.publishBlocked", { steps: eligibility.missing.map((s) => t(s.key)).join(", ") }));
      return;
    }
    setBusy(publish ? "publish" : "draft");
    try {
      const withClaim = { ...input, businessClaimed };
      const saved = await (existing ? updateListing(existing.id, withClaim, publish) : createListing(kind, withClaim, publish));
      const pending = saved.status === "pending_review";
      toast.success(
        pending
          ? t("verify.listingReviewing")
          : existing
            ? (publish && isDraft ? t("lf.published") : t("lf.saved"))
            : publish ? k("lf.publishedOffer", "lf.publishedNeed")
            : t("lf.draftSaved")
      );
      navigate(publish || !existing ? `/listing/${saved.id}` : base);
    } catch (e) {
      setServerError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setImgError("");
    const room = LIMITS.imagesPerListing - f.images.length;
    const list = [...files].slice(0, room);
    if (files.length > room) setImgError(t("err.imagesMax", { n: num(LIMITS.imagesPerListing) }));
    for (const file of list) {
      setImgBusy((n) => n + 1);
      try {
        const data = await processImage(file);
        setF((p) => ({ ...p, images: [...p.images, data].slice(0, LIMITS.imagesPerListing) }));
      } catch (e) {
        setImgError(errMsg(e));
      } finally {
        setImgBusy((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const checklist = [
    { ok: !errors.title, label: t("lf.check.title") },
    { ok: !errors.category && !errors.type, label: t("lf.check.catType") },
    { ok: !errors.description, label: t("lf.check.desc") },
    { ok: !errors.details, label: k("lf.check.detailsOffer", "lf.check.detailsNeed") },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link to={base} className={cn("mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-emerald-700", focusRing)}><ArrowLeft className="h-4 w-4" /> {k("nav.offers", "nav.needs")}</Link>
      <h1 className="display text-[32px] font-semibold text-[#541B2B]">{existing ? k("lf.editOffer", "lf.editNeed") : k("lf.createOffer", "action.postNeed")}</h1>
      <p className="mb-6 mt-1 text-sm text-slate-500">{k("lf.offerIntro", "lf.needIntro")}</p>

      {/* Mandatory verification — the same rule the server enforces */}
      <Card className="border-l-2 border-l-[#E9DFDC] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a3b44]">{t("verify.eyebrow")}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <TrustLevel trust={verQuery.data?.verification.trust ?? "new"} />
              <TrustBadges
                v={{
                  phoneVerified: verQuery.data?.verification.phone.status === "verified",
                  emailVerified: verQuery.data?.verification.email.status === "verified",
                  businessVerified: verQuery.data?.verification.business.status === "verified",
                  identityVerified: verQuery.data?.verification.identity.status === "verified",
                  completedExchanges: verQuery.data?.verification.completedExchanges ?? 0,
                  trust: verQuery.data?.verification.trust ?? "new",
                }}
              />
            </div>

            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              {eligibility.required.map((step) => {
                const done = step.status === "verified";
                return (
                  <li key={step.channel} className="flex items-center gap-2">
                    {done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#26734D]" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-[#A45A16]" />}
                    <span className={cn("text-[12.5px]", done ? "text-slate-500" : "font-medium text-[#29232A]")}>
                      {t(step.key)}
                    </span>
                  </li>
                );
              })}
            </ul>

            {!eligibility.ok && (
              <p className="mt-2 text-[12.5px] text-[#A45A16]">
                {t("verify.publishBlockedNote", { steps: eligibility.missing.map((s) => t(s.key)).join(", ") })}
              </p>
            )}
          </div>
          <LinkButton to="/verification" variant="link" size="sm" icon={ShieldCheck}>{t("verify.formLink")}</LinkButton>
        </div>
      </Card>

      <form className="grid gap-6 lg:grid-cols-[1fr_300px]" onSubmit={(e) => { e.preventDefault(); void submit(true); }} noValidate>
        <div className="min-w-0 space-y-5">
          <Section n={1} title={t("lf.s1")}>
            <Field label={k("lf.offerTitle", "lf.needTitle")} htmlFor="lf-title" required error={err("title")} count={f.title.trim().length} max={LIMITS.title}>
              <Input id="lf-title" invalid={!!err("title")} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder={k("lf.titlePhOffer", "lf.titlePhNeed")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("listing.field.category")} htmlFor="lf-cat" required error={err("category")}>
                <Select id="lf-cat" invalid={!!err("category")} value={f.category} onChange={(e) => set("category", e.target.value)}>
                  <option value="">{t("lf.selectCategory")}</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t(L.cat(c))}</option>)}
                </Select>
              </Field>
              <Field label={k("lf.offerType", "lf.needType")} htmlFor="lf-type" required error={err("type")}>
                <Select id="lf-type" invalid={!!err("type")} value={f.type} onChange={(e) => set("type", e.target.value)}>
                  <option value="">{t("lf.selectType")}</option>
                  {(isOffer ? OFFER_TYPES : NEED_TYPES).map((c) => <option key={c} value={c}>{t(L.type(c))}</option>)}
                </Select>
              </Field>
            </div>
            <Field label={t("lf.description")} htmlFor="lf-desc" required error={err("description")} count={f.description.trim().length} max={LIMITS.description}>
              <Textarea id="lf-desc" invalid={!!err("description")} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder={k("lf.descPhOffer", "lf.descPhNeed")} />
            </Field>
          </Section>

          <Section n={2} title={k("lf.s2Offer", "lf.s2Need")} desc={k("lf.s2OfferDesc", "lf.s2NeedDesc")}>
            <Field label={k("lf.detailsOffer", "lf.detailsNeed")} htmlFor="lf-details" required error={err("details")} count={f.details.trim().length} max={LIMITS.details}>
              <Textarea id="lf-details" invalid={!!err("details")} value={f.details} onChange={(e) => set("details", e.target.value)} placeholder={k("lf.detailsPhOffer", "lf.detailsPhNeed")} className="min-h-[80px]" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("lf.quantity")} htmlFor="lf-qty" error={err("quantity")}>
                <Input id="lf-qty" value={f.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder={k("lf.qtyPhOffer", "lf.qtyPhNeed")} />
              </Field>
              <Field label={t("lf.tags")} htmlFor="lf-tags" hint={t("lf.tagsHint")}>
                <Input id="lf-tags" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder={t("lf.tagsPh")} />
              </Field>
            </div>
          </Section>

          <Section n={3} title={k("lf.s3Offer", "lf.s3Need")} desc={t("lf.s3Desc")}>
            <Field label={k("lf.prefOffer", "lf.prefNeed")} htmlFor="lf-pref" error={err("exchangePref")} count={f.exchangePref.trim().length} max={LIMITS.pref}>
              <Textarea id="lf-pref" value={f.exchangePref} onChange={(e) => set("exchangePref", e.target.value)} placeholder={k("lf.prefPhOffer", "lf.prefPhNeed")} className="min-h-[72px]" />
            </Field>
          </Section>

          <Section n={4} title={k("lf.s4Offer", "lf.s4Need")} desc={t("lf.s4Desc", { n: num(LIMITS.imagesPerListing) })}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {f.images.map((src, i) => (
                <div key={i} className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200">
                  <img src={src} alt={t("lf.imageAlt", { n: i + 1 })} className="h-full w-full object-cover" />
                  <button type="button" onClick={() => set("images", f.images.filter((_, j) => j !== i))} aria-label={t("lf.removeImage", { n: i + 1 })} className={cn("absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-white/95 text-red-600 shadow", focusRing)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {Array.from({ length: imgBusy }).map((_, i) => (
                <div key={`b${i}`} role="status" aria-label={t("common.loading")} className="grid aspect-square place-items-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 text-xs text-emerald-700"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ))}
              {f.images.length + imgBusy < LIMITS.imagesPerListing && (
                <button type="button" onClick={() => fileRef.current?.click()} className={cn("flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 p-2 text-center text-xs text-slate-500 transition hover:border-emerald-400 hover:bg-emerald-50/50 hover:text-emerald-700", focusRing)}>
                  <ImagePlus className="h-5 w-5" /> {t("lf.addImage")}
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label={t("lf.chooseImages")} onChange={(e) => addFiles(e.target.files)} tabIndex={-1} />
            {imgError && <p role="alert" className="text-xs text-red-600">{imgError}</p>}
          </Section>

          <Section n={5} title={t("lf.s5")} desc={t("lf.s5Desc")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("lf.location")} htmlFor="lf-loc" error={err("location")}>
                <Input id="lf-loc" value={f.location} onChange={(e) => set("location", e.target.value)} placeholder={t("lf.locationPh")} />
              </Field>
              <Field label={k("lf.availOffer", "lf.availNeed")} htmlFor="lf-avail" error={err("availability")}>
                <Input id="lf-avail" value={f.availability} onChange={(e) => set("availability", e.target.value)} placeholder={k("lf.availPhOffer", "lf.availPhNeed")} />
              </Field>
              <Field label={t("lf.mode")} htmlFor="lf-mode">
                <Select id="lf-mode" value={f.mode} onChange={(e) => set("mode", e.target.value as ListingInput["mode"])}>
                  <option value="">{t("common.notSpecified")}</option>
                  {MODES.map((m) => <option key={m} value={m}>{t(L.mode(m))}</option>)}
                </Select>
              </Field>
              <label className="flex items-start gap-2.5 pt-1 text-[13px] text-slate-600">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#541B2B]" checked={businessClaimed} onChange={(e) => setBusinessClaimed(e.target.checked)} />
                <span>
                  <span className="font-medium text-slate-700">{t("verify.formBusinessClaim")}</span>
                  <span className="block text-[11.5px] text-slate-500">{t("verify.formBusinessClaimHint")}</span>
                </span>
              </label>
            </div>
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-slate-900">{t("lf.review")}</h2>
            <div className="mt-3 rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{f.category ? t(L.cat(f.category)) : t("listing.field.category")} · {f.type ? t(L.type(f.type)) : t("lf.typeLabel")}</p>
              <p className="mt-0.5 break-words text-sm font-semibold text-slate-800">{f.title || <span className="text-slate-400">{t("lf.untitled")}</span>}</p>
              <p className="mt-1 line-clamp-3 break-words text-xs text-slate-500">{f.description || t("lf.noDesc")}</p>
              {f.exchangePref && <p className="mt-2 line-clamp-2 break-words text-xs text-slate-600"><b>{k("lf.inReturn", "lf.canOffer")}</b> {f.exchangePref}</p>}
            </div>
            <ul className="mt-3 space-y-1.5">
              {checklist.map((c) => (
                <li key={c.label} className={cn("flex items-center gap-2 text-xs", c.ok ? "text-emerald-700" : "text-slate-500")}>
                  {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <Circle className="h-3.5 w-3.5 shrink-0" />} {c.label}
                </li>
              ))}
            </ul>
            {(serverError || eligibilityQuery.error) && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{serverError || eligibilityQuery.error}</p>}
            {touched && Object.keys(errors).length > 0 && <p role="alert" className="mt-3 text-xs text-red-600">{t("lf.fixFields")}</p>}
            <div className="mt-4 space-y-2">
              <Button
                type="submit"
                className="w-full"
                icon={Send}
                loading={busy === "publish"}
                disabled={!!busy || imgBusy > 0 || !eligibilityQuery.data?.ok}
                title={eligibilityQuery.error ?? (eligibility.ok ? undefined : t("verify.err.publishBlocked", { steps: eligibility.missing.map((s) => t(s.key)).join(", ") }))}
              >
                {isDraft ? k("lf.publishOffer", "lf.publishNeed") : t("lf.saveChanges")}
              </Button>
              {isDraft && <Button type="button" variant="secondary" className="w-full" icon={Save} loading={busy === "draft"} disabled={!!busy || imgBusy > 0}               onClick={() => void submit(false)}>{t("lf.saveDraft")}</Button>}
              <Button type="button" variant="ghost" className="w-full" onClick={() => navigate(base)} disabled={!!busy}>{t("common.cancel")}</Button>
            </div>
            {isDraft && <p className="mt-3 text-[11px] text-slate-400">{k("lf.draftNoteOffer", "lf.draftNoteNeed")}</p>}
            {!eligibility.ok && isDraft && (
              <p className="mt-2 text-[11px] text-[#A45A16]">{t("verify.draftVerifiedNote")}</p>
            )}
          </Card>
        </aside>
      </form>
    </div>
  );
}

export default function ListingForm({ kind, id }: { kind: ListingKind; id?: string }) {
  const { t } = useI18n();
  const res = useQuery(() => (id ? getListing(id) : null), [id]);
  if (!id) return <Form kind={kind} />;
  if (res.error) return <EmptyState icon={ShieldAlert} title={t("lf.loadError")} body={res.error} />;
  const l = res.data?.listing;
  if (!res.data || !l || !res.data.isOwner || l.kind !== kind || l.deletedAt)
    return (
      <EmptyState icon={ShieldAlert} title={t("lf.cantEditTitle")} body={t("lf.cantEditBody")}>
        <LinkButton to={kind === "offer" ? "/offers" : "/needs"}>{t("common.back")}</LinkButton>
      </EmptyState>
    );
  return <Form key={l.id} kind={kind} existing={l} />;
}
