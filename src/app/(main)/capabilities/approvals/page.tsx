"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type ApprovalItem = {
  id: string;
  sourceType: string;
  actionType: string;
  title?: string | null;
  riskLevel: string;
  status: string;
  executionStatus?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  submittedById?: string | null;
  sourceAgentSkillTool?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  multiApprover?: boolean;
};

const TABS: Array<{ key: string; label: string }> = [
  { key: "pending_mine", label: "待我审批" },
  { key: "submitted_by_me", label: "我提交的" },
  { key: "processing", label: "处理中" },
  { key: "approved", label: "已批准" },
  { key: "rejected", label: "已拒绝" },
  { key: "executed", label: "已执行" },
  { key: "execution_failed", label: "执行失败" },
  { key: "expired", label: "已过期" },
];

export default function CapabilitiesApprovalsPage() {
  const [tab, setTab] = useState("pending_mine");
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState("");
  const [riskLevel, setRiskLevel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        tab,
        page: String(page),
        pageSize: "20",
      });
      if (sourceType) qs.set("sourceType", sourceType);
      if (riskLevel) qs.set("riskLevel", riskLevel);
      const res = await apiFetch(`/api/capabilities/approvals?${qs}`);
      if (res.status === 403) {
        setError("无企业成员身份，无法访问审批中心");
        setItems([]);
        return;
      }
      if (!res.ok) {
        setError("加载失败");
        return;
      }
      const data = (await res.json()) as {
        items: ApprovalItem[];
        total: number;
      };
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [tab, page, sourceType, riskLevel]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="审批中心"
        description="统一查看 PendingAction / ApprovalRequest / Product Content 审批（不改底层执行器）"
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`rounded-md border px-3 py-1.5 text-sm ${
              tab === t.key ? "bg-muted font-medium" : ""
            }`}
            onClick={() => {
              setPage(1);
              setTab(t.key);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          className="rounded-md border bg-background px-3 py-1.5 text-sm"
          value={sourceType}
          onChange={(e) => {
            setPage(1);
            setSourceType(e.target.value);
          }}
        >
          <option value="">全部来源</option>
          <option value="PENDING_ACTION">PendingAction</option>
          <option value="APPROVAL_REQUEST">ApprovalRequest</option>
          <option value="PRODUCT_CONTENT">Product Content</option>
        </select>
        <select
          className="rounded-md border bg-background px-3 py-1.5 text-sm"
          value={riskLevel}
          onChange={(e) => {
            setPage(1);
            setRiskLevel(e.target.value);
          }}
        >
          <option value="">全部风险</option>
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>
        <span className="text-sm text-muted-foreground">共 {total} 条</span>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">提交时间</th>
              <th className="px-3 py-2">动作</th>
              <th className="px-3 py-2">来源</th>
              <th className="px-3 py-2">Workspace</th>
              <th className="px-3 py-2">风险</th>
              <th className="px-3 py-2">审批状态</th>
              <th className="px-3 py-2">执行状态</th>
              <th className="px-3 py-2">到期</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-muted-foreground">
                  暂无审批
                </td>
              </tr>
            ) : (
              items.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link
                      href={`/capabilities/approvals/${encodeURIComponent(a.id)}`}
                      className="text-primary hover:underline"
                    >
                      {new Date(a.createdAt).toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{a.title ?? a.actionType}</td>
                  <td className="px-3 py-2">
                    {a.sourceType}
                    <div className="text-xs text-muted-foreground">
                      {a.sourceAgentSkillTool ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {a.workspaceId ?? "—"}
                  </td>
                  <td className="px-3 py-2">{a.riskLevel}</td>
                  <td className="px-3 py-2">{a.status}</td>
                  <td className="px-3 py-2">{a.executionStatus ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {a.expiresAt
                      ? new Date(a.expiresAt).toLocaleString()
                      : "—"}
                    {a.multiApprover ? (
                      <span className="ml-1 text-xs text-amber-700">多人</span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          上一页
        </button>
        <span className="text-sm text-muted-foreground">第 {page} 页</span>
        <button
          type="button"
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          disabled={loading || page * 20 >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
