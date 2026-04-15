"use client";

import { useState } from "react";
import Link from "next/link";
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  FileText,
  Star,
  Power,
  PowerOff,
  Brain,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SupplierHistory } from "@/components/supplier/supplier-history";

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

export function SupplierTable({
  suppliers,
  onEdit,
  onToggleStatus,
  onDelete,
  onClassify,
  page,
  totalPages,
  onPageChange,
}: {
  suppliers: Supplier[];
  onEdit: (supplier: Supplier) => void;
  onToggleStatus: (supplier: Supplier) => void;
  onDelete: (id: string) => void;
  onClassify: (id: string) => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
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
                onEdit={() => onEdit(s)}
                onToggleStatus={() => onToggleStatus(s)}
                onDelete={() => onDelete(s.id)}
                onClassify={() => onClassify(s.id)}
              />
            );
          })}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-xs text-muted">
            第 {page}/{totalPages} 页
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-border px-3 py-1 text-xs transition-colors hover:bg-background disabled:opacity-40"
            >
              上一页
            </button>
            <button
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-border px-3 py-1 text-xs transition-colors hover:bg-background disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
