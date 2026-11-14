import { useMemo, useState } from "react";
import { Check, Circle, Inbox, ShieldCheck, ShieldAlert, UserCog, X } from "lucide-react";
import { cn } from "@/utils/cn";
import {
  getAdminOverview, getAdminUsers, isAdmin, setAccountStatus,
} from "@/lib/api";
import {
  getAdminReviewQueue, getAdminReviewHistory, reviewBusinessEvidence, reviewIdentityVerification,
} from "@/lib/verification-api";
import { L, useI18n, type Key } from "@/lib/i18n";
import { useDebounced, useQuery } from "@/lib/hooks";
import { useI18n as useI18nT } from "@/lib/i18n";
import { navigate } from "@/lib/router";
import type { BusinessEvidence, IdentitySubmission } from "@/lib/types";
import {
  Button, Card, EmptyState, ErrorState, SectionTitle, SearchInput, Select, Textarea, errMsg, focusRing, toast,
} from "@/components/ui";
import { ConfirmDialog } from "@/components/ui";

type Submission = {
  userId: string;
  type: "business" | "identity";
  submittedAt: string | undefined;
  reviewedAt?: string;
  status: string;
  ownerName: string;
  ownerUsername?: string;
  evidence?: BusinessEvidence;
  submission?: IdentitySubmission;
  rejectionReason?: string;
};

type FilterKey = "pending" | "approved" | "rejected";
type TypeKey = "all" | "business" | "identity";

