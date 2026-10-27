import { useMemo, useState } from "react";
import { PAGE_IMAGES } from "@/lib/images";
import { BadgeCheck, Flag, MessageSquareText, Star, StarHalf } from "lucide-react";
import { cn } from "@/utils/cn";
import { getMyReviewData, report } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { Link } from "@/lib/router";
import { Avatar, Button, Card, EmptyState, ErrorState, LinkButton, Modal, PageHeader, Select, Spinner, Stars, Tabs, Textarea, errMsg, focusRing, toast } from "@/components/ui";
import { ReviewForm } from "@/components/ReviewForm";

export default function Reviews() {
  const { t, num, date, ago } = useI18n();
  const res = useQuery(() => getMyReviewData());
  const [tab, setTab] = useState<"received" | "given" | "pending">("received");
  const [rating, setRating] = useState(0);
  const [range, setRange] = useState("all");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const d = res.data;
  const list = useMemo(() => {
    if (!d || tab === "pending") return [];
    let r = tab === "received" ? d.received : d.given;
    if (rating) r = r.filter((x) => x.rating === rating);
    if (range !== "all") r = r.filter((x) => Date.now() - Date.parse(x.createdAt) < Number(range) * 86400_000);
    return [...r].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [d, tab, rating, range]);

  if (res.error) return <ErrorState message={res.error} onRetry={res.refetch} />;
  if (!d) return <Spinner />;
  const { summary } = d;
  const max = Math.max(1, ...summary.distribution);
  const filtered = rating > 0 || range !== "all";

  return (
    <div>
      <PageHeader title={t("nav.reviews")} subtitle={t("rp.subtitle")} image={PAGE_IMAGES.reviews} />
      <div className="mb-8 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card className="flex flex-wrap items-center gap-8 border-x-0 p-6">
          <div className="text-center">
            <p className="display text-[52px] font-semibold tabular-nums text-[#541B2B]">{summary.average !== null ? num(summary.average) : "—"}</p>
            <div className="mt-1">{summary.average !== null ? <Stars value={summary.average} size={16} /> : <span className="text-xs text-slate-400">{t("rp.noRating")}</span>}</div>
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><MessageSquareText className="h-4 w-4 shrink-0 text-emerald-600" /><dt className="text-slate-500">{t("rp.received")}</dt><dd className="font-semibold text-slate-900">{num(summary.count)}</dd></div>
            <div className="flex items-center gap-2"><BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" /><dt className="text-slate-500">{t("rp.completed")}</dt><dd className="font-semibold text-slate-900">{num(d.completedCount)}</dd></div>
            <div className="flex items-center gap-2"><StarHalf className="h-4 w-4 shrink-0 text-emerald-600" /><dt className="text-slate-500">{t("rp.given")}</dt><dd className="font-semibold text-slate-900">{num(d.given.length)}</dd></div>
          </dl>
        </Card>
        <Card className="border-x-0 p-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("rp.distribution")}</h2>
          <ul className="space-y-1.5">
            {[5, 4, 3, 2, 1].map((s) => (
              <li key={s}>
                <button onClick={() => (setTab("received"), setRating(rating === s ? 0 : s))} aria-pressed={rating === s} aria-label={t("rp.nStars", { n: num(s) })} className={cn("flex w-full items-center gap-3 rounded-lg px-1 py-0.5 text-xs hover:bg-slate-50", focusRing)}>
                  <span className="flex w-10 items-center gap-1 text-slate-600">{num(s)}<Star className="h-3 w-3 fill-amber-400 text-amber-400" /></span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-amber-400" style={{ width: `${(summary.distribution[s - 1] / max) * 100}%` }} /></span>
                  <span className="w-6 text-right tabular-nums text-slate-500">{num(summary.distribution[s - 1])}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs label={t("rp.sections")} value={tab} onChange={setTab} tabs={[{ value: "received", label: t("rp.tab.received"), count: d.received.length }, { value: "given", label: t("rp.tab.given"), count: d.given.length }, { value: "pending", label: t("rp.tab.pending"), count: d.pending.length }]} />
        {tab !== "pending" && (
          <div className="flex gap-2">
            <Select aria-label={t("rp.filterRating")} value={rating} onChange={(e) => setRating(Number(e.target.value))} className="w-36">
              <option value={0}>{t("rp.allRatings")}</option>
              {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{t("rp.nStars", { n: num(s) })}</option>)}
            </Select>
            <Select aria-label={t("rp.filterDate")} value={range} onChange={(e) => setRange(e.target.value)} className="w-36">
              <option value="all">{t("common.anyTime")}</option><option value="30">{t("common.last30")}</option><option value="365">{t("common.lastYear")}</option>
            </Select>
          </div>
        )}
      </div>

      {tab === "pending" ? (
        d.pending.length === 0 ? (
          <EmptyState icon={Star} title={t("rp.noPendingTitle")} body={t("rp.noPendingBody")} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {d.pending.map(({ exchange: x, other }) => (
              <Card key={x.id} className="p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={other.fullName} src={other.avatar} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{other.fullName}</p>
                    <p className="text-xs text-slate-400"><Link to={`/collaborations/${x.id}`} className="break-words text-emerald-700 hover:underline">{x.title}</Link> · {t("rp.completedOn", { date: date(x.completedAt) })}</p>
                  </div>
                  {reviewing !== x.id && <Button size="sm" icon={Star} onClick={() => setReviewing(x.id)}>{t("rp.write")}</Button>}
                </div>
                {reviewing === x.id && <div className="mt-4 border-t border-slate-100 pt-4"><ReviewForm key={x.id} exchangeId={x.id} recipientName={other.fullName} onDone={() => setReviewing(null)} /></div>}
              </Card>
            ))}
          </div>
        )
      ) : list.length === 0 ? (
        <EmptyState icon={MessageSquareText} title={filtered ? t("rp.noMatchTitle") : tab === "received" ? t("rp.noReceivedTitle") : t("rp.noGivenTitle")} body={tab === "received" ? t("rp.receivedBody") : t("rp.givenBody")}>
          {filtered ? <Button variant="secondary" onClick={() => (setRating(0), setRange("all"))}>{t("common.clearFilters")}</Button> : <LinkButton to="/collaborations" variant="secondary">{t("rp.viewCollabs")}</LinkButton>}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {list.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex items-start gap-3">
                <Avatar name={r.member.fullName} src={r.member.avatar} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm text-slate-500">
                    {t(tab === "received" ? "rp.fromLabel" : "rp.toLabel")}{" "}
                    {r.member.username ? <Link to={`/u/${r.member.username}`} className="font-medium text-slate-800 hover:text-emerald-700">{r.member.fullName}</Link> : r.member.fullName}
                    {r.exchangeTitle && <> · <Link to={`/collaborations/${r.exchangeId}`} className="text-emerald-700 hover:underline">{r.exchangeTitle}</Link></>}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2"><Stars value={r.rating} /><time dateTime={r.createdAt} className="text-xs text-slate-400">{ago(r.createdAt)}</time></div>
                  <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-600">{r.comment}</p>
                </div>
                {tab === "received" && (d.reportedIds.has(r.id) ? <span className="text-xs text-slate-400">{t("rp.reported")}</span> : <Button size="sm" variant="ghost" icon={Flag} onClick={() => setReporting(r.id)} aria-label={t("rp.reportAria")}>{t("rp.report")}</Button>)}
              </div>
            </Card>
          ))}
        </ul>
      )}

      <Modal open={!!reporting} onClose={() => setReporting(null)} title={t("rp.reportAria")} size="sm">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); try { report("review", reporting!, reason); toast.success(t("rp.reportedToast")); setReporting(null); setReason(""); } catch (er) { toast.error(errMsg(er)); } }}>
          <Textarea aria-label={t("rp.reportPh")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("rp.reportPh")} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setReporting(null)}>{t("common.cancel")}</Button><Button type="submit" variant="danger">{t("common.submit")}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
