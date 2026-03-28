"use client";

import { useEffect, useRef } from "react";
import {
  FileText,
  Database,
  Bot,
  Wrench,
  FolderKanban,
  Users,
  Settings,
  Mail,
  FileQuestion,
  ClipboardList,
  BarChart3,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FormattedActivity } from "@/lib/activity/formatter";

const TARGET_ICONS: Record<string, LucideIcon> = {
  project: FolderKanban,
  prompt: FileText,
  knowledge_base: Database,
  knowledge_document: Database,
  agent: Bot,
  tool: Wrench,
  user: Users,
  organization: Settings,
  organization_member: Users,
  project_member: Users,
  project_email: Mail,
  project_question: FileQuestion,
  report: ClipboardList,
  quote_analysis: BarChart3,
  system_event: Sparkles,
};

const ACTION_COLORS: Record<string, string> = {
  create: "bg-[rgba(46,122,86,0.12)] text-[#2e7a56]",
  update: "bg-[rgba(43,96,85,0.10)] text-[#2b6055]",
  delete: "bg-[rgba(166,61,61,0.10)] text-[#a63d3d]",
  status_change: "bg-[rgba(154,106,47,0.10)] text-[#9a6a2f]",
  role_change: "bg-[rgba(45,106,122,0.10)] text-[#2d6a7a]",
  invite: "bg-[rgba(46,122,86,0.12)] text-[#2e7a56]",
  remove: "bg-[rgba(166,61,61,0.10)] text-[#a63d3d]",
  ai_generate: "bg-[rgba(99,89,196,0.10)] text-[#6359c4]",
  ai_send: "bg-[rgba(43,96,85,0.12)] text-[#2b6055]",
  ai_analyze: "bg-[rgba(99,89,196,0.10)] text-[#6359c4]",
  stage_advanced: "bg-[rgba(46,122,86,0.12)] text-[#2e7a56]",
  email_sent: "bg-[rgba(43,96,85,0.12)] text-[#2b6055]",
  task_created: "bg-[rgba(46,122,86,0.12)] text-[#2e7a56]",
  event_created: "bg-[rgba(46,122,86,0.12)] text-[#2e7a56]",
  stage_changed: "bg-[rgba(154,106,47,0.10)] text-[#9a6a2f]",
  member_joined: "bg-[rgba(46,122,86,0.12)] text-[#2e7a56]",
  member_removed: "bg-[rgba(166,61,61,0.10)] text-[#a63d3d]",
};

import {
  isTodayToronto,
  isYesterdayToronto,
  formatTimeToronto,
  toToronto,
} from "@/lib/time";

function formatTime(iso: string): string {
  const d = new Date(iso);
  const time = formatTimeToronto(d);
  if (isTodayToronto(d)) return `今天 ${time}`;
  if (isYesterdayToronto(d)) return `昨天 ${time}`;
  const t = toToronto(d);
  return `${t.getMonth() + 1}/${t.getDate()} ${time}`;
}

interface ActivityTimelineProps {
  activities: FormattedActivity[];
  loading?: boolean;
  compact?: boolean;
  highlightId?: string | null;
}

export function ActivityTimeline({ activities, loading, compact, highlightId }: ActivityTimelineProps) {
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightId]);

  if (loading) {
    return (
      <div className="space-y-3 px-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="h-8 w-8 animate-pulse rounded-full bg-[rgba(26,36,32,0.06)]" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-3/4 animate-pulse rounded bg-[rgba(26,36,32,0.06)]" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-[rgba(26,36,32,0.06)]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted">
        暂无动态记录
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute left-4 top-2 bottom-2 w-px bg-border" />

      <div className="space-y-0">
        {activities.map((act, idx) => {
          const Icon = TARGET_ICONS[act.targetType] ?? FolderKanban;
          const colorCls = ACTION_COLORS[act.actionKey] ?? "bg-[rgba(110,125,118,0.08)] text-muted";
          const isLast = idx === activities.length - 1;
          const isHighlighted = highlightId === act.id;

          return (
            <div
              key={act.id}
              ref={isHighlighted ? highlightRef : undefined}
              data-activity-id={act.id}
              className={cn(
                "group relative flex gap-3 py-3 pl-0 pr-1 transition-colors duration-500",
                !isLast && "border-b border-transparent",
                compact && "py-2",
                isHighlighted && "rounded-[var(--radius-sm)] bg-[rgba(43,96,85,0.08)] ring-1 ring-accent/20"
              )}
            >
              <div className="relative z-10 flex-shrink-0">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full transition-shadow",
                    colorCls,
                    "group-hover:shadow-[0_0_0_3px_rgba(43,96,85,0.08)]",
                    isHighlighted && "shadow-[0_0_0_3px_rgba(43,96,85,0.15)]"
                  )}
                >
                  <Icon size={14} />
                </div>
              </div>

              <div className="min-w-0 flex-1 pt-0.5">
                <p className={cn("text-sm text-foreground", compact && "text-[13px]")}>
                  <span className="font-medium text-foreground">{act.actor.name}</span>
                  <span className="text-muted"> · </span>
                  <span>{act.summary}</span>
                </p>
                {act.diff && !compact && (
                  <p className="mt-1 text-xs text-muted/80">{act.diff}</p>
                )}
                <p className={cn("mt-1 text-xs text-muted/60", compact && "mt-0.5")}>
                  {formatTime(act.timestamp)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
