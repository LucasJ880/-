"use client";

import { useState, useEffect } from "react";
import { Plus, X, Loader2, DollarSign } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Opportunity } from "./types";
import { useSalesCurrentOrgId } from "@/lib/hooks/use-sales-current-org-id";
import {
  isSalesOrgCreateBlocked,
  salesOrgCreateBlockedHint,
  withSalesOrgId,
} from "@/lib/sales/sales-client-org";

interface QuoteLineItem {
  product: string;
  fabric: string;
  widthIn: string;
  heightIn: string;
  cordless: boolean;
  location: string;
}

interface ProductOption {
  name: string;
  fabrics: string[];
}

interface PreviewResult {
  grandTotal: number;
  merchSubtotal: number;
  installApplied: number;
  deliveryFee: number;
  taxAmount: number;
  itemResults: { price: number; install: number; msrp: number; discountPct: number }[];
  errors: { index: number; error: string }[];
}

export function CreateQuoteDialog({
  open,
  onOpenChange,
  customerId,
  opportunities,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  opportunities: Opportunity[];
  onSuccess: () => void;
}) {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [opportunityId, setOpportunityId] = useState("");
  const [installMode, setInstallMode] = useState<"default" | "pickup">("default");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<QuoteLineItem[]>([
    { product: "", fabric: "", widthIn: "", heightIn: "", cordless: false, location: "" },
  ]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { orgId, ambiguous, loading: orgLoading } = useSalesCurrentOrgId();

  useEffect(() => {
    apiFetch("/api/sales/quotes/preview")
      .then((r) => r.json())
      .then((d) => setProducts(d.products || []))
      .catch(() => {})
      .finally(() => setLoadingProducts(false));
  }, []);

  const updateItem = (idx: number, patch: Partial<QuoteLineItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    setPreview(null);
  };

  const removeItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
    setPreview(null);
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { product: "", fabric: "", widthIn: "", heightIn: "", cordless: false, location: "" },
    ]);
  };

  const canPreview = items.every(
    (it) => it.product && it.fabric && Number(it.widthIn) > 0 && Number(it.heightIn) > 0
  );

  const handlePreview = async () => {
    if (!canPreview) return;
    setPreviewLoading(true);
    try {
      const apiItems = items.map((it) => ({
        product: it.product,
        fabric: it.fabric,
        widthIn: Number(it.widthIn),
        heightIn: Number(it.heightIn),
        cordless: it.cordless,
        location: it.location || undefined,
      }));
      const res = await apiFetch("/api/sales/quotes/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: apiItems, installMode }),
      });
      const data = await res.json();
      setPreview(data);
    } catch (err) {
      console.error(err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!canPreview) return;
    if (isSalesOrgCreateBlocked(orgLoading, ambiguous, orgId)) {
      alert(salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? "无法保存");
      return;
    }
    setSaving(true);
    try {
      const apiItems = items.map((it) => ({
        product: it.product,
        fabric: it.fabric,
        widthIn: Number(it.widthIn),
        heightIn: Number(it.heightIn),
        cordless: it.cordless,
        location: it.location || undefined,
      }));
      const res = await apiFetch("/api/sales/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          withSalesOrgId(orgId!, {
            customerId,
            opportunityId: opportunityId || undefined,
            items: apiItems,
            installMode,
            notes: notes || undefined,
          }),
        ),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "创建报价失败");
        return;
      }
      onSuccess();
    } catch (err) {
      console.error(err);
      alert("创建报价失败");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/20";

  const getFabrics = (productName: string) =>
    products.find((p) => p.name === productName)?.fabrics || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新建报价</DialogTitle>
          <DialogDescription>为客户创建窗饰产品报价</DialogDescription>
        </DialogHeader>

        {loadingProducts ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {opportunities.length > 0 && (
                <div className="space-y-1.5">
                  <Label>关联机会</Label>
                  <ShadSelect
                    value={opportunityId || "none"}
                    onValueChange={(v) => setOpportunityId(v === "none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="不关联" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不关联</SelectItem>
                      {opportunities.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>安装方式</Label>
                <ShadSelect
                  value={installMode}
                  onValueChange={(v) => {
                    setInstallMode(v as "default" | "pickup");
                    setPreview(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">上门安装</SelectItem>
                    <SelectItem value="pickup">自取 (无安装费)</SelectItem>
                  </SelectContent>
                </ShadSelect>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  产品明细 ({items.length})
                </span>
                <button
                  onClick={addItem}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  添加产品
                </button>
              </div>

              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-border/60 bg-white/50 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-muted">#{idx + 1}</span>
                    {items.length > 1 && (
                      <button
                        onClick={() => removeItem(idx)}
                        className="text-muted hover:text-red-500 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-0.5 block text-[10px] text-muted">产品</label>
                      <select
                        className={inputClass}
                        value={item.product}
                        onChange={(e) => updateItem(idx, { product: e.target.value, fabric: "" })}
                      >
                        <option value="">选择产品…</option>
                        {products.map((p) => (
                          <option key={p.name} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] text-muted">面料/系列</label>
                      <select
                        className={inputClass}
                        value={item.fabric}
                        onChange={(e) => updateItem(idx, { fabric: e.target.value })}
                        disabled={!item.product}
                      >
                        <option value="">选择面料…</option>
                        {getFabrics(item.product).map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className="mb-0.5 block text-[10px] text-muted">宽 (inch)</label>
                      <Input
                        type="number"
                        placeholder="宽"
                        value={item.widthIn}
                        min={1}
                        onChange={(e) => updateItem(idx, { widthIn: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] text-muted">高 (inch)</label>
                      <Input
                        type="number"
                        placeholder="高"
                        value={item.heightIn}
                        min={1}
                        onChange={(e) => updateItem(idx, { heightIn: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] text-muted">位置</label>
                      <Input
                        placeholder="可选"
                        value={item.location}
                        onChange={(e) => updateItem(idx, { location: e.target.value })}
                      />
                    </div>
                    <div className="flex items-end pb-0.5">
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-muted cursor-pointer">
                        <input
                          type="checkbox"
                          className="rounded border-border"
                          checked={item.cordless}
                          onChange={(e) => updateItem(idx, { cordless: e.target.checked })}
                        />
                        无绳
                      </label>
                    </div>
                  </div>
                  {preview?.itemResults[idx] && (
                    <div className="flex items-center gap-3 rounded bg-accent/5 px-2 py-1 text-[11px]">
                      <span className="text-muted">MSRP ${preview.itemResults[idx].msrp}</span>
                      <span className="text-muted">折后 ${preview.itemResults[idx].price.toFixed(2)}</span>
                      <span className="text-muted">安装 ${preview.itemResults[idx].install.toFixed(2)}</span>
                    </div>
                  )}
                  {preview?.errors.find((e) => e.index === idx) && (
                    <p className="text-[11px] text-red-500">
                      {preview.errors.find((e) => e.index === idx)!.error}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label>备注</Label>
              <textarea
                className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:border-accent/30 h-16 resize-none"
                placeholder="可选备注…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {preview && preview.itemResults.length > 0 && (
              <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 space-y-1 text-sm">
                <div className="flex justify-between text-muted">
                  <span>产品小计</span><span>${preview.merchSubtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>安装费</span><span>${preview.installApplied.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>配送费</span><span>${preview.deliveryFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>税费 (HST)</span><span>${preview.taxAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t border-accent/20 pt-1 font-semibold text-foreground">
                  <span>总计</span><span>${preview.grandTotal.toFixed(2)}</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                variant="secondary"
                onClick={handlePreview}
                disabled={!canPreview || previewLoading}
              >
                {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
                计算价格
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                <Button
                  variant="accent"
                  onClick={handleSubmit}
                  disabled={
                    saving ||
                    !canPreview ||
                    isSalesOrgCreateBlocked(orgLoading, ambiguous, orgId)
                  }
                  title={salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? undefined}
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  创建报价
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
