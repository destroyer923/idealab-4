import { useState } from "react";
import { ArrowLeft, Ban, CalendarDays, CheckCircle2, Circle, ExternalLink, FileCheck2, Flag, History, ListChecks, Loader2, Pencil, Plus, ShieldAlert, Star, Truck } from "lucide-react";
import { cn } from "@/utils/cn";
import {
  addProgressNote, cancelExchange, createMilestone, getExchangeDetail, proposeAmendment, respondAmendment, reviewSubmission, setMyProgress, submitWork, updateDelivery, updateMilestone, type ExchangeView,
} from "@/lib/api";
import { DELIVERY_STATUSES, MILESTONE_STATUSES, PROGRESS_STEPS } from "@/lib/constants";
import { useQuery } from "@/lib/hooks";
import { L, dyn, useI18n } from "@/lib/i18n";
import { Link } from "@/lib/router";
import type { Commitment, Delivery, MilestoneStatus } from "@/lib/types";
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, LinkButton, Select, Stars, Textarea, errMsg, focusRing, toast } from "@/components/ui";
import { MessageButton } from "@/components/listing";
import { ReviewForm } from "@/components/ReviewForm";
export { ReviewForm } from "@/components/ReviewForm";
import { EVENT_ICON } from "./Dashboard";
import { ExchangeStatusBadge, RequestActions } from "./Exchange";

function attempt(fn: () => void, ok?: string) {
  try {
    fn();
    if (ok) toast.success(ok);
    return true;
  } catch (e) {
    toast.error(errMsg(e));
    return false;
  }
}

