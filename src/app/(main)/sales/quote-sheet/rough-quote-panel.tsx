"use client";

/**
 * 电子报价单内的 Rough Quote 面板（合入 July sunny-quote UI，不另开导航类目）。
 * 通过 iframe + 青砚 Bridge 保存到 /api/sales/quotes。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle, ExternalLink, Share2 } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import type { DiscountsOverride } from "./pricing-helpers";

interface SavePayload {
  items: {
    product: string;
    fabric: string;
    widthIn: number;
    heightIn: number;
    cordless: boolean;
    sku?: string | null;
    discountOverridePct?: number | null;
  }[];
  addons?: { addonKey: string; qty: number }[];
  installMode?: string;
  deliveryFee?: number;
}

interface Props {
  customerId: string;
  opportunityId: string;
  discounts?: DiscountsOverride;
  isMobile?: boolean;
  onRequireCustomer?: () => void;
  onSaved?: (info: { quoteId: string; grandTotal: number }) => void;
}

function toBridgeDiscounts(
  d?: DiscountsOverride,
): Record<string, number> | null {
  if (!d) return null;
  const out: Record<string, number> = {};
  const keys = [
    "Zebra",
    "SHANGRILA",
    "Cordless Cellular",
    "Roller",
    "Drapery",
    "Sheer",
    "Shutters",
    "SkylightHoneycomb",
  ] as const;
  for (const k of keys) {
    const v = d[k];
    if (typeof v === "number") out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function RoughQuotePanel({
  customerId,
  opportunityId,
  discounts,
  isMobile = false,
  onRequireCustomer,
  onSaved,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<{
    quoteId: string;
    shareToken: string;
    grandTotal: number;
    autoLinked?: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  // cache-bust once per mount so July HTML updates show after deploy
  const [src] = useState(
    () => `/sunny-quote.html?v=${Date.now()}${isMobile ? "&m=1" : ""}`,
  );

  const pushInit = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: "QINGYAN_INIT",
        mobile: isMobile,
        discounts: toBridgeDiscounts(discounts),
      },
      "*",
    );
  }, [discounts, isMobile]);

  const handleIframeLoad = useCallback(() => {
    pushInit();
  }, [pushInit]);

  // discounts 热更新
  useEffect(() => {
    if (!discounts) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "QINGYAN_DISCOUNT_PUSH",
        discounts: toBridgeDiscounts(discounts),
      },
      "*",
    );
  }, [discounts]);

  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (e.data?.type === "QINGYAN_DISCOUNT_REQUEST") {
        try {
          const d = await apiJson<{
            zebra: number;
            shangrila: number;
            cellular: number;
            roller: number;
            drapery: number;
            sheer: number;
            shutters: number;
            honeycomb: number;
          }>("/api/sales/quote-settings/discounts");
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "QINGYAN_DISCOUNT_PUSH",
              discounts: {
                Zebra: d.zebra,
                SHANGRILA: d.shangrila,
                "Cordless Cellular": d.cellular,
                Roller: d.roller,
                Drapery: d.drapery,
                Sheer: d.sheer,
                Shutters: d.shutters,
                SkylightHoneycomb: d.honeycomb,
              },
            },
            "*",
          );
        } catch {
          /* ignore */
        }
        return;
      }

      if (e.data?.type === "QINGYAN_DISCOUNT_SAVE") {
        const after = e.data.payload?.after as Record<string, number> | null;
        if (!after || typeof after !== "object") return;
        try {
          const res = await apiFetch("/api/sales/quote-settings/discounts", {
            method: "PUT",
            body: JSON.stringify({
              zebra: after.Zebra,
              shangrila: after.SHANGRILA,
              cellular: after["Cordless Cellular"],
              roller: after.Roller,
              drapery: after.Drapery,
              sheer: after.Sheer,
              shutters: after.Shutters,
              honeycomb: after.SkylightHoneycomb,
            }),
          });
          const body = await res.json().catch(() => null);
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "QINGYAN_DISCOUNT_SAVE_RESULT",
              success: res.ok,
              error: res.ok ? null : body?.error || "保存失败",
            },
            "*",
          );
        } catch (err) {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "QINGYAN_DISCOUNT_SAVE_RESULT",
              success: false,
              error: String(err),
            },
            "*",
          );
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (e.data?.type !== "SAVE_QUOTE") return;
      const payload = e.data.payload as SavePayload;

      if (!customerId) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "SAVE_RESULT", success: false, error: "请先选择客户" },
          "*",
        );
        onRequireCustomer?.();
        return;
      }

      if (!payload?.items?.length) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "SAVE_RESULT", success: false, error: "No items to save" },
          "*",
        );
        return;
      }

      setSaving(true);
      try {
        const res = await apiFetch("/api/sales/quotes", {
          method: "POST",
          body: JSON.stringify({
            customerId,
            opportunityId: opportunityId || undefined,
            items: payload.items,
            addons: payload.addons,
            installMode: payload.installMode ?? "default",
            deliveryFee: payload.deliveryFee,
          }),
        }).then((r) => r.json());

        if (res.quote?.id) {
          const info = {
            quoteId: res.quote.id as string,
            shareToken: (res.quote.shareToken as string) ?? "",
            grandTotal: (res.quote.grandTotal as number) ?? 0,
            autoLinked: Boolean(res.lifecycle?.autoAdvanced),
          };
          setLastSaved(info);
          onSaved?.({ quoteId: info.quoteId, grandTotal: info.grandTotal });
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "SAVE_RESULT",
              success: true,
              quoteId: info.quoteId,
            },
            "*",
          );
        } else {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "SAVE_RESULT",
              success: false,
              error: res.error || "Unknown error",
            },
            "*",
          );
        }
      } catch (err) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "SAVE_RESULT", success: false, error: String(err) },
          "*",
        );
      } finally {
        setSaving(false);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [customerId, opportunityId, onRequireCustomer, onSaved]);

  const copyShareLink = (lang: string) => {
    if (!lastSaved?.shareToken) return;
    const url = `${window.location.origin}/quote/${lastSaved.shareToken}?lang=${lang}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex min-h-[70dvh] flex-col overflow-hidden rounded-xl border border-border bg-card-bg">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <span className="font-medium text-muted-foreground">
          July Rough Quote · 保存后进入「全部报价」
        </span>
        {saving && (
          <span className="animate-pulse text-muted-foreground">保存中…</span>
        )}
        {lastSaved && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
              <CheckCircle size={14} />
              已保存 · $
              {lastSaved.grandTotal.toLocaleString("en-CA", {
                minimumFractionDigits: 2,
              })}
              {lastSaved.autoLinked ? " · 商机已推进" : ""}
            </span>
            <Link
              href={`/sales/quote-sheet?quoteId=${lastSaved.quoteId}&mode=order`}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-background"
            >
              打开详细订单
            </Link>
            <Link
              href="/sales/quotes"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-background"
            >
              <ExternalLink size={12} />
              全部报价
            </Link>
            {lastSaved.shareToken &&
              ["en", "cn", "fr"].map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => copyShareLink(lang)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-background"
                >
                  <Share2 size={11} />
                  {lang === "en" ? "EN" : lang === "cn" ? "中" : "FR"}
                </button>
              ))}
            {copied && (
              <span className="font-medium text-emerald-600">已复制</span>
            )}
          </div>
        )}
      </div>
      <iframe
        ref={iframeRef}
        src={src}
        onLoad={handleIframeLoad}
        className="min-h-[65dvh] w-full flex-1 border-0 bg-white"
        title="Sunny Rough Quote"
      />
    </div>
  );
}
