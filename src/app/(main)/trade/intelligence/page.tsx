"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Radar, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  new: "新建",
  searching: "搜索中",
  analyzing: "分析中",
  needs_review: "待复核",
  buyer_identified: "已标买家",
  converted_to_prospect: "已转线索",
  failed: "失败",
  archived: "已归档",
};

const STATUS_OPTIONS = [
  "",
  "new",
  "searching",
  "analyzing",
  "needs_review",
  "buyer_identified",
  "converted_to_prospect",
  "failed",
  "archived",
];

interface ListItem {
  id: string;
  title: string;
  productName: string | null;
  brand: string | null;
  upc: string | null;
  mpn: string | null;
  status: string;
  confidenceScore: number | null;
  lastRunAt: string | null;
  createdAt: string;
  topBuyerName: string | null;
  topBuyerConfidence: number | null;
}

export default function TradeIntelligenceListPage() {
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [items, setItems] = useState<ListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [runBusy, setRunBusy] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const queryString = useMemo(() => {
    if (!orgId) return "";
    const sp = new URLSearchParams();
    sp.set("orgId", orgId);
    sp.set("page", "1");
    sp.set("pageSize", "50");
    if (debouncedSearch) sp.set("search", debouncedSearch);
    if (status) sp.set("status", status);
    return sp.toString();
  }, [orgId, debouncedSearch, status]);

  const load = useCallback(async () => {
    if (!orgId || ambiguous) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(`/api/trade/intelligence?${queryString}`);
      if (res.ok) {
        const data = (await res.json()) as { items?: ListItem[]; total?: number };
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
      } else {
        setItems([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
    }
  }, [orgId, ambiguous, queryString]);

  useEffect(() => {
    if (orgLoading) return;
    void load();
  }, [load, orgLoading]);

  const runCase = async (id: string) => {
    if (!orgId) return;
    setRunBusy(id);
    try {
      const res = await apiFetch(`/api/trade/intelligence/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(j.error ?? `运行失败（${res.status}）`);
        return;
      }
      await load();
    } finally {
      setRunBusy(null);
    }
  };

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!orgId || ambiguous) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted">请先选择当前组织后再使用竞品溯源。</p>
        <button
          type="button"
          onClick={() => router.push("/organizations")}
          className="text-sm text-accent underline-offset-2 hover:underline"
        >
          前往组织
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="竞品溯源"
        description="输入 UPC、MPN、品牌与产品页等线索，自动搜索与归纳候选买家/渠道；人工确认后可一键转为外贸线索。"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/trade/intelligence/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-500"
          >
            <Plus size={14} />
            新建调查
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs text-foreground hover:border-blue-500/40"
          >
            <RefreshCw size={12} />
            刷新
          </button>
        </div>
        <p className="text-[10px] text-muted">共 {total} 条案例</p>
      </div>

      <div className="rounded-xl border border-border/60 bg-card-bg p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">搜索</label>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="标题、产品、品牌、UPC、MPN"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">状态</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground focus:outline-none"
            >
              <option value="">全部状态</option>
              {STATUS_OPTIONS.filter(Boolean).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s] ?? s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/60 bg-card-bg">
        {items.length === 0 ? (
          <div className="px-8 py-16 text-center">
            <Radar className="mx-auto mb-3 h-8 w-8 text-muted" />
            <p className="text-sm text-muted">暂无调查案例</p>
            <Link
              href="/trade/intelligence/new"
              className="mt-4 inline-block text-xs text-blue-400 hover:underline"
            >
              创建第一条调查
            </Link>
          </div>
        ) : (
          <table className="w-full min-w-[960px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-medium">标题</th>
                <th className="px-3 py-2 font-medium">产品</th>
                <th className="px-3 py-2 font-medium">品牌</th>
                <th className="px-3 py-2 font-medium">UPC / MPN</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">首选买家候选</th>
                <th className="px-3 py-2 font-medium">置信度</th>
                <th className="px-3 py-2 font-medium">上次运行</th>
                <th className="px-3 py-2 font-medium">创建</th>
                <th className="px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-border/40 transition hover:bg-border/10">
                  <td className="max-w-[160px] px-3 py-2">
                    <Link href={`/trade/intelligence/${row.id}`} className="font-medium text-blue-400 hover:underline">
                      {row.title}
                    </Link>
                  </td>
                  <td className="max-w-[120px] px-3 py-2 text-muted">
                    <span className="line-clamp-2">{row.productName ?? "—"}</span>
                  </td>
                  <td className="max-w-[100px] px-3 py-2 text-muted">
                    <span className="line-clamp-2">{row.brand ?? "—"}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {[row.upc, row.mpn].filter(Boolean).join(" / ") || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px]",
                        row.status === "failed" && "bg-red-500/15 text-red-300",
                        row.status === "converted_to_prospect" && "bg-emerald-500/15 text-emerald-300",
                        row.status === "needs_review" && "bg-amber-500/15 text-amber-300",
                        !["failed", "converted_to_prospect", "needs_review"].includes(row.status) &&
                          "bg-border/40 text-muted",
                      )}
                    >
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="max-w-[140px] px-3 py-2 text-muted">
                    <span className="line-clamp-2">{row.topBuyerName ?? "—"}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {row.confidenceScore != null ? row.confidenceScore.toFixed(2) : "—"}
                    {row.topBuyerConfidence != null && row.topBuyerConfidence !== row.confidenceScore ? (
                      <span className="ml-1 text-[10px]">({row.topBuyerConfidence.toFixed(2)})</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {row.lastRunAt
                      ? new Date(row.lastRunAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {new Date(row.createdAt).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Link
                        href={`/trade/intelligence/${row.id}`}
                        className="rounded border border-border px-2 py-0.5 text-[10px] text-foreground hover:border-blue-500/40"
                      >
                        详情
                      </Link>
                      <button
                        type="button"
                        disabled={runBusy === row.id || row.status === "converted_to_prospect"}
                        onClick={() => void runCase(row.id)}
                        className="rounded border border-border px-2 py-0.5 text-[10px] text-foreground hover:border-amber-500/40 disabled:opacity-40"
                      >
                        {runBusy === row.id ? "运行中…" : "重新运行"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
