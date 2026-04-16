"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import {
  CheckCircle,
  ExternalLink,
  Share2,
  ChevronDown,
  AlertTriangle,
  User,
  X,
  History,
} from "lucide-react";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { canViewAdminPages } from "@/lib/permissions-client";

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
  const { isMobile } = useIsMobile();
  const { user: currentUser } = useCurrentUser();
  const canViewAudit = canViewAdminPages(currentUser?.role);
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
  const [mobileSelectorOpen, setMobileSelectorOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await apiJson<{ customers?: typeof customers }>("/api/sales/customers?limit=200");
        setCustomers((d.customers ?? []) as typeof customers);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    if (!customerId) { setOpportunities([]); setOpportunityId(""); return; }
    apiJson<{ opportunities?: typeof opportunities }>(`/api/sales/customers/${customerId}/opportunities`)
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
        { type: "QINGYAN_INIT", mobile: isMobile },
        "*",
      );
    }
  }, [isMobile]);

  useEffect(() => {
    const logHandler = (e: MessageEvent) => {
      if (e.data?.type !== "QINGYAN_DISCOUNT_LOG") return;
      const payload = e.data.payload as {
        before: Record<string, number> | null;
        after: Record<string, number> | null;
        code?: string;
      };
      apiFetch("/api/sales/quote-settings/log", {
        method: "POST",
        body: JSON.stringify(payload),
      }).catch(() => {
        /* 记录失败不影响主流程，控制台已有错误 */
      });
    };
    window.addEventListener("message", logHandler);
    return () => window.removeEventListener("message", logHandler);
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
            error: "请先选择客户",
          },
          "*",
        );
        if (isMobile) setMobileSelectorOpen(true);
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
  }, [customerId, opportunityId, isMobile]);

  const copyShareLink = (lang: string) => {
    if (!lastSaved?.shareToken) return;
    const url = `${window.location.origin}/quote/${lastSaved.shareToken}?lang=${lang}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const selectedOpp = opportunities.find((o) => o.id === opportunityId);

  return (
    <div className="-mx-4 md:-mx-6 -my-4 md:-my-5 flex h-[calc(100dvh-52px)] md:h-[calc(100vh-60px)] flex-col">
      {/* ───── Desktop toolbar ───── */}
      <div className="hidden md:flex items-center gap-4 border-b border-border bg-white/80 px-4 py-2.5 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">报价工具</span>
          <span className="text-xs text-muted-foreground">Sunny Quote System</span>
        </div>

        <div className="mx-2 h-5 w-px bg-border" />

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">保存到客户：</label>
          <div className="relative">
            <select
              value={customerId}
              onChange={(e) => { setCustomerId(e.target.value); setLastSaved(null); }}
              className="rounded-lg border border-border bg-white px-3 py-1.5 pr-8 text-sm appearance-none min-w-[180px]"
            >
              <option value="">选择客户</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.phone ? ` (${c.phone})` : ""}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          </div>
          {!customerId && (
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <AlertTriangle size={12} />需要选择客户才能保存
            </span>
          )}
        </div>

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
                    {o.title}{o.productTypes ? ` (${o.productTypes})` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        )}

        {saving && <span className="text-xs text-muted-foreground animate-pulse">保存中...</span>}

        {canViewAudit && (
          <button
            onClick={() => router.push("/sales/quote-tool/audit")}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-white px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            title="查看折扣率修改记录"
          >
            <History size={12} />
            折扣修改记录
          </button>
        )}

        {lastSaved && (
          <div className={`${canViewAudit ? "" : "ml-auto"} flex items-center gap-3`}>
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle size={14} />
              {`已保存 · $${lastSaved.grandTotal.toLocaleString("en-CA", { minimumFractionDigits: 2 })}`}
              {lastSaved.autoLinked && " · 商机已自动推进到「已报价」"}
            </span>
            <button
              onClick={() => router.push("/sales/quotes")}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              <ExternalLink size={12} />查看全部报价
            </button>
            {lastSaved.shareToken && (
              <div className="flex items-center gap-1">
                {copied ? (
                  <span className="text-xs text-emerald-600 font-medium">已复制!</span>
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
                        {lang === "en" ? "EN" : lang === "cn" ? "中" : "FR"}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ───── Mobile compact header ───── */}
      <div className="flex md:hidden items-center justify-between gap-2 border-b border-border bg-white/85 px-3 py-2 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setMobileSelectorOpen(true)}
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
            customerId
              ? "border-[var(--accent-soft)] bg-[var(--accent-light)] text-[var(--accent)]"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          <User size={12} />
          <span className="max-w-[140px] truncate">
            {selectedCustomer ? selectedCustomer.name : "选择客户"}
          </span>
          {selectedOpp && <span className="text-muted-foreground">· {selectedOpp.title}</span>}
        </button>
        <div className="flex items-center gap-1.5">
          {saving && (
            <span className="text-[11px] text-muted-foreground animate-pulse">保存中...</span>
          )}
          {canViewAudit && (
            <button
              type="button"
              onClick={() => router.push("/sales/quote-tool/audit")}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-white text-muted-foreground active:bg-muted/50"
              aria-label="折扣修改记录"
              title="折扣修改记录"
            >
              <History size={13} />
            </button>
          )}
        </div>
      </div>

      {/* iframe — cache bust via build timestamp；折扣率调整需在 iframe 内输入访问码，走后端审计 */}
      <iframe
        ref={iframeRef}
        src={`/sunny-quote.html?v=${Date.now()}${isMobile ? "&m=1" : ""}`}
        onLoad={handleIframeLoad}
        className="flex-1 w-full border-0"
        title="Sunny Quote Tool"
      />

      {/* ───── Mobile bottom saved toast ───── */}
      {isMobile && lastSaved && (
        <div className="absolute inset-x-3 bottom-[calc(var(--mobile-tabbar-height)+env(safe-area-inset-bottom,0px)+12px)] z-30 rounded-xl border border-emerald-200 bg-white/95 p-3 shadow-float backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <CheckCircle size={16} />
            已保存 ${lastSaved.grandTotal.toLocaleString("en-CA", { minimumFractionDigits: 2 })}
          </div>
          {lastSaved.autoLinked && (
            <div className="mt-0.5 text-[11px] text-emerald-600">商机已推进到「已报价」</div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {lastSaved.shareToken && ["en", "cn", "fr"].map((lang) => (
              <button
                key={lang}
                onClick={() => copyShareLink(lang)}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] text-muted-foreground active:bg-muted/50"
              >
                <Share2 size={10} />
                {lang === "en" ? "英文" : lang === "cn" ? "中文" : "法语"}链接
              </button>
            ))}
            <button
              onClick={() => router.push("/sales/quotes")}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] text-foreground active:bg-muted/50"
            >
              <ExternalLink size={10} />全部报价
            </button>
            {copied && <span className="ml-1 text-[11px] text-emerald-600 font-medium">已复制!</span>}
          </div>
        </div>
      )}

      {/* ───── Mobile selector sheet ───── */}
      {isMobile && mobileSelectorOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
          <div
            className="absolute inset-0"
            onClick={() => setMobileSelectorOpen(false)}
          />
          <div className="relative z-10 max-h-[80dvh] rounded-t-2xl bg-white pb-safe shadow-dialog">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-base font-semibold text-foreground">选择客户与商机</h3>
              <button
                onClick={() => setMobileSelectorOpen(false)}
                className="rounded-full p-1 text-muted-foreground active:bg-muted/50"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-4 py-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  客户 <span className="text-amber-600">必填</span>
                </label>
                <select
                  value={customerId}
                  onChange={(e) => {
                    setCustomerId(e.target.value);
                    setLastSaved(null);
                  }}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-base"
                >
                  <option value="">选择客户</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.phone ? ` (${c.phone})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {customerId && opportunities.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">商机</label>
                  <select
                    value={opportunityId}
                    onChange={(e) => setOpportunityId(e.target.value)}
                    className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-base"
                  >
                    {opportunities.length > 1 && <option value="">自动匹配</option>}
                    {opportunities.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                        {o.productTypes ? ` (${o.productTypes})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="button"
                onClick={() => setMobileSelectorOpen(false)}
                className="w-full rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white active:bg-[var(--accent-hover)]"
              >
                完成
              </button>

              {canViewAudit && (
                <div className="border-t border-border pt-3">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                    管理
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileSelectorOpen(false);
                      router.push("/sales/quote-tool/audit");
                    }}
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-foreground active:bg-muted/50"
                  >
                    <span className="flex items-center gap-2">
                      <History size={14} className="text-muted-foreground" />
                      折扣修改记录
                    </span>
                    <ChevronDown size={14} className="-rotate-90 text-muted-foreground" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
