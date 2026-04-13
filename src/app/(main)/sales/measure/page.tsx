"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Trash2,
  Ruler,
  Camera,
  CheckCircle,
  FileText,
  ChevronDown,
} from "lucide-react";

interface WindowEntry {
  id: string;
  roomName: string;
  windowLabel: string;
  widthWhole: string;
  widthFrac: string;
  heightWhole: string;
  heightFrac: string;
  measureType: string;
  product: string;
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

const PRODUCTS = [
  "Zebra", "Roller", "Drapery", "Sheer", "Shutters",
  "SHANGRILA", "Cordless Cellular", "SkylightHoneycomb",
];

const ROOM_PRESETS = [
  "Living Room", "Master Bedroom", "Bedroom 2", "Bedroom 3",
  "Kitchen", "Dining Room", "Bathroom", "Office", "Basement",
];

function newWindow(): WindowEntry {
  return {
    id: crypto.randomUUID(),
    roomName: "",
    windowLabel: "",
    widthWhole: "",
    widthFrac: "0",
    heightWhole: "",
    heightFrac: "0",
    measureType: "IN",
    product: "Zebra",
    fabric: "",
    cordless: false,
    notes: "",
  };
}

function toInches(whole: string, frac: string): number {
  return (parseFloat(whole) || 0) + (parseFloat(frac) || 0);
}

export default function MeasurePage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<{ id: string; name: string; address?: string }[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [overallNotes, setOverallNotes] = useState("");
  const [windows, setWindows] = useState<WindowEntry[]>([newWindow()]);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    apiFetch("/api/sales/customers?limit=200")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers ?? []));
  }, []);

  const updateWindow = (id: string, field: string, value: unknown) => {
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, [field]: value } : w)));
  };

  const addWindow = () => setWindows((ws) => [...ws, newWindow()]);

  const duplicateWindow = (id: string) => {
    setWindows((ws) => {
      const idx = ws.findIndex((w) => w.id === id);
      if (idx < 0) return ws;
      const copy = { ...ws[idx], id: crypto.randomUUID(), windowLabel: "" };
      const next = [...ws];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const removeWindow = (id: string) => {
    if (windows.length <= 1) return;
    setWindows((ws) => ws.filter((w) => w.id !== id));
  };

  const handleSave = async () => {
    if (!customerId) return;
    setSaving(true);
    try {
      const body = {
        customerId,
        overallNotes,
        windows: windows.map((w) => ({
          roomName: w.roomName || "Room",
          windowLabel: w.windowLabel || null,
          widthIn: toInches(w.widthWhole, w.widthFrac),
          heightIn: toInches(w.heightWhole, w.heightFrac),
          measureType: w.measureType,
          product: w.product || null,
          fabric: w.fabric || null,
          cordless: w.cordless,
          notes: w.notes || null,
        })),
      };
      const res = await apiFetch("/api/sales/measurements", {
        method: "POST",
        body: JSON.stringify(body),
      }).then((r) => r.json());
      setSavedId(res.record?.id);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateQuote = async () => {
    if (!savedId) return;
    setGenerating(true);
    try {
      const res = await apiFetch(`/api/sales/measurements/${savedId}/generate-quote`, {
        method: "POST",
        body: JSON.stringify({ installMode: "default" }),
      }).then((r) => r.json());
      if (res.quote?.id) {
        router.push(`/sales/quotes`);
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="现场量房"
        description="录入窗位尺寸 → 选产品 → 一键报价"
      />

      {/* Customer select */}
      <div className="rounded-xl border border-border bg-white/60 p-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>客户 *</Label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
            >
              <option value="">选择客户</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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
        {windows.map((w, idx) => (
          <div key={w.id} className="rounded-xl border border-border bg-white/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-foreground">
                窗位 #{idx + 1}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => duplicateWindow(w.id)}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
                >
                  复制
                </button>
                {windows.length > 1 && (
                  <button onClick={() => removeWindow(w.id)} className="rounded-md p-1 text-red-400 hover:bg-red-50 transition-colors">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {/* Room */}
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

              {/* Window label */}
              <div className="space-y-1">
                <Label className="text-[11px]">窗位标记</Label>
                <input
                  value={w.windowLabel}
                  onChange={(e) => updateWindow(w.id, "windowLabel", e.target.value)}
                  className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
                  placeholder="W1 / Bay L"
                />
              </div>

              {/* Width: whole + fraction */}
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

              {/* Height: whole + fraction */}
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

            {/* Row 2: product, fabric, measure type */}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-[11px]">产品</Label>
                <select
                  value={w.product}
                  onChange={(e) => updateWindow(w.id, "product", e.target.value)}
                  className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
                >
                  {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">面料</Label>
                <input
                  value={w.fabric}
                  onChange={(e) => updateWindow(w.id, "fabric", e.target.value)}
                  className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
                  placeholder="默认"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">测量方式</Label>
                <select
                  value={w.measureType}
                  onChange={(e) => updateWindow(w.id, "measureType", e.target.value)}
                  className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
                >
                  <option value="IN">Inside (IN)</option>
                  <option value="OUT">Outside (OUT)</option>
                  <option value="Tight">Tight</option>
                </select>
              </div>
              <div className="flex items-end gap-2 pb-0.5">
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={w.cordless}
                    onChange={(e) => updateWindow(w.id, "cordless", e.target.checked)}
                    className="rounded border-border"
                  />
                  Cordless
                </label>
              </div>
            </div>

            {/* Display computed inches */}
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <span>W: {toInches(w.widthWhole, w.widthFrac).toFixed(4)}"</span>
              <span>H: {toInches(w.heightWhole, w.heightFrac).toFixed(4)}"</span>
              <span>SF: {((toInches(w.widthWhole, w.widthFrac) * toInches(w.heightWhole, w.heightFrac)) / 144).toFixed(1)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={addWindow}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        >
          <Plus size={16} />
          添加窗位
        </button>

        <div className="flex items-center gap-3">
          {savedId && (
            <button
              onClick={handleGenerateQuote}
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              <FileText size={16} />
              {generating ? "生成中..." : "一键生成报价"}
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !customerId || windows.every((w) => !w.widthWhole)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              "保存中..."
            ) : savedId ? (
              <>
                <CheckCircle size={16} />
                已保存
              </>
            ) : (
              <>
                <Ruler size={16} />
                保存量房记录
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
