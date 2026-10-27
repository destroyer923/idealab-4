import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { cn } from "@/utils/cn";
import { HERO_SLIDES, photo } from "@/lib/images";
import { useMediaQuery } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { Link } from "@/lib/router";
import { focusRing } from "./ui";

const INTERVAL = 8000;
const ctrl =
  "grid h-9 w-9 place-items-center border border-white/35 text-white/90 transition-colors hover:border-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#2a0d16]";

/**
 * Large photographic hero band (WAI-ARIA carousel pattern).
 * Straight edges, one headline, one primary action; controls are thin and unobtrusive.
 * Auto-advance pauses on hover/focus/hidden tab and never runs under reduced-motion.
 */
export function HeroCarousel() {
  const { t, num } = useI18n();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const root = useRef<HTMLElement>(null);
  const n = HERO_SLIDES.length;
  const go = useCallback((to: number) => setI(((to % n) + n) % n), [n]);
  const auto = playing && !reduced && !hovered && !focused;

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => document.visibilityState === "visible" && setI((v) => (v + 1) % n), INTERVAL);
    return () => clearInterval(id);
  }, [auto, n]);

  return (
    <section
      ref={root}
      aria-roledescription="carousel"
      aria-label={t("car.label")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !root.current?.contains(e.relatedTarget as Node) && setFocused(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(i - 1);
        if (e.key === "ArrowRight") go(i + 1);
      }}
      className="relative isolate overflow-hidden bg-[#2a0d16]"
    >
      <div className="relative aspect-[4/5] sm:aspect-[16/9] lg:aspect-[21/9] lg:max-h-[560px]" aria-live={auto ? "off" : "polite"}>
        {HERO_SLIDES.map((s, idx) => {
          const active = idx === i;
          return (
            <div
              key={s.id}
              role="group"
              aria-roledescription="slide"
              aria-label={t("car.slideOf", { n: num(idx + 1), total: num(n) })}
              aria-hidden={!active}
              className={cn("absolute inset-0 transition-opacity duration-[900ms] ease-out", active ? "opacity-100" : "pointer-events-none opacity-0")}
            >
              <picture>
                <source media="(max-width: 640px)" srcSet={photo.px(s.image, 900, 1120)} />
                <img
                  src={photo.px(s.image, 1800, 780)}
                  alt={t(s.alt)}
                  loading={idx === 0 ? "eager" : "lazy"}
                  decoding="async"
                  className={cn("h-full w-full object-cover", active && !reduced && "animate-[kenburns_14s_ease-out_both]")}
                />
              </picture>
              <div className="absolute inset-0 bg-gradient-to-t from-[#2a0d16]/92 via-[#2a0d16]/35 to-transparent sm:bg-gradient-to-r sm:from-[#2a0d16]/88 sm:via-[#2a0d16]/35 sm:to-transparent" aria-hidden />
              <div className="absolute inset-x-0 bottom-0 p-6 pb-20 sm:inset-y-0 sm:right-auto sm:flex sm:max-w-[560px] sm:flex-col sm:justify-center sm:p-12 sm:pb-12 lg:p-16">
                <p className="mb-4 flex items-center gap-3 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[#E8A6A1]">
                  <span className="h-px w-8 bg-[#E8A6A1]" aria-hidden />
                  {t("car.label")}
                </p>
                <h2 className="display text-[30px] font-semibold text-white sm:text-[46px] lg:text-[54px]">{t(s.title)}</h2>
                <p className="mt-3 max-w-md text-[14px] leading-relaxed text-white/80 sm:text-[16px]">{t(s.body)}</p>
                <Link
                  to={s.to}
                  tabIndex={active ? 0 : -1}
                  className="mt-7 inline-flex h-11 w-fit items-center gap-2 bg-white px-6 text-[13px] font-semibold tracking-[0.01em] text-[#541B2B] transition-colors hover:bg-[#FFF8F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#2a0d16]"
                >
                  {t(s.cta)} <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      <div className="absolute bottom-5 left-6 right-6 flex items-end justify-between gap-4 sm:left-12 sm:right-12 lg:left-16">
        <div className="flex items-center gap-4" role="group" aria-label={t("car.label")}>
          <span className="font-display text-[13px] tabular-nums text-white/80">
            {num(i + 1)} <span className="text-white/40">/ {num(n)}</span>
          </span>
          <div className="flex items-center gap-1.5">
            {HERO_SLIDES.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => go(idx)}
                aria-label={t("car.goTo", { n: num(idx + 1) })}
                aria-current={idx === i ? "true" : undefined}
                className={cn("h-px w-7 transition-all", idx === i ? "bg-[#E8A6A1] shadow-[0_0_0_1px_rgba(232,166,161,0.6)]" : "bg-white/40 hover:bg-white/70", focusRing)}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setPlaying((p) => !p)} aria-label={playing && !reduced ? t("car.pause") : t("car.play")} aria-pressed={!playing} className={ctrl}>
            {playing && !reduced ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => go(i - 1)} aria-label={t("car.prev")} className={ctrl}><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={() => go(i + 1)} aria-label={t("car.next")} className={ctrl}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
    </section>
  );
}
