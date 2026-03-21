"use client";

import { FolderKanban, ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ProjectBreakdown } from "./types";

function ProgressBar({
  done,
  inProgress,
  total,
}: {
  done: number;
  inProgress: number;
  total: number;
}) {
  if (total === 0)
    return <div className="h-1.5 w-full rounded-full bg-[rgba(110,125,118,0.08)]" />;
  const donePct = (done / total) * 100;
  const inPct = (inProgress / total) * 100;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[rgba(110,125,118,0.08)]">
      {donePct > 0 && (
        <div
          className="bg-[#2e7a56] transition-all"
          style={{ width: `${donePct}%` }}
        />
      )}
      {inPct > 0 && (
        <div
          className="bg-[#2b6055] transition-all"
          style={{ width: `${inPct}%` }}
        />
      )}
    </div>
  );
}

interface Props {
  projectBreakdown: ProjectBreakdown[];
  onProjectClick?: (projectId: string) => void;
}

export function DashboardProjectsSection({ projectBreakdown, onProjectClick }: Props) {
  if (projectBreakdown.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card-bg">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <FolderKanban size={15} className="text-[#805078]" />
          <h2 className="font-semibold">项目概览</h2>
        </div>
        <Link
          href="/projects"
          className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
        >
          全部项目 <ArrowRight size={12} />
        </Link>
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
        {projectBreakdown.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onProjectClick?.(p.id)}
            className={cn(
              "space-y-2 bg-card-bg px-5 py-4 text-left transition-colors",
              onProjectClick && "cursor-pointer hover:bg-[rgba(43,96,85,0.03)] active:bg-[rgba(43,96,85,0.06)]"
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <span className="text-sm font-medium">{p.name}</span>
              <span className="ml-auto text-xs text-muted">
                {p.done}/{p.total}
              </span>
            </div>
            <ProgressBar
              done={p.done}
              inProgress={p.inProgress}
              total={p.total}
            />
            <div className="flex gap-3 text-[11px] text-muted">
              <span>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2e7a56]" />{" "}
                已完成 {p.done}
              </span>
              <span>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2b6055]" />{" "}
                进行中 {p.inProgress}
              </span>
              <span>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[rgba(110,125,118,0.15)]" />{" "}
                待办 {p.todo}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
