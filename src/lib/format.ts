import { LIMITS } from "./constants";
import { ApiError } from "./db";

/** Locale-aware dates/times/relative times live in `useI18n()` (src/lib/i18n.ts). */

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

/** Validates and downsizes an image to a compact JPEG data URL for storage. */
export async function processImage(file: File, maxDim = 900, quality = 0.75): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new ApiError("err.imageType");
  if (file.size > LIMITS.imageBytes) throw new ApiError("err.imageSize");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new ApiError("err.imageRead"));
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
