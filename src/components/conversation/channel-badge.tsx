"use client";

import { cn } from "@/lib/utils";

const CHANNEL_MAP: Record<string, { label: string; className: string }> = {
  web: {
    label: "Web",
    className: "bg-[rgba(43,96,85,0.08)] text-[#2b6055]",
  },
  internal: {
    label: "内部",
    className: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]",
  },
  api: {
    label: "API",
    className: "bg-[rgba(45,106,122,0.08)] text-[#2d6a7a]",
  },
  demo: {
    label: "Demo",
    className: "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]",
  },
};

export function ChannelBadge({
  channel,
  className,
}: {
  channel: string;
  className?: string;
}) {
  const info = CHANNEL_MAP[channel] ?? {
    label: channel,
    className: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium",
        info.className,
        className
      )}
    >
      {info.label}
    </span>
  );
}
