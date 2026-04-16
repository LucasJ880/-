"use client";

import { useEffect, useRef, useState } from "react";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  threshold?: number;
  enabled?: boolean;
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * iOS 风格下拉刷新。自动查找最近的滚动祖先容器（overflow-y: auto/scroll）。
 * 仅当滚动容器已到顶部，向下拖拽才触发；不接管正常滚动。
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 72,
  enabled = true,
}: UsePullToRefreshOptions) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const scrollElRef = useRef<HTMLElement | null>(null);
  const pullDistanceRef = useRef(0);

  useEffect(() => {
    pullDistanceRef.current = pullDistance;
  }, [pullDistance]);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const scrollEl =
      findScrollParent(el) || (document.scrollingElement as HTMLElement | null) || document.documentElement;
    scrollElRef.current = scrollEl;
    if (!scrollEl) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (scrollEl.scrollTop <= 0) {
        startY.current = e.touches[0].clientY;
      } else {
        startY.current = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current == null || refreshing) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta > 0) {
        setPullDistance(Math.min(delta * 0.5, threshold * 1.5));
      } else {
        setPullDistance(0);
      }
    };

    const onTouchEnd = async () => {
      if (startY.current == null) return;
      startY.current = null;
      if (pullDistanceRef.current >= threshold) {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
    };

    scrollEl.addEventListener("touchstart", onTouchStart, { passive: true });
    scrollEl.addEventListener("touchmove", onTouchMove, { passive: true });
    scrollEl.addEventListener("touchend", onTouchEnd, { passive: true });
    scrollEl.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      scrollEl.removeEventListener("touchstart", onTouchStart);
      scrollEl.removeEventListener("touchmove", onTouchMove);
      scrollEl.removeEventListener("touchend", onTouchEnd);
      scrollEl.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled, onRefresh, refreshing, threshold]);

  return { ref, pullDistance, refreshing, threshold };
}
