import { BadgeCheck, Mail, Phone, Building2, Users2, type LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";
import { useI18n } from "@/lib/i18n";
import type { PublicVerification } from "@/lib/types";

export type TrustIcons = { phone?: LucideIcon; email?: LucideIcon; business?: LucideIcon; identity?: LucideIcon };

/**
 * Compact trust row: one small icon + label per genuinely completed check.
 * Only renders indicators that are actually verified — nothing is implied.
 */
export function TrustBadges({ v, icons, className, spacing = "gap-x-3" }: { v?: PublicVerification; icons?: TrustIcons; className?: string; spacing?: "gap-x-3" | "gap-x-2" }) {
  const { t, tn } = useI18n();
  if (!v) return null;
  const items = [
    { key: "phone", label: t("verify.trust.phone"), icon: icons?.phone ?? Phone, on: v.phoneVerified },
    { key: "email", label: t("verify.trust.email"), icon: icons?.email ?? Mail, on: v.emailVerified },
    { key: "business", label: t("verify.trust.business"), icon: icons?.business ?? Building2, on: v.businessVerified },
    { key: "identity", label: t("verify.trust.identity"), icon: icons?.identity ?? BadgeCheck, on: v.identityVerified },
  ].filter((i) => i.on);
  if (!items.length && v.completedExchanges === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-y-1.5", spacing, className)}>
      {items.map((i) => (
        <span key={i.key} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
          <i.icon className="h-3.5 w-3.5 text-[#8a3b44]" aria-hidden strokeWidth={1.75} />
          {i.label}
        </span>
      ))}
      {v.completedExchanges > 0 && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
          <Users2 className="h-3.5 w-3.5 text-[#8a3b44]" aria-hidden strokeWidth={1.75} />
          {tn("verify.trust.exchanges", v.completedExchanges)}
        </span>
      )}
    </div>
  );
}

/** Trust level label with an explicit meaning — never a fabricated score. */
export function TrustLevel({ trust, className }: { trust: PublicVerification["trust"]; className?: string }) {
  const { t } = useI18n();
  const map = {
    new: { label: t("verify.trustNew"), sub: t("verify.trustNewSub") },
    contact_verified: { label: t("verify.trustContact"), sub: t("verify.trustContactSub") },
    business_verified: { label: t("verify.trustBusiness"), sub: t("verify.trustBusinessSub") },
    identity_verified: { label: t("verify.trustIdentity"), sub: t("verify.trustIdentitySub") },
  } as const;
  const m = map[trust];
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#8a3b44]" aria-hidden />
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a3b44]">{m.label}</span>
    </div>
  );
}
