"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import {
  CheckCircle,
  ExternalLink,
  Share2,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";

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

export default function QuoteToolPage() {
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [customers, setCustomers] = useState<
    { id: string; name: string; phone?: string; email?: string }[]
  >([]);
  const [customerId, setCustomerId] = useState("");
  const [opportunities, setOpportunities] = useState<
    { id: string; title: string; stage: string; estimatedValue: number | null; productTypes: string | null }[]
  >([]);
  const [opportunityId, setOpportunityId] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<{
    quoteId: string;
    shareToken: string;
    grandTotal: number;
    autoLinked?: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiFetch("/api/sales/customers?limit=200")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers ?? []));
  }, []);

  useEffect(() => {
    if (!customerId) { setOpportunities([]); setOpportunityId(""); return; }
    apiFetch(`/api/sales/customers/${customerId}/opportunities`)
      .then((r) => r.json())
      .then((d) => {
        const opps = d.opportunities ?? [];
        setOpportunities(opps);
        setOpportunityId(opps.length === 1 ? opps[0].id : "");
      })
      .catch(() => setOpportunities([]));
  }, [customerId]);

  const handleIframeLoad = useCallback(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "QINGYAN_INIT" },
        "*",
      );
    }
  }, []);

  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (e.data?.type !== "SAVE_QUOTE") return;
      const payload = e.data.payload as SavePayload;

      if (!customerId) {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: "SAVE_RESULT",
            success: false,
            error: "请先在顶部选择客户",
          },
          "*",
        );
        return;
      }

      if (!payload?.items?.length) {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: "SAVE_RESULT",
            success: false,
            error: "No items to save",
          },
          "*",
        );
        return;
      }

      setSaving(true);
      try {
        const body = {
          customerId,
          opportunityId: opportunityId || undefined,
          items: payload.items,
          addons: payload.addons,
          installMode: payload.installMode ?? "default",
          deliveryFee: payload.deliveryFee,
        };

        const res = await apiFetch("/api/sales/quotes", {
          method: "POST",
          body: JSON.stringify(body),
        }).then((r) => r.json());

        if (res.quote?.id) {
          setLastSaved({
            quoteId: res.quote.id,
            shareToken: res.quote.shareToken ?? "",
            grandTotal: res.quote.grandTotal ?? 0,
            autoLinked: res.lifecycle?.autoAdvanced ?? false,
          });
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "SAVE_RESULT",
              success: true,
              quoteId: res.quote.id,
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
          {
            type: "SAVE_RESULT",
            success: false,
            error: String(err),
          },
          "*",
        );
      } finally {
        setSaving(false);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [customerId]);

  const copyShareLink = (lang: string) => {
    if (!lastSaved?.shareToken) return;
    const url = `${window.location.origin}/quote/${lastSaved.shareToken}?lang=${lang}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex h-[calc(100vh-60px)] flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-4 border-b border-border bg-white/80 px-4 py-2.5 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            报价工具
          </span>
          <span className="text-xs text-muted-foreground">
            Sunny Quote System
          </span>
        </div>

        <div className="mx-2 h-5 w-px bg-border" />

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            保存到客户：
          </label>
          <div className="relative">
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setLastSaved(null);
              }}
              className="rounded-lg border border-border bg-white px-3 py-1.5 pr-8 text-sm appearance-none min-w-[180px]"
            >
              <option value="">选择客户</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` (${c.phone})` : ""}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
          </div>
          {!customerId && (
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <AlertTriangle size={12} />
              需要选择客户才能保存
            </span>
          )}
        </div>

        {/* 商机选择器 — 选客户后自动加载 */}
        {customerId && opportunities.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">商机：</label>
            <div className="relative">
              <select
                value={opportunityId}
                onChange={(e) => setOpportunityId(e.target.value)}
                className="rounded-lg border border-border bg-white px-3 py-1.5 pr-8 text-sm appearance-none min-w-[160px]"
              >
                {opportunities.length > 1 && <option value="">自动匹配</option>}
                {opportunities.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                    {o.productTypes ? ` (${o.productTypes})` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          </div>
        )}

        {saving && (
          <span className="text-xs text-muted-foreground animate-pulse">
            保存中...
          </span>
        )}

        {lastSaved && (
          <div className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle size={14} />
              已保存 · ${lastSaved.grandTotal.toLocaleString("en-CA", { minimumFractionDigits: 2 })}
              {lastSaved.autoLinked && " · 商机已自动推进到「已报价」"}
            </span>
            <button
              onClick={() => router.push("/sales/quotes")}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              <ExternalLink size={12} />
              查看全部报价
            </button>
            {lastSaved.shareToken && (
              <div className="flex items-center gap-1">
                {copied ? (
                  <span className="text-xs text-emerald-600 font-medium">
                    已复制!
                  </span>
                ) : (
                  <>
                    {["en", "cn", "fr"].map((lang) => (
                      <button
                        key={lang}
                        onClick={() => copyShareLink(lang)}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
                        title={`复制${lang === "en" ? "英文" : lang === "cn" ? "中文" : "法语"}分享链接`}
                      >
                        <Share2 size={11} />
                        {lang === "en"
                          ? "EN"
                          : lang === "cn"
                            ? "中"
                            : "FR"}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* iframe — cache bust via build timestamp */}
      <iframe
        ref={iframeRef}
        src={`/sunny-quote.html?v=${Date.now()}`}
        onLoad={handleIframeLoad}
        className="flex-1 w-full border-0"
        title="Sunny Quote Tool"
      />
    </div>
  );
}
