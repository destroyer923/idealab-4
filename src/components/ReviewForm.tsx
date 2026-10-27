import { useRef, useState } from "react";
import { Star } from "lucide-react";
import { getReviewContext, submitReview } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { LIMITS } from "@/lib/constants";
import { Button, ErrorState, Field, Spinner, StarInput, Textarea, errMsg, toast } from "./ui";

export function ReviewForm({ exchangeId, recipientName, onDone }: { exchangeId: string; recipientName: string; onDone?: () => void }) {
  const { t, num } = useI18n();
  const context = useQuery(() => getReviewContext(exchangeId), [exchangeId]);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<"rating" | "comment" | null>(null);
  const inFlight = useRef(false);
  const id = `rv-${exchangeId}`;

  if (context.error) return <ErrorState message={context.error} onRetry={context.refetch} />;
  if (!context.data) return <Spinner />;
  if (context.data.existing) return <p role="status" className="text-sm text-[#26734D]">{t("err.reviewDuplicate")}</p>;
  if (!context.data.eligible) return <p className="text-sm text-slate-500">{t("err.reviewNotCompleted")}</p>;
  const name = context.data.recipient.fullName || recipientName;

  return (
    <form className="space-y-4" aria-busy={busy} noValidate onSubmit={async (e) => {
      e.preventDefault();
      if (inFlight.current) return;
      setError(null);
      if (rating < 1 || rating > 5) { setFieldError("rating"); return; }
      if (comment.trim().length < LIMITS.reviewMin || comment.trim().length > LIMITS.review) { setFieldError("comment"); return; }
      setFieldError(null);
      inFlight.current = true;
      setBusy(true);
      try {
        await submitReview(exchangeId, rating, comment);
        toast.successKey("community.reviewSaved");
        onDone?.();
      } catch (err) { setError(err); }
      finally { inFlight.current = false; setBusy(false); }
    }}>
      <div className="border-l-2 border-[#E8A6A1] pl-3 text-sm">
        <p className="font-medium text-[#541B2B]">{name}</p>
        <p className="break-words text-slate-500">{context.data.title}</p>
      </div>
      <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
        <div>
          <p id={`${id}-rating`} className="mb-2 text-sm font-medium text-slate-700">{t("rv.rating")} <span aria-hidden className="text-red-600">*</span></p>
          <StarInput id={`${id}-rating`} value={rating} onChange={(v) => { setRating(v); if (fieldError === "rating") setFieldError(null); }} />
          {fieldError === "rating" && <p role="alert" className="mt-1 text-xs text-red-600">{t("err.rating")}</p>}
        </div>
        <Field label={t("rv.feedback", { name })} htmlFor={id} required count={comment.trim().length} max={LIMITS.review}
          error={fieldError === "comment" ? t(comment.trim().length > LIMITS.review ? "err.maxLength" : "err.reviewMin", { min: num(LIMITS.reviewMin), max: num(LIMITS.review) }) : undefined}>
          <Textarea id={id} required invalid={fieldError === "comment"} maxLength={LIMITS.review} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("rv.feedbackPh")} />
        </Field>
      </fieldset>
      {error !== null && <ErrorState message={errMsg(error)} />}
      <Button type="submit" loading={busy} icon={Star}>{busy ? t("community.reviewSending") : t("rv.submit")}</Button>
      <p className="text-xs leading-relaxed text-slate-500">{t("rv.publicNote", { name })}</p>
    </form>
  );
}