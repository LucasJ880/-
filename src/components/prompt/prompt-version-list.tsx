"use client";

import { cn } from "@/lib/utils";

interface VersionItem {
  id: string;
  version: number;
  note: string | null;
  createdAt: string;
  createdById: string;
  contentPreview?: string;
}

export function PromptVersionList({
  versions,
  activeVersionId,
  selectedIds,
  onSelect,
  onView,
  className,
}: {
  versions: VersionItem[];
  activeVersionId?: string | null;
  selectedIds?: string[];
  onSelect?: (id: string) => void;
  onView?: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {versions.length === 0 && (
        <p className="py-4 text-center text-sm text-muted">暂无版本记录</p>
      )}
      {versions.map((v) => {
        const isActive = v.id === activeVersionId;
        const isSelected = selectedIds?.includes(v.id);

        return (
          <div
            key={v.id}
            className={cn(
              "rounded-lg border px-3 py-2 transition-colors",
              isSelected
                ? "border-accent bg-accent/5"
                : "border-border/60 hover:bg-background",
              isActive && "ring-1 ring-accent/30"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold">
                  v{v.version}
                </span>
                {isActive && (
                  <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                    当前生效
                  </span>
                )}
              </div>
              <span className="text-xs text-muted">
                {new Date(v.createdAt).toLocaleString("zh-CN")}
              </span>
            </div>
            {v.note && (
              <p className="mt-1 text-xs text-muted">{v.note}</p>
            )}
            <div className="mt-1.5 flex items-center gap-2">
              {onSelect && (
                <button
                  type="button"
                  onClick={() => onSelect(v.id)}
                  className={cn(
                    "text-xs",
                    isSelected
                      ? "text-accent font-medium"
                      : "text-muted hover:text-foreground"
                  )}
                >
                  {isSelected ? "已选中" : "选择对比"}
                </button>
              )}
              {onView && (
                <button
                  type="button"
                  onClick={() => onView(v.id)}
                  className="text-xs text-accent hover:underline"
                >
                  查看全文
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
