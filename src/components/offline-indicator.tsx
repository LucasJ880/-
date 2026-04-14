"use client";

import { useOnlineStatus, useSyncState } from "@/lib/offline/hooks";
import { Wifi, WifiOff, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  const sync = useSyncState();

  if (isOnline && sync.pendingCount === 0 && !sync.lastError) {
    return null;
  }

  if (!isOnline) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 shadow-sm">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          离线模式 — 数据已保存，联网后自动同步
        </span>
        {sync.pendingCount > 0 && (
          <span className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium">
            {sync.pendingCount} 待同步
          </span>
        )}
      </div>
    );
  }

  if (sync.isSyncing) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800 shadow-sm">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span>
          正在同步 {sync.currentIndex}/{sync.pendingCount}...
        </span>
      </div>
    );
  }

  if (sync.lastError) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 shadow-sm">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">
          同步出错: {sync.lastError}
        </span>
      </div>
    );
  }

  if (sync.pendingCount > 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 shadow-sm">
        <Wifi className={cn("h-4 w-4 shrink-0")} />
        <span>{sync.pendingCount} 条数据待同步</span>
      </div>
    );
  }

  return null;
}

export function OfflineStatusDot() {
  const isOnline = useOnlineStatus();
  const sync = useSyncState();

  const color = !isOnline
    ? "bg-amber-500"
    : sync.isSyncing
      ? "bg-blue-500 animate-pulse"
      : sync.pendingCount > 0
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full", color)}
      title={
        !isOnline
          ? "离线"
          : sync.isSyncing
            ? `同步中 ${sync.currentIndex}/${sync.pendingCount}`
            : sync.pendingCount > 0
              ? `${sync.pendingCount} 待同步`
              : "在线"
      }
    />
  );
}

export function SyncBadge({ status }: { status: string }) {
  if (status === "synced") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        已同步
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
        <Loader2 className="h-3 w-3" />
        待同步
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">
        <AlertTriangle className="h-3 w-3" />
        同步失败
      </span>
    );
  }
  return null;
}
