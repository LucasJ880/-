"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  BarChart3,
  Star,
  AlertTriangle,
  MessageSquare,
  FileText,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { RatingBadge, IssueTypeBadge, FeedbackStatusBadge } from "@/components/feedback";

interface QualitySummary {
  totalConversations: number;
  totalConversationFeedbacks: number;
  totalMessageFeedbacks: number;
  avgRating: number | null;
  ratingDistribution: Record<string, number>;
  issueTypeDistribution: Record<string, number>;
  statusDistribution: Record<string, number>;
  byAgent: { agentId: string; count: number; avgRating: number | null }[];
  byEnvironment: { environmentId: string; count: number; avgRating: number | null }[];
  recentNegativeCases: {
    id: string;
    conversationId: string;
    rating: number;
    issueType: string | null;
    note: string | null;
    status: string;
    createdAt: string;
  }[];
}

interface EnvOption {
  id: string;
  code: string;
  name: string;
}

const ISSUE_LABELS: Record<string, string> = {
  hallucination: "幻觉",
  irrelevance: "答非所问",
  format_error: "格式错误",
  unsafe: "不安全",
  tool_error: "工具错误",
  kb_miss: "知识库缺失",
  slow: "响应慢",
  other: "其他",
};

export default function QualityPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<QualitySummary | null>(null);
  const [error, setError] = useState("");
  const [environments, setEnvironments] = useState<EnvOption[]>([]);
  const [envFilter, setEnvFilter] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = envFilter ? `?environmentId=${envFilter}` : "";
      const [qualityRes, envRes] = await Promise.all([
        apiFetch(`/api/projects/${projectId}/quality${qs}`).then((r) => r.json()),
        environments.length === 0
          ? apiFetch(`/api/projects/${projectId}/environments`).then((r) => r.json())
          : Promise.resolve(null),
      ]);
      if (qualityRes.error) {
        setError(qualityRes.error);
      } else {
        setData(qualityRes);
        setError("");
      }
      if (envRes) setEnvironments(envRes.environments ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId, envFilter, environments.length]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const maxRatingCount = data
    ? Math.max(1, ...Object.values(data.ratingDistribution))
    : 1;
  const maxIssueCount = data
    ? Math.max(1, ...Object.values(data.issueTypeDistribution))
    : 1;

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
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart3 size={20} /> 质量概览
          </h1>
          <p className="mt-1 text-sm text-muted">
            基于反馈数据的项目质量统计
          </p>
        </div>
        {environments.length > 0 && (
          <select
            value={envFilter}
            onChange={(e) => setEnvFilter(e.target.value)}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="">全部环境</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>{env.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted" /></div>
      ) : error ? (
        <p className="text-[#a63d3d] py-8 text-center">{error}</p>
      ) : !data ? (
        <p className="text-muted py-8 text-center">暂无数据</p>
      ) : (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="总会话数" value={data.totalConversations} icon={<MessageSquare size={16} />} />
            <StatCard label="会话反馈" value={data.totalConversationFeedbacks} icon={<Star size={16} />} />
            <StatCard label="消息反馈" value={data.totalMessageFeedbacks} icon={<FileText size={16} />} />
            <StatCard label="平均评分" value={data.avgRating !== null ? `${data.avgRating} / 5` : "-"} icon={<Star size={16} className="text-[#9a6a2f]" />} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Rating distribution */}
            <div className="rounded-xl border border-border bg-card-bg p-4">
              <h3 className="mb-3 text-sm font-semibold">评分分布</h3>
              <div className="space-y-2">
                {[5, 4, 3, 2, 1].map((r) => {
                  const count = data.ratingDistribution[r] ?? 0;
                  const pct = maxRatingCount > 0 ? (count / maxRatingCount) * 100 : 0;
                  return (
                    <div key={r} className="flex items-center gap-2">
                      <span className="w-6 text-right text-xs font-medium">{r}★</span>
                      <div className="flex-1 h-5 rounded-full bg-[rgba(26,36,32,0.05)] overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            r >= 4 ? "bg-[#2e7a56]" : r === 3 ? "bg-[#9a6a2f]" : "bg-[#a63d3d]"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-xs text-muted">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Issue type distribution */}
            <div className="rounded-xl border border-border bg-card-bg p-4">
              <h3 className="mb-3 text-sm font-semibold">问题类型分布</h3>
              {Object.keys(data.issueTypeDistribution).length === 0 ? (
                <p className="py-4 text-center text-xs text-muted">暂无问题标记</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(data.issueTypeDistribution)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, count]) => {
                      const pct = maxIssueCount > 0 ? (count / maxIssueCount) * 100 : 0;
                      return (
                        <div key={type} className="flex items-center gap-2">
                          <span className="w-20 truncate text-xs">{ISSUE_LABELS[type] ?? type}</span>
                          <div className="flex-1 h-5 rounded-full bg-[rgba(26,36,32,0.05)] overflow-hidden">
                            <div className="h-full rounded-full bg-[#9a6a2f] transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-8 text-right text-xs text-muted">{count}</span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>

          {/* Status distribution */}
          <div className="rounded-xl border border-border bg-card-bg p-4">
            <h3 className="mb-3 text-sm font-semibold">反馈状态分布</h3>
            <div className="flex flex-wrap gap-4">
              {Object.entries(data.statusDistribution).map(([status, count]) => (
                <div key={status} className="flex items-center gap-2">
                  <FeedbackStatusBadge status={status} />
                  <span className="text-sm font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* By environment */}
          {data.byEnvironment.length > 0 && (
            <div className="rounded-xl border border-border bg-card-bg p-4">
              <h3 className="mb-3 text-sm font-semibold">按环境</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.byEnvironment.map((item) => {
                  const env = environments.find((e) => e.id === item.environmentId);
                  return (
                    <div key={item.environmentId} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                      <span className="text-sm">{env?.name ?? item.environmentId}</span>
                      <div className="flex items-center gap-3 text-xs text-muted">
                        <span>{item.count} 条反馈</span>
                        {item.avgRating !== null && <span>平均 {item.avgRating}★</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent negative cases */}
          <div className="rounded-xl border border-border bg-card-bg p-4">
            <h3 className="mb-3 text-sm font-semibold flex items-center gap-1">
              <AlertTriangle size={14} className="text-[#a63d3d]" />
              最近低分反馈
            </h3>
            {data.recentNegativeCases.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted">暂无低分反馈</p>
            ) : (
              <div className="space-y-2">
                {data.recentNegativeCases.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.02)] px-3 py-2">
                    <RatingBadge rating={c.rating} size="sm" />
                    <FeedbackStatusBadge status={c.status} />
                    {c.issueType && <IssueTypeBadge issueType={c.issueType} />}
                    {c.note && <span className="truncate text-xs text-muted max-w-[300px]">{c.note}</span>}
                    <span className="ml-auto text-[10px] text-muted">{new Date(c.createdAt).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}</span>
                    <button
                      type="button"
                      onClick={() => router.push(`/projects/${projectId}/conversations/${c.conversationId}`)}
                      className="text-accent hover:underline"
                      title="查看会话"
                    >
                      <ExternalLink size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card-bg p-4 text-center">
      <div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
        {icon}
      </div>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  );
}
