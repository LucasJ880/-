"use client";

import { cn } from "@/lib/utils";
import { Star } from "lucide-react";

const COLOR_MAP: Record<number, string> = {
  1: "text-[#a63d3d]",
  2: "text-[#b06a28]",
  3: "text-[#9a6a2f]",
  4: "text-[#5a8a56]",
  5: "text-[#2e7a56]",
};

export function RatingBadge({
  rating,
  size = "sm",
  className,
}: {
  rating: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const iconSize = size === "md" ? 16 : 12;
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((v) => (
        <Star
          key={v}
          size={iconSize}
          className={cn(
            v <= rating ? COLOR_MAP[rating] ?? "text-[#9a6a2f]" : "text-muted/40"
          )}
          fill={v <= rating ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}

export function RatingInput({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className="p-0.5 hover:scale-110 transition-transform"
        >
          <Star
            size={20}
            className={cn(
              v <= value ? COLOR_MAP[value] ?? "text-[#9a6a2f]" : "text-muted/40"
            )}
            fill={v <= value ? "currentColor" : "none"}
          />
        </button>
      ))}
    </span>
  );
}