function CommitmentPanel({ x, c, me }: { x: ExchangeView; c: Commitment; me: string }) {
  const { t, ago, date } = useI18n();
  const mine = c.userId === me;
  const who = c.userId === x.requesterId ? x.requester : x.recipient;
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [revise, setRevise] = useState("");
  const [reviseOpen, setReviseOpen] = useState(false);
  const active = x.status === "active";
  const step = PROGRESS_STEPS.indexOf(c.progress);

  return (
    <div className={cn("border-t-2 border-[#E9DFDC] bg-white p-4", mine && "border-t-[#541B2B] bg-[#FFF8F0]/60")}>
      <div className="flex items-center gap-2.5">
        <Avatar name={who.fullName} src={who.avatar} size={32} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{mine ? t("cd.yourCommitment") : t("cd.theirCommitment", { name: who.fullName })}</p>
          <p className="break-words text-sm text-slate-800">{c.description || <span className="text-slate-400">{t("cd.noCommitment")}</span>}</p>
        </div>
      </div>
      {c.description && (
        <>
          <ol className="mt-4 grid grid-cols-4 gap-1" aria-label={t("cd.progressLabel")}>
            {PROGRESS_STEPS.map((s, i) => (
              <li key={s} className="text-center">
                <div className={cn("h-1.5 rounded-full", i <= step ? (c.progress === "confirmed" ? "bg-lime-500" : "bg-emerald-500") : "bg-slate-200")} />
                <span className={cn("mt-1 block break-words text-[10px] leading-tight", i === step ? "font-semibold text-slate-800" : "text-slate-400")} aria-current={i === step ? "step" : undefined}>{t(L.progress(s))}</span>
              </li>
            ))}
          </ol>
          {c.submission && (
            <div className="mt-3 rounded-xl bg-white p-3 text-sm ring-1 ring-slate-100">
              <p className="text-xs font-semibold text-slate-500">{t("cd.delivered", { time: ago(c.submission.at) })}</p>
              <p className="mt-0.5 whitespace-pre-line break-words text-slate-700">{c.submission.note}</p>
              {c.submission.link && (
                <a href={c.submission.link} target="_blank" rel="noopener noreferrer nofollow" className={cn("mt-1 inline-flex items-center gap-1 break-all text-xs font-medium text-emerald-700 hover:underline", focusRing)}>
                  <ExternalLink className="h-3 w-3" /> {c.submission.link}
                </a>
              )}
            </div>
          )}
          {c.feedback && c.progress === "in_progress" && (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              <p className="text-xs font-semibold">{t("cd.revisionRequested", { time: ago(c.feedback.at) })}</p>
              <p className="mt-0.5 whitespace-pre-line break-words">{c.feedback.note}</p>
            </div>
          )}
          {active && mine && (c.progress === "not_started" || c.progress === "in_progress") && (
            <div className="mt-3 flex flex-wrap gap-2">
              {c.progress === "not_started" ? (
                <Button size="sm" variant="secondary" onClick={() => attempt(() => setMyProgress(x.id, "in_progress"), t("cd.startedToast"))}>{t("cd.start")}</Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => attempt(() => setMyProgress(x.id, "not_started"))}>{t("cd.markNotStarted")}</Button>
              )}
              <Button size="sm" icon={FileCheck2} onClick={() => setSubmitOpen((o) => !o)} aria-expanded={submitOpen}>{t("cd.reportFulfilled")}</Button>
            </div>
          )}
          {submitOpen && active && mine && (
            <form className="mt-3 space-y-2 rounded-xl bg-white p-3 ring-1 ring-slate-100" onSubmit={(e) => { e.preventDefault(); if (attempt(() => submitWork(x.id, note, link), t("cd.submittedToast"))) setSubmitOpen(false); }}>
              <Field label={t("cd.whatDelivered")} htmlFor={`sub-${c.userId}`} required>
                <Textarea id={`sub-${c.userId}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("cd.whatDeliveredPh")} className="min-h-[72px]" />
              </Field>
              <Field label={t("cd.link")} htmlFor={`link-${c.userId}`} hint={t("cd.linkHint")}>
                <Input id={`link-${c.userId}`} type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
              </Field>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setSubmitOpen(false)}>{t("common.cancel")}</Button>
                <Button type="submit" size="sm">{t("cd.submitConfirm")}</Button>
              </div>
            </form>
          )}
          {active && mine && c.progress === "ready" && <p className="mt-3 text-xs text-sky-700">{t("cd.waitingConfirm", { name: x.other.fullName })}</p>}
          {active && !mine && c.progress === "ready" && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium text-sky-800">{t("cd.saysDone", { name: who.fullName })}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={CheckCircle2} onClick={() => attempt(() => reviewSubmission(x.id, "confirm"), t("cd.confirmedToast"))}>{t("cd.confirmReceived")}</Button>
                <Button size="sm" variant="secondary" icon={Flag} onClick={() => setReviseOpen((o) => !o)}>{t("cd.requestRevision")}</Button>
              </div>
              {reviseOpen && (
                <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (attempt(() => reviewSubmission(x.id, "revise", revise), t("cd.revisionToast"))) setReviseOpen(false); }}>
                  <Textarea aria-label={t("cd.revisionNotes")} value={revise} onChange={(e) => setRevise(e.target.value)} placeholder={t("cd.revisionPh")} className="min-h-[64px]" />
                  <Button type="submit" size="sm">{t("cd.sendRevision")}</Button>
                </form>
              )}
            </div>
          )}
          {c.confirmedAt && <p className="mt-3 flex items-center gap-1 text-xs text-lime-700"><CheckCircle2 className="h-3.5 w-3.5" /> {t("cd.confirmedOn", { date: date(c.confirmedAt) })}</p>}
        </>
      )}
    </div>
  );
}

function DeliveryPanel({ x }: { x: ExchangeView }) {
  const { t, date } = useI18n();
  const [d, setD] = useState<Delivery>(x.delivery);
  const [editing, setEditing] = useState(false);
  const active = x.status === "active";
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Truck className="h-4 w-4 text-emerald-600" /> {t("dl.title")}</h2>
        {active && !editing && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => (setD(x.delivery), setEditing(true))}>{t("common.update")}</Button>}
      </div>
      {!editing ? (
        x.delivery.required ? (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-xs text-slate-400">{t("dl.status")}</dt><dd><Badge tone={x.delivery.status === "received" ? "lime" : "sky"}>{t(L.delivery(x.delivery.status))}</Badge></dd></div>
            <div><dt className="text-xs text-slate-400">{t("dl.method")}</dt><dd className="break-words text-slate-700">{x.delivery.method || "—"}</dd></div>
            <div><dt className="text-xs text-slate-400">{t("dl.date")}</dt><dd className="text-slate-700">{x.delivery.date ? date(x.delivery.date) : "—"}</dd></div>
            <div><dt className="text-xs text-slate-400">{t("dl.ref")}</dt><dd className="break-words text-slate-700">{x.delivery.reference || "—"}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">{t("dl.none")}</p>
        )
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (attempt(() => updateDelivery(x.id, d), t("dl.savedToast"))) setEditing(false); }}>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4 shrink-0 accent-emerald-600" checked={d.required} onChange={(e) => setD({ ...d, required: e.target.checked })} /> {t("dl.required")}</label>
          {d.required && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("dl.method")} htmlFor="dl-m"><Input id="dl-m" value={d.method} onChange={(e) => setD({ ...d, method: e.target.value })} placeholder={t("dl.methodPh")} /></Field>
              <Field label={t("dl.status")} htmlFor="dl-s" required>
                <Select id="dl-s" value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as Delivery["status"] })}>
                  {DELIVERY_STATUSES.map((k) => <option key={k} value={k}>{t(L.delivery(k))}</option>)}
                </Select>
              </Field>
              <Field label={t("dl.dateLabel")} htmlFor="dl-d"><Input id="dl-d" type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>
              <Field label={t("dl.refLabel")} htmlFor="dl-r"><Input id="dl-r" value={d.reference} onChange={(e) => setD({ ...d, reference: e.target.value })} placeholder={t("dl.refPh")} /></Field>
            </div>
          )}
          <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>{t("common.cancel")}</Button><Button type="submit" size="sm">{t("common.save")}</Button></div>
        </form>
      )}
      <p className="mt-3 text-[11px] text-slate-400">{t("dl.disclaimer")}</p>
    </Card>
  );
}

export default function ExchangeDetail({ id, base }: { id: string; base: "/exchange" | "/collaborations" }) {
  const { t, ago, date, dateTime, num } = useI18n();
  const res = useQuery(() => getExchangeDetail(id), [id]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [msTitle, setMsTitle] = useState("");
  const [msDesc, setMsDesc] = useState("");
  const [msDue, setMsDue] = useState("");
  const [msOpen, setMsOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [amendOpen, setAmendOpen] = useState(false);
  const [am, setAm] = useState({ mine: "", theirs: "", date: "" });

  if (res.error) return <ErrorState message={res.error} />;
  if (!res.data) return <div className="flex justify-center py-16" role="status" aria-label={t("common.loading")}><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>;
  if (res.data.error)
    return (
      <EmptyState icon={ShieldAlert} title={res.data.error === "forbidden" ? t("cd.noAccessTitle") : t("cd.notFoundTitle")} body={t("cd.noAccessBody")}>
        <LinkButton to={base}>{t("common.back")}</LinkButton>
      </EmptyState>
    );

  const { exchange: x, me, milestones, events, reviews, listing, offeredListing } = res.data;
  const active = x.status === "active";
  const myCommit = x.commitments.find((c) => c.userId === me)!;
  const theirCommit = x.commitments.find((c) => c.userId !== me)!;
  const doneMs = milestones.filter((m) => m.status === "completed").length;
  const myReview = reviews.find((r) => r.reviewerId === me);
  const theirReview = reviews.find((r) => r.reviewerId !== me);
  const otherFirst = x.other.fullName.split(" ")[0];
  const nameOf = (uid: string) => (uid === me ? t("common.youLower") : x.other.fullName);

  return (
    <div className="mx-auto max-w-6xl">
      <Link to={base} className={cn("mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-emerald-700", focusRing)}>
        <ArrowLeft className="h-4 w-4" /> {base === "/exchange" ? t("nav.exchange") : t("co.title")}
      </Link>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ExchangeStatusBadge status={x.status} awaiting={x.awaiting} />
            <span className="text-xs text-slate-400">{t(L.cat(x.category))}</span>
          </div>
          <h1 className="display mt-1.5 break-words text-[32px] font-semibold text-[#541B2B]">{x.title}</h1>
          <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
            <div className="flex shrink-0 -space-x-2"><Avatar name={x.requester.fullName} src={x.requester.avatar} size={26} /><Avatar name={x.recipient.fullName} src={x.recipient.avatar} size={26} /></div>
            <span className="min-w-0">
              {x.requester.username ? <Link to={`/u/${x.requester.username}`} className="font-medium text-slate-700 hover:text-emerald-700">{x.requester.fullName}</Link> : x.requester.fullName}
              <span className="text-slate-400"> {t("cd.requesterTag")} · </span>
              {x.recipient.username ? <Link to={`/u/${x.recipient.username}`} className="font-medium text-slate-700 hover:text-emerald-700">{x.recipient.fullName}</Link> : x.recipient.fullName}
              <span className="text-slate-400"> {t("cd.recipientTag")}</span>
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <RequestActions x={x} />
          <MessageButton userId={x.other.userId} contextType="exchange" contextId={x.id} label={t("cd.openMessages")} />
          {active && <Button variant="ghost" icon={Ban} onClick={() => setCancelOpen(true)} className="text-red-600 hover:bg-red-50 hover:text-red-700">{t("cd.cancelShort")}</Button>}
        </div>
      </div>

      {x.status === "pending" && (
        <div className="mb-5 border-l-2 border-[#A45A16] bg-amber-50/60 p-4 text-sm text-amber-900">
          {x.role === "recipient" ? t("cd.pendingRecipient", { name: x.other.fullName }) : t("cd.pendingRequester", { name: x.other.fullName })}
        </div>
      )}
      {x.status === "cancelled" && (
        <div className="mb-5 break-words border-l-2 border-[#E9DFDC] bg-[#FFF8F0] p-4 text-sm text-slate-700">
          {t("cd.cancelledBy", { who: x.cancelledBy ? nameOf(x.cancelledBy) : "", date: date(x.cancelledAt) })}
          {x.cancelReason && <> {t("cd.reason", { reason: x.cancelReason })}</>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">{t("cd.responsibilities")}</h2>
              {active && !x.amendment && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => (setAm({ mine: myCommit.description, theirs: theirCommit.description, date: x.targetDate }), setAmendOpen(true))}>{t("cd.proposeChanges")}</Button>}
            </div>
            {x.amendment && (
              <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm">
                <p className="font-medium text-sky-900">{x.amendment.byUserId === me ? t("cd.amendMine") : t("cd.amendTheirs", { name: x.other.fullName })}</p>
                <ul className="mt-2 space-y-1 break-words text-slate-700">
                  {x.amendment.commitments.map((c) => (
                    <li key={c.userId}><b>{c.userId === me ? t("x.youProvide") : t("x.theyProvide", { name: otherFirst })}:</b> {c.description || t("cd.nothingOneWay")}</li>
                  ))}
                  <li><b>{t("cd.targetDate")}:</b> {x.amendment.targetDate ? date(x.amendment.targetDate) : t("common.none")}</li>
                </ul>
                {x.amendment.byUserId !== me && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => attempt(() => respondAmendment(x.id, true), t("cd.changesAccepted"))}>{t("cd.acceptChanges")}</Button>
                    <Button size="sm" variant="secondary" onClick={() => attempt(() => respondAmendment(x.id, false), t("cd.changesDeclined"))}>{t("x.decline")}</Button>
                  </div>
                )}
              </div>
            )}
            {amendOpen && (
              <form className="mb-4 space-y-3 rounded-xl bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); if (attempt(() => proposeAmendment(x.id, am.mine, am.theirs, am.date), t("cd.amendSent"))) setAmendOpen(false); }}>
                <p className="text-xs text-slate-500">{t("cd.amendNote", { name: x.other.fullName })}</p>
                <Field label={t("x.youProvide")} htmlFor="am-m"><Textarea id="am-m" value={am.mine} onChange={(e) => setAm({ ...am, mine: e.target.value })} className="min-h-[60px]" /></Field>
                <Field label={t("x.theyProvide", { name: x.other.fullName })} htmlFor="am-t"><Textarea id="am-t" value={am.theirs} onChange={(e) => setAm({ ...am, theirs: e.target.value })} className="min-h-[60px]" /></Field>
                <Field label={t("cd.targetDate")} htmlFor="am-d"><Input id="am-d" type="date" value={am.date} onChange={(e) => setAm({ ...am, date: e.target.value })} /></Field>
                <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => setAmendOpen(false)}>{t("common.cancel")}</Button><Button type="submit" size="sm">{t("propose.send")}</Button></div>
              </form>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <CommitmentPanel x={x} c={myCommit} me={me} />
              <CommitmentPanel x={x} c={theirCommit} me={me} />
            </div>
            {active && <p className="mt-3 text-xs text-slate-500">{t("cd.completeRule")}</p>}
          </Card>

          {x.status !== "pending" && (active || milestones.length > 0) && (
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ListChecks className="h-4 w-4 text-emerald-600" /> {t("ms.title")}</h2>
                {active && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setMsOpen((o) => !o)} aria-expanded={msOpen}>{t("common.add")}</Button>}
              </div>
              {milestones.length > 0 && (
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-slate-500"><span>{t("ms.progress", { done: num(doneMs), total: num(milestones.length) })}</span><span>{num(Math.round((doneMs / milestones.length) * 100))}%</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={doneMs} aria-valuemin={0} aria-valuemax={milestones.length} aria-label={t("ms.progressLabel")}>
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-500 transition-all" style={{ width: `${(doneMs / milestones.length) * 100}%` }} />
                  </div>
                </div>
              )}
              {msOpen && (
                <form className="mb-3 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_160px]" onSubmit={(e) => { e.preventDefault(); if (attempt(() => createMilestone(x.id, { title: msTitle, description: msDesc, dueDate: msDue }), t("ms.addedToast"))) { setMsTitle(""); setMsDesc(""); setMsDue(""); setMsOpen(false); } }}>
                  <Input aria-label={t("ms.titlePh")} placeholder={t("ms.titlePh")} value={msTitle} onChange={(e) => setMsTitle(e.target.value)} />
                  <Input aria-label={t("ms.due")} title={t("ms.due")} type="date" value={msDue} onChange={(e) => setMsDue(e.target.value)} />
                  <Input aria-label={t("ms.descPh")} placeholder={t("ms.descPh")} value={msDesc} onChange={(e) => setMsDesc(e.target.value)} className="sm:col-span-2" />
                  <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" size="sm" variant="ghost" onClick={() => setMsOpen(false)}>{t("common.cancel")}</Button><Button type="submit" size="sm">{t("ms.add")}</Button></div>
                </form>
              )}
              {milestones.length === 0 ? (
                <p className="text-sm text-slate-500">{t("ms.empty")}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {milestones.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-start gap-3 py-3">
                      {m.status === "completed" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-lime-600" /> : <Circle className={cn("mt-0.5 h-4 w-4", m.status === "in_progress" ? "text-sky-500" : "text-slate-300")} />}
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-medium text-slate-800">{m.title}</p>
                        {m.description && <p className="break-words text-xs text-slate-500">{m.description}</p>}
                        <p className="text-[11px] text-slate-400">
                          {m.dueDate && <>{t("ms.dueOn", { date: date(m.dueDate) })} · </>}
                          {t("ms.addedBy", { name: nameOf(m.createdBy) })}
                          {m.updatedAt !== m.createdAt ? ` · ${t("ms.updatedBy", { name: nameOf(m.updatedBy) })}` : ""}
                        </p>
                      </div>
                      <Select aria-label={t("ms.statusOf", { title: m.title })} value={m.status} disabled={!active} onChange={(e) => attempt(() => updateMilestone(m.id, e.target.value as MilestoneStatus))} className="h-8 w-40 text-xs">
                        {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{t(L.ms(s))}</option>)}
                      </Select>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {x.status === "completed" && (
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><Star className="h-4 w-4 text-amber-500" /> {t("rv.title")}</h2>
              {myReview ? (
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{t("rv.yourReview", { name: x.other.fullName })}</p><Stars value={myReview.rating} /><p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{myReview.comment}</p></div>
              ) : (
                <ReviewForm exchangeId={x.id} recipientName={x.other.fullName} />
              )}
              {theirReview && (
                <div className="mt-3 rounded-xl bg-emerald-50/60 p-3"><p className="text-xs text-slate-500">{t("rv.theirReview", { name: x.other.fullName })}</p><Stars value={theirReview.rating} /><p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{theirReview.comment}</p></div>
              )}
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900"><History className="h-4 w-4 text-emerald-600" /> {t("tl.title")}</h2>
            {active && (
              <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (attempt(() => addProgressNote(x.id, noteText), t("tl.posted"))) setNoteText(""); }}>
                <Input aria-label={t("tl.postPh")} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t("tl.postPh")} />
                <Button type="submit" variant="secondary">{t("tl.post")}</Button>
              </form>
            )}
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {[...events].reverse().map((e) => {
                const I = EVENT_ICON[e.type];
                return (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[31px] grid h-5 w-5 place-items-center rounded-full bg-white ring-2 ring-emerald-100"><I className="h-3 w-3 text-emerald-600" /></span>
                    <p className="break-words text-sm text-slate-700">{dyn(t, e.key, e.vars, e.text)}</p>
                    {e.body && <p className="mt-1 whitespace-pre-line break-words rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{e.body}</p>}
                    <time dateTime={e.createdAt} className="text-[11px] text-slate-400">{dateTime(e.createdAt)}</time>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("ov.title")}</h2>
            <dl className="space-y-2.5 text-sm">
              {[
                [t("ov.proposed"), date(x.createdAt)],
                [t("ov.agreed"), !["pending", "declined", "withdrawn"].includes(x.status) ? date(x.respondedAt) : ""],
                [t("ov.target"), x.targetDate ? date(x.targetDate) : ""],
                [t("ov.completed"), date(x.completedAt)],
                [t("ov.updated"), ago(x.updatedAt)],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3"><dt className="flex items-center gap-1.5 text-slate-500"><CalendarDays className="h-3.5 w-3.5 shrink-0" />{k}</dt><dd className="text-right font-medium text-slate-700">{v}</dd></div>
                ))}
            </dl>
            {x.message && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold text-slate-500">{t("ov.message")}</p>
                <p className="mt-1 whitespace-pre-line break-words text-sm italic text-slate-600">“{x.message}”</p>
              </div>
            )}
            {(listing || offeredListing) && (
              <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold text-slate-500">{t("ov.related")}</p>
                {[listing, offeredListing].filter(Boolean).map((l) => (
                  <div key={l!.id} className="break-words text-sm">
                    {l!.available && !l!.deleted ? <Link to={`/listing/${l!.id}`} className="font-medium text-emerald-700 hover:underline">{l!.title}</Link> : <span className="text-slate-500">{l!.title} <span className="text-xs">({l!.deleted ? t("ov.removed") : t("ov.inactive")})</span></span>}
                    <span className="ml-1 text-xs text-slate-400">· {t(l!.kind === "offer" ? "listing.offer" : "listing.need")}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          {!["pending", "declined", "withdrawn"].includes(x.status) && <DeliveryPanel key={x.delivery.updatedAt ?? "d"} x={x} />}
        </aside>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t("cd.cancelTitle")}
        body={t("cd.cancelBody", { name: x.other.fullName })}
        confirmLabel={t("cd.cancelConfirm")}
        tone="danger"
        onConfirm={() => {
          if (attempt(() => cancelExchange(x.id, reason), t("cd.cancelledToast"))) setCancelOpen(false);
        }}
      >
        <Textarea aria-label={t("cd.reasonPh")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("cd.reasonPh")} className="mt-3 min-h-[70px]" />
      </ConfirmDialog>
    </div>
  );
}
