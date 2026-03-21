"use client";

import { Clock } from "lucide-react";

interface VersionItem {
  id: string;
  version: number;
  changeNote: string | null;
  createdBy?: { name: string | null } | null;
  createdAt: string;
}

export function AgentVersionList({
  versions,
  activeVersionId,
  onSelect,
}: {
  versions: VersionItem[];
  activeVersionId?: string | null;
  onSelect?: (id: string) => void;
}) {
  if (versions.length === 0) {
    return <p className="py-4 text-center text-xs text-muted">暂无版本记录</p>;
  }

  return (
    <ul className="space-y-2">
      {versions.map((v) => (
        <li
          key={v.id}
          onClick={() => onSelect?.(v.id)}
          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-background/50 ${
            v.id === activeVersionId
              ? "border-accent bg-accent/5"
              : "border-border bg-card-bg"
          }`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">
            v{v.version}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{v.changeNote || "—"}</p>
            <div className="flex items-center gap-2 text-[10px] text-muted">
              <Clock size={10} />
              {new Date(v.createdAt).toLocaleString("zh-CN")}
              {v.createdBy?.name && <span>· {v.createdBy.name}</span>}
            </div>
          </div>
          {v.id === activeVersionId && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
              当前
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
