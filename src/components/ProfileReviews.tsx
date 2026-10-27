import { useState } from "react";
import { BadgeCheck, Flag, Star } from "lucide-react";
import { getProfileReviewEligibility, report, type getPublicProfile } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { Link } from "@/lib/router";
import { ReviewForm } from "./ReviewForm";
import { Avatar, Button, EmptyState, ErrorState, Field, Modal, SectionTitle, Select, Spinner, Stars, Textarea, errMsg, toast } from "./ui";

type MemberProfile = NonNullable<ReturnType<typeof getPublicProfile>>;

export function ProfileReviews({ member, reviews, rating, isMe }: Pick<MemberProfile, "member" | "reviews" | "rating" | "isMe">) {
  const { t, tn, num, ago } = useI18n();
  const eligibility = useQuery(() => getProfileReviewEligibility(member.userId), [member.userId]);
  const [selected, setSelected] = useState("");
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reportError, setReportError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const pending = eligibility.data?.pending ?? [];
  const exchangeId = pending.some((x) => x.id === selected) ? selected : pending[0]?.id;

  return <div className="space-y-8">
    {!isMe && <section className="border-b border-[#E9DFDC] pb-6" aria-label={t("community.reviewEligible")}>
      <SectionTitle title={t("community.reviewEligible")} />
      {eligibility.error ? <ErrorState message={eligibility.error} onRetry={eligibility.refetch} /> : !eligibility.data ? <Spinner /> : !exchangeId ? (
        <p className="text-sm leading-relaxed text-slate-500">{t(eligibility.data.completedCount > 0 ? "community.reviewAllWritten" : "community.reviewNoEligibility")}</p>
      ) : <div className="space-y-4">
        <p className="text-sm text-slate-500">{t("community.reviewChoose")}</p>
        <Field htmlFor="profile-review-exchange" label={t("community.reviewSelect")} required>
          <Select id="profile-review-exchange" value={exchangeId} onChange={(e) => setSelected(e.target.value)}>
            {pending.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </Select>
        </Field>
        <ReviewForm key={exchangeId} exchangeId={exchangeId} recipientName={member.fullName} onDone={() => setSelected("")} />
      </div>}
    </section>}

    {reviews.length === 0 ? <EmptyState icon={Star} title={t("pf.noReviews")} body={t("pf.reviewsEmptyBody")} /> : <section>
      <SectionTitle title={t("pf.avgFrom", { avg: num(rating.average ?? 0), reviews: tn("count.reviews", rating.count) })} />
      <ul className="divide-y divide-[#E9DFDC]">
        {reviews.map((r) => <li key={r.id} className="py-5 first:pt-0">
          <div className="flex flex-wrap items-start gap-3">
            <Avatar name={r.reviewer.fullName} src={r.reviewer.avatar} size={34} />
            <div className="min-w-0 flex-1">
              {r.reviewer.username ? <Link to={`/u/${encodeURIComponent(r.reviewer.username)}`} className="text-sm font-medium text-slate-800 hover:text-[#541B2B]">{r.reviewer.fullName}</Link> : <span className="text-sm text-slate-500">{r.reviewer.fullName}</span>}
              <div className="mt-1 flex flex-wrap items-center gap-2"><Stars value={r.rating} /><time dateTime={r.createdAt} className="text-xs text-slate-500">{ago(r.createdAt)}</time></div>
            </div>
            {r.reported ? <span className="text-xs text-slate-500">{t("rp.reported")}</span> : <Button size="sm" variant="ghost" icon={Flag} aria-label={t("community.reportReview")} onClick={() => { setReporting(r.id); setReportError(null); setReason(""); }}>{t("rp.report")}</Button>}
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{r.comment}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500"><BadgeCheck className="h-3.5 w-3.5" aria-hidden />{t("community.completedReview")}{r.canOpenExchange && <Link className="underline underline-offset-4" to={`/collaborations/${r.exchangeId}`}>{t("common.viewDetails")}</Link>}</p>
        </li>)}
      </ul>
    </section>}

    <Modal open={!!reporting} onClose={() => { if (!busy) setReporting(null); }} title={t("rp.reportAria")} size="sm">
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        if (busy || !reporting) return;
        setBusy(true);
        setReportError(null);
        try { report("review", reporting, reason); toast.successKey("rp.reportedToast"); setReporting(null); }
        catch (err) { setReportError(err); }
        finally { setBusy(false); }
      }}>
        <Field label={t("rp.reportPh")} htmlFor="profile-review-report" required><Textarea id="profile-review-report" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required /></Field>
        <p className="text-xs text-slate-500">{t("community.reportNoDeletion")}</p>
        {reportError !== null && <ErrorState message={errMsg(reportError)} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setReporting(null)}>{t("common.cancel")}</Button><Button type="submit" loading={busy}>{t("common.submit")}</Button></div>
      </form>
    </Modal>
  </div>;
}