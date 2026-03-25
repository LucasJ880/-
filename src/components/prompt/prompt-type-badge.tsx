"use client";

import { cn } from "@/lib/utils";

const TYPE_STYLES: Record<string, { label: string; className: string }> = {
  system: {
    label: "系统",
    className: "bg-[rgba(43,96,85,0.08)] text-[#2b6055]",
  },
  assistant: {
    label: "助手",
    className: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]",
  },
  workflow: {
    label: "工作流",
    className: "bg-[rgba(128,80,120,0.08)] text-[#805078]",
  },
};

export function PromptTypeBadge({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const info = TYPE_STYLES[type] ?? {
    label: type,
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
