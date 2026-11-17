import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, CameraOff, ImageUp, MapPin, QrCode, RotateCcw, Search, UserRound } from "lucide-react";
import { resolveQrPayload } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { L, useI18n } from "@/lib/i18n";
import { useLocation } from "@/lib/router";
import { ConnectionActions, ConnectionsDirectory } from "@/components/ConnectionActions";
import { MessageButton } from "@/components/listing";
import { Avatar, Badge, Button, Card, ErrorState, Field, Input, LinkButton, PageHeader, errMsg } from "@/components/ui";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<{ rawValue?: string }[]>;
};

export default function ScanQrPage() {
  const { t } = useI18n();
  const { query } = useLocation();
  const codeParam = query.get("code") ?? "";

  const [scannedInput, setScannedInput] = useState<string>(codeParam);
  const [manualInput, setManualInput] = useState<string>("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const activeScanRef = useRef(false);

  useEffect(() => {
    if (codeParam) {
      setScannedInput(codeParam);
      setScanError("");
    }
  }, [codeParam]);

  const stopCamera = useCallback(() => {
    activeScanRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScanning(false);
  }, []);

  // Always stop the camera stream when leaving the scanner page.
  useEffect(() => () => stopCamera(), [stopCamera]);

  const applyCandidate = useCallback(
    (raw: string) => {
      try {
        resolveQrPayload(raw);
        stopCamera();
        setScanError("");
        setScannedInput(raw.trim());
        return true;
      } catch (e) {
        setScanError(errMsg(e));
        return false;
      }
    },
    [stopCamera],
  );

  const startCamera = async () => {
    setScanError("");
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setScanError(t("scan.err.insecure"));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanError(t("scan.err.noCamera"));
      return;
    }

    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      activeScanRef.current = true;
      setScanning(true);

      const video = videoRef.current;
      if (!video) {
        stopCamera();
        return;
      }
      video.srcObject = stream;
      await video.play();

      const DetectorCtor = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
      let detector: BarcodeDetectorLike | null = null;
      if (DetectorCtor) {
        try {
          detector = new DetectorCtor({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }

      const tick = async () => {
        if (!activeScanRef.current || !videoRef.current) return;
        const v = videoRef.current;
        if (v.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA && v.videoWidth > 0 && v.videoHeight > 0) {
          if (detector) {
            try {
              const codes = await detector.detect(v);
              const hit = codes.find((c) => c.rawValue)?.rawValue;
              if (hit && applyCandidate(hit)) return;
            } catch {
              detector = null;
            }
          }
          const canvas = canvasRef.current ?? document.createElement("canvas");
          canvasRef.current = canvas;
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const decoded = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
            if (decoded?.data && applyCandidate(decoded.data)) return;
          }
        }
        if (activeScanRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            void tick();
          });
        }
      };

      rafRef.current = requestAnimationFrame(() => {
        void tick();
      });
    } catch (err) {
      stopCamera();
      const name = err instanceof DOMException ? err.name : (err as { name?: string })?.name ?? "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
        setScanError(t("scan.err.cameraDenied"));
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
        setScanError(t("scan.err.noCamera"));
      } else {
        setScanError(t("scan.err.cameraFailed"));
      }
    }
  };

  const scanImageFile = async (file: File | undefined) => {
    if (!file) return;
    setScanError("");
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("read_error"));
        el.src = url;
      });
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setScanError(t("scan.err.noQrInImage"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(data.data, data.width, data.height, { inversionAttempts: "attemptBoth" });
      if (!decoded?.data) {
        setScanError(t("scan.err.noQrInImage"));
        return;
      }
      applyCandidate(decoded.data);
    } catch {
      setScanError(t("scan.err.noQrInImage"));
    } finally {
      URL.revokeObjectURL(url);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const resolved = useQuery(() => (scannedInput ? resolveQrPayload(scannedInput) : null), [scannedInput]);

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <PageHeader eyebrow={t("scan.eyebrow")} title={t("scan.title")} subtitle={t("scan.subtitle")}>
        <LinkButton to="/qr-code" variant="secondary" icon={QrCode}>
          {t("nav.qrCode")}
        </LinkButton>
      </PageHeader>

      {(scanError || resolved.error) && (
        <ErrorState
          message={scanError || resolved.error!}
          onRetry={() => {
            setScanError("");
            setScannedInput("");
          }}
        />
      )}

      {resolved.data && (
        <Card className="border-l-2 border-l-[#541B2B] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <Avatar name={resolved.data.member.fullName} src={resolved.data.member.avatar} size={64} />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a3b44]">{t("scan.previewTitle")}</p>
                <h2 className="mt-0.5 font-display text-2xl font-semibold text-[#541B2B]">{resolved.data.member.fullName}</h2>
                <p className="text-sm text-slate-500">
                  @{resolved.data.member.username}
                  {resolved.data.member.occupation ? ` · ${resolved.data.member.occupation}` : ""}
                </p>
                {resolved.data.member.location && (
                  <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {resolved.data.member.location}
                  </p>
                )}
              </div>
            </div>

            <Button
              size="sm"
              variant="ghost"
              icon={RotateCcw}
              onClick={() => {
                setScannedInput("");
                setScanError("");
              }}
            >
              {t("scan.clearResult")}
            </Button>
          </div>

          {resolved.data.bio && (
            <p className="mt-4 whitespace-pre-line break-words text-sm leading-relaxed text-slate-600">{resolved.data.bio}</p>
          )}

          {resolved.data.skills.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {resolved.data.skills.map((s) => (
                <Badge key={s.id} tone="slate">
                  {s.name} · {t(L.cat(s.category))}
                </Badge>
              ))}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[#E9DFDC] pt-4">
            {resolved.data.isSelf ? (
              <>
                <span className="text-sm text-slate-500">{t("scan.selfNote")}</span>
                <LinkButton to="/profile" size="sm" variant="secondary" icon={UserRound}>
                  {t("nav.profile")}
                </LinkButton>
              </>
            ) : (
              <>
                <ConnectionActions
                  userId={resolved.data.member.userId}
                  fullName={resolved.data.member.fullName}
                  includeMessageButton
                />
                {resolved.data.connection.status !== "friends" && (
                  <MessageButton userId={resolved.data.member.userId} variant="ghost" />
                )}
                <LinkButton to={`/u/${encodeURIComponent(resolved.data.member.username)}`} variant="link" icon={UserRound}>
                  {t("common.viewProfile")}
                </LinkButton>
              </>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-6">
          <div>
            <h2 className="font-display text-xl font-semibold text-[#541B2B]">{t("scan.cameraTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("scan.cameraSub")}</p>
          </div>

          <div className="relative aspect-[4/3] w-full overflow-hidden border border-[#E9DFDC] bg-[#29232A]">
            <video
              ref={videoRef}
              playsInline
              muted
              className={scanning ? "h-full w-full object-cover" : "hidden"}
            />
            {!scanning && (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-white/80">
                <Camera className="h-9 w-9 text-[#E8A6A1]" aria-hidden />
                <p className="text-xs leading-relaxed text-white/75">{t("scan.httpsHint")}</p>
              </div>
            )}
            {scanning && (
              <div className="pointer-events-none absolute inset-6 border-2 border-[#E8A6A1]/85" aria-hidden />
            )}
          </div>

          {scanning && (
            <p role="status" className="text-xs font-medium text-[#541B2B]">
              {t("scan.scanning")}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!scanning ? (
              <Button icon={Camera} onClick={() => void startCamera()}>
                {t("scan.startCamera")}
              </Button>
            ) : (
              <Button variant="secondary" icon={CameraOff} onClick={stopCamera}>
                {t("scan.stopCamera")}
              </Button>
            )}
            <Button variant="secondary" icon={ImageUp} onClick={() => fileRef.current?.click()}>
              {t("scan.uploadImage")}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={t("scan.uploadAria")}
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => void scanImageFile(e.target.files?.[0])}
            />
          </div>
        </Card>

        <Card className="space-y-4 p-6">
          <div>
            <h2 className="font-display text-xl font-semibold text-[#541B2B]">{t("scan.manualTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("scan.manualSub")}</p>
          </div>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setScanError("");
              if (!manualInput.trim()) {
                setScanError(t("scan.err.invalidCode"));
                return;
              }
              if (applyCandidate(manualInput)) setManualInput("");
            }}
          >
            <Field label={t("scan.manualLabel")} htmlFor="scan-manual-token" required>
              <Input
                id="scan-manual-token"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder={t("scan.manualPh")}
                autoComplete="off"
              />
            </Field>
            <Button type="submit" icon={Search}>
              {t("scan.manualSubmit")}
            </Button>
          </form>
        </Card>
      </div>

      <ConnectionsDirectory />
    </div>
  );
}
