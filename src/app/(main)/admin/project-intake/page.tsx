"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Search,
  Package,
  ArrowRight,
  ExternalLink,
  Clock,
  Building2,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { canViewAdminPages } from "@/lib/permissions-client";
import { formatDateTimeToronto } from "@/lib/time";
import { DispatchDialog } from "./dispatch-dialog";

interface IntakeProject {
  id: string;
  name: string;
  description: string | null;
  intakeStatus: string;
  priority: string;
  clientOrganization: string | null;
  solicitationNumber: string | null;
  estimatedValue: number | null;
  currency: string | null;
  closeDate: string | null;
  createdAt: string;
  sourceSystem: string | null;
  org: { id: string; name: string } | null;
  owner: { id: string; name: string; email: string } | null;
  externalRef: { system: string; externalId: string; url: string | null } | null;
  intelligence: {
    recommendation: string | null;
    fitScore: number | null;
    riskLevel: string | null;
  } | null;
}

interface IntakeResponse {
  items: IntakeProject[];
  total: number;
  page: number;
  pageSize: number;
}

const RECOMMENDATION_LABELS: Record<string, { label: string; cls: string }> = {
  pursue: { label: "推荐跟进", cls: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]" },
  review_carefully: { label: "谨慎评估", cls: "bg-[rgba(181,137,47,0.08)] text-[#b5892f]" },
  low_probability: { label: "概率较低", cls: "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]" },
  skip: { label: "建议跳过", cls: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" },
};

const PRIORITY_LABELS: Record<string, { label: string; cls: string }> = {
  high: { label: "高", cls: "text-[#a63d3d]" },
  medium: { label: "中", cls: "text-[#b5892f]" },
  low: { label: "低", cls: "text-[#6e7d76]" },
};

export default function ProjectIntakePage() {
  const { user, loading: userLoading } = useCurrentUser();
  const router = useRouter();
  const [data, setData] = useState<IntakeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [dispatchTarget, setDispatchTarget] = useState<IntakeProject | null>(null);
  const [successMsg, setSuccessMsg] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        intakeStatus: "pending_dispatch",
        page: String(page),
        pageSize: "20",
      });
      if (keyword) params.set("keyword", keyword);
      const res = await apiFetch(`/api/admin/project-intake?${params}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, keyword]);

  useEffect(() => {
    if (!userLoading && user && canViewAdminPages(user.role)) {
      fetchData();
    }
  }, [userLoading, user, fetchData]);

  if (userLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!user || !canViewAdminPages(user.role)) {
    return (
      <div className="p-8">
        <EmptyState icon={Package} title="无权限" description="仅超级管理员可访问此页面" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="待分发项目"
        description="从 Bid to Go 导入的项目需要审核后分发给对应组织和负责人"
      />

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <input
            type="text"
            placeholder="搜索项目名称、客户组织、招标编号…"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-[rgba(26,36,32,0.12)] bg-white pl-10 pr-4 py-2.5 text-sm text-[#1a2420] shadow-sm placeholder:text-[#B8C4C0] outline-none focus:border-[#4F7C78] focus:ring-2 focus:ring-[#4F7C78]/20"
          />
        </div>
        <div className="text-sm text-muted">
          共 {data?.total ?? 0} 个待分发项目
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : !data?.items?.length ? (
        <EmptyState
          icon={Package}
          title="暂无待分发项目"
          description="Bid to Go 导入的项目将在此处等待分发"
        />
      ) : (
        <div className="space-y-3">
          {data.items.map((project) => (
            <ProjectIntakeCard
              key={project.id}
              project={project}
              onDispatch={() => setDispatchTarget(project)}
              onView={() => router.push(`/projects/${project.id}`)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.total > 20 && (
        <div className="flex justify-center pt-2">
          <div className="flex items-center gap-2 text-sm text-muted">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1.5 rounded-md border border-border disabled:opacity-40 hover:bg-card-hover transition-colors"
            >
              上一页
            </button>
            <span>
              第 {page} / {Math.ceil(data.total / 20)} 页
            </span>
            <button
              disabled={page * 20 >= data.total}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1.5 rounded-md border border-border disabled:opacity-40 hover:bg-card-hover transition-colors"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {/* Success toast */}
      {successMsg && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 fade-in rounded-xl border border-[rgba(46,122,86,0.2)] bg-[rgba(46,122,86,0.06)] px-5 py-3 text-sm font-medium text-[#2e7a56] shadow-lg">
          {successMsg}
        </div>
      )}

      {/* Dispatch Dialog */}
      {dispatchTarget && (
        <DispatchDialog
          project={dispatchTarget}
          onClose={() => setDispatchTarget(null)}
          onSuccess={() => {
            const name = dispatchTarget.name;
            setDispatchTarget(null);
            setSuccessMsg(`「${name}」已成功分发，相关人员将收到通知`);
            setTimeout(() => setSuccessMsg(""), 4000);
            fetchData();
          }}
        />
      )}
    </div>
  );
}

function ProjectIntakeCard({
  project,
  onDispatch,
  onView,
}: {
  project: IntakeProject;
  onDispatch: () => void;
  onView: () => void;
}) {
  const rec = project.intelligence?.recommendation
    ? RECOMMENDATION_LABELS[project.intelligence.recommendation]
    : null;
  const pri = PRIORITY_LABELS[project.priority] ?? PRIORITY_LABELS.medium;

  return (
    <div className="group rounded-xl border border-[rgba(26,36,32,0.1)] bg-[#faf8f4] p-4 sm:p-5 shadow-sm hover:shadow-md transition-all">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        {/* Left */}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className="text-base font-semibold text-foreground truncate cursor-pointer hover:text-primary transition-colors"
              onClick={onView}
            >
              {project.name}
            </h3>
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[rgba(79,124,120,0.1)] text-primary">
              BidToGo
            </span>
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[rgba(181,137,47,0.1)] text-[#b5892f]">
              待分发
            </span>
            {rec && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${rec.cls}`}>
                {rec.label}
              </span>
            )}
          </div>

          {project.description && (
            <p className="text-sm text-muted line-clamp-2">{project.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {project.clientOrganization && (
              <span className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                {project.clientOrganization}
              </span>
            )}
            {project.solicitationNumber && (
              <span>编号: {project.solicitationNumber}</span>
            )}
            {project.estimatedValue != null && (
              <span>
                预估金额: {project.currency ?? ""}{" "}
                {project.estimatedValue.toLocaleString("zh-CN")}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              导入: {formatDateTimeToronto(project.createdAt)}
            </span>
            {project.closeDate && (
              <span>
                截标: {formatDateTimeToronto(project.closeDate)}
              </span>
            )}
            {project.intelligence?.fitScore != null && (
              <span>匹配度: {project.intelligence.fitScore}分</span>
            )}
            <span className={`font-medium ${pri.cls}`}>
              优先级: {pri.label}
            </span>
          </div>

          {project.externalRef?.url && (
            <a
              href={project.externalRef.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              查看 BidToGo 详情
            </a>
          )}
        </div>

        {/* Right: action */}
        <div className="flex-shrink-0">
          <button
            onClick={onDispatch}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-hover transition-colors"
          >
            分发项目
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
