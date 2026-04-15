"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Trash2,
  Ruler,
  FileText,
  ChevronDown,
  DollarSign,
  Copy,
  CheckCircle,
  AlertTriangle,
  Truck,
  Calculator,
} from "lucide-react";

import { priceFor, calculateQuoteTotal, formatCAD } from "@/lib/blinds/pricing-engine";
import { getAvailableFabrics, ALL_PRODUCTS } from "@/lib/blinds/pricing-data";
import type { ProductName, PriceResult } from "@/lib/blinds/pricing-types";
import { ADDON_CATALOG, getEligibleAddons } from "@/lib/blinds/pricing-addons";
import { PencilCanvas, type PencilCanvasRef } from "@/components/pencil-canvas";

interface WindowEntry {
  id: string;
  roomName: string;
  windowLabel: string;
  widthWhole: string;
  widthFrac: string;
  heightWhole: string;
  heightFrac: string;
  measureType: string;
  product: ProductName;
  fabric: string;
  cordless: boolean;
  notes: string;
}

const FRACTION_OPTIONS = [
  { label: "0", value: "0" },
  { label: "1/16", value: "0.0625" },
  { label: "1/8", value: "0.125" },
  { label: "3/16", value: "0.1875" },
  { label: "1/4", value: "0.25" },
  { label: "5/16", value: "0.3125" },
  { label: "3/8", value: "0.375" },
  { label: "7/16", value: "0.4375" },
  { label: "1/2", value: "0.5" },
  { label: "9/16", value: "0.5625" },
  { label: "5/8", value: "0.625" },
  { label: "11/16", value: "0.6875" },
  { label: "3/4", value: "0.75" },
  { label: "13/16", value: "0.8125" },
  { label: "7/8", value: "0.875" },
  { label: "15/16", value: "0.9375" },
];

const ROOM_PRESETS = [
  "Living Room", "Master Bedroom", "Bedroom 2", "Bedroom 3",
  "Kitchen", "Dining Room", "Bathroom", "Office", "Basement",
];

function newWindow(): WindowEntry {
  const product: ProductName = "Zebra";
  const fabrics = getAvailableFabrics(product);
  return {
    id: crypto.randomUUID(),
    roomName: "",
    windowLabel: "",
    widthWhole: "",
    widthFrac: "0",
    heightWhole: "",
    heightFrac: "0",
    measureType: "IN",
    product,
    fabric: fabrics[0] ?? "",
    cordless: false,
    notes: "",
  };
}

function toInches(whole: string, frac: string): number {
  return (parseFloat(whole) || 0) + (parseFloat(frac) || 0);
}

type ItemPricing = { type: "ok"; result: PriceResult } | { type: "error"; msg: string } | { type: "empty" };

function calcItemPrice(w: WindowEntry): ItemPricing {
  const wIn = toInches(w.widthWhole, w.widthFrac);
  const hIn = toInches(w.heightWhole, w.heightFrac);
  if (wIn <= 0 || hIn <= 0) return { type: "empty" };
  const res = priceFor(w.product, w.fabric, wIn, hIn, null, w.cordless);
  if ("error" in res) return { type: "error", msg: res.error };
  return { type: "ok", result: res };
}

