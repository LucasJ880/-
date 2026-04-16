"use client";

import { RefreshCw } from "lucide-react";
import { usePullToRefresh } from "@/lib/hooks/use-pull-to-refresh";

interface Props {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  enabled?: boolean;
  className?: string;
}

/**
 * 包裹需要下拉刷新的容器。仅在移动端有效（被包裹时 overflow 需设为可滚动）。
 * 典型用法：<PullToRefresh onRefresh={loadList}> ... 列表 ... </PullToRefresh>
 */
export function PullToRefresh({ onRefresh, children, enabled = true, className }: Props) {
  const { ref, pullDistance, refreshing, threshold } = usePullToRefresh({
    onRefresh,
    enabled,
  });

  const progress = Math.min(pullDistance / threshold, 1);
  const showIndicator = pullDistance > 8 || refreshing;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {showIndicator && (
        <div
          className="pointer-events-none absolute left-0 right-0 z-10 flex items-center justify-center"
          style={{
            top: 0,
            height: Math.max(pullDistance, refreshing ? threshold : 0),
            transition: refreshing ? "height 200ms ease-out" : undefined,
            color: "var(--accent)",
          }}
        >
          <RefreshCw
            size={20}
            className={refreshing ? "ptr-spin" : ""}
            style={{
              transform: refreshing ? undefined : `rotate(${progress * 270}deg)`,
              opacity: 0.4 + progress * 0.6,
            }}
          />
        </div>
      )}
      <div
        className={className}
        style={{
          transform: `translateY(${refreshing ? threshold : pullDistance}px)`,
          transition: refreshing || pullDistance === 0 ? "transform 200ms ease-out" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
