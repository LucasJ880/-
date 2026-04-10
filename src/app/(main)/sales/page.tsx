"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Plus,
  Upload,
  Users,
  DollarSign,
  TrendingUp,
  Clock,
  Phone,
  Mail,
  ChevronRight,
  X,
  Loader2,
  FileSpreadsheet,
  Search,
  Eye,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

/* ── Pipeline stages ── */
const STAGES = [
  { key: "new_inquiry", label: "新询盘", color: "bg-blue-100 text-blue-800 border-blue-200" },
  { key: "consultation_booked", label: "已约咨询", color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
  { key: "measured", label: "已测量", color: "bg-amber-100 text-amber-800 border-amber-200" },
  { key: "quoted", label: "已报价", color: "bg-orange-100 text-orange-800 border-orange-200" },
  { key: "negotiation", label: "洽谈中", color: "bg-purple-100 text-purple-800 border-purple-200" },
  { key: "won", label: "已成交", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { key: "lost", label: "已流失", color: "bg-red-100 text-red-800 border-red-200" },
  { key: "on_hold", label: "暂搁置", color: "bg-gray-100 text-gray-600 border-gray-200" },
] as const;

const PRIORITIES = {
  hot: { label: "热", class: "bg-red-500 text-white" },
  warm: { label: "温", class: "bg-amber-500 text-white" },
  cold: { label: "冷", class: "bg-blue-400 text-white" },
};

/* ── Types ── */
interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  status: string;
  createdAt: string;
  opportunities: Opportunity[];
  _count: { interactions: number; quotes: number; blindsOrders: number };
}

interface Opportunity {
  id: string;
  title: string;
  stage: string;
  estimatedValue: number | null;
  priority: string;
  productTypes: string | null;
  customer?: { id: string; name: string; phone: string | null };
  _count?: { interactions: number; quotes: number; blindsOrders: number };
  nextFollowupAt: string | null;
  updatedAt: string;
}

interface ImportResult {
  totalRows: number;
  customersCreated: number;
  opportunitiesCreated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

type ViewMode = "pipeline" | "customers";

/* ── Component ── */
export default function SalesPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("pipeline");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (viewMode === "pipeline") {
        const res = await apiFetch("/api/sales/opportunities");
        const data = await res.json();
        setOpportunities(data.opportunities || []);
      } else {
        const qs = search ? `?search=${encodeURIComponent(search)}` : "";
        const res = await apiFetch(`/api/sales/customers${qs}`);
        const data = await res.json();
        setCustomers(data.customers || []);
      }
    } catch (err) {
      console.error("Load sales data failed:", err);
    } finally {
      setLoading(false);
    }
  }, [viewMode, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="销售管理"
        description="Sunny Shutter 销售 Pipeline · 客户 · 报价"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white/80 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-white transition-colors"
            >
              <Upload className="h-4 w-4" />
              CSV 导入
            </button>
            <button
              onClick={() => setShowNewCustomer(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-white hover:bg-foreground/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              新客户
            </button>
          </div>
        }
      />

      {/* Stats cards */}
      <StatsCards opportunities={opportunities} customers={customers} viewMode={viewMode} />

      {/* View toggle + search */}
      <div className="flex items-center justify-between gap-4">
        <div className="inline-flex rounded-lg border border-border bg-white/60 p-0.5">
          <button
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              viewMode === "pipeline"
                ? "bg-white text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            )}
            onClick={() => setViewMode("pipeline")}
          >
            Pipeline 看板
          </button>
          <button
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              viewMode === "customers"
                ? "bg-white text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            )}
            onClick={() => setViewMode("customers")}
          >
            客户列表
          </button>
        </div>

        {viewMode === "customers" && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="搜索客户…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-border bg-white/80 py-1.5 pl-9 pr-3 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : viewMode === "pipeline" ? (
        <PipelineBoard opportunities={opportunities} onRefresh={loadData} />
      ) : (
        <CustomerList customers={customers} />
      )}

      {/* CSV Import dialog */}
      {showImport && (
        <CsvImportDialog
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false);
            loadData();
          }}
        />
      )}

      {/* New Customer dialog */}
      {showNewCustomer && (
        <NewCustomerDialog
          onClose={() => setShowNewCustomer(false)}
          onSuccess={() => {
            setShowNewCustomer(false);
            loadData();
          }}
        />
      )}
    </div>
  );
}

