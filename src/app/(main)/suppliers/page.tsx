"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Plus,
  Loader2,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  FileText,
  Star,
  Package,
  Power,
  PowerOff,
  Building2,
  Upload,
  Brain,
  Sparkles,
  Tags,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/page-header";
import { useOrganizations } from "@/lib/hooks/use-organizations";
import { SupplierFormDialog } from "@/components/supplier/supplier-form-dialog";
import { SupplierHistory } from "@/components/supplier/supplier-history";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface SupplierStats {
  projectCount: number;
  inquiryCount: number;
  quotedCount: number;
  selectedCount: number;
}

interface Supplier {
  id: string;
  orgId: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  category: string | null;
  region: string | null;
  notes: string | null;
  status: string;
  source: string | null;
  sourceDetail: string | null;
  website: string | null;
  tags: string | null;
  capabilities: string | null;
  rating: number | null;
  createdAt: string;
  stats: SupplierStats;
}

const SOURCE_LABELS: Record<string, string> = {
  exhibition: "展会",
  referral: "转介绍",
  online: "线上搜索",
  xiaohongshu: "小红书",
  "1688": "1688",
  cold_call: "陌生拜访",
  other: "其他",
};

const SOURCE_COLORS: Record<string, string> = {
  exhibition: "bg-purple-100 text-purple-700",
  referral: "bg-green-100 text-green-700",
  online: "bg-blue-100 text-blue-700",
  xiaohongshu: "bg-red-100 text-red-700",
  "1688": "bg-orange-100 text-orange-700",
  cold_call: "bg-amber-100 text-amber-700",
  other: "bg-gray-100 text-gray-600",
};

