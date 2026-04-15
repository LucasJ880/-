"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const SOURCE_LABELS: Record<string, string> = {
  exhibition: "展会",
  referral: "转介绍",
  online: "线上搜索",
  xiaohongshu: "小红书",
  "1688": "1688",
  cold_call: "陌生拜访",
  other: "其他",
};

export function SupplierFilters({
  activeOrgs,
  selectedOrgId,
  onOrgChange,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sourceFilter,
  onSourceFilterChange,
  total,
}: {
  activeOrgs: { id: string; name: string }[];
  selectedOrgId: string;
  onOrgChange: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: "all" | "active" | "inactive";
  onStatusFilterChange: (v: "all" | "active" | "inactive") => void;
  sourceFilter: string;
  onSourceFilterChange: (v: string) => void;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {activeOrgs.length > 1 && (
        <select
          value={selectedOrgId}
          onChange={(e) => onOrgChange(e.target.value)}
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
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索供应商..."
          className="w-full rounded-lg border border-border bg-background py-1.5 pl-9 pr-3 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="flex items-center gap-1 text-sm">
        {(["all", "active", "inactive"] as const).map((v) => (
          <button
            key={v}
            onClick={() => onStatusFilterChange(v)}
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
        onChange={(e) => onSourceFilterChange(e.target.value)}
        className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
      >
        <option value="all">全部来源</option>
        {Object.entries(SOURCE_LABELS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>

      <span className="ml-auto text-xs text-muted">共 {total} 家</span>
    </div>
  );
}
