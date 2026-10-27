import { useEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Search, Star, X, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";
import { initials } from "@/lib/format";
import { Link } from "@/lib/router";
import { ApiError } from "@/lib/db";
import { hasKey, translate, useT, type Key } from "@/lib/i18n";

/* Button ------------------------------------------------------------ */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft" | "link";
const variants: Record<Variant, string> = {
  primary: "bg-[#541B2B] text-white shadow-sm shadow-[#541B2B]/20 hover:bg-[#461623] hover:shadow-md hover:shadow-[#541B2B]/25",
  secondary: "border border-[#541B2B]/30 bg-white text-[#541B2B] hover:border-[#541B2B] hover:bg-[#FFF8F0]",
  ghost: "text-slate-600 hover:bg-[#F6E7E5]/60 hover:text-[#541B2B]",
  danger: "bg-red-600 text-white hover:bg-red-700",
  soft: "bg-[#F6E7E5] text-[#541B2B] hover:bg-[#F0D6D2]",
  link: "px-0 text-[#541B2B] underline decoration-[#E8A6A1] decoration-2 underline-offset-4 hover:decoration-[#541B2B]",
};
export const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2";

export function Button({ variant = "primary", size = "md", loading, icon: Icon, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: LucideIcon }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 text-[13px] font-semibold tracking-[0.01em] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55",
        focusRing,
        size === "sm" ? "h-8 px-3 text-xs" : size === "lg" ? "h-12 px-6" : "h-10 px-4",
        variants[variant],
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ to, variant = "primary", size = "md", icon: Icon, className, children, ...rest }: { to: string; variant?: Variant; size?: "sm" | "md" | "lg"; icon?: LucideIcon; className?: string; children: ReactNode; "aria-label"?: string }) {
  return (
    <Link
      to={to}
      className={cn("inline-flex items-center justify-center gap-2 text-[13px] font-semibold tracking-[0.01em] transition-colors duration-150", focusRing, size === "sm" ? "h-8 px-3 text-xs" : size === "lg" ? "h-12 px-6" : "h-10 px-4", variants[variant], className)}
      {...rest}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
      {children}
    </Link>
  );
}

/* Card / Badge -------------------------------------------------------- */
export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("border border-[#E9DFDC] bg-white", className)} {...rest}>
      {children}
    </div>
  );
}

const tones = {
  green: "bg-[#F6E7E5] text-[#541B2B] ring-[#541B2B]/10",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/20",
  sky: "bg-sky-50 text-sky-700 ring-sky-600/15",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/15",
  red: "bg-red-50 text-red-700 ring-red-600/15",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/15",
  lime: "bg-lime-50 text-lime-800 ring-lime-600/20",
};
export type Tone = keyof typeof tones;
export function Badge({ tone = "slate", children, className, icon: Icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: LucideIcon }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] ring-1 ring-inset", tones[tone], className)}>
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {children}
    </span>
  );
}

/* Avatar -------------------------------------------------------------- */
export function Avatar({ name, src, size = 40, className }: { name: string; src?: string; size?: number; className?: string }) {
  return src ? (
    <img src={src} alt="" width={size} height={size} loading="lazy" className={cn("shrink-0 rounded-full object-cover ring-2 ring-white", className)} style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-100 to-lime-100 font-semibold text-emerald-800 ring-2 ring-white", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
    >
      {initials(name)}
    </span>
  );
}