interface ListResponse {
  data: Supplier[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function SupplierMenu({
  supplier,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  supplier: Supplier;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isActive = supplier.status === "active";

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="rounded p-1.5 text-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-background hover:text-foreground"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-lg border border-border bg-card-bg py-1 shadow-lg">
            <button
              onClick={() => { setOpen(false); onEdit(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-background"
            >
              <Pencil size={14} />
              编辑
            </button>
            <button
              onClick={() => { setOpen(false); onToggleStatus(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-background"
            >
              {isActive ? <PowerOff size={14} /> : <Power size={14} />}
              {isActive ? "停用" : "启用"}
            </button>
            {supplier.stats.inquiryCount === 0 && (
              <button
                onClick={() => { setOpen(false); onDelete(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[#a63d3d] transition-colors hover:bg-[rgba(166,61,61,0.04)]"
              >
                <Trash2 size={14} />
                删除
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatBadge({ count, label, accent }: { count: number; label: string; accent?: boolean }) {
  if (count === 0) return <span className="text-xs text-muted">{label} 0</span>;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
      accent
        ? "bg-[rgba(181,137,47,0.08)] text-[#b5892f]"
        : "bg-[rgba(79,124,120,0.08)] text-primary"
    )}>
      {count} {label}
    </span>
  );
}

export default function SuppliersPage() {
  const { organizations, loading: orgsLoading } = useOrganizations();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeOrgs = organizations.filter((o) => o.status === "active");

  useEffect(() => {
    if (!orgsLoading && activeOrgs.length > 0 && !selectedOrgId) {
      setSelectedOrgId(activeOrgs[0].id);
    }
  }, [orgsLoading, activeOrgs, selectedOrgId]);

  const loadSuppliers = useCallback(() => {
    if (!selectedOrgId) return;
    setLoading(true);
    setLoadError("");

    const params = new URLSearchParams({ orgId: selectedOrgId, page: String(page), pageSize: "50" });
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (search.trim()) params.set("search", search.trim());

    apiFetch(`/api/suppliers?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error("加载失败");
        return r.json();
      })
      .then((res: ListResponse) => {
        setSuppliers(res.data);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch(() => setLoadError("加载供应商列表失败，请稍后重试"))
      .finally(() => setLoading(false));
  }, [selectedOrgId, page, statusFilter, sourceFilter, search]);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, sourceFilter, selectedOrgId]);

  const handleToggleStatus = async (s: Supplier) => {
    const newStatus = s.status === "active" ? "inactive" : "active";
    await apiFetch(`/api/suppliers/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    loadSuppliers();
  };

  const handleClassify = async (id: string) => {
    try {
      await apiFetch(`/api/suppliers/${id}/classify`, { method: "POST" });
      loadSuppliers();
    } catch {
      alert("AI 分类失败");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确认删除该供应商？")) return;
    try {
      const res = await apiFetch(`/api/suppliers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "删除失败");
        return;
      }
      loadSuppliers();
    } catch {
      alert("删除失败");
    }
  };

  const noOrg = !orgsLoading && activeOrgs.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="供应商管理"
        description="管理组织内的供应商库，查看合作历史和报价记录。"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowBatchImport(true)}
              disabled={noOrg}
              className="flex items-center gap-2 rounded-lg border border-border bg-white/80 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white disabled:opacity-50"
            >
              <Upload size={16} />
              批量导入
            </button>
            <button
              type="button"
              onClick={() => { setEditing(null); setShowForm(true); }}
              disabled={noOrg}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              <Plus size={16} />
              新建供应商
            </button>
          </div>
        }
      />

      {noOrg ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(110,125,118,0.08)]">
            <Package size={28} className="text-[#8a9590]" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">暂无组织</p>
            <p className="mt-1 max-w-sm text-sm text-muted">供应商归属于组织，请先创建或加入一个组织。</p>
          </div>
          <Link
            href="/organizations"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Building2 size={16} />
            前往创建组织
          </Link>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            {activeOrgs.length > 1 && (
              <select
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
              >
                {activeOrgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}

            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索供应商..."
                className="w-full rounded-lg border border-border bg-background py-1.5 pl-9 pr-3 text-sm outline-none focus:border-accent"
              />
            </div>

            <div className="flex items-center gap-1 text-sm">
              {(["all", "active", "inactive"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setStatusFilter(v)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 font-medium transition-colors",
                    statusFilter === v
                      ? "bg-primary/10 text-primary"
                      : "text-muted hover:bg-card-hover"
                  )}
                >
                  {{ all: "全部", active: "活跃", inactive: "停用" }[v]}
                </button>
              ))}
            </div>

            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
            >
              <option value="all">全部来源</option>
              {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>

            <span className="ml-auto text-xs text-muted">共 {total} 家</span>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" />
              加载中...
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
              <span>{loadError}</span>
              <button onClick={loadSuppliers} className="text-sm font-medium text-accent hover:underline">
                重试
              </button>
            </div>
          ) : suppliers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(110,125,118,0.08)]">
                <Package size={28} className="text-[#8a9590]" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">
                  {search ? "未找到匹配的供应商" : "还没有供应商"}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {search ? "请尝试其他搜索条件" : "点击「新建供应商」添加第一家"}
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-background/50 text-left text-xs text-muted">
                    <th className="w-8 px-3 py-2.5" />
                    <th className="px-3 py-2.5 font-medium">供应商</th>
                    <th className="px-3 py-2.5 font-medium">来源</th>
                    <th className="px-3 py-2.5 font-medium">品类 / 标签</th>
                    <th className="px-3 py-2.5 font-medium">地区</th>
                    <th className="px-3 py-2.5 font-medium text-center">合作</th>
                    <th className="px-3 py-2.5 font-medium">状态</th>
                    <th className="w-10 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => {
                    const isExpanded = expandedId === s.id;
                    return (
                      <SupplierRow
                        key={s.id}
                        supplier={s}
                        isExpanded={isExpanded}
                        onToggleExpand={() => setExpandedId(isExpanded ? null : s.id)}
                        onEdit={() => { setEditing(s); setShowForm(true); }}
                        onToggleStatus={() => handleToggleStatus(s)}
                        onDelete={() => handleDelete(s.id)}
                        onClassify={() => handleClassify(s.id)}
                      />
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border px-4 py-3">
                  <span className="text-xs text-muted">
                    第 {page}/{totalPages} 页
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="rounded-lg border border-border px-3 py-1 text-xs transition-colors hover:bg-background disabled:opacity-40"
                    >
                      上一页
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="rounded-lg border border-border px-3 py-1 text-xs transition-colors hover:bg-background disabled:opacity-40"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <SupplierFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onSaved={loadSuppliers}
        editing={editing}
        orgId={selectedOrgId}
      />

      <BatchImportDialog
        open={showBatchImport}
        onOpenChange={setShowBatchImport}
        orgId={selectedOrgId}
        onSuccess={() => {
          setShowBatchImport(false);
          loadSuppliers();
        }}
      />
    </div>
  );
}

function SupplierRow({
  supplier: s,
  isExpanded,
  onToggleExpand,
  onEdit,
  onToggleStatus,
  onDelete,
  onClassify,
}: {
  supplier: Supplier;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
  onClassify: () => void;
}) {
  const hasHistory = s.stats.inquiryCount > 0;
  const tagList = s.tags ? s.tags.split(",").filter(Boolean).slice(0, 4) : [];

  return (
    <>
      <tr className="group border-b border-border/50 transition-colors hover:bg-background/30">
        <td className="px-3 py-3">
          {hasHistory ? (
            <button onClick={onToggleExpand} className="rounded p-0.5 text-muted hover:text-foreground">
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="inline-block w-[14px]" />
          )}
        </td>
        <td className="px-3 py-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <Link
                href={`/suppliers/${s.id}`}
                className="font-medium text-foreground hover:text-accent hover:underline"
              >
                {s.name}
              </Link>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                {s.contactName && <span>{s.contactName}</span>}
                {s.contactEmail && <span>{s.contactEmail}</span>}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-3">
          {s.source ? (
            <span className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
              SOURCE_COLORS[s.source] || "bg-gray-100 text-gray-600"
            )}>
              {SOURCE_LABELS[s.source] || s.source}
            </span>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
          {s.sourceDetail && (
            <p className="mt-0.5 text-[10px] text-muted truncate max-w-[120px]" title={s.sourceDetail}>
              {s.sourceDetail}
            </p>
          )}
        </td>
        <td className="px-3 py-3">
          <div className="space-y-1">
            {s.category && (
              <span className="rounded-full bg-[rgba(79,124,120,0.06)] px-2 py-0.5 text-xs font-medium text-primary">
                {s.category}
              </span>
            )}
            {tagList.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tagList.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted"
                  >
                    {tag.trim()}
                  </span>
                ))}
                {s.tags && s.tags.split(",").length > 4 && (
                  <span className="text-[10px] text-muted">
                    +{s.tags.split(",").length - 4}
                  </span>
                )}
              </div>
            )}
            {!s.category && tagList.length === 0 && (
              <button
                onClick={onClassify}
                className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
              >
                <Sparkles size={10} />
                AI 分类
              </button>
            )}
          </div>
        </td>
        <td className="px-3 py-3 text-muted text-xs">
          {s.region || "—"}
        </td>
        <td className="px-3 py-3 text-center">
          <div className="flex flex-col items-center gap-0.5">
            {s.stats.projectCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                <FolderKanban size={11} />
                {s.stats.projectCount} 项目
              </span>
            )}
            {s.stats.quotedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2e7a56]">
                <FileText size={11} />
                {s.stats.quotedCount} 报价
              </span>
            )}
            {s.stats.selectedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#b5892f]">
                <Star size={11} fill="#b5892f" />
                {s.stats.selectedCount} 中选
              </span>
            )}
            {s.stats.projectCount === 0 && s.stats.quotedCount === 0 && (
              <span className="text-[11px] text-muted">暂无</span>
            )}
          </div>
        </td>
        <td className="px-3 py-3">
          <span className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            s.status === "active"
              ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
              : "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
          )}>
            {s.status === "active" ? "活跃" : "停用"}
          </span>
        </td>
        <td className="px-3 py-3">
          <SupplierMenu
            supplier={s}
            onEdit={onEdit}
            onToggleStatus={onToggleStatus}
            onDelete={onDelete}
          />
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={8} className="bg-background/30 px-0 py-0">
            <div className="border-b border-border/50 py-2">
              {s.capabilities && (
                <div className="mx-4 mb-2 rounded-lg bg-accent/[0.03] px-3 py-2">
                  <div className="flex items-center gap-1 text-[10px] font-semibold text-accent mb-1">
                    <Brain size={10} />
                    AI 能力画像
                  </div>
                  <p className="text-xs text-foreground/80 leading-relaxed">{s.capabilities}</p>
                </div>
              )}
              <div className="mb-1 flex items-center gap-2 px-4 py-1.5 text-xs font-semibold text-muted">
                <FolderKanban size={12} />
                项目参与记录
              </div>
              <SupplierHistory supplierId={s.id} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Batch Import Dialog ── */
function BatchImportDialog({
  open,
  onOpenChange,
  orgId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<"text" | "structured">("text");
  const [rawText, setRawText] = useState("");
  const [source, setSource] = useState("exhibition");
  const [sourceDetail, setSourceDetail] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    created: number;
    failed: number;
    results: { name: string; status: string; error?: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    if (!rawText.trim()) {
      setError("请粘贴供应商信息");
      return;
    }
    setImporting(true);
    setError(null);

    try {
      const res = await apiFetch("/api/suppliers/batch-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          mode: "text",
          rawText,
          source,
          sourceDetail: sourceDetail || undefined,
          autoClassify: true,
        }),
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

  function handleReset() {
    setRawText("");
    setResult(null);
    setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>批量导入供应商</DialogTitle>
          <DialogDescription>
            粘贴展会名片、聊天记录或备忘信息，AI 自动识别并分类
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>来源渠道</Label>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                >
                  {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>来源详情</Label>
                <input
                  type="text"
                  value={sourceDetail}
                  onChange={(e) => setSourceDetail(e.target.value)}
                  placeholder="如：2026广交会-3号馆"
                  className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>供应商信息</Label>
              <textarea
                className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 h-48 resize-none font-mono text-xs leading-relaxed"
                placeholder={`粘贴供应商信息，支持多种格式：

名片格式：
绍兴华美纺织有限公司
联系人：张经理
电话：138-1234-5678
邮箱：zhang@huamei.com
主营：阻燃面料、窗帘布

或自由文本：
今天在广交会3号馆收了几张名片：
1. 绍兴华美纺织，张经理 138xxxx，做阻燃面料
2. 广州锦盛窗饰，李总 139xxxx，百叶窗配件`}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
              <p className="text-[11px] text-muted flex items-center gap-1">
                <Sparkles size={10} className="text-accent" />
                AI 会自动识别公司名称、联系人、电话、邮箱、品类等信息，并自动分类打标
              </p>
            </div>

            {error && (
              <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={handleImport} disabled={!rawText.trim() || importing}>
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Brain className="h-4 w-4" />
                )}
                AI 解析导入
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className={cn(
              "rounded-lg px-4 py-3 text-sm",
              result.failed === 0
                ? "bg-success-bg text-success"
                : "bg-warning-bg text-warning"
            )}>
              导入完成！成功 {result.created} 家
              {result.failed > 0 && `，失败 ${result.failed} 家`}
              <p className="mt-1 text-xs opacity-70">
                AI 正在后台自动分类打标，稍后刷新可见
              </p>
            </div>

            {result.results.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <tbody>
                    {result.results.map((r, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="px-3 py-1.5 font-medium">{r.name}</td>
                        <td className="px-3 py-1.5">
                          {r.status === "created" ? (
                            <Badge className="bg-green-100 text-green-700">已创建</Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-700">失败</Badge>
                          )}
                        </td>
                        {r.error && (
                          <td className="px-3 py-1.5 text-muted">{r.error}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={handleReset}>
                继续导入
              </Button>
              <Button onClick={onSuccess}>完成</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
