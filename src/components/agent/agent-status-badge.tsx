"use client";

import { cn } from "@/lib/utils";

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  active: {
    label: "活跃",
    className: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]",
  },
  draft: {
    label: "草稿",
    className: "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]",
  },
  archived: {
    label: "已归档",
    className: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]",
  },
};

export function AgentStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const info = STATUS_MAP[status] ?? {
    label: status,
    className: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        info.className,
        className
      )}
    >
      {info.label}
    </span>
  );
}