/* States -------------------------------------------------------------- */
export function EmptyState({ icon: Icon, title, body, children, className }: { icon: LucideIcon; title: string; body?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center border-t border-[#E9DFDC] px-6 py-14 text-center", className)}>
      <Icon className="mb-4 h-7 w-7 text-[#E8A6A1]" aria-hidden strokeWidth={1.5} />
      <h3 className="font-display text-xl text-[#541B2B]">{title}</h3>
      {body && <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">{body}</p>}
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex items-start gap-3 border-l-2 border-[#B42335] bg-[#B42335]/5 p-4 text-sm text-[#7a1824]">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex-1">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className={cn("font-semibold underline", focusRing)}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-[#F5EDE9]", className)} />;
}

export function Spinner({ label }: { label?: string }) {
  const t = useT();
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin text-emerald-600" aria-hidden /> {label ?? t("common.loading")}…
    </div>
  );
}

/* Page header --------------------------------------------------------- */
export function PageHeader({ title, subtitle, children, eyebrow, image }: { title: string; subtitle?: string; children?: ReactNode; eyebrow?: string; image?: string }) {
  if (image)
    return (
      <header className="rise mb-10">
        <div className="relative isolate aspect-[21/9] max-h-[320px] w-full overflow-hidden bg-[#541B2B] sm:aspect-[24/7]">
          <img src={image} alt="" loading="eager" decoding="async" className="img-fallback absolute inset-0 h-full w-full object-cover opacity-85" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#2a0d16]/85 via-[#2a0d16]/40 to-transparent" aria-hidden />
          <div className="absolute inset-0 flex flex-col justify-end p-6 sm:justify-center sm:p-10">
            {eyebrow && <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#E8A6A1]">{eyebrow}</p>}
            <h1 className="display max-w-2xl text-[30px] font-semibold text-white sm:text-[44px]">{title}</h1>
            {subtitle && <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/85 sm:text-[15px]">{subtitle}</p>}
          </div>
        </div>
        {children && <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">{children}</div>}
      </header>
    );
  return (
    <header className="mb-8 flex flex-col gap-4 border-b border-[#E9DFDC] pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a3b44]">{eyebrow}</p>}
        <h1 className="display text-[30px] font-semibold text-[#541B2B] sm:text-[38px]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-slate-500">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-x-5 gap-y-2">{children}</div>}
    </header>
  );
}

export function SearchInput({ value, onChange, placeholder, label, className }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a3b44]" aria-hidden />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full border-b border-[#E9DFDC] bg-transparent pl-7 pr-3 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-[#541B2B] focus:outline-none"
      />
    </div>
  );
}

/* Tabs ---------------------------------------------------------------- */
export function Tabs<T extends string>({ tabs, value, onChange, label, className }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn("-mb-px flex max-w-full gap-5 overflow-x-auto border-b border-[#E9DFDC] [scrollbar-width:none]", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 pb-2.5 pt-1 text-[13px] font-semibold transition-colors",
            focusRing,
            value === t.value ? "border-[#541B2B] text-[#541B2B]" : "border-transparent text-slate-500 hover:text-[#541B2B]"
          )}
        >
          {t.label}
          {t.count !== undefined && <span className={cn("text-[11px] tabular-nums", value === t.value ? "text-[#8a3b44]" : "text-slate-400")}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "shrink-0 whitespace-nowrap border px-3 py-1.5 text-[12px] font-medium transition-colors",
        focusRing,
        active ? "border-[#541B2B] bg-[#541B2B] text-white" : "border-[#E9DFDC] bg-white text-slate-600 hover:border-[#541B2B] hover:text-[#541B2B]"
      )}
    >
      {children}
    </button>
  );
}

/* Form fields --------------------------------------------------------- */
const inputCls = "w-full border bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 transition focus:outline-none focus:ring-2";
const okCls = "border-[#E9DFDC] focus:border-[#541B2B] focus:ring-[#541B2B]/15";
const errCls = "border-[#B42335] focus:border-[#B42335] focus:ring-[#B42335]/15";

