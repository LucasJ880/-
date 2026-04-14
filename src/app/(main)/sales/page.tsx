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
  Bell,
  Sparkles,
  ChevronDown as ChevronDownIcon,
  AlertTriangle,
  Send,
  Heart,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { Badge } from "@/components/ui/badge";

/* ── Pipeline stages ── */
const STAGES = [
  { key: "new_lead", label: "新线索", color: "bg-blue-100 text-blue-800 border-blue-200" },
  { key: "needs_confirmed", label: "需求确认", color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
  { key: "measure_booked", label: "预约量房", color: "bg-teal-100 text-teal-800 border-teal-200" },
  { key: "quoted", label: "已报价", color: "bg-orange-100 text-orange-800 border-orange-200" },
  { key: "negotiation", label: "洽谈中", color: "bg-purple-100 text-purple-800 border-purple-200" },
  { key: "signed", label: "已签单", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { key: "producing", label: "生产中", color: "bg-amber-100 text-amber-800 border-amber-200" },
  { key: "installing", label: "安装中", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  { key: "completed", label: "已完成", color: "bg-green-100 text-green-800 border-green-200" },
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
  createdAt: string;
  latestQuoteTotal: number | null;
  latestQuoteStatus: string | null;
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

      {/* AI 提醒面板 */}
      <AiAlertPanel />

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
      <CsvImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        onSuccess={() => {
          setShowImport(false);
          loadData();
        }}
      />

      {/* New Customer dialog */}
      <NewCustomerDialog
        open={showNewCustomer}
        onOpenChange={setShowNewCustomer}
        onSuccess={() => {
          setShowNewCustomer(false);
          loadData();
        }}
      />
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
    (o) => !["signed", "completed", "lost", "on_hold"].includes(o.stage)
  );
  const totalPipeline = activeOpps.reduce(
    (sum, o) => sum + (o.estimatedValue || 0),
    0
  );
  const signedOpps = opportunities.filter((o) => ["signed", "producing", "installing", "completed"].includes(o.stage));
  const signedTotal = signedOpps.reduce((sum, o) => sum + (o.estimatedValue || 0), 0);

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
      label: "已签单",
      value: signedOpps.length,
      sub: signedTotal > 0 ? `$${(signedTotal / 1000).toFixed(1)}k` : undefined,
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
type HealthInfo = { score: number; sentiment: string | null; tip: string | null; hasKnowledge: boolean };

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
  const [healthMap, setHealthMap] = useState<Record<string, HealthInfo>>({});

  useEffect(() => {
    if (opportunities.length === 0) return;
    apiFetch("/api/sales/opportunities/health-batch")
      .then((r) => r.json())
      .then((d) => { if (d.healthMap) setHealthMap(d.healthMap); })
      .catch(() => {});
  }, [opportunities]);

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
                      health={healthMap[opp.id]}
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

      <NewOpportunityDialog
        open={showNewOpp}
        onOpenChange={setShowNewOpp}
        onSuccess={() => {
          setShowNewOpp(false);
          onRefresh();
        }}
      />
    </>
  );
}

function healthColor(score: number): string {
  if (score >= 70) return "text-emerald-500";
  if (score >= 40) return "text-amber-500";
  return "text-red-500";
}
function healthBg(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function OpportunityCard({
  opp,
  health,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  opp: Opportunity;
  health?: HealthInfo;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const pri = PRIORITIES[opp.priority as keyof typeof PRIORITIES] || PRIORITIES.warm;
  const [showTip, setShowTip] = useState(false);

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
        <div className="flex items-center gap-1 shrink-0">
          {health && health.score > 0 && (
            <span className={cn("text-[10px] font-bold", healthColor(health.score))}>
              {health.score}
            </span>
          )}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-bold",
              pri.class
            )}
          >
            {pri.label}
          </span>
        </div>
      </div>
      {opp.customer && (
        <p className="mt-1 text-xs text-muted">{opp.customer.name}</p>
      )}

      {health && health.score > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="h-1.5 flex-1 rounded-full bg-muted/20 overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", healthBg(health.score))}
              style={{ width: `${health.score}%` }}
            />
          </div>
          {health.tip && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowTip(!showTip); }}
              className="shrink-0 rounded-full p-0.5 hover:bg-accent/10 transition-colors"
              title="AI 建议"
            >
              <Zap className="h-3 w-3 text-accent" />
            </button>
          )}
        </div>
      )}

      {showTip && health?.tip && (
        <div className="mt-1.5 rounded-md bg-accent/5 border border-accent/20 px-2 py-1.5">
          <p className="text-[10px] text-accent leading-relaxed line-clamp-3">
            <Sparkles className="inline h-2.5 w-2.5 mr-0.5" />
            {health.tip}
          </p>
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs text-muted">
        {(opp.latestQuoteTotal ?? opp.estimatedValue) != null && (
          <span className="flex items-center gap-0.5">
            <DollarSign className="h-3 w-3" />
            {(opp.latestQuoteTotal ?? opp.estimatedValue ?? 0).toLocaleString()}
          </span>
        )}
        {opp.productTypes && (
          <span className="truncate">{opp.productTypes}</span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        {opp.latestQuoteTotal != null && (
          <span className="inline-flex items-center rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
            报价 ${opp.latestQuoteTotal.toLocaleString()}
          </span>
        )}
        {opp.nextFollowupAt && (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-600">
            <Clock className="h-3 w-3" />
            {new Date(opp.nextFollowupAt).toLocaleDateString("zh-CN")}
          </span>
        )}
        {opp.updatedAt && (
          <span className="text-[10px] text-muted/60">
            {Math.floor((Date.now() - new Date(opp.updatedAt).getTime()) / 86400000)}天
          </span>
        )}
      </div>
    </Link>
  );
}

/* ── New Opportunity Dialog (shadcn/ui) ── */
function NewOpportunityDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    customerId: "",
    title: "",
    stage: "new_lead",
    estimatedValue: "",
    productTypes: "",
    priority: "warm",
  });
  const [customerOptions, setCustomerOptions] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建销售机会</DialogTitle>
          <DialogDescription>为客户创建新的销售跟进机会</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>客户 *</Label>
            <ShadSelect
              value={form.customerId}
              onValueChange={(v) => setForm({ ...form, customerId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择客户…" />
              </SelectTrigger>
              <SelectContent>
                {customerOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </ShadSelect>
          </div>
          <div className="space-y-1.5">
            <Label>标题 *</Label>
            <Input
              placeholder="例：客厅窗帘报价"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>阶段</Label>
              <ShadSelect
                value={form.stage}
                onValueChange={(v) => setForm({ ...form, stage: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </div>
            <div className="space-y-1.5">
              <Label>优先级</Label>
              <ShadSelect
                value={form.priority}
                onValueChange={(v) => setForm({ ...form, priority: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hot">热</SelectItem>
                  <SelectItem value="warm">温</SelectItem>
                  <SelectItem value="cold">冷</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>预估金额 ($)</Label>
              <Input
                type="number"
                placeholder="0"
                value={form.estimatedValue}
                onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>产品类型</Label>
              <Input
                placeholder="Zebra, Roller…"
                value={form.productTypes}
                onChange={(e) => setForm({ ...form, productTypes: e.target.value })}
              />
            </div>
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
                      <Badge
                        key={opp.id}
                        variant="outline"
                        className={cn(
                          stage?.color || "bg-gray-100 text-gray-600 border-gray-200"
                        )}
                      >
                        {stage?.label || opp.stage}
                      </Badge>
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

/* ── CSV Import Dialog (shadcn/ui) ── */
function CsvImportDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>CSV 客户导入</DialogTitle>
          <DialogDescription>
            从简道云导出 CSV 文件后上传。支持的列名：客户名称 / 电话 / 邮箱 / 地址 / 来源 / 备注 / 机会标题 / 阶段 / 预估金额 / 产品类型 / 优先级
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <>
            <div
              className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-border bg-white/50 py-8 transition-colors hover:border-foreground/30"
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
              <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button onClick={handleImport} disabled={!file || importing}>
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                开始导入
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <div className="rounded-lg bg-success-bg px-4 py-3 text-sm text-success">
                导入完成！创建了 {result.customersCreated} 位客户，
                {result.opportunitiesCreated} 个销售机会。
                {result.skipped > 0 && ` 跳过 ${result.skipped} 行。`}
              </div>
              {result.errors.length > 0 && (
                <div className="rounded-lg bg-warning-bg px-4 py-3 text-sm text-warning">
                  {result.errors.length} 行出错：
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {result.errors.slice(0, 5).map((e, i) => (
                      <li key={i}>第 {e.row} 行: {e.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={onSuccess}>完成</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── New Customer Dialog (shadcn/ui) ── */
function NewCustomerDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建客户</DialogTitle>
          <DialogDescription>添加新客户到 Sunny Shutter 销售系统</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">客户名称 *</Label>
            <Input
              id="name"
              placeholder="例：John Smith"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="phone">电话</Label>
              <Input
                id="phone"
                placeholder="416-xxx-xxxx"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                placeholder="email@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">地址</Label>
            <Input
              id="address"
              placeholder="123 Main St, Toronto"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>来源</Label>
            <ShadSelect
              value={form.source}
              onValueChange={(v) => setForm({ ...form, source: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="请选择…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="referral">转介绍</SelectItem>
                <SelectItem value="google_ads">Google Ads</SelectItem>
                <SelectItem value="walk_in">上门</SelectItem>
                <SelectItem value="wechat">微信</SelectItem>
                <SelectItem value="phone">电话</SelectItem>
                <SelectItem value="other">其他</SelectItem>
              </SelectContent>
            </ShadSelect>
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── AI 提醒面板 ── */

interface AlertItem {
  title: string;
  description: string;
  severity: string;
  category: string;
  action?: { payload?: { customerId?: string; opportunityId?: string } };
}

interface BriefingData {
  date: string;
  stats: Record<string, number>;
  urgentItems: AlertItem[];
  aiSummary: string;
  generatedAt: string;
}

const EMAIL_SCENES: Record<string, string> = {
  quote_pending: "quote_followup",
  viewed_not_signed: "quote_viewed",
  stale_opportunity: "general_followup",
  new_lead_stale: "general_followup",
};

interface InlineEmail {
  to: string; subject: string; html: string; scene: string;
  customerId: string; quoteId?: string;
}

function AiAlertPanel() {
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pushing, setPushing] = useState(false);

  // 内嵌邮件预览（key = customerId）
  const [emails, setEmails] = useState<Record<string, InlineEmail>>({});
  const [emailLoadingSet, setEmailLoadingSet] = useState<Set<string>>(new Set());
  const [emailSendingId, setEmailSendingId] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<Set<string>>(new Set());

  // AI 优化弹窗
  const [refineTarget, setRefineTarget] = useState<InlineEmail | null>(null);
  const [refineInput, setRefineInput] = useState("");
  const [refining, setRefining] = useState(false);

  const loadBriefing = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/sales/daily-briefing");
      const data = await res.json();
      setBriefing(data.briefing);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadBriefing(); }, [loadBriefing]);

  // 展开时自动加载所有可发邮件项
  const prevExpandedRef = useRef(false);
  useEffect(() => {
    if (expanded && !prevExpandedRef.current && briefing) {
      const emailItems = briefing.urgentItems.filter(
        (i) => i.action?.payload?.customerId && EMAIL_SCENES[i.category],
      );
      for (const item of emailItems) {
        const cid = item.action!.payload!.customerId!;
        if (emails[cid] || emailSent.has(cid)) continue;
        const scene = EMAIL_SCENES[item.category];
        setEmailLoadingSet((s) => new Set(s).add(cid));
        apiFetch("/api/sales/email-compose", {
          method: "POST",
          body: JSON.stringify({ customerId: cid, scene }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d.email) setEmails((prev) => ({ ...prev, [cid]: { ...d.email, customerId: cid } }));
          })
          .catch(() => {})
          .finally(() => setEmailLoadingSet((s) => { const n = new Set(s); n.delete(cid); return n; }));
      }
    }
    prevExpandedRef.current = expanded;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, briefing]);

  const pushToWechat = async () => {
    setPushing(true);
    try { await apiFetch("/api/sales/daily-briefing", { method: "POST" }); }
    catch {}
    finally { setPushing(false); }
  };

  const handleSendInline = async (customerId: string) => {
    const email = emails[customerId];
    if (!email) return;
    setEmailSendingId(customerId);
    try {
      const res = await apiFetch("/api/sales/email-compose?action=send", {
        method: "POST",
        body: JSON.stringify({ customerId, scene: email.scene, quoteId: email.quoteId }),
      });
      const data = await res.json();
      if (data.sent) {
        setEmailSent((prev) => new Set(prev).add(customerId));
      } else {
        alert(data.error || "发送失败");
      }
    } catch { alert("发送请求失败"); }
    finally { setEmailSendingId(null); }
  };

  const handleRefine = async () => {
    if (!refineTarget || !refineInput.trim()) return;
    setRefining(true);
    try {
      const res = await apiFetch("/api/sales/email-compose?action=refine", {
        method: "POST",
        body: JSON.stringify({
          currentSubject: refineTarget.subject,
          currentHtml: refineTarget.html,
          refinement: refineInput.trim(),
        }),
      });
      const data = await res.json();
      if (data.email) {
        const updated = { ...refineTarget, subject: data.email.subject, html: data.email.html };
        setEmails((prev) => ({ ...prev, [refineTarget.customerId]: updated }));
        setRefineTarget(updated);
        setRefineInput("");
      }
    } catch { alert("优化失败"); }
    finally { setRefining(false); }
  };

  if (!briefing && !loading) return null;

  const urgentCount = briefing?.urgentItems.filter((i) => i.severity === "urgent").length ?? 0;
  const warningCount = briefing?.urgentItems.filter((i) => i.severity === "warning").length ?? 0;

  return (
    <>
      <div className="rounded-xl border border-border bg-gradient-to-r from-amber-50/80 to-orange-50/60 p-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-left">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100">
              <Sparkles className="h-4 w-4 text-amber-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">AI 销售助手</span>
                {loading && <Loader2 className="h-3 w-3 animate-spin text-muted" />}
                {urgentCount > 0 && (
                  <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{urgentCount} 紧急</span>
                )}
                {warningCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{warningCount} 注意</span>
                )}
              </div>
              <p className="text-xs text-muted">{briefing ? `今日简报 · ${briefing.urgentItems.length} 项待处理` : "加载中..."}</p>
            </div>
            <ChevronDownIcon className={cn("h-4 w-4 text-muted transition-transform", expanded && "rotate-180")} />
          </button>
          <div className="flex items-center gap-2">
            <button onClick={pushToWechat} disabled={pushing || !briefing} className="inline-flex items-center gap-1 rounded-lg border border-border bg-white/80 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-white transition-colors disabled:opacity-50">
              <Send className="h-3 w-3" />{pushing ? "推送中..." : "推送微信"}
            </button>
            <button onClick={loadBriefing} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-border bg-white/80 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-white transition-colors disabled:opacity-50">
              <Bell className="h-3 w-3" />刷新
            </button>
          </div>
        </div>

        {expanded && briefing && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg bg-white/80 p-3 text-sm whitespace-pre-line text-foreground/80">
              {briefing.aiSummary}
            </div>

            {briefing.urgentItems.length > 0 && (
              <div className="space-y-3">
                {briefing.urgentItems.slice(0, 8).map((item, idx) => {
                  const customerId = item.action?.payload?.customerId;
                  const canEmail = customerId && EMAIL_SCENES[item.category];
                  const isSent = customerId ? emailSent.has(customerId) : false;
                  const email = customerId ? emails[customerId] : undefined;
                  const isLoadingEmail = customerId ? emailLoadingSet.has(customerId) : false;
                  const isSending = emailSendingId === customerId;

                  return (
                    <div
                      key={idx}
                      className={cn(
                        "rounded-lg border overflow-hidden",
                        item.severity === "urgent" ? "border-red-200 bg-red-50/60" : "border-amber-200 bg-amber-50/60",
                      )}
                    >
                      {/* 提醒标题 */}
                      <div className="p-3 flex items-start gap-2">
                        <AlertTriangle className={cn("h-4 w-4 mt-0.5 shrink-0", item.severity === "urgent" ? "text-red-500" : "text-amber-500")} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground">{item.title}</p>
                          {item.description && <p className="mt-0.5 text-[11px] text-muted line-clamp-2">{item.description}</p>}
                        </div>
                      </div>

                      {/* 内嵌邮件预览 */}
                      {canEmail && !isSent && (
                        <div className="border-t border-border/50 bg-white/80">
                          {isLoadingEmail ? (
                            <div className="p-3 flex items-center gap-2 text-xs text-muted">
                              <Loader2 className="h-3 w-3 animate-spin" /> AI 正在生成跟进邮件...
                            </div>
                          ) : email ? (
                            <div className="p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="text-[11px] text-muted">
                                  To: <span className="text-foreground">{email.to}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => { setRefineTarget(email); setRefineInput(""); }}
                                    className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
                                  >
                                    AI 优化
                                  </button>
                                </div>
                              </div>
                              <p className="text-xs font-medium text-foreground">{email.subject}</p>
                              <div className="rounded border border-border/50 bg-gray-50/50 p-2 text-[11px] text-foreground/70 max-h-24 overflow-y-auto"
                                dangerouslySetInnerHTML={{ __html: email.html }}
                              />
                              <button
                                onClick={() => handleSendInline(customerId!)}
                                disabled={isSending}
                                className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                              >
                                {isSending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                {isSending ? "发送中..." : "一键发送"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      )}
                      {canEmail && isSent && (
                        <div className="border-t border-emerald-200 bg-emerald-50/80 p-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                          <Mail className="h-3.5 w-3.5" /> 跟进邮件已发送
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI 优化邮件弹窗 */}
      <Dialog open={!!refineTarget} onOpenChange={() => setRefineTarget(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              AI 邮件优化
            </DialogTitle>
            <DialogDescription>
              告诉 AI 你想怎么改，和 ChatGPT 一样自然对话
            </DialogDescription>
          </DialogHeader>

          {refineTarget && (
            <div className="space-y-4 mt-2">
              <div className="rounded-lg border border-border p-3 space-y-1">
                <div className="text-xs text-muted">To: {refineTarget.to}</div>
                <p className="text-sm font-medium">{refineTarget.subject}</p>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="bg-gray-50 px-3 py-1.5 text-xs font-medium text-muted border-b">邮件预览</div>
                <div className="p-4 text-sm max-h-48 overflow-y-auto" dangerouslySetInnerHTML={{ __html: refineTarget.html }} />
              </div>

              {/* ChatGPT 风格的优化输入 */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={refineInput}
                  onChange={(e) => setRefineInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleRefine(); } }}
                  placeholder="告诉 AI 怎么改… 如：语气更热情一些 / 加上10%折扣信息 / 更简短"
                  className="flex-1 rounded-lg border border-border px-3 py-2 text-sm placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  disabled={refining}
                />
                <Button onClick={handleRefine} disabled={refining || !refineInput.trim()} size="sm">
                  {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button variant="outline" onClick={() => setRefineTarget(null)}>关闭</Button>
            <Button onClick={() => {
              if (refineTarget) {
                handleSendInline(refineTarget.customerId);
                setRefineTarget(null);
              }
            }} disabled={emailSendingId === refineTarget?.customerId}>
              <Send className="h-4 w-4 mr-1" /> 确认发送
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
