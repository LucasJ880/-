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

/** Phase1 供应商库快捷分桶（基于 region/category/tags/status 启发式） */
export const SUPPLIER_BUCKETS = [
  { key: "all", label: "全部供应商" },
  { key: "china", label: "国内厂家" },
  { key: "canada", label: "加拿大供应商" },
  { key: "manufacturer", label: "制造商" },
  { key: "distributor", label: "经销商" },
  { key: "trader", label: "贸易商" },
  { key: "pending", label: "待审核" },
  { key: "high_risk", label: "高风险" },
] as const;

export type SupplierBucketKey = (typeof SUPPLIER_BUCKETS)[number]["key"];

export function matchSupplierBucket(
  s: {
    region?: string | null;
    category?: string | null;
    tags?: string | null;
    status?: string | null;
    rating?: number | null;
  },
  bucket: SupplierBucketKey,
): boolean {
  if (bucket === "all") return true;
  const region = (s.region || "").toLowerCase();
  const category = (s.category || "").toLowerCase();
  const tags = (s.tags || "").toLowerCase();
  const blob = `${region} ${category} ${tags}`;
  if (bucket === "china") {
    return /中国|china|cn|大陆|国内/.test(blob);
  }
  if (bucket === "canada") {
    return /canada|加拿大|ca\b|ontario|quebec|bc\b/.test(blob);
  }
  if (bucket === "manufacturer") {
    return /制造|厂家|manufacturer|factory|oem|工厂/.test(blob);
  }
  if (bucket === "distributor") {
    return /经销|distributor|dealer|代理/.test(blob);
  }
  if (bucket === "trader") {
    return /贸易|trader|trading|进出口/.test(blob);
  }
  if (bucket === "pending") {
    return s.status === "inactive" || /待审核|pending|review/.test(blob);
  }
  if (bucket === "high_risk") {
    return (
      /高风险|high.?risk|blacklist|黑名单/.test(blob) ||
      (typeof s.rating === "number" && s.rating > 0 && s.rating <= 2)
    );
  }
  return true;
}

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
  bucketFilter,
  onBucketFilterChange,
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
  bucketFilter: SupplierBucketKey;
  onBucketFilterChange: (v: SupplierBucketKey) => void;
  total: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {SUPPLIER_BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => onBucketFilterChange(b.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 font-medium transition-colors",
              bucketFilter === b.key
                ? "bg-accent/15 text-accent"
                : "text-muted hover:bg-card-hover",
            )}
          >
            {b.label}
          </button>
        ))}
      </div>

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
              type="button"
              onClick={() => onStatusFilterChange(v)}
              className={cn(
                "rounded-lg px-3 py-1.5 font-medium transition-colors",
                statusFilter === v
                  ? "bg-primary/10 text-primary"
                  : "text-muted hover:bg-card-hover"
              )}
            >
              {{ all: "全部状态", active: "活跃", inactive: "停用" }[v]}
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
    </div>
  );
}
