import { Gavel, Bookmark, ClipboardList, Compass, Handshake, LayoutDashboard, MessageCircle, Package, PlusCircle, QrCode, ScanLine, Settings, ShieldCheck, Star, UserRound, Users, type LucideIcon } from "lucide-react";
import type { Key } from "@/lib/i18n";

export interface NavItem {
  label: Key;
  to: string;
  icon: LucideIcon;
  /** Extra path prefixes that should keep this item highlighted. */
  match?: string[];
  badge?: "unreadMessages";
  /** Only shown to administrators. */
  adminOnly?: boolean;
}

export const NAV_GROUPS: { label: Key; items: NavItem[] }[] = [
  {
    label: "nav.main",
    items: [
      { label: "nav.dashboard", to: "/dashboard", icon: LayoutDashboard },
      { label: "nav.explore", to: "/explore", icon: Compass, match: ["/listing"] },
      { label: "nav.matches", to: "/matches", icon: Handshake },
      { label: "nav.exchange", to: "/exchange", icon: Package },
    ],
  },
  {
    label: "nav.activity",
    items: [
      { label: "nav.offers", to: "/offers", icon: PlusCircle },
      { label: "nav.needs", to: "/needs", icon: ClipboardList },
      { label: "nav.collaborations", to: "/collaborations", icon: Users },
      { label: "nav.messages", to: "/messages", icon: MessageCircle, badge: "unreadMessages" },
      { label: "nav.qrCode", to: "/qr-code", icon: QrCode },
      { label: "nav.scanQr", to: "/scan-qr", icon: ScanLine },
      { label: "nav.saved", to: "/saved", icon: Bookmark },
    ],
  },
  {
    label: "nav.account",
    items: [
      { label: "nav.profile", to: "/profile", icon: UserRound, match: ["/u/"] },
      { label: "nav.reviews", to: "/reviews", icon: Star },
      { label: "nav.verification", to: "/verification", icon: ShieldCheck },
      { label: "admin.navLabel", to: "/admin", icon: Gavel, adminOnly: true },
      { label: "nav.settings", to: "/settings", icon: Settings },
    ],
  },
];

export function isActive(item: NavItem, path: string) {
  return path === item.to || path.startsWith(item.to + "/") || (item.match ?? []).some((m) => path.startsWith(m));
}
