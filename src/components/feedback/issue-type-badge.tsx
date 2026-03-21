"use client";

import { cn } from "@/lib/utils";

const ISSUE_MAP: Record<string, { label: string; className: string }> = {
  hallucination: {
    label: "幻觉",
    className: "bg-[rgba(128,80,120,0.08)] text-[#805078]",
  },
  irrelevance: {
    label: "答非所问",
    className: "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]",
  },
  format_error: {
    label: "格式错误",
    className: "bg-[rgba(176,141,91,0.08)] text-[#9a7a3f]",
  },
  unsafe: {
    label: "不安全",
    className: "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]",
  },
  tool_error: {
    label: "工具错误",
    className: "bg-[rgba(148,56,56,0.08)] text-[#943838]",
  },
  kb_miss: {
    label: "知识库缺失",
    className: "bg-[rgba(45,106,122,0.08)] text-[#2d6a7a]",
  },
  slow: {
    label: "响应慢",
    className: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]",
  },
  other: {
    label: "其他",
    className: "bg-[rgba(110,125,118,0.06)] text-[#6e7d76]",
  },
};

export function IssueTypeBadge({
  issueType,
  className,
}: {
  issueType: string;
  className?: string;
}) {
  const info = ISSUE_MAP[issueType] ?? { label: issueType, className: "bg-[rgba(110,125,118,0.06)] text-[#6e7d76]" };
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

export const ISSUE_TYPE_OPTIONS = Object.entries(ISSUE_MAP).map(([value, { label }]) => ({
  value,
  label,
}));
