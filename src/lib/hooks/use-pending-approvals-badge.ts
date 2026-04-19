/**
 * PR4.5 —— 全局"待我确认"徽章 hook
 *
 * 用途：
 *  - 侧边栏 AI 助手菜单项上的红点数字
 *  - assistant 页面顶部 Inbox 条的计数
 *
 * 数据源：`GET /api/ai/pending-actions/count`
 * 刷新策略：
 *  - 组件 mount 时立即拉一次
 *  - 每 60s 轮询一次（页面不可见时暂停）
 *  - 监听 window 上的 `pending-actions-changed` 自定义事件立即刷新
 *    （ApprovalCard、主路由 SSE 收到 approval_required 时 dispatch）
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api-fetch";

const REFRESH_EVENT = "pending-actions-changed";
const POLL_INTERVAL_MS = 60_000;

/** 其他组件触发刷新时调用 */
export function notifyPendingActionsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
}

export function usePendingApprovalsBadge() {
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiJson<{ count: number }>(
        "/api/ai/pending-actions/count",
      );
      setCount(typeof data.count === "number" ? data.count : 0);
    } catch {
      // 静默失败，徽章是辅助信息，不打断用户
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    refresh();

    const onChange = () => {
      if (mounted) void refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && mounted) void refresh();
    };

    window.addEventListener(REFRESH_EVENT, onChange);
    document.addEventListener("visibilitychange", onVisibility);

    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && mounted) void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.removeEventListener(REFRESH_EVENT, onChange);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, [refresh]);

  return { count, loading, refresh };
}
