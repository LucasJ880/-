"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type CatalogItem = {
  id: string;
  name: string;
  type: string;
  status: string;
  sourceScope: string;
  workspaceId: string | null;
  version: string | null;
  riskLevel: string | null;
  requiresApproval: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  successRate30d: number | null;
  callCount30d: number | null;
  description?: string | null;
};

const TYPES = [
  "",
  "AGENT",
  "SKILL",
  "TOOL",
  "WORKFLOW",
  "KNOWLEDGE_BASE",
  "INDUSTRY_PACK",
  "PROMPT_TEMPLATE",
];

const STATUSES = [
  "",
  "ACTIVE",
  "DISABLED",
  "MISSING_CONFIG",
  "INCOMPATIBLE",
  "DEPRECATED",
  "ERROR",
];

function statusClass(status: string) {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-50 text-emerald-800";
    case "DISABLED":
      return "bg-slate-100 text-slate-600";
    case "MISSING_CONFIG":
      return "bg-amber-50 text-amber-800";
    case "INCOMPATIBLE":
    case "ERROR":
      return "bg-red-50 text-red-700";
    default:
      return "bg-slate-50 text-slate-600";
  }
}

export default function CapabilitiesCatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [requiresApproval, setRequiresApproval] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (type) qs.set("type", type);
      if (status) qs.set("status", status);
      if (q.trim()) qs.set("q", q.trim());
      if (requiresApproval) qs.set("requiresApproval", requiresApproval);
      const res = await apiFetch(`/api/capabilities/catalog?${qs}`);
      if (res.status === 403) {
        setError("无企业成员身份，无法访问能力目录");
        setItems([]);
        return;
      }
      if (!res.ok) {
        setError("加载能力目录失败");
        setItems([]);
        return;
      }
      const data = (await res.json()) as { items: CatalogItem[] };
      setItems(data.items ?? []);
    } catch {
      setError("加载能力目录失败");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [type, status, q, requiresApproval]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="能力目录"
        description="只读查看企业 Agent、Skill、Tool、Workflow 与 Industry Pack 状态（不含 Builder）"
        actions={
          <Link
            href="/capabilities"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← 返回中台总览
          </Link>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white/60 p-3">
        <label className="text-xs text-muted-foreground">
          类型
          <select
            className="mt-1 block min-h-9 rounded-md border border-border bg-white px-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {TYPES.map((t) => (
              <option key={t || "all"} value={t}>
                {t || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          状态
          <select
            className="mt-1 block min-h-9 rounded-md border border-border bg-white px-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s || "all"} value={s}>
                {s || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          需审批
          <select
            className="mt-1 block min-h-9 rounded-md border border-border bg-white px-2 text-sm"
            value={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.value)}
          >
            <option value="">全部</option>
            <option value="true">是</option>
            <option value="false">否</option>
          </select>
        </label>
        <label className="min-w-[180px] flex-1 text-xs text-muted-foreground">
          关键字
          <input
            className="mt-1 block w-full min-h-9 rounded-md border border-border bg-white px-2 text-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="名称 / ID"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-9 rounded-md bg-accent px-3 text-sm font-medium text-white"
        >
          刷新
        </button>
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">加载中…</p>
      )}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          当前筛选下没有能力条目
        </p>
      )}

      {!loading && items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-white/70">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">类型</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">来源</th>
                <th className="px-3 py-2 font-medium">风险</th>
                <th className="px-3 py-2 font-medium">审批</th>
                <th className="px-3 py-2 font-medium">近 30 天</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border/70">
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.name}</div>
                    {item.description && (
                      <div className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">
                        {item.description}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{item.type}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${statusClass(item.status)}`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{item.sourceScope}</td>
                  <td className="px-3 py-2 text-xs">{item.riskLevel ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {item.requiresApproval ? "是" : "否"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {item.callCount30d != null
                      ? `${item.callCount30d} 次`
                      : "—"}
                    {item.successRate30d != null
                      ? ` · ${item.successRate30d}%`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