function SubmissionRow({ s, onReviewed }: { s: Submission; onReviewed: () => void }) {
  const { t, ago } = useI18nT();
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);

  const approve = async () => {
    try {
      if (s.type === "business") await reviewBusinessEvidence(s.userId, "approve");
      else await reviewIdentityVerification(s.userId, "approve");
      toast.success(t("verify.approve"));
      onReviewed();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const reject = async () => {
    try {
      if (s.type === "business") await reviewBusinessEvidence(s.userId, "reject", reason);
      else await reviewIdentityVerification(s.userId, "reject", reason);
      toast.success(t("verify.reject"));
      setReason("");
      setOpen(false);
      onReviewed();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Card className="border-l-2 border-l-[#E9DFDC] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-[13px] font-semibold text-[#29232A]">
              {s.ownerName} {s.ownerUsername ? <span className="font-normal text-slate-400">@{s.ownerUsername}</span> : null}
            </p>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#8a3b44]">
              {s.type === "business" ? t("admin.filter.business") : t("admin.filter.identity")}
            </span>
            <time dateTime={s.submittedAt} className="text-[11px] text-slate-400">{s.submittedAt ? ago(s.submittedAt) : "—"}</time>
          </div>

          {s.type === "business" && s.evidence && (
            <dl className="mt-2 grid gap-2 text-[12.5px] sm:grid-cols-2">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{t("verify.bizType")}</dt><dd className="text-right text-slate-700">{t(L.biz(s.evidence.businessType))}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{t("verify.bizName")}</dt><dd className="text-right text-slate-700">{s.evidence.businessName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{t("verify.bizOwner")}</dt><dd className="text-right text-slate-700">{s.evidence.ownerName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{t("verify.bizUdyam")}</dt><dd className="text-right text-slate-700">{s.evidence.udyamNumber || "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{t("verify.bizLocation")}</dt><dd className="text-right text-slate-700">{s.evidence.location}</dd></div>
              <div className="sm:col-span-2"><dt className="text-slate-500">{t("verify.bizDesc")}</dt><dd className="text-slate-700">{s.evidence.description}</dd></div>
              {s.evidence.documents.map((d) => (
                <div key={d.title} className="sm:col-span-2">
                  <dt className="text-slate-500">{d.title}</dt>
                  <dd>
                    {d.value.startsWith("http") ? (
                      <a href={d.value} target="_blank" rel="noopener noreferrer nofollow" className={cn("text-[12px] font-medium text-[#541B2B]", focusRing)}>{d.value}</a>
                    ) : (
                      <span className="text-[12px] text-slate-700">{d.value}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {s.type === "identity" && s.submission && (
            <dl className="mt-2 grid gap-2 text-[12.5px] sm:grid-cols-2">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{t("verify.identityFullName")}</dt><dd className="text-right text-slate-700">{s.submission.fullName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{t("verify.identityRef")}</dt><dd className="text-right text-slate-700">{s.submission.idReference}</dd></div>
              <div className="sm:col-span-2"><dt className="text-slate-500">{t("verify.identityNote")}</dt><dd className="text-slate-700">{s.submission.note}</dd></div>
            </dl>
          )}
          {s.rejectionReason && (
            <p className="mt-2 text-[12px] text-[#B42335]">{t("verify.bizRejectedReason", { reason: s.rejectionReason })}</p>
          )}
          <p className="mt-2 text-[11px] text-slate-400">{t("verify.evidencePrivate")}</p>
        </div>
        {s.status === "pending" ? (
          <div className="flex shrink-0 flex-col gap-1.5">
            <Button size="sm" icon={Check} onClick={approve}>{t("verify.approve")}</Button>
            <Button size="sm" variant="secondary" icon={Circle} onClick={() => setOpen((o) => !o)}>{t("verify.reject")}</Button>
          </div>
        ) : (
          <Badge dot={s.status === "verified"}>
            {s.status === "verified" ? t("admin.filter.approved") : t("admin.filter.rejected")}
          </Badge>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-2 border-t border-[#E9DFDC] pt-3">
          <Textarea aria-label={t("verify.rejectReason")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("verify.rejectReasonPh")} className="min-h-[64px]" />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" onClick={reject}>{t("verify.reject")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

type AdminUser = Awaited<ReturnType<typeof getAdminUsers>>["users"][number];

function UserRow({ u, onChanged }: { u: AdminUser; onChanged: () => void }) {
  const { t, date } = useI18nT();
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");

  const doSuspend = async () => {
    try {
      await setAccountStatus(u.userId, "suspended", suspendReason);
      toast.success(t("admin.user.status.suspended"));
      setSuspendOpen(false);
      setSuspendReason("");
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Card className="border-l-2 border-l-[#E9DFDC] p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[#29232A]">{u.fullName} <span className="font-normal text-slate-400">@{u.username}</span></p>
          <p className="text-[11px] text-slate-500">{u.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <span className="text-slate-500">{t("admin.user.created")}: <b className="text-slate-700">{date(u.createdAt)}</b></span>
          <span className="text-slate-500">{t("admin.user.listings")}: <b className="text-slate-700">{u.listings}</b></span>
          <Badge dot={u.phoneVerified}>{t("verify.st.verified")}</Badge>
          <Badge dot={u.emailVerified}>{t("verify.st.verified")}</Badge>
          <Badge dot={u.businessVerified}>{t("verify.st.verified")}</Badge>
          <Badge dot={u.identityVerified}>{t("verify.st.verified")}</Badge>
          {u.status === "suspended" ? (
            <span className="rounded-sm bg-red-50 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-red-700 ring-1 ring-red-600/15">{t("admin.user.status.suspended")}</span>
          ) : (
            <span className="rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-emerald-700 ring-1 ring-emerald-600/15">{t("admin.user.status.active")}</span>
          )}
        </div>
        {u.role === "admin" ? (
          <span className="rounded-sm bg-[#F6E7E5] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[#541B2B] ring-1 ring-[#541B2B]/15">{t("admin.user.role.admin")}</span>
        ) : (
          <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-600 ring-1 ring-slate-500/15">{t("admin.user.role.member")}</span>
        )}
      </div>
      {u.role !== "admin" && u.status === "active" && (
        <div className="mt-2">
          <Button size="sm" variant="ghost" icon={ShieldAlert} onClick={() => setSuspendOpen(true)} className="text-red-600 hover:bg-red-50 hover:text-red-700">{t("admin.user.suspend")}</Button>
        </div>
      )}
      {u.role !== "admin" && u.status === "suspended" && (
        <div className="mt-2">
          <Button size="sm" variant="ghost" icon={Check} onClick={async () => { try { await setAccountStatus(u.userId, "active"); toast.success(t("admin.user.status.active")); onChanged(); } catch (e) { toast.error(errMsg(e)); } }}>{t("admin.user.activate")}</Button>
        </div>
      )}
      {suspendOpen && (
        <ConfirmDialog
          open={suspendOpen}
          onClose={() => setSuspendOpen(false)}
          onConfirm={doSuspend}
          title={t("admin.confirm.suspend")}
          body={t("admin.confirm.suspendBody")}
          confirmLabel={t("admin.user.suspend")}
          tone="danger"
        >
          <Textarea aria-label={t("verify.rejectReason")} value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder={t("verify.rejectReasonPh")} className="mt-3 min-h-[64px]" />
        </ConfirmDialog>
      )}
    </Card>
  );
}

function Badge({ dot, children }: { dot: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] ring-1 ring-inset",
      dot ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15" : "bg-slate-100 text-slate-400 ring-slate-500/15")}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot ? "bg-emerald-500" : "bg-slate-300")} aria-hidden />
      {children}
    </span>
  );
}

export default function Admin() {
  const { t } = useI18n();
  const isAdminUser = useQuery(() => isAdmin());
  const overview = useQuery(() => (isAdminUser.data ? getAdminOverview() : null));
  const queue = useQuery(() => (isAdminUser.data ? getAdminReviewQueue() : null));
  const history = useQuery(() => (isAdminUser.data ? getAdminReviewHistory() : []));
  const [tab, setTab] = useState<"requests" | "users">("requests");
  const tabOnChange = (v: string) => setTab(v as "requests" | "users");
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [typeFilter, setTypeFilter] = useState<TypeKey>("all");
  const [userQuery, setUserQuery] = useState("");
  const dUserQuery = useDebounced(userQuery, 200);
  const users = useQuery(() => (isAdminUser.data ? getAdminUsers(dUserQuery) : null), [dUserQuery]);

  const allSubmissions: Submission[] = useMemo(() => {
    if (!queue.data) return [];
    return queue.data.all;
  }, [queue.data]);

  if (!isAdminUser.data) {
    return (
      <EmptyState icon={ShieldCheck} title={t("admin.unauthorizedTitle")} body={t("admin.unauthorizedBody")}>
        <Button variant="secondary" onClick={() => navigate("/dashboard")}>{t("admin.goDashboard")}</Button>
      </EmptyState>
    );
  }

  if (queue.error || overview.error) return <ErrorState message={queue.error ?? overview.error ?? ""} />;

  const filtered = allSubmissions.filter((s) => {
    if (filter === "pending" && s.status !== "pending") return false;
    if (filter === "approved" && s.status !== "verified") return false;
    if (filter === "rejected" && s.status !== "rejected") return false;
    if (typeFilter !== "all" && s.type !== typeFilter) return false;
    return true;
  });

  const o = overview.data ?? { totalUsers: 0, pending: 0, approved: 0, rejected: 0, bizPending: 0, idPending: 0, totalListings: 0, activeExchanges: 0, completedExchanges: 0 };

  return (
    <div className="space-y-12">
      <header className="border-b border-[#E9DFDC] pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a3b44]">{t("admin.eyebrow")}</p>
        <h1 className="display mt-2 text-[34px] font-semibold text-[#541B2B]">{t("admin.title")}</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-slate-500">{t("admin.subtitle")}</p>
        <div className="mt-5 grid grid-cols-2 border-y border-[#E9DFDC] sm:grid-cols-3 lg:grid-cols-5">
          <StatCell label={t("admin.stat.totalUsers")} value={o.totalUsers} />
          <StatCell label={t("admin.stat.pending")} value={o.pending} tone="amber" />
          <StatCell label={t("admin.stat.approved")} value={o.approved} tone="green" />
          <StatCell label={t("admin.stat.rejected")} value={o.rejected} tone="red" />
          <StatCell label={t("admin.stat.history")} value={history.data?.length ?? 0} />
        </div>
        <div className="mt-px grid grid-cols-2 border-b border-[#E9DFDC] sm:grid-cols-3 lg:grid-cols-5">
          <StatCell label={t("admin.stat.business")} value={o.bizPending} tone="amber" />
          <StatCell label={t("admin.stat.identity")} value={o.idPending} tone="amber" />
          <StatCell label={t("admin.stat.totalListings")} value={o.totalListings} />
          <StatCell label={t("admin.stat.activeExchanges")} value={o.activeExchanges} />
          <StatCell label={t("admin.stat.completedExchanges")} value={o.completedExchanges} tone="green" />
        </div>
      </header>

      <Tabs
        tabs={[
          { value: "requests", label: t("admin.pendingTitle") },
          { value: "users", label: t("admin.user.search"), icon: UserCog },
        ]}
        value={tab}
        onChange={tabOnChange}
      />

      {tab === "requests" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Chip active={filter === "pending"} onClick={() => setFilter("pending")}>{t("admin.filter.pending")}</Chip>
              <Chip active={filter === "approved"} onClick={() => setFilter("approved")}>{t("admin.filter.approved")}</Chip>
              <Chip active={filter === "rejected"} onClick={() => setFilter("rejected")}>{t("admin.filter.rejected")}</Chip>
            </div>
            <Select aria-label={t("admin.filter.allTypes")} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeKey)} className="w-44">
              <option value="all">{t("admin.filter.allTypes")}</option>
              <option value="business">{t("admin.filter.business")}</option>
              <option value="identity">{t("admin.filter.identity")}</option>
            </Select>
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon={Inbox} title={t("admin.noPendingTitle")} body={t("admin.noPendingBody")} />
          ) : (
            <ul className="space-y-4">
              {filtered.map((s) => <li key={s.userId + s.type}><SubmissionRow s={s} onReviewed={() => { queue.refetch(); history.refetch(); }} /></li>)}
            </ul>
          )}
        </div>
      )}

      {tab === "users" && (
        <div className="space-y-6">
          <SearchInput value={userQuery} onChange={setUserQuery} label={t("admin.user.search")} placeholder={t("admin.user.search")} className="max-w-xl" />
          {users.error ? (
            <ErrorState message={users.error} />
          ) : !users.data?.users.length ? (
            <EmptyState icon={UserCog} title={t("admin.noPendingTitle")} body={t("admin.user.search")} />
          ) : (
            <ul className="space-y-3">
              {users.data.users.map((u) => <li key={u.userId}><UserRow u={u} onChanged={() => users.refetch()} /></li>)}
            </ul>
          )}
        </div>
      )}

      <section aria-label={t("admin.historyTitle")}>
        <SectionTitle title={t("admin.historyTitle")} sub={t("admin.historySub")} />
        {!history.data?.length ? (
          <p className="py-6 text-[13px] text-slate-500">{t("verify.historyEmpty")}</p>
        ) : (
          <ul>
            {history.data.map((e) => (
              <li key={e.id} className="border-b border-[#E9DFDC] last:border-0">
                <div className="flex items-baseline gap-3 py-3">
                  {e.type === "business_reviewed" ? <Check className="h-3.5 w-3.5 shrink-0 text-[#26734D]" /> : <X className="h-3.5 w-3.5 shrink-0 text-[#B42335]" />}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{t(e.key as Key, e.vars)}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{e.ownerName}</span>
                  <time dateTime={e.createdAt} className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-slate-400">{t("admin.historyTime", { time: new Date(e.createdAt).toLocaleString() })}</time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCell({ label, value, tone }: { label: string; value: number; tone?: "amber" | "green" | "red" }) {
  const toneCls = tone === "amber" ? "text-[#A45A16]" : tone === "green" ? "text-[#26734D]" : tone === "red" ? "text-[#B42335]" : "text-[#541B2B]";
  return (
    <div className="border-r border-[#E9DFDC] px-4 py-5 last:border-r-0">
      <p className={cn("display text-[30px] font-semibold tabular-nums", toneCls)}>{value}</p>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
    </div>
  );
}

function Tabs({ tabs, value, onChange }: { tabs: { value: string; label: string; icon?: React.ComponentType<{ className?: string }> }[]; value: string; onChange: (v: string) => void }) {
  const { t } = useI18nT();
  return (
    <div role="tablist" aria-label={t("admin.pendingTitle")} className="-mb-px flex gap-5 border-b border-[#E9DFDC]">
      {tabs.map((tab) => {
        const active = value === tab.value;
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2.5 pt-1 text-[13px] font-semibold transition-colors",
              active ? "border-[#541B2B] text-[#541B2B]" : "border-transparent text-slate-500 hover:text-[#541B2B]",
            )}
          >
            {tab.icon && <tab.icon className="h-3.5 w-3.5" />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "shrink-0 whitespace-nowrap border px-3 py-1.5 text-[12px] font-medium transition",
        active ? "border-[#541B2B] bg-[#541B2B] text-white" : "border-[#E9DFDC] bg-white text-slate-600 hover:border-[#541B2B] hover:text-[#541B2B]",
      )}
    >
      {children}
    </button>
  );
}
