import { useEffect, useMemo, useState } from "react";
import { Building2, Circle, Check, Info, Mail, Phone, RefreshCw, ShieldCheck, Users2 } from "lucide-react";
import { cn } from "@/utils/cn";
import {
  getVerification, getVerifyEvents, getBusinessEvidence, submitBusinessEvidence, reviewBusinessEvidence,
  updateProviderConfig, isReviewer, getListingReviewQueue, reviewListing, submitIdentityVerification,
  getIdentityEvidence, reviewIdentityVerification,
} from "@/lib/api";
import { BUSINESS_TYPES, OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES } from "@/lib/verify";
import { L, useI18n, type Key } from "@/lib/i18n";
import { useQuery } from "@/lib/hooks";
import { navigate } from "@/lib/router";
import type { BusinessEvidence, BusinessType, CheckStatus } from "@/lib/types";
import { Button, Card, ErrorState, Field, Input, SectionTitle, Select, Textarea, errMsg, focusRing, toast } from "@/components/ui";
import { TrustBadges, TrustLevel } from "@/components/trust";

/** One verification check row: status, what it means, and the action available. */
function CheckRow({
  icon: Icon, title, hint, status, masked, note, action, children,
}: {
  icon: React.ElementType;
  title: string;
  hint: string;
  status: CheckStatus;
  masked?: string;
  note?: Key;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const statusClass =
    status === "verified" ? "text-[#26734D]" : status === "rejected" ? "text-[#B42335]" : status === "pending" ? "text-[#A45A16]" : "text-slate-500";
  const StatusIcon = status === "verified" ? Check : status === "rejected" ? Circle : status === "pending" ? RefreshCw : Circle;
  return (
    <Card className="flex flex-col gap-3 border-l-2 border-l-[#E9DFDC] p-5 sm:flex-row sm:items-start sm:gap-5">
      <div className="flex flex-1 items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#8a3b44]" aria-hidden strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="font-display text-[16px] font-semibold text-[#29232A]">{title}</h3>
            <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em]", statusClass)}>
              <StatusIcon className="h-3 w-3" aria-hidden />
              {t(`verify.st.${status}`)}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{hint}</p>
          {masked && <p className="mt-1 text-[12px] text-slate-500">{masked}</p>}
          {note && <p className={cn("mt-1 text-[12px] font-medium", status === "rejected" ? "text-[#B42335]" : "text-[#A45A16]")}>{t(note)}</p>}
          {children}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        {action}
      </div>
    </Card>
  );
}

