import { useState } from "react";
import { ArrowRightLeft, Handshake, Languages, Leaf, ShieldCheck, Sprout } from "lucide-react";
import { cn } from "@/utils/cn";
import { adminLogin, isAdmin, login, register } from "@/lib/api";
import { LANGUAGES, setVisitorLang, useI18n } from "@/lib/i18n";
import { PAGE_IMAGES } from "@/lib/images";
import { navigate } from "@/lib/router";
import { Button, Field, Input, Tabs, errMsg, focusRing } from "@/components/ui";

function VisitorLanguagePicker({ dark }: { dark?: boolean }) {
  const { t, lang } = useI18n();
  return (
    <div role="radiogroup" aria-label={t("auth.language")} className={cn("inline-flex items-center gap-1 rounded-xl p-1", dark ? "bg-white/10" : "bg-slate-100")}>
      <Languages className={cn("mx-1 h-4 w-4", dark ? "text-emerald-100" : "text-slate-500")} aria-hidden />
      {LANGUAGES.map((l) => (
        <button
          key={l.value}
          role="radio"
          aria-checked={lang === l.value}
          lang={l.value}
          onClick={() => setVisitorLang(l.value)}
          className={cn(
            "rounded-lg px-2.5 py-1 text-xs font-medium transition",
            focusRing,
            lang === l.value ? (dark ? "bg-white text-emerald-900" : "bg-white text-emerald-800 shadow-sm") : dark ? "text-emerald-50 hover:bg-white/10" : "text-slate-600 hover:text-slate-900"
          )}
        >
          {l.native}
        </button>
      ))}
    </div>
  );
}

export default function AuthPage() {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<"signin" | "signup" | "admin">("signin");
  const [f, setF] = useState({ email: "", password: "", fullName: "", username: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-[#541B2B] p-12 text-white lg:flex lg:flex-col">
        <img src={PAGE_IMAGES.auth} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#2a0d16] via-[#541B2B]/75 to-[#541B2B]/40" aria-hidden />
        <div className="relative flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#E8A6A1] text-[#541B2B]"><Sprout className="h-5 w-5" /></span>
          <span className="font-display text-xl font-semibold">SkillSwap Rural</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <h1 className="text-[42px] font-semibold leading-[1.1]">{t("auth.tagline")}</h1>
          <p className="mt-4 text-[#FBE9E6]/85">{t("auth.intro")}</p>
          <ul className="mt-8 space-y-3 text-sm text-[#FBE9E6]/95">
            {[
              { i: ArrowRightLeft, k: "auth.f1" as const },
              { i: Handshake, k: "auth.f2" as const },
              { i: ShieldCheck, k: "auth.f3" as const },
            ].map(({ i: I, k }) => (
              <li key={k} className="flex items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#E8A6A1]/20 text-[#E8A6A1]"><I className="h-4 w-4" /></span>{t(k)}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col bg-cream px-5 py-6">
        <div className="flex justify-end">
          <VisitorLanguagePicker />
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center gap-2.5 lg:hidden">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#541B2B] text-[#FFF8F0]"><Leaf className="h-5 w-5" /></span>
              <span className="font-display text-xl font-semibold text-[#541B2B]">SkillSwap Rural</span>
            </div>
            <h2 className="font-display text-3xl font-semibold text-[#541B2B]">
              {mode === "signin" ? t("auth.welcome") : mode === "signup" ? t("auth.create") : t("auth.adminTitle")}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {mode === "signin" ? t("auth.welcomeSub") : mode === "signup" ? t("auth.createSub") : t("auth.adminSub")}
            </p>
            <Tabs
              className="mt-6"
              label={t("auth.mode")}
              value={mode}
              onChange={(m) => (setMode(m), setError(""))}
              tabs={[
                { value: "signin", label: t("auth.signIn") },
                { value: "signup", label: t("auth.createTab") },
                { value: "admin", label: t("auth.enterAdmin") },
              ]}
            />
            <form
              className="mt-6 space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                setBusy(true);
                try {
                  if (mode === "admin") {
                    await adminLogin(f.email, f.password);
                    navigate("/admin");
                    return;
                  }
                  if (mode === "signin") await login(f.email, f.password);
                  else await register({ ...f, language: lang });
                  // Administrators go to their review area; everyone else to the dashboard.
                  if (isAdmin()) navigate("/admin");
                  else navigate("/dashboard");
                } catch (er) {
                  setError(errMsg(er));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {mode === "signup" && (
                <>
                  <Field label={t("auth.fullName")} htmlFor="a-name" required>
                    <Input id="a-name" autoComplete="name" value={f.fullName} onChange={set("fullName")} required />
                  </Field>
                  <Field label={t("auth.username")} htmlFor="a-user" required hint={t("auth.usernameHint")}>
                    <Input id="a-user" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} required pattern="[a-z0-9_]{3,24}" title={t("auth.usernameHint")} />
                  </Field>
                </>
              )}
              <Field label={t("auth.email")} htmlFor="a-email" required>
                <Input id="a-email" type="email" autoComplete="email" value={f.email} onChange={set("email")} required />
              </Field>
              <Field label={t("auth.password")} htmlFor="a-pass" required hint={mode === "signup" ? t("auth.passwordHint") : undefined}>
                <Input id="a-pass" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={f.password} onChange={set("password")} required minLength={mode === "signup" ? 8 : undefined} />
              </Field>
              {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <Button type="submit" loading={busy} className="w-full" size="lg">
                {mode === "signin" ? t("auth.signIn") : mode === "signup" ? t("auth.createTab") : t("auth.enterAdmin")}
              </Button>
            </form>
            <p className="mt-6 text-center text-xs text-slate-400">{t("auth.storageNote")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
