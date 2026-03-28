"use client";

import Link from "next/link";
import {
  Building2,
  FolderKanban,
  FileText,
  Sparkles,
  Check,
  ArrowRight,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Stats } from "./types";

interface WelcomeStep {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  done: boolean;
}

export function DashboardWelcomeSection({
  stats,
  userName,
}: {
  stats: Stats;
  userName?: string;
}) {
  const hasProjects = stats.totalProjects > 0;
  const hasTasks = stats.totalTasks > 0;
  const hasPrompts = stats.projectBreakdown.length > 0;

  const steps: WelcomeStep[] = [
    {
      id: "org",
      icon: <Building2 size={20} />,
      title: "工作区已就绪",
      description: "系统已为你创建了个人工作区，你也可以创建更多组织来协作。",
      href: "/organizations",
      linkLabel: "查看组织",
      done: true,
    },
    {
      id: "project",
      icon: <FolderKanban size={20} />,
      title: "创建或加入项目",
      description: "项目是协作的核心单元，管理进度、成员与供应商。",
      href: "/projects",
      linkLabel: "进入项目",
      done: hasProjects,
    },
    {
      id: "task",
      icon: <Sparkles size={20} />,
      title: "创建一个任务",
      description: "用任务管理你的日常工作，支持优先级、截止日期和跟进。",
      href: "/tasks",
      linkLabel: "去创建任务",
      done: hasTasks,
    },
    {
      id: "assistant",
      icon: <FileText size={20} />,
      title: "试试 AI 助手",
      description: "用自然语言描述工作，AI 帮你自动创建任务和日程。",
      href: "/assistant",
      linkLabel: "打开 AI 助手",
      done: false,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;

  if (allDone) return null;

  return (
    <div className="rounded-xl border border-accent/20 bg-gradient-to-br from-accent/5 via-card-bg to-card-bg p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">
            {userName ? `你好，${userName}！` : "欢迎来到青砚"}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            跟着下面的步骤快速上手，只需几分钟
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-24 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{
                width: `${(completedCount / steps.length) * 100}%`,
              }}
            />
          </div>
          <span className="text-xs text-muted">
            {completedCount}/{steps.length}
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {steps.map((step, idx) => (
          <Link
            key={step.id}
            href={step.href}
            className={cn(
              "group flex items-start gap-3 rounded-lg border p-4 transition-all",
              step.done
                ? "border-[rgba(46,122,86,0.15)] bg-[rgba(46,122,86,0.02)]"
                : "border-border bg-card-bg hover:border-accent/30 hover:shadow-sm"
            )}
          >
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                step.done
                  ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
                  : "bg-accent/10 text-accent"
              )}
            >
              {step.done ? <Check size={18} /> : step.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p
                  className={cn(
                    "text-sm font-medium",
                    step.done && "text-[#2e7a56]"
                  )}
                >
                  {step.title}
                </p>
                {step.done && (
                  <span className="text-[10px] font-medium text-[#2e7a56]">
                    已完成
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">{step.description}</p>
              {!step.done && (
                <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                  {step.linkLabel}
                  <ArrowRight size={12} />
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-xs text-muted">
        <Users size={14} className="shrink-0 text-accent" />
        <span>
          想邀请团队成员？在
          <Link href="/organizations" className="mx-0.5 font-medium text-accent hover:underline">
            组织
          </Link>
          中添加成员即可，他们会自动看到组织下的所有项目。
        </span>
      </div>
    </div>
  );
}
