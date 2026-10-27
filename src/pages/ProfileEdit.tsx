import { useRef, useState } from "react";
import { ArrowLeft, Camera, CheckCircle2, ImagePlus, Plus, Trash2, XCircle } from "lucide-react";
import { cn } from "@/utils/cn";
import { getMe, isUsernameAvailable, updateProfile, type ProfileInput } from "@/lib/api";
import { CATEGORIES, COLLAB_TYPES, LIMITS, SKILL_LEVELS } from "@/lib/constants";
import { uid } from "@/lib/db";
import { useDebounced } from "@/lib/hooks";
import { L, useI18n, useT } from "@/lib/i18n";
import { processImage } from "@/lib/format";
import { Link, navigate } from "@/lib/router";
import type { Skill } from "@/lib/types";
import { Avatar, Button, Card, Chip, Field, Input, Select, Textarea, errMsg, focusRing, toast } from "@/components/ui";

const csv = (a: string[]) => a.join(", ");
const parse = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function ImagePick({ label, onPick, children, maxDim, className }: { label: string; onPick: (d: string) => void; children: React.ReactNode; maxDim: number; className?: string }) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} aria-label={label} disabled={busy} className={cn("relative", focusRing, className)}>
        {children}
        {busy && <span className="absolute inset-0 grid place-items-center rounded-[inherit] bg-white/70 text-xs">{t("pe.processing")}</span>}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            onPick(await processImage(f, maxDim, 0.8));
          } catch (er) {
            toast.error(errMsg(er));
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }}
      />
    </>
  );
}