export function Field({ label, htmlFor, error, hint, required, children, count, max }: { label: string; htmlFor: string; error?: string; hint?: string; required?: boolean; children: ReactNode; count?: number; max?: number }) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-600">
          {label} {required ? <span className="text-red-500" aria-hidden>*</span> : <span className="text-xs font-normal text-slate-400">({t("ui.optional")})</span>}
        </label>
        {max !== undefined && <span className={cn("text-[11px] tabular-nums", (count ?? 0) > max ? "text-red-600" : "text-slate-400")}>{count ?? 0}/{max}</span>}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-err`} className="flex items-center gap-1 text-xs text-red-600">
          <XCircle className="h-3 w-3" aria-hidden /> {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ invalid, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input aria-invalid={invalid || undefined} aria-describedby={invalid && rest.id ? `${rest.id}-err` : undefined} className={cn(inputCls, "h-10", invalid ? errCls : okCls, className)} {...rest} />;
}
export function Textarea({ invalid, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea aria-invalid={invalid || undefined} aria-describedby={invalid && rest.id ? `${rest.id}-err` : undefined} className={cn(inputCls, "min-h-[96px] py-2.5", invalid ? errCls : okCls, className)} {...rest} />;
}
export function Select({ invalid, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select aria-invalid={invalid || undefined} className={cn(inputCls, "h-10 pr-8", invalid ? errCls : okCls, className)} {...rest}>
      {children}
    </select>
  );
}

/* Modal --------------------------------------------------------------- */
export function Modal({ open, onClose, title, children, size = "md", description }: { open: boolean; onClose: () => void; title: string; children: ReactNode; size?: "sm" | "md" | "lg" | "xl"; description?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("input,textarea,select,button:not([data-close])")?.focus() ?? ref.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) (e.preventDefault(), f[f.length - 1].focus());
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) (e.preventDefault(), f[0].focus());
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-[fade_.15s_ease-out] bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92vh] w-full animate-[pop_.18s_ease-out] flex-col overflow-hidden border border-[#E9DFDC] bg-white shadow-2xl",
          size === "sm" ? "sm:max-w-md" : size === "lg" ? "sm:max-w-2xl" : size === "xl" ? "sm:max-w-4xl" : "sm:max-w-lg"
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#E9DFDC] px-5 py-4">
          <div className="min-w-0">
            <h2 id="modal-title" className="font-display text-xl text-[#541B2B]">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button data-close onClick={onClose} aria-label={t("ui.closeDialog")} className={cn("rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700", focusRing)}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel, tone = "primary", children }: { open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>; title: string; body: string; confirmLabel: string; tone?: "primary" | "danger"; children?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const t = useT();
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-slate-600">{body}</p>
      {children}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          variant={tone === "danger" ? "danger" : "primary"}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/* Toasts -------------------------------------------------------------- */
type ToastT = { id: number; kind: "success" | "error"; text: string; key?: Key; vars?: Record<string, string | number>; action?: { label: string; run: () => void } };
let toasts: ToastT[] = [];
const tl = new Set<() => void>();
const pushT = (t: Omit<ToastT, "id">) => {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { ...t, id }];
  tl.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id);
    tl.forEach((l) => l());
  }, t.action ? 6000 : 4000);
};
export const toast = {
  success: (text: string, action?: ToastT["action"]) => pushT({ kind: "success", text, action }),
  successKey: (key: Key, vars?: ToastT["vars"]) => pushT({ kind: "success", text: "", key, vars }),
  error: (text: string) => pushT({ kind: "error", text }),
};
/** Translate an error for display. API errors carry translation keys; anything else gets a generic message. */
export function errMsg(e: unknown) {
  if (e instanceof ApiError && hasKey(e.message)) return translate(e.message as Key, e.vars);
  return translate("err.generic");
}

export function Toaster() {
  const translateToast = useT();
  const list = useSyncExternalStore(
    (cb) => (tl.add(cb), () => tl.delete(cb)),
    () => toasts,
    () => toasts
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2">
      {list.map((t) => (
        <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className={cn("pointer-events-auto flex animate-[pop_.2s_ease-out] items-start gap-2.5 border-l-2 bg-white p-3 text-sm shadow-lg ring-1 ring-[#E9DFDC]", t.kind === "error" ? "border-[#B42335]" : "border-[#541B2B]")}>
          {t.kind === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#B42335]" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#26734D]" aria-hidden />}
          <span className="flex-1 text-slate-700">{t.key ? translateToast(t.key, t.vars) : t.text}</span>
          {t.action && (
            <button onClick={t.action.run} className={cn("font-semibold text-[#541B2B] underline underline-offset-4", focusRing)}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* Stars --------------------------------------------------------------- */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={t("ui.starsOf", { n: value })} role="img">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="relative inline-block shrink-0" style={{ width: size, height: size }} aria-hidden>
          <Star style={{ width: size, height: size }} className="absolute inset-0 fill-slate-200 text-slate-200" />
          <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${Math.max(0, Math.min(1, value - i + 1)) * 100}%` }}>
            <Star style={{ width: size, height: size }} className="absolute left-0 top-0 fill-amber-400 text-amber-400" />
          </span>
        </span>
      ))}
    </span>
  );
}

export function StarInput({ value, onChange, id }: { value: number; onChange: (v: number) => void; id: string }) {
  const t = useT();
  const labels = [1, 2, 3, 4, 5].map((i) => t(`ui.star.${i}` as Key));
  return (
    <div role="radiogroup" aria-labelledby={id} className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={t("ui.starRadio", { n: i, label: labels[i - 1] })}
          tabIndex={value === i || (!value && i === 1) ? 0 : -1}
          onClick={() => onChange(i)}
          onKeyDown={(e) => {
            let next = i;
            if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, i + 1);
            else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, i - 1);
            else if (e.key === "Home") next = 1;
            else if (e.key === "End") next = 5;
            else return;
            e.preventDefault();
            onChange(next);
            e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next - 1]?.focus();
          }}
          className={cn("rounded-md p-0.5 transition hover:scale-110", focusRing)}
        >
          <Star className={cn("h-7 w-7", i <= value ? "fill-amber-400 text-amber-400" : "fill-slate-100 text-slate-300")} />
        </button>
      ))}
      {value > 0 && <span className="ml-2 text-sm text-slate-600">{labels[value - 1]}</span>}
    </div>
  );
}

export function SectionTitle({ title, action, icon: Icon, sub }: { title: string; action?: ReactNode; icon?: LucideIcon; sub?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 border-b border-[#E9DFDC] pb-2.5">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 font-display text-[22px] leading-tight text-[#541B2B]">
          {Icon && <Icon className="h-4 w-4 text-[#8a3b44]" aria-hidden strokeWidth={1.75} />}
          {title}
        </h2>
        {sub && <p className="mt-0.5 text-[13px] text-slate-500">{sub}</p>}
      </div>
      {action && <div className="shrink-0 pb-0.5 text-[13px]">{action}</div>}
    </div>
  );
}