/* ── Stats Cards ── */
function StatsCards({
  opportunities,
  customers,
  viewMode,
}: {
  opportunities: Opportunity[];
  customers: Customer[];
  viewMode: ViewMode;
}) {
  const activeOpps = opportunities.filter(
    (o) => !["won", "lost", "on_hold"].includes(o.stage)
  );
  const totalPipeline = activeOpps.reduce(
    (sum, o) => sum + (o.estimatedValue || 0),
    0
  );
  const wonOpps = opportunities.filter((o) => o.stage === "won");
  const wonTotal = wonOpps.reduce((sum, o) => sum + (o.estimatedValue || 0), 0);

  const stats = [
    {
      label: "进行中",
      value: activeOpps.length,
      icon: TrendingUp,
      color: "text-blue-600",
    },
    {
      label: "Pipeline 金额",
      value: `$${(totalPipeline / 1000).toFixed(1)}k`,
      icon: DollarSign,
      color: "text-emerald-600",
    },
    {
      label: "已成交",
      value: wonOpps.length,
      sub: wonTotal > 0 ? `$${(wonTotal / 1000).toFixed(1)}k` : undefined,
      icon: TrendingUp,
      color: "text-purple-600",
    },
    {
      label: "客户总数",
      value: viewMode === "customers" ? customers.length : "–",
      icon: Users,
      color: "text-amber-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl border border-border bg-white/70 px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <s.icon className={cn("h-4 w-4", s.color)} />
            <span className="text-xs text-muted">{s.label}</span>
          </div>
          <div className="mt-1 text-xl font-semibold text-foreground">
            {s.value}
          </div>
          {s.sub && <div className="text-xs text-muted">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/* ── Pipeline Board with drag-and-drop ── */
function PipelineBoard({
  opportunities,
  onRefresh,
}: {
  opportunities: Opportunity[];
  onRefresh: () => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [showNewOpp, setShowNewOpp] = useState(false);

  const grouped = STAGES.map((stage) => ({
    ...stage,
    items: opportunities.filter((o) => o.stage === stage.key),
  }));

  const handleDragStart = (e: React.DragEvent, oppId: string) => {
    setDraggingId(oppId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", oppId);
  };

  const handleDragOver = (e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(stageKey);
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = async (e: React.DragEvent, newStage: string) => {
    e.preventDefault();
    setDropTarget(null);
    const oppId = e.dataTransfer.getData("text/plain");
    setDraggingId(null);
    if (!oppId) return;

    const opp = opportunities.find((o) => o.id === oppId);
    if (!opp || opp.stage === newStage) return;

    try {
      await apiFetch(`/api/sales/opportunities/${oppId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });
      onRefresh();
    } catch (err) {
      console.error("Stage update failed:", err);
    }
  };

  return (
    <>
      {opportunities.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-white/40 py-16">
          <TrendingUp className="h-10 w-10 text-muted/50" />
          <p className="mt-3 text-sm text-muted">暂无销售机会</p>
          <p className="mt-1 text-xs text-muted/70">
            通过 CSV 导入客户数据，或手动创建新客户
          </p>
          <button
            onClick={() => setShowNewOpp(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-white hover:bg-foreground/90"
          >
            <Plus className="h-4 w-4" />
            新建机会
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              onClick={() => setShowNewOpp(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white/80 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              新建机会
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {grouped.map((col) => (
              <div
                key={col.key}
                className="flex w-64 shrink-0 flex-col"
                onDragOver={(e) => handleDragOver(e, col.key)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.key)}
              >
                <div
                  className={cn(
                    "mb-2 flex items-center justify-between rounded-lg border px-3 py-1.5",
                    col.color
                  )}
                >
                  <span className="text-xs font-semibold">{col.label}</span>
                  <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-bold">
                    {col.items.length}
                  </span>
                </div>
                <div
                  className={cn(
                    "flex min-h-[80px] flex-col gap-2 rounded-lg border-2 border-transparent p-1 transition-colors",
                    dropTarget === col.key && "border-dashed border-accent/40 bg-accent/5"
                  )}
                >
                  {col.items.map((opp) => (
                    <OpportunityCard
                      key={opp.id}
                      opp={opp}
                      isDragging={draggingId === opp.id}
                      onDragStart={(e) => handleDragStart(e, opp.id)}
                      onDragEnd={() => setDraggingId(null)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showNewOpp && (
        <NewOpportunityDialog
          onClose={() => setShowNewOpp(false)}
          onSuccess={() => {
            setShowNewOpp(false);
            onRefresh();
          }}
        />
      )}
    </>
  );
}

function OpportunityCard({
  opp,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  opp: Opportunity;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const pri = PRIORITIES[opp.priority as keyof typeof PRIORITIES] || PRIORITIES.warm;

  return (
    <Link
      href={`/sales/customers/${opp.customer?.id}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group cursor-grab rounded-lg border border-border bg-white/80 p-3 transition-all hover:shadow-md hover:border-foreground/20 active:cursor-grabbing",
        isDragging && "opacity-40 ring-2 ring-accent/30"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-foreground line-clamp-2">
          {opp.title}
        </h4>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold",
            pri.class
          )}
        >
          {pri.label}
        </span>
      </div>
      {opp.customer && (
        <p className="mt-1 text-xs text-muted">{opp.customer.name}</p>
      )}
      <div className="mt-2 flex items-center gap-3 text-xs text-muted">
        {opp.estimatedValue != null && (
          <span className="flex items-center gap-0.5">
            <DollarSign className="h-3 w-3" />
            {opp.estimatedValue.toLocaleString()}
          </span>
        )}
        {opp.productTypes && (
          <span className="truncate">{opp.productTypes}</span>
        )}
      </div>
      {opp.nextFollowupAt && (
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-600">
          <Clock className="h-3 w-3" />
          跟进: {new Date(opp.nextFollowupAt).toLocaleDateString("zh-CN")}
        </div>
      )}
    </Link>
  );
}

/* ── New Opportunity Dialog ── */
function NewOpportunityDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    customerId: "",
    title: "",
    stage: "new_inquiry",
    estimatedValue: "",
    productTypes: "",
    priority: "warm",
  });
  const [customerOptions, setCustomerOptions] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/sales/customers")
      .then((r) => r.json())
      .then((d) => {
        setCustomerOptions(
          (d.customers || []).map((c: { id: string; name: string }) => ({
            id: c.id,
            name: c.name,
          }))
        );
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    if (!form.customerId || !form.title.trim()) {
      setError("请选择客户并填写标题");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/sales/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          estimatedValue: form.estimatedValue || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建失败");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-foreground/20";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">新建销售机会</h3>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">客户 *</label>
            <select
              className={inputClass}
              value={form.customerId}
              onChange={(e) => setForm({ ...form, customerId: e.target.value })}
            >
              <option value="">选择客户…</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">标题 *</label>
            <input
              className={inputClass}
              placeholder="例：客厅窗帘报价"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">阶段</label>
              <select
                className={inputClass}
                value={form.stage}
                onChange={(e) => setForm({ ...form, stage: e.target.value })}
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">优先级</label>
              <select
                className={inputClass}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                <option value="hot">热</option>
                <option value="warm">温</option>
                <option value="cold">冷</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">预估金额 ($)</label>
              <input
                type="number"
                className={inputClass}
                placeholder="0"
                value={form.estimatedValue}
                onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">产品类型</label>
              <input
                className={inputClass}
                placeholder="Zebra, Roller…"
                value={form.productTypes}
                onChange={(e) => setForm({ ...form, productTypes: e.target.value })}
              />
            </div>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-white hover:bg-foreground/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Customer List ── */
function CustomerList({ customers }: { customers: Customer[] }) {
  if (customers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-white/40 py-16">
        <Users className="h-10 w-10 text-muted/50" />
        <p className="mt-3 text-sm text-muted">暂无客户</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white/70">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-white/50 text-left text-xs text-muted">
            <th className="px-4 py-2.5 font-medium">客户</th>
            <th className="px-4 py-2.5 font-medium">联系方式</th>
            <th className="px-4 py-2.5 font-medium">机会</th>
            <th className="px-4 py-2.5 font-medium">报价</th>
            <th className="px-4 py-2.5 font-medium">来源</th>
            <th className="px-4 py-2.5 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr
              key={c.id}
              className="border-b border-border/50 hover:bg-white/60 transition-colors"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/sales/customers/${c.id}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {c.name}
                </Link>
                {c.address && (
                  <p className="mt-0.5 text-xs text-muted truncate max-w-[200px]">
                    {c.address}
                  </p>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-col gap-0.5 text-xs text-muted">
                  {c.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {c.phone}
                    </span>
                  )}
                  {c.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {c.email}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {c.opportunities.map((opp) => {
                    const stage = STAGES.find((s) => s.key === opp.stage);
                    return (
                      <span
                        key={opp.id}
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                          stage?.color || "bg-gray-100 text-gray-600 border-gray-200"
                        )}
                      >
                        {stage?.label || opp.stage}
                      </span>
                    );
                  })}
                  {c.opportunities.length === 0 && (
                    <span className="text-xs text-muted/50">–</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-muted">
                {c._count.quotes > 0 ? `${c._count.quotes} 份` : "–"}
              </td>
              <td className="px-4 py-3 text-xs text-muted">
                {c.source || "–"}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/sales/customers/${c.id}`}
                  className="inline-flex items-center gap-0.5 text-xs text-muted hover:text-foreground"
                >
                  <Eye className="h-3.5 w-3.5" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── CSV Import Dialog ── */
function CsvImportDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch("/api/sales/import-csv", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "导入失败");
      }
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">CSV 客户导入</h3>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!result ? (
          <>
            <p className="mt-3 text-sm text-muted leading-relaxed">
              从简道云导出 CSV 文件后上传。支持的列名：
              <br />
              客户名称 / 电话 / 邮箱 / 地址 / 来源 / 备注 / 机会标题 / 阶段 / 预估金额 / 产品类型 / 优先级
            </p>

            <div
              className="mt-4 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-border bg-white/50 py-8 transition-colors hover:border-foreground/30"
              onClick={() => inputRef.current?.click()}
            >
              <FileSpreadsheet className="h-8 w-8 text-muted/50" />
              <p className="mt-2 text-sm text-muted">
                {file ? file.name : "点击选择 .csv 文件"}
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>

            {error && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={!file || importing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-white hover:bg-foreground/90 disabled:opacity-50"
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                开始导入
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 space-y-2">
              <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                导入完成！创建了 {result.customersCreated} 位客户，
                {result.opportunitiesCreated} 个销售机会。
                {result.skipped > 0 && ` 跳过 ${result.skipped} 行。`}
              </div>
              {result.errors.length > 0 && (
                <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {result.errors.length} 行出错：
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {result.errors.slice(0, 5).map((e, i) => (
                      <li key={i}>
                        第 {e.row} 行: {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                onClick={onSuccess}
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-white hover:bg-foreground/90"
              >
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── New Customer Dialog ── */
function NewCustomerDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    source: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!form.name.trim()) {
      setError("客户名称不能为空");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/sales/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建失败");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-foreground/20";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">新建客户</h3>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              客户名称 *
            </label>
            <input
              className={inputClass}
              placeholder="例：John Smith"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                电话
              </label>
              <input
                className={inputClass}
                placeholder="416-xxx-xxxx"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                邮箱
              </label>
              <input
                className={inputClass}
                placeholder="email@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              地址
            </label>
            <input
              className={inputClass}
              placeholder="123 Main St, Toronto"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              来源
            </label>
            <select
              className={inputClass}
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            >
              <option value="">请选择…</option>
              <option value="referral">转介绍</option>
              <option value="google_ads">Google Ads</option>
              <option value="walk_in">上门</option>
              <option value="wechat">微信</option>
              <option value="phone">电话</option>
              <option value="other">其他</option>
            </select>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-white hover:bg-foreground/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
