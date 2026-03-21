"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileText,
  Database,
  MessageSquare,
  Bot,
  Wrench,
  ArrowRight,
  Loader2,
  FolderKanban,
  Users,
  Layers,
} from "lucide-react";
import Link from "next/link";
import { Drawer } from "@/components/ui/drawer";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import type { FormattedActivity } from "@/lib/activity/formatter";

interface OverviewData {
  project: {
    id: string;
    name: string;
    description: string | null;
    color: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  counts: Record<string, number>;
  recentActivity: FormattedActivity[];
}

interface ProjectQuickViewDrawerProps {
  projectId: string | null;
  open: boolean;
  onClose: () => void;
  highlightActivityId?: string | null;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  active: { label: "正常", cls: "bg-[rgba(46,122,86,0.10)] text-[#2e7a56]" },
  archived: { label: "已归档", cls: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" },
  suspended: { label: "已停用", cls: "bg-[rgba(166,61,61,0.10)] text-[#a63d3d]" },
};

const QUICK_LINKS = [
  { key: "prompts", label: "Prompt", icon: FileText, path: "prompts" },
  { key: "knowledgeBases", label: "知识库", icon: Database, path: "knowledge-bases" },
  { key: "conversations", label: "会话", icon: MessageSquare, path: "conversations" },
  { key: "agents", label: "Agent", icon: Bot, path: "agents" },
  { key: "tools", label: "工具", icon: Wrench, path: "tools" },
] as const;

const STAT_ITEMS = [
  { key: "tasks", label: "任务", icon: FolderKanban },
  { key: "members", label: "成员", icon: Users },
  { key: "environments", label: "环境", icon: Layers },
  { key: "prompts", label: "Prompt", icon: FileText },
  { key: "knowledgeBases", label: "知识库", icon: Database },
  { key: "conversations", label: "会话", icon: MessageSquare },
  { key: "agents", label: "Agent", icon: Bot },
] as const;

export function ProjectQuickViewDrawer({ projectId, open, onClose, highlightActivityId }: ProjectQuickViewDrawerProps) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (pid: string) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/projects/${pid}/overview`);
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && projectId) {
      load(projectId);
    }
    if (!open) {
      setData(null);
    }
  }, [open, projectId, load]);

  return (
    <Drawer open={open} onClose={onClose} title="项目概览">
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      ) : data ? (
        <div className="space-y-5 p-5">
          {/* header */}
          <div>
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-lg font-bold text-white"
                style={{ backgroundColor: data.project.color }}
              >
                {data.project.name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-semibold text-foreground">
                  {data.project.name}
                </h3>
                <div className="mt-0.5 flex items-center gap-2">
                  {(() => {
                    const s = STATUS_MAP[data.project.status] ?? STATUS_MAP.active;
                    return (
                      <span className={cn("inline-block rounded-md px-2 py-0.5 text-xs font-medium", s.cls)}>
                        {s.label}
                      </span>
                    );
                  })()}
                  <span className="text-xs text-muted">
                    更新于 {new Date(data.project.updatedAt).toLocaleDateString("zh-CN")}
                  </span>
                </div>
              </div>
            </div>
            {data.project.description && (
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {data.project.description}
              </p>
            )}
          </div>

          {/* stats grid */}
          <div className="grid grid-cols-4 gap-2">
            {STAT_ITEMS.map((s) => {
              const count = data.counts[s.key] ?? 0;
              return (
                <div
                  key={s.key}
                  className="flex flex-col items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-[rgba(26,36,32,0.02)] px-2 py-2.5"
                >
                  <s.icon size={14} className="text-accent/50" />
                  <span className="text-base font-semibold text-foreground">{count}</span>
                  <span className="text-[11px] text-muted">{s.label}</span>
                </div>
              );
            })}
          </div>

          {/* quick links */}
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
              快捷入口
            </h4>
            <div className="grid grid-cols-5 gap-2">
              {QUICK_LINKS.map((link) => (
                <Link
                  key={link.key}
                  href={`/projects/${data.project.id}/${link.path}`}
                  onClick={onClose}
                  className="flex flex-col items-center gap-1.5 rounded-[var(--radius-sm)] border border-transparent px-2 py-3 text-muted transition-all hover:border-border hover:bg-[rgba(43,96,85,0.04)] hover:text-foreground"
                >
                  <link.icon size={16} />
                  <span className="text-[11px]">{link.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* recent activity */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted">
                最近动态
              </h4>
              <Link
                href={`/projects/${data.project.id}`}
                onClick={onClose}
                className="flex items-center gap-1 text-xs text-accent hover:underline"
              >
                查看全部 <ArrowRight size={12} />
              </Link>
            </div>
            <ActivityTimeline activities={data.recentActivity} compact highlightId={highlightActivityId} />
          </div>

          {/* full page link */}
          <Link
            href={`/projects/${data.project.id}`}
            onClick={onClose}
            className="flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-border bg-[rgba(43,96,85,0.03)] px-4 py-3 text-sm font-medium text-accent transition-colors hover:bg-[rgba(43,96,85,0.08)]"
          >
            进入完整项目页 <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="flex items-center justify-center py-20 text-sm text-muted">
          选择一个项目查看详情
        </div>
      )}
    </Drawer>
  );
}
