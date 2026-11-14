import { useState } from "react";
import { Bell, Check, KeyRound, Languages, LogOut, UserRound } from "lucide-react";
import { cn } from "@/utils/cn";
import { changePassword, getMe, logout, setLanguage, updatePrefs } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { LANGUAGES, translate, useLang, useT, type Lang } from "@/lib/i18n";
import { navigate } from "@/lib/router";
import { Button, Card, ErrorState, Field, Input, LinkButton, PageHeader, errMsg, toast } from "@/components/ui";

function LanguageCard() {
  const t = useT();
  const lang = useLang();
  const choose = (l: Lang) => {
    if (l === lang) return;
    try {
      setLanguage(l);
      toast.success(translate("st.languageSaved", undefined, l));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Card className="p-5">
      <fieldset>
        <legend className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Languages className="h-4 w-4 text-emerald-600" aria-hidden /> {t("st.language")}
        </legend>
        <p className="mb-4 text-sm text-slate-500">{t("st.languageDesc")}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {LANGUAGES.map((l) => {
            const active = lang === l.value;
            return (
              <label
                key={l.value}
                className={cn(
                  "relative flex cursor-pointer items-center gap-3 border px-4 py-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#541B2B] has-[:focus-visible]:ring-offset-2",
                  active ? "border-[#541B2B] bg-[#FFF8F0]" : "border-[#E9DFDC] hover:border-[#541B2B]"
                )}
              >
                <input type="radio" name="st.language" value={l.value} checked={active} onChange={() => choose(l.value)} className="sr-only" lang={l.value} />
                <span className={cn("grid h-9 w-9 shrink-0 place-items-center text-sm font-semibold", active ? "bg-[#541B2B] text-white" : "bg-[#F5EDE9] text-slate-600")} aria-hidden>
                  {l.badge}
                </span>
                <span className="min-w-0 flex-1">
                  <span lang={l.value} className="block text-sm font-semibold text-slate-900">{l.native}</span>
                  <span className="block text-xs text-slate-500">{l.english}</span>
                </span>
                {active && <Check className="h-4 w-4 text-[#541B2B]" aria-hidden />}
              </label>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-400">{t("st.languageNote")}</p>
      </fieldset>
    </Card>
  );
}

export default function Settings() {
  const me = useQuery(() => getMe());
  const t = useT();
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [pwErr, setPwErr] = useState("");
  if (me.error) return <ErrorState message={me.error} />;
  if (!me.data) return null;
  const prefs = me.data.profile.prefs;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("nav.settings")} subtitle={t("st.subtitle")} />
      <div className="space-y-5">
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-3"><UserRound className="h-5 w-5 text-emerald-600" /><div><p className="text-sm font-semibold text-slate-900">{t("st.account")}</p><p className="text-sm text-slate-500">{me.data.email} · {t("st.onlyYou")}</p></div></div>
          <LinkButton to="/profile/edit" variant="secondary" size="sm">{t("st.editProfile")}</LinkButton>
        </Card>

        <LanguageCard />

        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><Bell className="h-4 w-4 text-emerald-600" /> {t("st.notifications")}</h2>
          {([["messages", "st.prefMessages"], ["exchanges", "st.prefExchanges"], ["reviews", "st.prefReviews"]] as const).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between border-b border-slate-50 py-2.5 text-sm text-slate-700 last:border-0">
              {t(label)}
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-600"
                checked={prefs[k]}
                onChange={async (e) => {
                  try {
                    await updatePrefs({ ...prefs, [k]: e.target.checked });
                    toast.success(t("st.prefSaved"));
                  } catch (er) {
                    toast.error(errMsg(er));
                  }
                }}
              />
            </label>
          ))}
          <p className="mt-2 text-xs text-slate-400">{t("st.noEmailPush")}</p>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><KeyRound className="h-4 w-4 text-emerald-600" /> {t("st.changePassword")}</h2>
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setPwErr("");
              if (pw.next !== pw.confirm) return setPwErr(t("err.passwordMismatch"));
              setBusy(true);
              try {
                await changePassword(pw.current, pw.next);
                setPw({ current: "", next: "", confirm: "" });
                toast.success(t("st.passwordChanged"));
              } catch (er) {
                setPwErr(errMsg(er));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label={t("st.currentPassword")} htmlFor="s-cur" required><Input id="s-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label={t("st.newPassword")} htmlFor="s-new" required><Input id="s-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label={t("st.confirmPassword")} htmlFor="s-conf" required><Input id="s-conf" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
            {pwErr && <p role="alert" className="text-sm text-red-600 sm:col-span-3">{pwErr}</p>}
            <div className="sm:col-span-3"><Button type="submit" loading={busy}>{t("st.updatePassword")}</Button></div>
          </form>
        </Card>

        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div><p className="text-sm font-semibold text-slate-900">{t("st.signOut")}</p><p className="text-sm text-slate-500">{t("st.signOutDesc")}</p></div>
          <Button variant="secondary" icon={LogOut} onClick={() => (logout(), navigate("/"))}>{t("nav.logout")}</Button>
        </Card>
      </div>
    </div>
  );
}
