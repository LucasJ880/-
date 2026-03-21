"use client";

import { cn } from "@/lib/utils";

interface CrossEnvVersion {
  envCode: string;
  version: number | null;
  kbId: string;
}

const ENV_COLORS: Record<string, string> = {
  test: "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]",
  prod: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]",
};

export function KbEnvStatus({
  versions,
  className,
}: {
  versions: CrossEnvVersion[];
  className?: string;
}) {
  if (!versions.length) return null;

  const sorted = [...versions].sort((a, b) => {
    const order = ["test", "prod"];
    return order.indexOf(a.envCode) - order.indexOf(b.envCode);
  });

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {sorted.map((v) => (
        <span
          key={v.envCode}
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
            ENV_COLORS[v.envCode] ?? "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
          )}
        >
          {v.envCode}
          <span className="font-mono">
            {v.version != null ? `v${v.version}` : "—"}
          </span>
        </span>
      ))}
    </div>
  );
}
