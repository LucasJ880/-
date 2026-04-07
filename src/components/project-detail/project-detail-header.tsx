"use client";

import Link from "next/link";
import {
  FolderKanban,
  Users,
  FileText,
  BookOpen,
  MessageSquare,
  Bot,
  Wrench,
  Star,
  BarChart3,
  Tag,
  Calendar,
  Clock,
  TrendingUp,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectDetail {
  id: string;
  name: string;
  color: string;
  status: string;
  sourceSystem?: string | null;
  sourcePlatform?: string | null;
  clientOrganization?: string | null;
  owner: { id: string; name: string };
  org: { id: string; name: string; code: string } | null;
  _count: { tasks: number; members: number };
  publicDate?: string | null;
  questionCloseDate?: string | null;
  closeDate?: string | null;
  createdAt?: string | null;
  intelligence?: {
    recommendation: string;
    riskLevel: string;
    fitScore: number;
    reportStatus?: string | null;
  } | null;
  documents?: Array<unknown>;
}

interface Props {
  project: ProjectDetail;
  canManage: boolean;
}

export function ProjectDetailHeader({ project, canManage }: Props) {
  const id = project.id;

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-start gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: project.color }}
        >
          <FolderKanban size={28} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold">{project.name}</h1>
            {project.sourceSystem === "bidtogo" && (
              <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold text-accent">
                BidToGo
              </span>
            )}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                project.status === "active"
                  ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
                  : project.status === "abandoned"
                    ? "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]"
                    : "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
              )}
            >
              {project.status === "active" ? "进行中" : project.status === "abandoned" ? "已放弃" : project.status}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>负责人 {project.owner.name}</span>
            {project.org ? (
              <>
                <span className="text-border">·</span>
                <Link href={`/organizations/${project.org.id}`} className="hover:text-accent transition-colors">
                  组织：{project.org.name} ({project.org.code})
                </Link>
              </>
            ) : (
              <>
                <span className="text-border">·</span>
                <span className="text-[#9a6a2f]">未绑定组织</span>
              </>
            )}
          </div>

          {/* 概览指标 */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Link
              href={`/tasks?project=${id}`}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 transition-colors hover:border-accent/30 hover:bg-accent/5"
            >
              <CheckCircle2 size={15} className="shrink-0 text-accent/60" />
              <div>
                <p className="text-base font-bold leading-tight">{project._count.tasks}</p>
                <p className="text-[11px] text-muted">任务</p>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => document.getElementById("project-members")?.scrollIntoView({ behavior: "smooth" })}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:border-accent/30 hover:bg-accent/5"
            >
              <Users size={15} className="shrink-0 text-accent/60" />
              <div>
                <p className="text-base font-bold leading-tight">{project._count.members}</p>
                <p className="text-[11px] text-muted">成员</p>
              </div>
            </button>
            <Link
              href={`/projects/${id}/knowledge-bases`}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 transition-colors hover:border-accent/30 hover:bg-accent/5"
            >
              <FileText size={15} className="shrink-0 text-accent/60" />
              <div>
                <p className="text-base font-bold leading-tight">{(project.documents ?? []).length}</p>
                <p className="text-[11px] text-muted">文档</p>
              </div>
            </Link>
            {project.closeDate ? (() => {
              const daysLeft = Math.ceil((new Date(project.closeDate).getTime() - Date.now()) / 86400000);
              return (
                <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2">
                  <Clock size={15} className={cn("shrink-0", daysLeft <= 7 ? "text-warning-text" : "text-accent/60")} />
                  <div>
                    <p className={cn("text-base font-bold leading-tight", daysLeft <= 3 ? "text-danger-text" : daysLeft <= 7 ? "text-warning-text" : "")}>
                      {daysLeft > 0 ? `${daysLeft} 天` : daysLeft === 0 ? "今天截标" : `已过 ${Math.abs(daysLeft)} 天`}
                    </p>
                    <p className="text-[11px] text-muted">距截标</p>
                  </div>
                </div>
              );
            })() : (
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2">
                <Calendar size={15} className="shrink-0 text-accent/60" />
                <div>
                  <p className="text-base font-bold leading-tight text-muted">{project.createdAt ? project.createdAt.slice(0, 10) : "—"}</p>
                  <p className="text-[11px] text-muted">创建日期</p>
                </div>
              </div>
            )}
          </div>

          {/* 关键日期 */}
          {(project.publicDate || project.questionCloseDate || project.closeDate) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {project.publicDate && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                  <Calendar size={10} /> 发布 {project.publicDate.slice(0, 10)}
                </span>
              )}
              {project.questionCloseDate && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                  <Calendar size={10} /> 提问截止 {project.questionCloseDate.slice(0, 10)}
                </span>
              )}
              {project.closeDate && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                  <Calendar size={10} /> 截标 {project.closeDate.slice(0, 10)}
                </span>
              )}
            </div>
          )}

          {/* AI 情报摘要 */}
          {project.intelligence && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-accent/5 px-3 py-2 text-sm">
              <TrendingUp size={14} className="shrink-0 text-accent" />
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                project.intelligence.recommendation === "pursue"
                  ? "bg-[rgba(46,122,86,0.1)] text-[#2e7a56]"
                  : project.intelligence.recommendation === "skip"
                    ? "bg-[rgba(166,61,61,0.1)] text-[#a63d3d]"
                    : "bg-[rgba(154,106,47,0.1)] text-[#9a6a2f]"
              )}>
                {({"pursue":"建议跟进","review_carefully":"需仔细评估","low_probability":"低概率","skip":"建议跳过"} as Record<string,string>)[project.intelligence.recommendation] || project.intelligence.recommendation}
              </span>
              {project.intelligence.reportStatus && project.intelligence.reportStatus !== "ai_generated" && (
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  project.intelligence.reportStatus === "approved" ? "bg-emerald-50 text-emerald-700" :
                  project.intelligence.reportStatus === "delivered" ? "bg-violet-50 text-violet-700" :
                  project.intelligence.reportStatus === "needs_revision" ? "bg-red-50 text-red-700" :
                  project.intelligence.reportStatus === "in_review" ? "bg-amber-50 text-amber-700" :
                  "bg-gray-100 text-gray-600"
                )}>
                  {({"in_review":"审核中","approved":"已通过","needs_revision":"需修改","delivered":"已交付","draft":"草稿"} as Record<string,string>)[project.intelligence.reportStatus] || project.intelligence.reportStatus}
                </span>
              )}
              <span className="text-muted">匹配度</span>
              <span className={cn(
                "font-bold",
                project.intelligence.fitScore >= 70 ? "text-[#2e7a56]" : project.intelligence.fitScore >= 40 ? "text-[#9a6a2f]" : "text-muted"
              )}>
                {project.intelligence.fitScore}%
              </span>
            </div>
          )}

          {/* 开发者工具 */}
          {canManage && (
            <div className="mt-4">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">开发者工具</p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {([
                  { href: `/projects/${id}/prompts`, icon: FileText, label: "Prompt 管理" },
                  { href: `/projects/${id}/knowledge-bases`, icon: BookOpen, label: "知识库" },
                  { href: `/projects/${id}/conversations`, icon: MessageSquare, label: "会话管理" },
                  { href: `/projects/${id}/agents`, icon: Bot, label: "Agent 管理" },
                  { href: `/projects/${id}/tools`, icon: Wrench, label: "工具注册" },
                  { href: `/projects/${id}/feedbacks`, icon: Star, label: "评估反馈" },
                  { href: `/projects/${id}/quality`, icon: BarChart3, label: "质量概览" },
                  { href: `/projects/${id}/feedback-tags`, icon: Tag, label: "评估标签" },
                ] as const).map(({ href, icon: Icon, label }) => (
                  <Link key={href} href={href}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
                  >
                    <Icon size={12} /> {label}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
