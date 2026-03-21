"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  ScrollText,
  Filter,
  X,
  Shield,
  ChevronRight,
  Clock,
  User,
  Target,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useOrganizations } from "@/lib/hooks/use-organizations";
import { canViewAdminPages } from "@/lib/permissions-client";
import { cn } from "@/lib/utils";

interface AuditLogRow {
  id: string;
  orgId: string | null;
  projectId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  ip: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

interface AuditLogsResponse {
  logs: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface AuditLogDetail {
  id: string;
  orgId: string | null;
  projectId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  create: { label: "创建", color: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]" },
  update: { label: "更新", color: "bg-[rgba(43,96,85,0.08)] text-[#2b6055]" },
  delete: { label: "删除", color: "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]" },
  login: { label: "登录", color: "bg-[rgba(128,80,120,0.08)] text-[#805078]" },
  logout: { label: "登出", color: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" },
  invite: { label: "邀请", color: "bg-[rgba(45,106,122,0.08)] text-[#2d6a7a]" },
  remove: { label: "移除", color: "bg-[rgba(176,106,40,0.08)] text-[#b06a28]" },
  role_change: { label: "角色变更", color: "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]" },
  status_change: { label: "状态变更", color: "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]" },
  export: { label: "导出", color: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" },
};

const TARGET_LABELS: Record<string, string> = {
  user: "用户",
  organization: "组织",
  organization_member: "组织成员",
  project: "项目",
  project_member: "项目成员",
  environment: "环境",
  task: "任务",
  calendar_event: "日历事件",
  blinds_order: "工艺单",
  prompt: "Prompt",
  knowledge_base: "知识库",
  knowledge_document: "知识文档",
  conversation: "会话",
  message: "消息",
  agent: "Agent",
  tool: "工具",
  tool_trace: "工具调用",
  runtime: "Runtime",
  conversation_feedback: "会话反馈",
  message_feedback: "消息反馈",
  evaluation_tag: "评估标签",
};

export default function AdminAuditLogsPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>}>
      <AuditLogsContent />
    </Suspense>
  );
}

function AuditLogsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user: currentUser, loading: userLoading } = useCurrentUser();
  const { organizations } = useOrganizations();

  const [data, setData] = useState<AuditLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [orgId, setOrgId] = useState(searchParams.get("orgId") ?? "");
  const [action, setAction] = useState(searchParams.get("action") ?? "");
  const [targetType, setTargetType] = useState(searchParams.get("targetType") ?? "");
  const [startDate, setStartDate] = useState(searchParams.get("startDate") ?? "");
  const [endDate, setEndDate] = useState(searchParams.get("endDate") ?? "");
  const [page, setPage] = useState(parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const [selectedLog, setSelectedLog] = useState<AuditLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadLogs = useCallback(() => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (orgId) params.set("orgId", orgId);
    if (action) params.set("action", action);
    if (targetType) params.set("targetType", targetType);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("page", String(page));
    params.set("pageSize", "20");

    apiFetch(`/api/audit-logs?${params}`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `请求失败 (${r.status})`);
        }
        return r.json();
      })
      .then((d: AuditLogsResponse) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [orgId, action, targetType, startDate, endDate, page]);

  useEffect(() => {
    if (userLoading) return;
    if (!canViewAdminPages(currentUser?.role)) return;
    loadLogs();
  }, [loadLogs, userLoading, currentUser?.role]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (orgId) params.set("orgId", orgId);
    if (action) params.set("action", action);
    if (targetType) params.set("targetType", targetType);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    router.replace(`/admin/audit-logs${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [orgId, action, targetType, startDate, endDate, page, router]);

  async function openDetail(logId: string) {
    setDetailLoading(true);
    try {
      const res = await apiFetch(`/api/audit-logs/${logId}`);
      const d = await res.json();
      setSelectedLog(d.log ?? null);
    } catch {
      setSelectedLog(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function clearFilters() {
    setOrgId("");
    setAction("");
    setTargetType("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  const hasFilters = orgId || action || targetType || startDate || endDate;

  if (userLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (!canViewAdminPages(currentUser?.role)) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] py-12">
          <Shield className="h-10 w-10 text-[#a63d3d]" />
          <p className="text-sm font-medium text-[#a63d3d]">无权限访问</p>
          <p className="text-sm text-[#a63d3d]">此页面仅超级管理员可查看</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="审计日志"
        description="查看平台操作审计记录，追踪关键变更"
      />

      <div className="rounded-xl border border-border bg-card-bg p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-muted">
          <Filter size={14} />
          过滤条件
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="ml-auto flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <X size={12} />
              清除
            </button>
          )}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <select
            value={orgId}
            onChange={(e) => { setOrgId(e.target.value); setPage(1); }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">全部组织</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>

          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">全部操作</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>

          <select
            value={targetType}
            onChange={(e) => { setTargetType(e.target.value); setPage(1); }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">全部对象</option>
            {Object.entries(TARGET_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder="开始日期"
          />

          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder="结束日期"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
          {error}
          <button onClick={loadLogs} className="ml-2 font-medium text-accent hover:underline">
            重试
          </button>
        </div>
      ) : !data || data.logs.length === 0 ? (
        <EmptyState icon={ScrollText} title="暂无日志" description="没有符合条件的审计记录" />
      ) : (
        <>
          <div className="space-y-2">
            {data.logs.map((log) => {
              const actionInfo = ACTION_LABELS[log.action] ?? { label: log.action, color: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" };
              return (
                <button
                  key={log.id}
                  onClick={() => openDetail(log.id)}
                  className="flex w-full items-center gap-4 rounded-xl border border-border bg-card-bg px-4 py-3 text-left transition-colors hover:bg-background/50"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(110,125,118,0.08)]">
                    <Target size={16} className="text-[#8a9590]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", actionInfo.color)}>
                        {actionInfo.label}
                      </span>
                      <span className="text-xs text-muted">
                        {TARGET_LABELS[log.targetType] ?? log.targetType}
                      </span>
                      {log.targetId && (
                        <span className="truncate text-[10px] text-muted/60">{log.targetId}</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                      <span className="flex items-center gap-1">
                        <User size={10} />
                        {log.user.name}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {new Date(log.createdAt).toLocaleString("zh-CN")}
                      </span>
                      {log.ip && <span className="text-[10px]">{log.ip}</span>}
                    </div>
                  </div>
                  <ChevronRight size={14} className="shrink-0 text-muted" />
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">共 {data.total} 条</p>
            <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />
          </div>
        </>
      )}

      {(selectedLog || detailLoading) && (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30">
          <div className="h-full w-full max-w-lg overflow-y-auto border-l border-border bg-card-bg p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">日志详情</h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="rounded p-1 text-muted hover:bg-background"
              >
                <X size={18} />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
              </div>
            ) : selectedLog ? (
              <div className="mt-4 space-y-4">
                <div className="space-y-2 rounded-lg border border-border p-3">
                  {([
                    ["操作", (ACTION_LABELS[selectedLog.action]?.label ?? selectedLog.action)],
                    ["对象类型", (TARGET_LABELS[selectedLog.targetType] ?? selectedLog.targetType)],
                    ["对象 ID", selectedLog.targetId ?? "—"],
                    ["操作人", `${selectedLog.user.name} (${selectedLog.user.email})`],
                    ["IP", selectedLog.ip ?? "—"],
                    ["时间", new Date(selectedLog.createdAt).toLocaleString("zh-CN")],
                    ["User-Agent", selectedLog.userAgent ?? "—"],
                  ] as [string, string][]).map(([label, value]) => (
                    <div key={label} className="flex items-start justify-between gap-4 text-sm">
                      <span className="shrink-0 text-muted">{label}</span>
                      <span className="break-all text-right font-medium">{value}</span>
                    </div>
                  ))}
                </div>

                {selectedLog.beforeData && (
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-muted">变更前</h4>
                    <div className="rounded-lg border border-border bg-background p-3">
                      {Object.entries(selectedLog.beforeData).map(([k, v]) => (
                        <div key={k} className="flex items-start justify-between gap-3 border-b border-border/40 py-1.5 text-xs last:border-0">
                          <span className="text-muted">{k}</span>
                          <span className="break-all text-right font-mono text-[#a63d3d]/80">{JSON.stringify(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedLog.afterData && (
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-muted">变更后</h4>
                    <div className="rounded-lg border border-border bg-background p-3">
                      {Object.entries(selectedLog.afterData).map(([k, v]) => (
                        <div key={k} className="flex items-start justify-between gap-3 border-b border-border/40 py-1.5 text-xs last:border-0">
                          <span className="text-muted">{k}</span>
                          <span className="break-all text-right font-mono text-[#2e7a56]/80">{JSON.stringify(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-4 text-sm text-[#a63d3d]">加载失败</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