function ContactCheck({ channel }: { channel: "phone" | "email" }) {
  const { t, num } = useI18n();
  const res = useQuery(() => getVerification(), [channel]);
  const [destination, setDestination] = useState(channel === "phone" ? "" : res.data?.email ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => setWait((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  if (res.error) return <ErrorState message={res.error} onRetry={res.refetch} />;
  if (!res.data) return null;
  const d = res.data;
  const c = d.verification[channel];
  const cfg = d.provider[channel];
  const label = channel === "phone" ? t("verify.phoneTitle") : t("verify.emailTitle");
  const isVerified = c.status === "verified";
  

  const send = async () => {
    setError("");
    setBusy(true);
    try {
      const r = await getVerificationCode(channel, destination);
      toast.success(t("verify.codeSentToast", { masked: r.masked }));
      setWait(60);
      if (r.demoCode) setLastCode(r.demoCode);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      await verifyCode(channel, code);
      toast.success(t("verify.verifiedToast"));
      setCode("");
      setLastCode(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {!isVerified && (
        <div className="space-y-2">
          <Field
            label={label}
            htmlFor={`vc-${channel}`}
            required={channel === "phone"}
            hint={channel === "phone" ? t("verify.phoneMasked") : undefined}
          >
            <Input
              id={`vc-${channel}`}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder={channel === "phone" ? "+91 98xxxxxxxx" : "name@example.com"}
              disabled={isVerified}
            />
          </Field>
          {error && <p role="alert" className="text-[12px] font-medium text-[#B42335]">{error}</p>}
          <Button variant="secondary" size="sm" icon={RefreshCw} loading={busy} onClick={send} disabled={busy}>
            {t("verify.resend")}
          </Button>
        </div>
      )}
      {!isVerified && c.status === "pending" && (
        <div className="space-y-2">
          <Field label={t("verify.enterCode")} htmlFor={`vc-code-${channel}`} required hint={t("verify.ttl", { n: num(OTP_TTL_MINUTES) })}>
            <Input id={`vc-code-${channel}`} inputMode="numeric" maxLength={OTP_LENGTH} value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" />
          </Field>
          <Button size="sm" icon={ShieldCheck} loading={busy} onClick={submit} disabled={busy}>{t("verify.submitCode")}</Button>
          {lastCode && (
            <p className="rounded-sm bg-[#F6E7E5]/60 px-3 py-2 text-[12px] text-[#541B2B]">
              {t("verify.codeShownHere", { code: lastCode })}
            </p>
          )}
        </div>
      )}
      {isVerified && <p className="text-[12px] text-[#26734D]">{t("verify.st.verified")}</p>}
      {c.attempts > 0 && <p className="text-[11px] text-slate-400">{t("verify.attemptsLeft", { n: num(Math.max(OTP_MAX_ATTEMPTS - c.attempts, 0)) })}</p>}
      {cfg.type === "none" && <p className="text-[12px] text-[#A45A16]">{t("verify.providerNotConfigured", { channel: t(`verify.providerChannel.${channel}`) })}</p>}
    </div>
  );
}

// thin wrappers so the OTP round trip is easy to invoke from the UI
async function getVerificationCode(channel: "phone" | "email", destination: string) {
  const { requestVerificationCode } = await import("@/lib/api");
  return requestVerificationCode(channel, destination);
}
async function verifyCode(channel: "phone" | "email", code: string) {
  const { verifyContactCode } = await import("@/lib/api");
  return verifyContactCode(channel, code);
}

function BusinessCheck() {
  const { t } = useI18n();
  const res = useQuery(() => getVerification());
  const evidence = useQuery(() => getBusinessEvidence());
  const [form, setForm] = useState({
    businessType: "" as BusinessType,
    businessName: "",
    ownerName: "",
    udyamNumber: "",
    location: "",
    description: "",
    documentTitle: "",
    documentValue: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const v = res.data?.verification;
  const ev = evidence.data;

  const submit = async () => {
    setError("");
    const payload: BusinessEvidence = {
      businessType: form.businessType || "other",
      businessName: form.businessName,
      ownerName: form.ownerName,
      udyamNumber: form.udyamNumber,
      location: form.location,
      description: form.description,
      documents: form.documentTitle ? [{ title: form.documentTitle, type: "link", value: form.documentValue }] : [],
    };
    setBusy(true);
    try {
      submitBusinessEvidence(payload);
      toast.success(t("verify.bizPending"));
      navigate("/verification");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!v) return null;
  const b = v.business;
  if (b.status === "verified") return <p className="text-sm text-[#26734D]">{t("verify.trust.business")}</p>;

  return (
    <div className="space-y-4">
      {b.status === "rejected" && (
        <div className="border-l-2 border-[#B42335] bg-[#B42335]/5 p-3 text-[13px] text-[#7a1824]">
          {t("verify.bizRejected")}
          {b.rejectionVars?.reason && <> — {t("verify.bizRejectedReason", { reason: b.rejectionVars.reason })}</>}
        </div>
      )}
      {b.status === "pending" && (
        <div className="border-l-2 border-[#A45A16] bg-[#A45A16]/5 p-3 text-[13px] text-[#A45A16]">{t("verify.bizPending")}</div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("verify.bizType")} htmlFor="vc-biz-type" required>
          <Select id="vc-biz-type" value={form.businessType} onChange={(e) => setForm({ ...form, businessType: e.target.value as BusinessType })}>
            <option value="">—</option>
            {BUSINESS_TYPES.map((bt) => <option key={bt} value={bt}>{t(`verify.bizType.${bt}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("verify.bizName")} htmlFor="vc-biz-name" required>
          <Input id="vc-biz-name" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
        </Field>
        <Field label={t("verify.bizOwner")} htmlFor="vc-biz-owner" required>
          <Input id="vc-biz-owner" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
        </Field>
        <Field label={t("verify.bizUdyam")} htmlFor="vc-biz-udyam">
          <Input id="vc-biz-udyam" value={form.udyamNumber} onChange={(e) => setForm({ ...form, udyamNumber: e.target.value.replace(/[^0-9]/g, "") })} inputMode="numeric" maxLength={10} />
        </Field>
        <Field label={t("verify.bizLocation")} htmlFor="vc-biz-loc" required>
          <Input id="vc-biz-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
        <Field label={t("verify.bizDoc")} htmlFor="vc-biz-doc" hint={t("verify.evidencePrivate")}>
          <Input id="vc-biz-doc" value={form.documentTitle} onChange={(e) => setForm({ ...form, documentTitle: e.target.value })} placeholder={t("verify.bizDocPh")} />
          <Input value={form.documentValue} onChange={(e) => setForm({ ...form, documentValue: e.target.value })} placeholder="https://" aria-label={t("verify.bizDoc")} className="mt-2" />
        </Field>
      </div>
      <Field label={t("verify.bizDesc")} htmlFor="vc-biz-desc" required>
        <Textarea id="vc-biz-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("verify.bizDescPh")} />
      </Field>
      <p className="text-[12px] text-slate-500">{t("verify.bizUnregisteredNote")}</p>
      {error && <p role="alert" className="text-[12px] font-medium text-[#B42335]">{error}</p>}
      <Button icon={Building2} loading={busy} onClick={submit} disabled={busy}>{t("verify.bizSubmit")}</Button>

      {ev && !ev.reviewer && ev.evidence && (
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("verify.bizView")}</p>
          <dl className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2">
            {[
              [t("verify.bizName"), ev.evidence.businessName],
              [t("verify.bizOwner"), ev.evidence.ownerName],
              [t("verify.bizUdyam"), ev.evidence.udyamNumber || "—"],
              [t("verify.bizLocation"), ev.evidence.location],
            ].map(([k, val]) => (
              <div key={k as string} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right text-slate-700">{val}</dd></div>
            ))}
            <div className="sm:col-span-2"><dt className="text-slate-500">{t("verify.bizDesc")}</dt><dd className="text-slate-700">{ev.evidence.description}</dd></div>
          </dl>
          {ev.evidence.documents.map((d) => (
            <a key={d.title} href={d.value} target="_blank" rel="noopener noreferrer nofollow" className={cn("mt-2 block break-all text-[12px] font-medium text-[#541B2B]", focusRing)}>{d.title}</a>
          ))}
        </Card>
      )}
    </div>
  );
}

function IdentityCheck() {
  const { t } = useI18n();
  const res = useQuery(() => getVerification());
  const [form, setForm] = useState({ fullName: "", idReference: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const d = res.data;
  const v = d?.verification;
  if (!d || !v) return null;

  if (v.identity.status === "verified") {
    return (
      <div className="space-y-2">
        <p className="text-[12px] text-[#26734D]">{t("verify.st.verified")}</p>
        {v.identity.submission && (
          <p className="text-[11px] text-slate-500">{t("verify.identitySubmissionTitle")}: {v.identity.submission.fullName}</p>
        )}
      </div>
    );
  }

  if (d.identityType === "none") {
    return (
      <div className="border-l-2 border-[#E9DFDC] bg-[#FFF8F0] p-3 text-[13px] text-slate-500">
        <p className="flex items-center gap-2 font-medium text-slate-700"><Info className="h-4 w-4 shrink-0 text-[#8a3b44]" />{t("verify.identityUnavailable")}</p>
        <p className="mt-1">{t("verify.identityNote")}</p>
      </div>
    );
  }

  const cfg = d.provider.identity;
  const status = v.identity.status;

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      submitIdentityVerification(form);
      toast.success(t("verify.identityPending"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {status === "pending" && (
        <div className="border-l-2 border-[#A45A16] bg-[#A45A16]/5 p-3 text-[13px] text-[#A45A16]">
          {t("verify.identityPending")}
          {cfg.type === "manual" && <> — {t("verify.identitySubmitDesc")}</>}
        </div>
      )}
      {status === "rejected" && (
        <div className="border-l-2 border-[#B42335] bg-[#B42335]/5 p-3 text-[13px] text-[#B42335]">
          {t("verify.bizRejected")}
          {v.identity.rejectionVars?.reason && <> — {t("verify.bizRejectedReason", { reason: v.identity.rejectionVars.reason })}</>}
        </div>
      )}
      {v.identity.submission && (
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("verify.identitySubmissionTitle")}</p>
          <dl className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">{t("verify.identityFullName")}</dt><dd className="text-right text-slate-700">{v.identity.submission.fullName}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">{t("verify.identityRef")}</dt><dd className="text-right text-slate-700">{v.identity.submission.idReference}</dd></div>
            <div className="sm:col-span-2"><dt className="text-slate-500">{t("verify.identityNote")}</dt><dd className="text-slate-700">{v.identity.submission.note}</dd></div>
          </dl>
          <p className="mt-2 text-[11px] text-slate-400">{t("verify.identityPrivacyNote")}</p>
        </Card>
      )}
      {!v.identity.submission && status !== "rejected" && (
        <div className="space-y-2">
          <Field label={t("verify.identityFullName")} htmlFor="vi-name" required>
            <Input id="vi-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder={t("verify.identityFullNamePh")} />
          </Field>
          <Field label={t("verify.identityRef")} htmlFor="vi-ref" required hint={t("verify.identityPrivacyNote")}>
            <Input id="vi-ref" value={form.idReference} onChange={(e) => setForm({ ...form, idReference: e.target.value })} placeholder={t("verify.identityRefPh")} />
          </Field>
          <Field label={t("verify.identityNote")} htmlFor="vi-note" required>
            <Textarea id="vi-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={t("verify.identityNotePh")} className="min-h-[72px]" />
          </Field>
          {error && <p role="alert" className="text-[12px] font-medium text-[#B42335]">{error}</p>}
          <Button icon={ShieldCheck} loading={busy} onClick={submit} disabled={busy}>{t("verify.identitySubmitTitle")}</Button>
        </div>
      )}
      {status === "rejected" && (
        <Button icon={RefreshCw} variant="soft" size="sm" onClick={() => { setForm({ fullName: form.fullName, idReference: form.idReference, note: form.note }); }}>{t("verify.bizResubmit")}</Button>
      )}
    </div>
  );
}

function ExchangesCheck() {
  const { t, tn } = useI18n();
  const res = useQuery(() => getVerification());
  const v = res.data?.verification;
  if (!v) return null;
  return (
    <div className="text-[13px] text-slate-500">
      {v.completedExchanges > 0 ? tn("verify.exchangesCount", v.completedExchanges) : t("verify.exchangesZero")}
      <p className="mt-1 text-[12px]">{t("verify.exchangesNote")}</p>
    </div>
  );
}

function ProviderConfig() {
  const { t } = useI18n();
  const res = useQuery(() => getVerification());
  const [form, setForm] = useState({ phoneType: "demo", phoneEndpoint: "", phoneToken: "", emailType: "demo", emailEndpoint: "", emailToken: "" });
  const d = res.data!;
  const submit = (channel: "phone" | "email") => {
    const type = channel === "phone" ? form.phoneType : form.emailType;
    const endpoint = channel === "phone" ? form.phoneEndpoint : form.emailEndpoint;
    const token = channel === "phone" ? form.phoneToken : form.emailToken;
    try {
      updateProviderConfig(channel, { type: type as "none" | "http" | "demo", endpoint, apiToken: token, label: t(`verify.providerChannel.${channel}`) });
      toast.success(t("verify.providerSave"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="space-y-5">
      <p className="text-[12px] text-slate-500">{t("verify.providerDesc")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["phone", "email"] as const).map((channel) => {
          const cfg = d.provider[channel];
          const type = channel === "phone" ? form.phoneType : form.emailType;
          const endpoint = channel === "phone" ? form.phoneEndpoint : form.emailEndpoint;
          const token = channel === "phone" ? form.phoneToken : form.emailToken;
          return (
            <Card key={channel} className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t(`verify.providerChannel.${channel}`)}</p>
              <div className="mt-2 space-y-2">
                <Select aria-label={t("verify.providerType")} value={type} onChange={(e) => setForm((f) => ({ ...f, [`${channel}Type`]: e.target.value }))}>
                  <option value="demo">{t("verify.providerType.demo")}</option>
                  <option value="http">{t("verify.providerType.http")}</option>
                  <option value="none">{t("verify.providerType.none")}</option>
                </Select>
                {type === "http" && (
                  <>
                    <Input aria-label={t("verify.providerEndpoint")} value={endpoint} onChange={(e) => setForm((f) => ({ ...f, [`${channel}Endpoint`]: e.target.value }))} placeholder="https://gateway.example.com/send" />
                    <Input aria-label={t("verify.providerToken")} value={token} onChange={(e) => setForm((f) => ({ ...f, [`${channel}Token`]: e.target.value }))} placeholder="sk_…" />
                  </>
                )}
                <Button size="sm" variant="secondary" onClick={() => submit(channel)}>{t("verify.providerSave")}</Button>
                <p className="text-[11px] text-slate-400">{cfg.label} · {cfg.type}</p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ModeratorPanel() {
  const { t } = useI18n();
  const ev = useQuery(() => getBusinessEvidence());
  const idEv = useQuery(() => (isReviewer() ? getIdentityEvidence() : null));
  const queue = useQuery(() => (isReviewer() ? getListingReviewQueue() : []));
  const [reason, setReason] = useState("");

  if (!isReviewer()) {
    return (
      <Card className="p-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a3b44]">{t("verify.reviewerTitle")}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-500">{t("verify.reviewerDesc")}</p>
        <p className="mt-3 text-[12px] text-slate-500">{t("verify.adminNotYou")}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {idEv.data && idEv.data.reviewer && (
        <section>
          <SectionTitle title={t("verify.identityReviewQueue")} />
          {!idEv.data.submissions?.length ? (
            <p className="py-6 text-[13px] text-slate-500">{t("verify.reviewQueueEmpty")}</p>
          ) : (
            <ul className="space-y-3">
              {idEv.data.submissions.map((s) => (
                <li key={s.userId} className="border-b border-[#E9DFDC] pb-4 last:border-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[#29232A]">{s.ownerName}</p>
                      <p className="text-[12px] text-slate-500">{s.submission!.fullName} · {s.submission!.idReference}</p>
                      <p className="mt-1 text-[12px] text-slate-600">{s.submission!.note}</p>
                      <p className="text-[11px] text-slate-400">{t("verify.identitySubmitted")}</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Button size="sm" icon={Check} onClick={() => { reviewIdentityVerification(s.userId, "approve"); toast.success(t("verify.identityApproved")); }}>{t("verify.approve")}</Button>
                      <Button size="sm" variant="secondary" icon={Circle} onClick={() => { try { reviewIdentityVerification(s.userId, "reject", reason); toast.success(t("verify.bizRejected")); setReason(""); } catch (e) { toast.error(errMsg(e)); } }}>{t("verify.reject")}</Button>
                    </div>
                  </div>
                  {reason && <Textarea aria-label={t("verify.rejectReason")} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 min-h-[60px]" placeholder={t("verify.rejectReasonPh")} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {ev.data && ev.data.reviewer && (
        <section>
          <SectionTitle title={t("verify.reviewerQueue")} />
          {!ev.data.submissions?.length ? (
            <p className="py-6 text-[13px] text-slate-500">{t("verify.reviewQueueEmpty")}</p>
          ) : (
            <ul className="space-y-3">
              {ev.data.submissions.map((s) => (
                <li key={s.userId} className="border-b border-[#E9DFDC] pb-4 last:border-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[#29232A]">{s.ownerName}</p>
                      <p className="text-[12px] text-slate-500">{t(L.biz(s.evidence!.businessType))} · {s.evidence!.businessName}</p>
                      <p className="text-[12px] text-slate-500">{s.evidence!.location} · {t("verify.bizUdyam")}: {s.evidence!.udyamNumber || "—"}</p>
                      <p className="mt-1 text-[12px] text-slate-600">{s.evidence!.description}</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Button size="sm" icon={Check} onClick={() => { reviewBusinessEvidence(s.userId, "approve"); toast.success(t("verify.bizReviewed")); }}>{t("verify.approve")}</Button>
                      <Button size="sm" variant="secondary" icon={Circle} onClick={() => { try { reviewBusinessEvidence(s.userId, "reject", reason); toast.success(t("verify.bizRejected")); setReason(""); } catch (e) { toast.error(errMsg(e)); } }}>{t("verify.reject")}</Button>
                    </div>
                  </div>
                  {reason && <Textarea aria-label={t("verify.rejectReason")} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 min-h-[60px]" placeholder={t("verify.rejectReasonPh")} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <SectionTitle title={t("verify.reviewerListings")} />
        {!queue.data?.length ? (
          <p className="py-6 text-[13px] text-slate-500">{t("verify.reviewQueueEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {queue.data.map(({ listing, ownerName, ownerUsername, businessVerified }) => (
              <li key={listing.id} className="border-b border-[#E9DFDC] pb-4 last:border-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[#29232A]">{listing.title}</p>
                    <p className="text-[12px] text-slate-500">{ownerName}{ownerUsername && ` · @${ownerUsername}`}</p>
                    <p className="mt-1 text-[12px] text-slate-500">{listing.category} · {listing.type}</p>
                    <p className="mt-1 line-clamp-2 text-[12px] text-slate-600">{listing.description}</p>
                    <TrustBadges v={{ phoneVerified: false, emailVerified: false, businessVerified, identityVerified: false, completedExchanges: 0, trust: "new" }} spacing="gap-x-2" className="mt-1" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Button size="sm" icon={Check} onClick={() => { reviewListing(listing.id, "approve"); toast.success(t("verify.listingPublished")); }}>{t("verify.approve")}</Button>
                    <Button size="sm" variant="secondary" icon={Circle} onClick={() => { try { reviewListing(listing.id, "reject", reason); toast.success(t("verify.listingRejected")); setReason(""); } catch (e) { toast.error(errMsg(e)); } }}>{t("verify.reject")}</Button>
                  </div>
                </div>
                {reason && <Textarea aria-label={t("verify.rejectReason")} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 min-h-[60px]" placeholder={t("verify.rejectReasonPh")} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function Verification() {
  const { t, ago } = useI18n();
  const res = useQuery(() => getVerification());
  const events = useQuery(() => getVerifyEvents(12));

  const trust = useMemo(() => res.data?.verification.trust ?? "new", [res.data]);
  const eligibility = useMemo(() => res.data?.eligibility ?? { ok: false, required: [], missing: [] }, [res.data]);
  if (res.error) return <ErrorState message={res.error} />;
  const d = res.data!;
  const v = d.verification;

  return (
    <div className="space-y-12">
      <header className="border-b border-[#E9DFDC] pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a3b44]">{t("verify.eyebrow")}</p>
        <h1 className="display mt-2 text-[34px] font-semibold text-[#541B2B]">{t("verify.title")}</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-slate-500">{t("verify.subtitle")}</p>
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
          <TrustLevel trust={trust} />
          <TrustBadges v={{ phoneVerified: v.phone.status === "verified", emailVerified: v.email.status === "verified", businessVerified: v.business.status === "verified", identityVerified: v.identity.status === "verified", completedExchanges: v.completedExchanges, trust }} />
        </div>

        {/* Mandatory checklist: the same eligibility rule the server enforces */}
        <div className="mt-6 border-y border-[#E9DFDC] py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a3b44]">{t("verify.mandatoryTitle")}</p>
          <ul className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {eligibility.required.map((step) => {
              const done = step.status === "verified";
              return (
                <li key={step.channel} className="flex items-center gap-2.5">
                  {done ? (
                    <Check className="h-4 w-4 shrink-0 text-[#26734D]" aria-hidden />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-[#A45A16]" aria-hidden />
                  )}
                  <span className={cn("text-[13px]", done ? "text-slate-500" : "font-medium text-[#29232A]")}>
                    {t(step.key)}
                    <span className="ml-2 text-[11px] uppercase tracking-[0.08em] text-slate-400">
                      {done ? t("verify.st.verified") : t(`verify.st.${step.status}`)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          {eligibility.ok ? (
            <p className="mt-3 text-[12.5px] text-[#26734D]">{t("verify.eligibleNow")}</p>
          ) : (
            <p className="mt-3 text-[12.5px] text-[#A45A16]">{t("verify.publishBlockedNote", { steps: eligibility.missing.map((s) => t(s.key)).join(", ") })}</p>
          )}
        </div>
      </header>

      <section aria-label={t("verify.contactTitle")}>
        <SectionTitle title={t("verify.contactTitle")} sub={t("verify.contactSub")} />
        <div className="grid gap-5 lg:grid-cols-2">
          <CheckRow
            icon={Phone}
            title={t("verify.phoneTitle")}
            hint={t("verify.phoneHint")}
            status={v.phone.status}
            masked={v.phone.masked}
            note={v.phone.note as Key | undefined}
          >
            <ContactCheck channel="phone" />
          </CheckRow>
          <CheckRow
            icon={Mail}
            title={t("verify.emailTitle")}
            hint={t("verify.emailHint")}
            status={v.email.status}
            masked={v.email.masked}
            note={v.email.note as Key | undefined}
          >
            <ContactCheck channel="email" />
          </CheckRow>
        </div>
      </section>

      <section aria-label={t("verify.businessTitle")}>
        <SectionTitle title={t("verify.businessTitle")} sub={t("verify.businessSub")} />
        <CheckRow icon={Building2} title={t("verify.businessTitle")} hint={t("verify.businessSub")} status={v.business.status}>
          <BusinessCheck />
        </CheckRow>
      </section>

      <section aria-label={t("verify.identityTitle")}>
        <SectionTitle title={t("verify.identityTitle")} sub={t("verify.identitySub")} />
        <CheckRow icon={ShieldCheck} title={t("verify.identityTitle")} hint={t("verify.identitySub")} status={v.identity.status}>
          <IdentityCheck />
        </CheckRow>
      </section>

      <section aria-label={t("verify.exchangesTitle")}>
        <SectionTitle title={t("verify.exchangesTitle")} sub={t("verify.exchangesSub")} />
        <CheckRow icon={Users2} title={t("verify.exchangesTitle")} hint={t("verify.exchangesSub")} status="not_started">
          <ExchangesCheck />
        </CheckRow>
      </section>

      <section aria-label={t("verify.providerTitle")}>
        <SectionTitle title={t("verify.providerTitle")} sub={t("verify.providerDesc")} />
        <ProviderConfig />
      </section>

      <section aria-label={t("verify.reviewerTitle")}>
        <SectionTitle title={t("verify.reviewerTitle")} sub={t("verify.reviewerDesc")} />
        <ModeratorPanel />
      </section>

      <section aria-label={t("verify.historyTitle")}>
        <SectionTitle title={t("verify.historyTitle")} />
        {!events.data?.length ? (
          <p className="py-6 text-[13px] text-slate-500">{t("verify.historyEmpty")}</p>
        ) : (
          <ul>
            {events.data.map((e) => (
              <li key={e.id} className="border-b border-[#E9DFDC] last:border-0">
                <div className="flex items-baseline gap-3 py-3">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{t(e.key as Key, e.vars)}</span>
                  <time dateTime={e.createdAt} className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-slate-400">{ago(e.createdAt)}</time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
