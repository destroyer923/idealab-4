import { useEffect } from "react";
import { Compass } from "lucide-react";
import { currentUserId } from "@/lib/api";
import { useQuery, useStoreSync } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { matchPath, navigate, useLocation } from "@/lib/router";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, LinkButton, Toaster } from "@/components/ui";
import AuthPage from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Explore from "@/pages/Explore";
import ListingDetail from "@/pages/ListingDetail";
import Matches from "@/pages/Matches";
import ResourceExchange from "@/pages/Exchange";
import ExchangeDetail from "@/pages/ExchangeDetail";
import MyListings from "@/pages/MyListings";
import ListingForm from "@/pages/ListingForm";
import Collaborations from "@/pages/Collaborations";
import Messages from "@/pages/Messages";
import QrCodePage from "@/pages/QrCodePage";
import ScanQrPage from "@/pages/ScanQrPage";
import Saved from "@/pages/Saved";
import MyProfile, { PublicProfile } from "@/pages/Profile";
import ProfileEdit from "@/pages/ProfileEdit";
import Reviews from "@/pages/Reviews";
import Settings from "@/pages/Settings";

function Routes({ me }: { me: string }) {
  const { path } = useLocation();
  const { t } = useI18n();
  const m = (p: string) => matchPath(p, path);
  let p: Record<string, string> | null;

  if (path === "/" || path === "/dashboard") return <Dashboard />;
  if (path === "/explore") return <Explore />;
  if ((p = m("/listing/:id"))) return <ListingDetail id={p.id} />;
  if (path === "/matches") return <Matches />;
  if (path === "/exchange") return <ResourceExchange />;
  if ((p = m("/exchange/:id"))) return <ExchangeDetail key={p.id} id={p.id} base="/exchange" />;
  if (path === "/offers") return <MyListings key="offer" kind="offer" />;
  if (path === "/offers/new") return <ListingForm key="new-offer" kind="offer" />;
  if ((p = m("/offers/:id/edit"))) return <ListingForm key={p.id} kind="offer" id={p.id} />;
  if (path === "/needs") return <MyListings key="need" kind="need" />;
  if (path === "/needs/new") return <ListingForm key="new-need" kind="need" />;
  if ((p = m("/needs/:id/edit"))) return <ListingForm key={p.id} kind="need" id={p.id} />;
  if (path === "/collaborations") return <Collaborations />;
  if ((p = m("/collaborations/:id"))) return <ExchangeDetail key={p.id} id={p.id} base="/collaborations" />;
  if (path === "/messages") return <Messages me={me} />;
  if (path === "/qr-code" || path === "/messages/qr") return <QrCodePage />;
  if (path === "/scan-qr" || path === "/messages/scan") return <ScanQrPage />;
  if ((p = m("/messages/:id"))) return <Messages id={p.id} me={me} />;
  if (path === "/saved") return <Saved />;
  if (path === "/profile" || path === "/account") return <MyProfile />;
  if (path === "/profile/edit") return <ProfileEdit />;
  if ((p = m("/u/:username"))) return <PublicProfile key={p.username} username={p.username} />;
  if (path === "/reviews") return <Reviews />;
  if (path === "/settings") return <Settings />;
  return (
    <EmptyState icon={Compass} title={t("app.notFoundTitle")} body={t("app.notFoundBody")}>
      <LinkButton to="/dashboard">{t("app.goDashboard")}</LinkButton>
    </EmptyState>
  );
}

export default function App() {
  useStoreSync();
  const { data: me, error, refetch } = useQuery(() => currentUserId());
  const { path } = useLocation();
  const { lang, t } = useI18n();

  useEffect(() => {
    if (me && path === "/") navigate("/dashboard");
  }, [me, path]);
  // Global language: <html lang> + document title follow the active language everywhere.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t("app.documentTitle");
  }, [lang, t]);

  return (
    <>
      {error ? (
        <main className="mx-auto max-w-2xl px-5 py-16"><ErrorState message={error} onRetry={refetch} /></main>
      ) : me ? (
        <AppShell key={me}>
          <Routes key={me} me={me} />
        </AppShell>
      ) : (
        <AuthPage />
      )}
      <Toaster />
    </>
  );
}