export default function MeasurePage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<{ id: string; name: string; address?: string }[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [overallNotes, setOverallNotes] = useState("");
  const [windows, setWindows] = useState<WindowEntry[]>([newWindow()]);
  const [installMode, setInstallMode] = useState<"default" | "pickup">("default");
  const [saving, setSaving] = useState(false);
  const [showSketch, setShowSketch] = useState(false);
  const sketchRef = useRef<PencilCanvasRef>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/sales/customers?limit=200");
        const d = await res.json();
        setCustomers((d.customers ?? []) as typeof customers);
      } catch { /* ignore */ }
    })();
  }, []);

  const updateWindow = useCallback((id: string, field: string, value: unknown) => {
    setWindows((ws) => {
      return ws.map((w) => {
        if (w.id !== id) return w;
        const updated = { ...w, [field]: value };
        if (field === "product") {
          const fabrics = getAvailableFabrics(value as ProductName);
          updated.fabric = fabrics[0] ?? "";
          if (value !== "Zebra" && value !== "Roller") updated.cordless = false;
        }
        return updated;
      });
    });
  }, []);

  const addWindow = () => setWindows((ws) => [...ws, newWindow()]);

  const duplicateWindow = (id: string) => {
    setWindows((ws) => {
      const idx = ws.findIndex((w) => w.id === id);
      if (idx < 0) return ws;
      return [...ws.slice(0, idx + 1), { ...ws[idx], id: crypto.randomUUID(), windowLabel: "" }, ...ws.slice(idx + 1)];
    });
  };

  const removeWindow = (id: string) => {
    if (windows.length <= 1) return;
    setWindows((ws) => ws.filter((w) => w.id !== id));
  };

  const itemPricings = useMemo(() => windows.map(calcItemPrice), [windows]);

  const quoteSummary = useMemo(() => {
    const items = windows
      .map((w, i) => ({ w, p: itemPricings[i] }))
      .filter((x): x is { w: WindowEntry; p: { type: "ok"; result: PriceResult } } => x.p.type === "ok");
    if (items.length === 0) return null;

    const total = calculateQuoteTotal({
      items: items.map(({ w }) => ({
        product: w.product,
        fabric: w.fabric,
        widthIn: toInches(w.widthWhole, w.widthFrac),
        heightIn: toInches(w.heightWhole, w.heightFrac),
        cordless: w.cordless,
      })),
      installMode,
    });
    return total;
  }, [windows, itemPricings, installMode]);

  const hasValidItems = itemPricings.some((p) => p.type === "ok");

  const handleSaveAndQuote = async () => {
    if (!customerId || !hasValidItems) return;
    setSaving(true);
    try {
      const windowsPayload = windows.map((w) => ({
        roomName: w.roomName || "Room",
        windowLabel: w.windowLabel || null,
        widthIn: toInches(w.widthWhole, w.widthFrac),
        heightIn: toInches(w.heightWhole, w.heightFrac),
        measureType: w.measureType,
        product: w.product || null,
        fabric: w.fabric || null,
        cordless: w.cordless,
        notes: w.notes || null,
        sortOrder: 0,
      }));

      const body = { customerId, overallNotes, windows: windowsPayload };
      const res = await apiFetch("/api/sales/measurements", {
        method: "POST",
        body: JSON.stringify(body),
      }).then((r) => r.json());

      if (res.record?.id) {
        await apiFetch(`/api/sales/measurements/${res.record.id}/generate-quote`, {
          method: "POST",
          body: JSON.stringify({ installMode }),
        });
      }
      router.push("/sales/quotes");
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="现场量房 & 即时报价"
        description="录入窗位尺寸 → 实时查看价格 → 一键生成报价单"
      />

      {/* Customer + install mode */}
      <div className="rounded-xl border border-border bg-white/60 p-5">
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>客户 *</Label>
            <div className="relative">
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm appearance-none"
              >
                <option value="">选择客户</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>安装方式</Label>
            <div className="flex gap-2">
              {([["default", "含安装", Truck], ["pickup", "自提", DollarSign]] as const).map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  onClick={() => setInstallMode(mode)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    installMode === mode
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30",
                  )}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>备注</Label>
            <input
              value={overallNotes}
              onChange={(e) => setOverallNotes(e.target.value)}
              className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
              placeholder="整体备注..."
            />
          </div>
        </div>
      </div>

      {/* Window entries */}
      <div className="space-y-3">
        {windows.map((w, idx) => {
          const pricing = itemPricings[idx];
          const fabrics = getAvailableFabrics(w.product);
          const wIn = toInches(w.widthWhole, w.widthFrac);
          const hIn = toInches(w.heightWhole, w.heightFrac);
          const canCordless = w.product === "Zebra" || w.product === "Roller";

          return (
            <div key={w.id} className="rounded-xl border border-border bg-white/60 overflow-hidden">
              {/* Header row */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-b border-border/50">
                <span className="text-sm font-semibold text-foreground">
                  窗位 #{idx + 1}
                  {w.roomName && <span className="ml-2 font-normal text-muted-foreground">— {w.roomName}</span>}
                </span>
                <div className="flex items-center gap-2">
                  {pricing.type === "ok" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-0.5 text-sm font-bold text-emerald-700">
                      <DollarSign size={13} />
                      {formatCAD(pricing.result.price)}
                    </span>
                  )}
                  {pricing.type === "error" && (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                      <AlertTriangle size={12} />
                      {pricing.msg}
                    </span>
                  )}
                  <button
                    onClick={() => duplicateWindow(w.id)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors"
                    title="复制此窗位"
                  >
                    <Copy size={14} />
                  </button>
                  {windows.length > 1 && (
                    <button onClick={() => removeWindow(w.id)} className="rounded-md p-1 text-red-400 hover:bg-red-50 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4 space-y-3">
                {/* Row 1: Room, Label, Width, Height */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-[11px]">房间</Label>
                    <div className="relative">
                      <select
                        value={w.roomName}
                        onChange={(e) => updateWindow(w.id, "roomName", e.target.value)}
                        className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm appearance-none"
                      >
                        <option value="">选择房间</option>
                        {ROOM_PRESETS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px]">窗位标记</Label>
                    <input
                      value={w.windowLabel}
                      onChange={(e) => updateWindow(w.id, "windowLabel", e.target.value)}
                      className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
                      placeholder="W1 / Bay L"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px]">宽度 (英寸)</Label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={w.widthWhole}
                        onChange={(e) => updateWindow(w.id, "widthWhole", e.target.value)}
                        className="w-16 rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-center"
                        placeholder="48"
                        min="0"
                      />
                      <select
                        value={w.widthFrac}
                        onChange={(e) => updateWindow(w.id, "widthFrac", e.target.value)}
                        className="flex-1 rounded-lg border border-border bg-white px-1 py-1.5 text-xs"
                      >
                        {FRACTION_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px]">高度 (英寸)</Label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={w.heightWhole}
                        onChange={(e) => updateWindow(w.id, "heightWhole", e.target.value)}
                        className="w-16 rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-center"
                        placeholder="72"
                        min="0"
                      />
                      <select
                        value={w.heightFrac}
                        onChange={(e) => updateWindow(w.id, "heightFrac", e.target.value)}
                        className="flex-1 rounded-lg border border-border bg-white px-1 py-1.5 text-xs"
                      >
                        {FRACTION_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Row 2: Product, Fabric, Measure type, Cordless */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-[11px]">产品</Label>
                    <div className="relative">
                      <select
                        value={w.product}
                        onChange={(e) => updateWindow(w.id, "product", e.target.value)}
                        className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm appearance-none"
                      >
                        {ALL_PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">面料</Label>
                    <div className="relative">
                      <select
                        value={w.fabric}
                        onChange={(e) => updateWindow(w.id, "fabric", e.target.value)}
                        className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm appearance-none"
                      >
                        {fabrics.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">测量方式</Label>
                    <div className="relative">
                      <select
                        value={w.measureType}
                        onChange={(e) => updateWindow(w.id, "measureType", e.target.value)}
                        className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm appearance-none"
                      >
                        <option value="IN">Inside (IN)</option>
                        <option value="OUT">Outside (OUT)</option>
                        <option value="Tight">Tight</option>
                      </select>
                      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                  <div className="flex items-end pb-0.5">
                    <label className={cn(
                      "flex items-center gap-1.5 text-xs",
                      !canCordless && "opacity-40 cursor-not-allowed",
                    )}>
                      <input
                        type="checkbox"
                        checked={w.cordless}
                        onChange={(e) => updateWindow(w.id, "cordless", e.target.checked)}
                        disabled={!canCordless}
                        className="rounded border-border"
                      />
                      Cordless (+15%)
                    </label>
                  </div>
                </div>

                {/* Real-time pricing detail */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border/30 pt-2">
                  <span>W: {wIn > 0 ? `${wIn.toFixed(4)}"` : "—"}</span>
                  <span>H: {hIn > 0 ? `${hIn.toFixed(4)}"` : "—"}</span>
                  <span>SF: {wIn > 0 && hIn > 0 ? ((wIn * hIn) / 144).toFixed(1) : "—"}</span>
                  {pricing.type === "ok" && (
                    <>
                      <span className="text-muted-foreground/60">|</span>
                      <span>MSRP: {formatCAD(pricing.result.msrp)}</span>
                      <span>折扣: {(pricing.result.discountPct * 100).toFixed(0)}%</span>
                      <span className="font-medium text-foreground">售价: {formatCAD(pricing.result.price)}</span>
                      <span>安装: {formatCAD(pricing.result.install)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add window */}
      <button
        onClick={addWindow}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors"
      >
        <Plus size={16} />
        添加窗位
      </button>

      {/* Sketch area (Apple Pencil) */}
      <div className="rounded-xl border border-border bg-white/60 p-4">
        <button
          onClick={() => setShowSketch((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Ruler size={16} />
          {showSketch ? "收起手绘草图" : "展开手绘草图（Apple Pencil）"}
        </button>
        {showSketch && (
          <div className="mt-3">
            <PencilCanvas
              ref={sketchRef}
              width={1000}
              height={500}
              label="用 Apple Pencil 画窗户形状、标注尺寸"
            />
          </div>
        )}
      </div>

      {/* Price Summary */}
      {quoteSummary && (
        <div className="rounded-xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-white p-5">
          <div className="flex items-center gap-2 mb-4">
            <Calculator size={18} className="text-emerald-600" />
            <h3 className="text-base font-bold text-foreground">报价预览</h3>
            <span className="ml-auto text-xs text-muted-foreground">
              {quoteSummary.itemResults.length} 项有效 / {windows.length} 项总计
              {quoteSummary.errors.length > 0 && (
                <span className="text-amber-600 ml-2">({quoteSummary.errors.length} 项无法定价)</span>
              )}
            </span>
          </div>

          <div className="space-y-1.5 mb-4">
            {quoteSummary.itemResults.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {item.input.product} · {item.input.fabric}
                  <span className="ml-2 text-xs opacity-60">{item.input.widthIn}" × {item.input.heightIn}"</span>
                  {item.cordless && <span className="ml-1 text-xs text-blue-600">(Cordless)</span>}
                </span>
                <span className="font-medium">{formatCAD(item.price)}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-emerald-200 pt-3 space-y-1.5">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>产品小计</span>
              <span>{formatCAD(quoteSummary.merchSubtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>安装费 {installMode === "pickup" ? "(自提免安装)" : ""}</span>
              <span>{formatCAD(quoteSummary.installApplied)}</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>配送费</span>
              <span>{formatCAD(quoteSummary.deliveryFee)}</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>税前合计</span>
              <span>{formatCAD(quoteSummary.preTaxTotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>HST ({(quoteSummary.taxRate * 100).toFixed(0)}%)</span>
              <span>{formatCAD(quoteSummary.taxAmount)}</span>
            </div>
            <div className="flex justify-between items-center text-lg font-bold text-emerald-700 border-t border-emerald-200 pt-2">
              <span>总计</span>
              <span>{formatCAD(quoteSummary.grandTotal)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="sticky bottom-4 z-10">
        <div className="rounded-xl border border-border bg-white/95 shadow-lg backdrop-blur-sm p-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {!customerId && <span className="text-amber-600">请先选择客户</span>}
            {customerId && !hasValidItems && <span className="text-amber-600">请至少输入一个有效窗位尺寸</span>}
            {customerId && hasValidItems && quoteSummary && (
              <span>
                <span className="font-semibold text-foreground">{quoteSummary.itemResults.length}</span> 个窗位
                {" · "}
                预计总额 <span className="font-bold text-emerald-700">{formatCAD(quoteSummary.grandTotal)}</span>
              </span>
            )}
          </div>
          <button
            onClick={handleSaveAndQuote}
            disabled={saving || !customerId || !hasValidItems}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {saving ? (
              "保存并生成报价中..."
            ) : (
              <>
                <FileText size={16} />
                保存量房 & 生成报价单
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
