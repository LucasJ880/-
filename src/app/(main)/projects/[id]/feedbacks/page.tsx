"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  MessageSquare,
  FileText,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import {
  FeedbackStatusBadge,
  RatingBadge,
  IssueTypeBadge,
  ISSUE_TYPE_OPTIONS,
} from "@/components/feedback";
import { Pagination } from "@/components/ui/pagination";

interface FeedbackRow {
  id: string;
  type: "conversation" | "message";
  rating: number;
  issueType: string | null;
  note: string | null;
  status: string;
  conversationId: string;
  messageId?: string;
  agentId: string | null;
  environmentId: string;
  createdById: string;
  createdAt: string;
  tags: { tag: { id: string; label: string; color: string } }[];
}

interface EnvOption {
  id: string;
  code: string;
  name: string;
}

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "open", label: "待处理" },
  { value: "triaged", label: "已分类" },
  { value: "resolved", label: "已解决" },
  { value: "closed", label: "已关闭" },
];

export default function FeedbacksPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [canManage, setCanManage] = useState(false);
  const [environments, setEnvironments] = useState<EnvOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [envFilter, setEnvFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [issueFilter, setIssueFilter] = useState("");
  const [ratingFilter, setRatingFilter] = useState("");
  const [tabFilter, setTabFilter] = useState<"all" | "conversation" | "message">("all");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [convFeedbacks, setConvFeedbacks] = useState<FeedbackRow[]>([]);
  const [convTotal, setConvTotal] = useState(0);
  const [msgFeedbacks, setMsgFeedbacks] = useState<FeedbackRow[]>([]);
  const [msgTotal, setMsgTotal] = useState(0);

  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);

  const loadProject = useCallback(async () => {
    const [projRes, envRes] = await Promise.all([
      apiFetch(`/api/projects/${projectId}`).then((r) => r.json()),
      apiFetch(`/api/projects/${projectId}/environments`).then((r) => r.json()),
    ]);
    setCanManage(!!projRes.canManage);
    setEnvironments(envRes.environments ?? []);
  }, [projectId]);

  const loadFeedbacks = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (envFilter) qs.set("environmentId", envFilter);
    if (statusFilter) qs.set("status", statusFilter);
    if (issueFilter) qs.set("issueType", issueFilter);
    if (ratingFilter) qs.set("rating", ratingFilter);
    qs.set("page", String(page));
    qs.set("pageSize", String(pageSize));

    try {
      const promises: Promise<void>[] = [];
      if (tabFilter === "all" || tabFilter === "conversation") {
        promises.push(
          apiFetch(`/api/projects/${projectId}/conversation-feedbacks?${qs.toString()}`)
            .then((r) => r.json())
            .then((d) => {
              setConvFeedbacks(
                (d.items ?? []).map((i: Record<string, unknown>) => ({ ...i, type: "conversation" }))
              );
              setConvTotal(d.total ?? 0);
            })
        );
      } else {
        setConvFeedbacks([]);
        setConvTotal(0);
      }

      if (tabFilter === "all" || tabFilter === "message") {
        promises.push(
          apiFetch(`/api/projects/${projectId}/message-feedbacks?${qs.toString()}`)
            .then((r) => r.json())
            .then((d) => {
              setMsgFeedbacks(
                (d.items ?? []).map((i: Record<string, unknown>) => ({ ...i, type: "message" }))
              );
              setMsgTotal(d.total ?? 0);
            })
        );
      } else {
        setMsgFeedbacks([]);
        setMsgTotal(0);
      }

      await Promise.all(promises);
    } finally {
      setLoading(false);
    }
  }, [projectId, envFilter, statusFilter, issueFilter, ratingFilter, tabFilter, page]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  useEffect(() => {
    loadFeedbacks();
  }, [loadFeedbacks]);

  const allItems: FeedbackRow[] = [
    ...convFeedbacks,
    ...msgFeedbacks,
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const totalItems = convTotal + msgTotal;

  async function updateFeedbackStatus(fb: FeedbackRow, newStatus: string) {
    setStatusUpdating(fb.id);
    try {
      const endpoint = fb.type === "conversation"
        ? `/api/projects/${projectId}/conversation-feedbacks/${fb.id}`
        : `/api/projects/${projectId}/message-feedbacks/${fb.id}`;
      const res = await apiFetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "更新失败");
      }
      loadFeedbacks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "更新失败");
    } finally {
      setStatusUpdating(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      <button
        type="button"
        onClick={() => router.push(`/projects/${projectId}`)}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> 返回项目
      </button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">评估反馈</h1>
          <p className="mt-1 text-sm text-muted">
            汇总查看会话级与消息级的质量反馈
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border text-xs">
          {(["all", "conversation", "message"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTabFilter(t); setPage(1); }}
              className={cn(
                "px-3 py-1.5 transition-colors",
                tabFilter === t ? "bg-accent text-white" : "text-muted hover:text-foreground"
              )}
            >
              {t === "all" ? "全部" : t === "conversation" ? "会话" : "消息"}
            </button>
          ))}
        </div>

        {environments.length > 0 && (
          <select
            value={envFilter}
            onChange={(e) => { setEnvFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="">全部环境</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>{env.name}</option>
            ))}
          </select>
        )}

        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={issueFilter}
          onChange={(e) => { setIssueFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
        >
          <option value="">全部问题类型</option>
          {ISSUE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={ratingFilter}
          onChange={(e) => { setRatingFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
        >
          <option value="">全部评分</option>
          {[1, 2, 3, 4, 5].map((r) => (
            <option key={r} value={String(r)}>{"★".repeat(r)}</option>
          ))}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-muted" />
        </div>
      ) : allItems.length === 0 ? (
        <div className="py-16 text-center">
          <FileText className="mx-auto mb-2 text-muted" size={32} />
          <p className="text-sm text-muted">暂无反馈记录</p>
        </div>
      ) : (
        <div className="space-y-2">
          {allItems.map((fb) => (
            <div key={fb.id} className="flex items-center gap-3 rounded-xl border border-border bg-card-bg p-3">
              <span className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                fb.type === "conversation" ? "bg-[rgba(43,96,85,0.08)] text-[#2b6055]" : "bg-[rgba(128,80,120,0.08)] text-[#805078]"
              )}>
                {fb.type === "conversation" ? <MessageSquare size={10} className="inline" /> : <FileText size={10} className="inline" />}
                {" "}{fb.type === "conversation" ? "会话" : "消息"}
              </span>

              <RatingBadge rating={fb.rating} size="sm" />
              <FeedbackStatusBadge status={fb.status} />
              {fb.issueType && <IssueTypeBadge issueType={fb.issueType} />}
              {fb.tags?.map((t) => (
                <span key={t.tag.id} className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: t.tag.color + "20", color: t.tag.color }}>
                  {t.tag.label}
                </span>
              ))}

              {fb.note && (
                <span className="truncate text-xs text-muted max-w-[200px]" title={fb.note}>
                  {fb.note}
                </span>
              )}

              <span className="ml-auto shrink-0 text-[10px] text-muted">
                {new Date(fb.createdAt).toLocaleString("zh-CN")}
              </span>

              <button
                type="button"
                onClick={() => router.push(`/projects/${projectId}/conversations/${fb.conversationId}`)}
                className="shrink-0 text-accent hover:underline"
                title="查看会话"
              >
                <ExternalLink size={14} />
              </button>

              {canManage && fb.status !== "closed" && (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) updateFeedbackStatus(fb, e.target.value);
                  }}
                  disabled={statusUpdating === fb.id}
                  className="shrink-0 rounded border border-border bg-background px-1 py-0.5 text-[10px]"
                >
                  <option value="">操作</option>
                  {fb.status !== "triaged" && <option value="triaged">分类</option>}
                  {fb.status !== "resolved" && <option value="resolved">解决</option>}
                  <option value="closed">关闭</option>
                </select>
              )}
            </div>
          ))}

          {totalItems > pageSize && (
            <Pagination
              page={page}
              totalPages={Math.ceil(totalItems / pageSize)}
              onPageChange={setPage}
            />
          )}
        </div>
      )}
    </div>
  );
}
