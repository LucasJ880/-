"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  Package,
  Plus,
  Search,
  AlertTriangle,
  ArrowUpCircle,
  ArrowDownCircle,
  X,
} from "lucide-react";

interface Fabric {
  id: string;
  sku: string;
  productType: string;
  fabricName: string;
  color: string | null;
  supplier: string | null;
  totalYards: number;
  reservedYards: number;
  minYards: number;
  unitCost: number;
  status: string;
  lastRestockAt: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  in_stock: "bg-emerald-100 text-emerald-700",
  low: "bg-amber-100 text-amber-700",
  out_of_stock: "bg-red-100 text-red-700",
};
const STATUS_LABELS: Record<string, string> = {
  in_stock: "充足",
  low: "偏低",
  out_of_stock: "缺货",
};

export default function InventoryPage() {
  const [fabrics, setFabrics] = useState<Fabric[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [adjustFabric, setAdjustFabric] = useState<Fabric | null>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const [newSku, setNewSku] = useState("");
  const [newProduct, setNewProduct] = useState("Zebra");
  const [newFabric, setNewFabric] = useState("");
  const [newColor, setNewColor] = useState("");
  const [newYards, setNewYards] = useState("");
  const [newMinYards, setNewMinYards] = useState("10");
  const [newCost, setNewCost] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch("/api/inventory").then((r) => r.json());
      setFabrics(d.fabrics ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    await apiFetch("/api/inventory", {
      method: "POST",
      body: JSON.stringify({
        sku: newSku, productType: newProduct, fabricName: newFabric,
        color: newColor, totalYards: newYards, minYards: newMinYards, unitCost: newCost,
      }),
    });
    setShowAdd(false);
    setNewSku(""); setNewFabric(""); setNewColor(""); setNewYards(""); setNewCost("");
    load();
  };

  const handleAdjust = async (direction: number) => {
    if (!adjustFabric || !adjustQty) return;
    const qty = parseFloat(adjustQty) * direction;
    await apiFetch(`/api/inventory/${adjustFabric.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        adjustYards: qty,
        type: direction > 0 ? "restock" : "consume",
        reason: adjustReason || undefined,
      }),
    });
    setAdjustFabric(null);
    setAdjustQty("");
    setAdjustReason("");
    load();
  };

  const filtered = fabrics.filter((f) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return f.sku.toLowerCase().includes(s) ||
      f.fabricName.toLowerCase().includes(s) ||
      f.productType.toLowerCase().includes(s) ||
      (f.color ?? "").toLowerCase().includes(s);
  });

  const lowCount = fabrics.filter((f) => f.status === "low").length;
  const outCount = fabrics.filter((f) => f.status === "out_of_stock").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="面料库存"
        description="管理面料入库、出库和库存预警"
        actions={
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} />
            新增面料
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "总 SKU", value: fabrics.length, color: "text-blue-600" },
          { label: "充足", value: fabrics.length - lowCount - outCount, color: "text-emerald-600" },
          { label: "偏低", value: lowCount, color: "text-amber-600" },
          { label: "缺货", value: outCount, color: "text-red-600" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-white/60 p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn("mt-1 text-2xl font-bold", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索 SKU、面料、产品..."
          className="w-full rounded-lg border border-border bg-white/80 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/20"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-20 text-center text-sm text-muted-foreground">加载中...</div>
      ) : (
        <div className="rounded-xl border border-border bg-white/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">产品</th>
                <th className="px-4 py-3">面料</th>
                <th className="px-4 py-3">颜色</th>
                <th className="px-4 py-3 text-right">总库存</th>
                <th className="px-4 py-3 text-right">已预留</th>
                <th className="px-4 py-3 text-right">可用</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const avail = f.totalYards - f.reservedYards;
                return (
                  <tr key={f.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-4 py-3 font-mono text-xs">{f.sku}</td>
                    <td className="px-4 py-3">{f.productType}</td>
                    <td className="px-4 py-3 font-medium">{f.fabricName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{f.color ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{f.totalYards.toFixed(1)} yd</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{f.reservedYards.toFixed(1)}</td>
                    <td className={cn("px-4 py-3 text-right font-medium", avail <= f.minYards ? "text-red-600" : "")}>
                      {avail.toFixed(1)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLORS[f.status] || "")}>
                        {f.status === "low" && <AlertTriangle size={11} />}
                        {STATUS_LABELS[f.status] || f.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setAdjustFabric(f)}
                        className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                      >
                        调整
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add dialog */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">新增面料</h3>
              <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-muted rounded-md"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">SKU *</Label><input value={newSku} onChange={(e) => setNewSku(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm" /></div>
              <div className="space-y-1"><Label className="text-xs">产品类型</Label>
                <select value={newProduct} onChange={(e) => setNewProduct(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm">
                  {["Zebra","Roller","Drapery","Sheer","Shutters","SHANGRILA","Cordless Cellular","SkylightHoneycomb"].map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label className="text-xs">面料名 *</Label><input value={newFabric} onChange={(e) => setNewFabric(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm" /></div>
              <div className="space-y-1"><Label className="text-xs">颜色</Label><input value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm" /></div>
              <div className="space-y-1"><Label className="text-xs">初始库存 (yards)</Label><input type="number" value={newYards} onChange={(e) => setNewYards(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm" /></div>
              <div className="space-y-1"><Label className="text-xs">安全库存线</Label><input type="number" value={newMinYards} onChange={(e) => setNewMinYards(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm" /></div>
              <div className="space-y-1"><Label className="text-xs">单位成本 ($/yd)</Label><input type="number" value={newCost} onChange={(e) => setNewCost(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm" /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="rounded-lg border border-border px-4 py-2 text-sm">取消</button>
              <button onClick={handleAdd} disabled={!newSku || !newFabric} className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">新增</button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust dialog */}
      {adjustFabric && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">库存调整 — {adjustFabric.sku}</h3>
              <button onClick={() => setAdjustFabric(null)} className="p-1 hover:bg-muted rounded-md"><X size={18} /></button>
            </div>
            <p className="text-sm text-muted-foreground">
              当前: {adjustFabric.totalYards.toFixed(1)} yd（可用 {(adjustFabric.totalYards - adjustFabric.reservedYards).toFixed(1)}）
            </p>
            <div className="space-y-1">
              <Label className="text-xs">数量 (yards)</Label>
              <input type="number" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="10" min="0.1" step="0.1" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">原因</Label>
              <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="进货/工单消耗/盘点修正..." />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => handleAdjust(1)} disabled={!adjustQty} className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 py-2 text-sm text-white disabled:opacity-50">
                <ArrowUpCircle size={15} /> 入库
              </button>
              <button onClick={() => handleAdjust(-1)} disabled={!adjustQty} className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-red-500 py-2 text-sm text-white disabled:opacity-50">
                <ArrowDownCircle size={15} /> 出库
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
