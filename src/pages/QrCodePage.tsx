import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Download, QrCode, ScanLine, ShieldCheck } from "lucide-react";
import { ensureMyQrToken, getMyQrIdentity } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { ConnectionsDirectory } from "@/components/ConnectionActions";
import { Avatar, Button, Card, ErrorState, LinkButton, PageHeader, Spinner, errMsg, toast } from "@/components/ui";

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

export default function QrCodePage() {
  const { t } = useI18n();
  const res = useQuery(() => getMyQrIdentity());
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [qrError, setQrError] = useState<string>("");

  useEffect(() => {
    void ensureMyQrToken().catch((e) => setQrError(errMsg(e)));
  }, []);

  const payload = res.data?.qrPayload ?? "";
  useEffect(() => {
    let cancelled = false;
    if (!payload) {
      setQrDataUrl("");
      return;
    }
    QRCode.toDataURL(payload, {
      width: 560,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#29232A", light: "#FFFFFF" },
    })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
          setQrError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setQrError(errMsg(e));
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (res.error) return <ErrorState message={res.error} onRetry={res.refetch} />;
  if (!res.data || !res.data.qrToken) return <Spinner />;

  const { fullName, username, occupation, avatar, qrToken, profileUrl } = res.data;

  const downloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `skillswap-${username || "member"}-qr.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <PageHeader eyebrow={t("qr.eyebrow")} title={t("qr.title")} subtitle={t("qr.subtitle")}>
        <LinkButton to="/scan-qr" variant="secondary" icon={ScanLine}>
          {t("qr.openScanner")}
        </LinkButton>
      </PageHeader>

      {qrError && <ErrorState message={qrError} />}

      <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
        <Card className="flex flex-col items-center p-6 text-center sm:p-8">
          <div className="flex h-64 w-64 items-center justify-center border border-[#E9DFDC] bg-white p-3">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={t("qr.alt", { name: fullName })}
                width={232}
                height={232}
                className="h-full w-full object-contain"
              />
            ) : (
              <QrCode className="h-12 w-12 text-[#8a3b44]" aria-hidden />
            )}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <Avatar name={fullName} src={avatar} size={40} />
            <div className="min-w-0 text-left">
              <p className="truncate font-display text-xl font-semibold text-[#541B2B]">{fullName}</p>
              <p className="truncate text-xs text-slate-500">
                @{username}
                {occupation ? ` · ${occupation}` : ""}
              </p>
            </div>
          </div>

          <div className="mt-6 flex w-full flex-col gap-2">
            <Button icon={Download} onClick={downloadQr} disabled={!qrDataUrl} className="w-full">
              {t("qr.download")}
            </Button>
            <Button
              variant="secondary"
              icon={Copy}
              className="w-full"
              onClick={async () => {
                try {
                  await copyText(profileUrl);
                  toast.success(t("qr.copiedLink"));
                } catch (e) {
                  toast.error(errMsg(e));
                }
              }}
            >
              {t("qr.copyLink")}
            </Button>
          </div>
        </Card>

        <div className="min-w-0 space-y-6">
          <Card className="space-y-4 p-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a3b44]">{t("qr.tokenLabel")}</p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border border-[#E9DFDC] bg-[#FFF8F0] px-3 py-2.5">
                <code className="min-w-0 break-all text-xs font-medium text-[#29232A]">{qrToken}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Copy}
                  onClick={async () => {
                    try {
                      await copyText(qrToken);
                      toast.success(t("qr.copiedToken"));
                    } catch (e) {
                      toast.error(errMsg(e));
                    }
                  }}
                >
                  {t("qr.copyToken")}
                </Button>
              </div>
            </div>
            <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#8a3b44]" aria-hidden />
              <span>{t("qr.privacyNote")}</span>
            </p>
          </Card>

          <ConnectionsDirectory />
        </div>
      </div>
    </div>
  );
}
