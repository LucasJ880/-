"use client";

import { cn } from "@/lib/utils";

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  open: {
    label: "待处理",
    className: "bg-[rgba(45,106,122,0.08)] text-[#2d6a7a]",
  },
  triaged: {
    label: "已分类",
    className: "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]",
  },
  resolved: {
    label: "已解决",
    className: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]",
  },
  closed: {
    label: "已关闭",
    className: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]",
  },
};

export function FeedbackStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const info = STATUS_MAP[status] ?? { label: status, className: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" };
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
