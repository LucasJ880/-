"use client";

import { cn } from "@/lib/utils";

const CAT_MAP: Record<string, { label: string; className: string }> = {
  builtin: {
    label: "内置",
    className: "bg-[rgba(43,96,85,0.08)] text-[#2b6055]",
  },
  api: {
    label: "API",
    className: "bg-[rgba(45,106,122,0.08)] text-[#2d6a7a]",
  },
  internal: {
    label: "内部",
    className: "bg-[rgba(107,76,48,0.08)] text-[#8a6038]",
  },
  integration: {
    label: "集成",
    className: "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]",
  },
};

export function ToolCategoryBadge({
  category,
  className,
}: {
  category: string;
  className?: string;
}) {
  const info = CAT_MAP[category] ?? {
    label: category,
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
