"use client";

import { cn } from "@/lib/utils";

interface DocVersionItem {
  id: string;
  version: number;
  note: string | null;
  createdAt: string;
  createdById: string;
  knowledgeBaseVersionId: string;
}

export function KbDocVersionList({
  versions,
  currentKbVersionId,
  onView,
  className,
}: {
  versions: DocVersionItem[];
  currentKbVersionId?: string | null;
  onView?: (versionId: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {versions.length === 0 && (
        <p className="py-4 text-center text-sm text-muted">暂无版本记录</p>
      )}
      {versions.map((v) => {
        const isCurrent = v.knowledgeBaseVersionId === currentKbVersionId;

        return (
          <div
            key={v.id}
            className={cn(
              "rounded-lg border px-3 py-2 transition-colors",
              isCurrent
                ? "border-accent/40 bg-accent/5 ring-1 ring-accent/30"
                : "border-border/60 hover:bg-background"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold">
                  v{v.version}
                </span>
                {isCurrent && (
                  <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                    当前生效
                  </span>
                )}
              </div>
              <span className="text-xs text-muted">
                {new Date(v.createdAt).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}
              </span>
            </div>
            {v.note && (
              <p className="mt-1 text-xs text-muted">{v.note}</p>
            )}
            {onView && (
              <div className="mt-1.5">
                <button
                  type="button"
                  onClick={() => onView(v.id)}
                  className="text-xs text-accent hover:underline"
                >
                  查看全文
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