export default function ProfileEdit() {
  const { t, num } = useI18n();
  const [p0] = useState(() => getMe().profile);
  const [f, setF] = useState<ProfileInput>({ ...p0 });
  const [roles, setRoles] = useState(csv(p0.roles));
  const [langs, setLangs] = useState(csv(p0.languages));
  const [interests, setInterests] = useState(csv(p0.interests));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const du = useDebounced(f.username.toLowerCase(), 300);
  const usernameOk = du === p0.username || isUsernameAvailable(du);
  const nameErr = touched && f.fullName.trim().length < 2 ? t("err.fullNameRequired") : undefined;
  const userErr = !/^[a-z0-9_]{3,24}$/.test(f.username) ? t("err.usernameFormat") : !usernameOk ? t("err.usernameTaken") : undefined;
  const bioErr = f.bio.length > LIMITS.bio ? t("err.maxLength", { max: num(LIMITS.bio) }) : undefined;

  const setSkill = (i: number, patch: Partial<Skill>) => set("skills", f.skills.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/profile" className={cn("mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-emerald-700", focusRing)}><ArrowLeft className="h-4 w-4" /> {t("nav.profile")}</Link>
      <h1 className="display mb-6 text-[32px] font-semibold text-[#541B2B]">{t("pe.title")}</h1>
      <form
        className="space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          setError("");
          if (f.fullName.trim().length < 2 || userErr || bioErr) return;
          setBusy(true);
          try {
            updateProfile({ ...f, roles: parse(roles), languages: parse(langs), interests: parse(interests) });
            toast.success(t("pe.savedToast"));
            navigate("/profile");
          } catch (er) {
            setError(errMsg(er));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Card className="overflow-hidden">
          <ImagePick label={t("pe.changeCover")} maxDim={1400} onPick={(d) => set("cover", d)} className="block w-full">
            <span className="relative block h-36 w-full bg-[#541B2B] sm:h-44">
              {f.cover && <img src={f.cover} alt="" className="h-full w-full object-cover" />}
              <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow"><ImagePlus className="h-3.5 w-3.5" /> {t("pe.cover")}</span>
            </span>
          </ImagePick>
          <div className="flex flex-wrap items-end gap-4 px-5 pb-5">
            <div className="-mt-10">
              <ImagePick label={t("pe.changePhoto")} maxDim={400} onPick={(d) => set("avatar", d)} className="rounded-full">
                <span className="relative block rounded-full">
                  <Avatar name={f.fullName || "?"} src={f.avatar} size={88} className="ring-4" />
                  <span className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full bg-emerald-600 text-white ring-2 ring-white"><Camera className="h-4 w-4" /></span>
                </span>
              </ImagePick>
            </div>
            <div className="flex flex-wrap gap-2 pb-1">
              {f.avatar && <Button type="button" size="sm" variant="ghost" onClick={() => set("avatar", undefined)}>{t("pe.removePhoto")}</Button>}
              {f.cover && <Button type="button" size="sm" variant="ghost" onClick={() => set("cover", undefined)}>{t("pe.removeCover")}</Button>}
            </div>
          </div>
        </Card>

        <Card className="space-y-4 p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-slate-900">{t("pe.basic")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("auth.fullName")} htmlFor="pe-name" required error={nameErr}><Input id="pe-name" invalid={!!nameErr} value={f.fullName} onChange={(e) => set("fullName", e.target.value)} autoComplete="name" /></Field>
            <Field label={t("auth.username")} htmlFor="pe-user" required error={userErr} hint={!userErr ? t("pe.usernameHint", { u: f.username }) : undefined}>
              <div className="relative">
                <Input id="pe-user" invalid={!!userErr} value={f.username} onChange={(e) => set("username", e.target.value.toLowerCase())} className="pr-8" />
                {!userErr ? <CheckCircle2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" aria-label={t("pe.available")} /> : <XCircle className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-red-500" aria-hidden />}
              </div>
            </Field>
            <Field label={t("pe.occupation")} htmlFor="pe-occ"><Input id="pe-occ" value={f.occupation} onChange={(e) => set("occupation", e.target.value)} placeholder={t("pe.occupationPh")} /></Field>
            <Field label={t("pe.roles")} htmlFor="pe-roles" hint={t("common.commaSeparated")}><Input id="pe-roles" value={roles} onChange={(e) => setRoles(e.target.value)} placeholder={t("pe.rolesPh")} /></Field>
            <Field label={t("pe.location")} htmlFor="pe-loc" hint={t("pe.locationHint")}><Input id="pe-loc" value={f.location} onChange={(e) => set("location", e.target.value)} /></Field>
            <Field label={t("pe.languages")} htmlFor="pe-lang" hint={t("common.commaSeparated")}><Input id="pe-lang" value={langs} onChange={(e) => setLangs(e.target.value)} placeholder={t("pe.languagesPh")} /></Field>
          </div>
          <Field label={t("pe.bio")} htmlFor="pe-bio" error={bioErr} count={f.bio.length} max={LIMITS.bio}><Textarea id="pe-bio" invalid={!!bioErr} value={f.bio} onChange={(e) => set("bio", e.target.value)} placeholder={t("pe.bioPh")} /></Field>
        </Card>

        <Card className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{t("pf.skills")}</h2>
            <Button type="button" size="sm" variant="soft" icon={Plus} onClick={() => set("skills", [...f.skills, { id: uid(), name: "", category: "Other", level: "", description: "" }])} disabled={f.skills.length >= 20}>{t("pe.addSkill")}</Button>
          </div>
          {f.skills.length === 0 && <p className="text-sm text-slate-500">{t("pe.noSkills")}</p>}
          {f.skills.map((s, i) => (
            <div key={s.id} className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 sm:grid-cols-[1fr_170px_150px_auto]">
              <Input aria-label={t("pe.skillNameAria", { n: i + 1 })} value={s.name} onChange={(e) => setSkill(i, { name: e.target.value })} placeholder={t("pe.skillName")} />
              <Select aria-label={t("pe.skillCatAria", { n: i + 1 })} value={s.category} onChange={(e) => setSkill(i, { category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(L.cat(c))}</option>)}</Select>
              <Select aria-label={t("pe.skillLevelAria", { n: i + 1 })} value={s.level} onChange={(e) => setSkill(i, { level: e.target.value as Skill["level"] })}>
                <option value="">{t("pe.levelOptional")}</option>
                {SKILL_LEVELS.map((lv) => <option key={lv} value={lv}>{t(L.level(lv))}</option>)}
              </Select>
              <Button type="button" variant="ghost" aria-label={t("pe.removeSkill", { n: i + 1 })} onClick={() => set("skills", f.skills.filter((_, j) => j !== i))} className="text-red-600"><Trash2 className="h-4 w-4" /></Button>
              <Input aria-label={t("pe.skillDetailsAria", { n: i + 1 })} value={s.description} onChange={(e) => setSkill(i, { description: e.target.value })} placeholder={t("pe.skillDetails")} className="sm:col-span-4" />
            </div>
          ))}
        </Card>

        <Card className="space-y-4 p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-slate-900">{t("pe.community")}</h2>
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">{t("pe.collabTypes")}</p>
            <div className="flex flex-wrap gap-1.5">{COLLAB_TYPES.map((c) => <Chip key={c} active={f.collabTypes.includes(c)} onClick={() => set("collabTypes", f.collabTypes.includes(c) ? f.collabTypes.filter((x) => x !== c) : [...f.collabTypes, c])}>{t(L.collab(c))}</Chip>)}</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("pe.interests")} htmlFor="pe-int" hint={t("common.commaSeparated")}><Input id="pe-int" value={interests} onChange={(e) => setInterests(e.target.value)} /></Field>
            <Field label={t("pe.availability")} htmlFor="pe-av"><Input id="pe-av" value={f.availability} onChange={(e) => set("availability", e.target.value)} placeholder={t("pe.availabilityPh")} /></Field>
          </div>
        </Card>

        <Card className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{t("pf.portfolio")}</h2>
            <Button type="button" size="sm" variant="soft" icon={Plus} disabled={f.portfolio.length >= 8} onClick={() => set("portfolio", [...f.portfolio, { id: uid(), title: "" }])}>{t("pe.addItem")}</Button>
          </div>
          {f.portfolio.length === 0 && <p className="text-sm text-slate-500">{t("pe.noPortfolio")}</p>}
          {f.portfolio.map((it, i) => (
            <div key={it.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 p-3">
              <ImagePick label={t("pe.itemImage", { n: i + 1 })} maxDim={700} onPick={(d) => set("portfolio", f.portfolio.map((x, j) => (j === i ? { ...x, image: d } : x)))} className="rounded-lg">
                <span className="grid h-16 w-16 place-items-center overflow-hidden rounded-lg bg-slate-100 text-slate-400">{it.image ? <img src={it.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5" />}</span>
              </ImagePick>
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                <Input aria-label={t("pe.itemTitleAria", { n: i + 1 })} value={it.title} onChange={(e) => set("portfolio", f.portfolio.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder={t("pe.itemTitlePh")} />
                <Input aria-label={t("pe.itemLinkAria", { n: i + 1 })} type="url" value={it.link ?? ""} onChange={(e) => set("portfolio", f.portfolio.map((x, j) => (j === i ? { ...x, link: e.target.value } : x)))} placeholder={t("pe.itemLinkPh")} />
              </div>
              <Button type="button" variant="ghost" aria-label={t("pe.removeItem", { n: i + 1 })} className="text-red-600" onClick={() => set("portfolio", f.portfolio.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </Card>

        <Card className="space-y-3 p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-slate-900">{t("pe.visibility")}</h2>
          <p className="text-xs text-slate-500">{t("pe.visibilityDesc")}</p>
          {(["bio", "location", "skills", "portfolio"] as const).map((k) => (
            <label key={k} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5 text-sm text-slate-700">
              {t(`pe.vis.${k}`)}
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-emerald-600" checked={f.visibility[k]} onChange={(e) => set("visibility", { ...f.visibility, [k]: e.target.checked })} />
            </label>
          ))}
        </Card>

        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-[#E9DFDC] bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:border">
          <Button type="button" variant="secondary" onClick={() => navigate("/profile")} disabled={busy}>{t("common.cancel")}</Button>
          <Button type="submit" loading={busy}>{t("pe.save")}</Button>
        </div>
      </form>
    </div>
  );
}
