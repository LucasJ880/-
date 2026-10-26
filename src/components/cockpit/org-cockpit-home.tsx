"use client";

/**
 * 组织驾驶舱首页容器（A-3，openspec change org-cockpit-home）
 *
 * 首屏只并发调用 GET /api/cockpit/posts 与 GET /api/cockpit/timeline；时间线后续页在点击"加载更多"时按 nextCursor 请求。
 * 只读：不发任何非 GET 请求，审批等处理一律跳到既有页面完成。
 */

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { CompanyLogResponse, PostsCockpitResponse } from "@/lib/cockpit/posts-read-model";
import { OrgCockpitView, type CockpitLoadError, type PostsState, type TimelineState } from "./org-cockpit-view";

const TIMELINE_URL = "/api/cockpit/timeline";

async function errorKind(res: Response): Promise<CockpitLoadError> {
  if (res.status === 403) {
    const body = (await res.json().catch(() => null)) as { needsSelection?: boolean } | null;
    return body?.needsSelection ? "org_selection" : "forbidden";
  }
  return "server";
}

export function OrgCockpitHome() {
  const [posts, setPosts] = useState<PostsState>({ status: "loading" });
  const [timeline, setTimeline] = useState<TimelineState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // 首屏与刷新共用：两个接口并发，各自独立成功 / 失败
  const load = useCallback(async () => {
    try {
      const [postsRes, timelineRes] = await Promise.all([apiFetch("/api/cockpit/posts"), apiFetch(TIMELINE_URL)]);
      setNow(new Date());
      if (postsRes.ok) setPosts({ status: "ready", data: (await postsRes.json()) as PostsCockpitResponse });
      else setPosts({ status: "error", error: await errorKind(postsRes) });
      if (timelineRes.ok) {
        const body = (await timelineRes.json()) as CompanyLogResponse;
        setTimeline({ status: "ready", items: body.items, nextCursor: body.nextCursor });
      } else {
        setTimeline({ status: "error", error: await errorKind(timelineRes) });
      }
    } catch {
      setPosts({ status: "error", error: "server" });
      setTimeline({ status: "error", error: "server" });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const retry = useCallback(() => {
    setPosts({ status: "loading" });
    setTimeline({ status: "loading" });
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (timeline.status !== "ready" || !timeline.nextCursor || timeline.loadingMore) return;
    const cursor = timeline.nextCursor;
    setTimeline({ ...timeline, loadingMore: true });
    try {
      const res = await apiFetch(`${TIMELINE_URL}?cursor=${encodeURIComponent(cursor)}`);
      if (!res.ok) throw new Error(`timeline ${res.status}`);
      const body = (await res.json()) as CompanyLogResponse;
      setTimeline((prev) =>
        prev.status === "ready" ? { status: "ready", items: [...prev.items, ...body.items], nextCursor: body.nextCursor } : prev,
      );
    } catch {
      setTimeline((prev) => (prev.status === "ready" ? { ...prev, loadingMore: false } : prev));
    }
  }, [timeline]);

  return (
    <OrgCockpitView
      now={now}
      posts={posts}
      timeline={timeline}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={retry}
      onLoadMore={() => void loadMore()}
    />
  );
}
