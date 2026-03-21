"use client";

import { cn } from "@/lib/utils";

const ROLE_MAP: Record<string, { label: string; className: string }> = {
  user: {
    label: "用户",
    className: "bg-[rgba(43,96,85,0.08)] text-[#2b6055]",
  },
  assistant: {
    label: "助手",
    className: "bg-[rgba(107,76,48,0.08)] text-[#8a6038]",
  },
  system: {
    label: "系统",
    className: "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]",
  },
  tool: {
    label: "工具",
    className: "bg-[rgba(45,106,122,0.08)] text-[#2d6a7a]",
  },
};

export function MessageRoleBadge({
  role,
  className,
}: {
  role: string;
  className?: string;
}) {
  const info = ROLE_MAP[role] ?? {
    label: role,
    className: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        info.className,
        className
      )}
    >
      {info.label}
    </span>
  );
}
