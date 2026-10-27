import { useState } from "react";
import { Check, Clock, UserCheck, UserPlus, Users, X } from "lucide-react";
import {
  cancelFriendRequest,
  getConnectionState,
  getMyConnections,
  respondFriendRequest,
  sendFriendRequest,
} from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { Link } from "@/lib/router";
import { cn } from "@/utils/cn";
import { MessageButton } from "./listing";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, SectionTitle, Tabs, errMsg, focusRing, toast } from "./ui";

export function ConnectionActions({
  userId,
  fullName,
  includeMessageButton = false,
  size = "md",
}: {
  userId: string;
  fullName: string;
  includeMessageButton?: boolean;
  size?: "sm" | "md";
}) {
  const { t } = useI18n();
  const state = useQuery(() => getConnectionState(userId), [userId]);
  const [busy, setBusy] = useState<string | null>(null);

  if (state.error || !state.data || state.data.status === "self") return null;
  const rel = state.data.status;

  if (rel === "blocked") {
    return <Badge tone="slate">{t("pf.unavailable")}</Badge>;
  }

  const run = async (key: string, fn: () => Promise<unknown>, okText: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      toast.success(okText);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  if (rel === "none") {
    return (
      <Button
        size={size}
        variant="secondary"
        icon={UserPlus}
        loading={busy === "send"}
        disabled={!!busy}
        onClick={() => void run("send", () => sendFriendRequest(userId), t("conn.sentToast", { name: fullName }))}
      >
        {t("conn.addFriend")}
      </Button>
    );
  }

  if (rel === "outgoing_pending") {
    return (
      <div className="inline-flex flex-wrap items-center gap-2">
        <Badge tone="amber" icon={Clock}>{t("conn.requestSent")}</Badge>
        <Button
          size="sm"
          variant="ghost"
          icon={X}
          loading={busy === "cancel"}
          disabled={!!busy}
          onClick={() => void run("cancel", () => cancelFriendRequest(userId), t("conn.cancelledToast"))}
        >
          {t("conn.cancelRequest")}
        </Button>
      </div>
    );
  }

  if (rel === "incoming_pending") {
    return (
      <div className="inline-flex flex-wrap items-center gap-2">
        <Button
          size={size}
          icon={Check}
          loading={busy === "accept"}
          disabled={!!busy}
          onClick={() => void run("accept", () => respondFriendRequest(userId, "accept"), t("conn.acceptedToast", { name: fullName }))}
        >
          {t("conn.acceptRequest")}
        </Button>
        <Button
          size={size}
          variant="secondary"
          icon={X}
          loading={busy === "reject"}
          disabled={!!busy}
          onClick={() => void run("reject", () => respondFriendRequest(userId, "reject"), t("conn.rejectedToast"))}
        >
          {t("conn.rejectRequest")}
        </Button>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <Badge tone="green" icon={UserCheck}>{t("conn.friends")}</Badge>
      {includeMessageButton && <MessageButton userId={userId} size={size} />}
    </div>
  );
}

export function ConnectionsDirectory() {
  const { t, ago } = useI18n();
  const res = useQuery(() => getMyConnections());
  const [tab, setTab] = useState<"friends" | "incoming" | "outgoing">("friends");

  if (res.error) return <ErrorState message={res.error} onRetry={res.refetch} />;
  if (!res.data) return null;

  const { friends, incoming, outgoing } = res.data;
  const activeTab = incoming.length > 0 && tab === "friends" && friends.length === 0 ? "incoming" : tab;

  return (
    <section aria-label={t("conn.sectionTitle")} className="space-y-4">
      <SectionTitle title={t("conn.sectionTitle")} sub={t("conn.sectionSub")} icon={Users} />
      <Tabs
        label={t("conn.sectionTitle")}
        value={activeTab}
        onChange={setTab}
        tabs={[
          { value: "friends", label: t("conn.tabFriends"), count: friends.length },
          { value: "incoming", label: t("conn.tabIncoming"), count: incoming.length },
          { value: "outgoing", label: t("conn.tabOutgoing"), count: outgoing.length },
        ]}
      />

      {activeTab === "friends" && (
        friends.length === 0 ? (
          <EmptyState icon={Users} title={t("conn.tabFriends")} body={t("conn.emptyFriends")} />
        ) : (
          <ul className="space-y-3">
            {friends.map(({ connectionId, since, member }) => (
              <li key={connectionId}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={member.fullName} src={member.avatar} size={40} />
                    <div className="min-w-0">
                      <Link to={`/u/${encodeURIComponent(member.username)}`} className={cn("block truncate text-sm font-semibold text-[#29232A] hover:text-[#541B2B]", focusRing)}>
                        {member.fullName}
                      </Link>
                      <p className="truncate text-xs text-slate-500">
                        @{member.username} · {ago(since)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="green" icon={UserCheck}>{t("conn.friends")}</Badge>
                    <MessageButton userId={member.userId} size="sm" />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )
      )}

      {activeTab === "incoming" && (
        incoming.length === 0 ? (
          <EmptyState icon={UserPlus} title={t("conn.tabIncoming")} body={t("conn.emptyIncoming")} />
        ) : (
          <ul className="space-y-3">
            {incoming.map(({ connectionId, createdAt, member }) => (
              <li key={connectionId}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={member.fullName} src={member.avatar} size={40} />
                    <div className="min-w-0">
                      <Link to={`/u/${encodeURIComponent(member.username)}`} className={cn("block truncate text-sm font-semibold text-[#29232A] hover:text-[#541B2B]", focusRing)}>
                        {member.fullName}
                      </Link>
                      <p className="truncate text-xs text-slate-500">
                        @{member.username} · {ago(createdAt)}
                      </p>
                    </div>
                  </div>
                  <ConnectionActions userId={member.userId} fullName={member.fullName} size="sm" />
                </Card>
              </li>
            ))}
          </ul>
        )
      )}

      {activeTab === "outgoing" && (
        outgoing.length === 0 ? (
          <EmptyState icon={Clock} title={t("conn.tabOutgoing")} body={t("conn.emptyOutgoing")} />
        ) : (
          <ul className="space-y-3">
            {outgoing.map(({ connectionId, createdAt, member }) => (
              <li key={connectionId}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={member.fullName} src={member.avatar} size={40} />
                    <div className="min-w-0">
                      <Link to={`/u/${encodeURIComponent(member.username)}`} className={cn("block truncate text-sm font-semibold text-[#29232A] hover:text-[#541B2B]", focusRing)}>
                        {member.fullName}
                      </Link>
                      <p className="truncate text-xs text-slate-500">
                        @{member.username} · {ago(createdAt)}
                      </p>
                    </div>
                  </div>
                  <ConnectionActions userId={member.userId} fullName={member.fullName} size="sm" />
                </Card>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}
