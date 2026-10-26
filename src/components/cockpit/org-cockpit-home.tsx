"use client";

/**
 * 组织驾驶舱首页容器（A-3，openspec change org-cockpit-home）
 *
 * 首屏只并发调用 GET /api/cockpit/posts 与 GET /api/cockpit/timeline；时间线后续页在点击"加载更多"时按 nextCursor 请求。
 * 只读：不发任何非 GET 请求，审批等处理一律跳到既有页面完成。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { errorKindFrom, serverNow } from "@/lib/cockpit/presentation";
import type { CompanyLogResponse, PostsCockpitResponse } from "@/lib/cockpit/posts-read-model";
import { OrgCockpitView, type CockpitLoadError, type PostsState, type TimelineState } from "./org-cockpit-view";

const POSTS_URL = "/api/cockpit/posts";
const TIMELINE_URL = "/api/cockpit/timeline";
const CLOCK_TICK_MS = 60_000;

type Loaded<T> = { ok: true; data: T } | { ok: false; error: CockpitLoadError };

/** 单个接口：请求、状态码、JSON 解析各自兜底，一个失败不影响另一个 */
async function getJson<T>(url: string): Promise<Loaded<T>> {
  try {
    const res = await apiFetch(url);
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: errorKindFrom(res.status, body) };
    if (body === null) return { ok: false, error: "server" };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: "server" };
  }
}

export function OrgCockpitHome() {
  const [posts, setPosts] = useState<PostsState>({ status: "loading" });
  const [timeline, setTimeline] = useState<TimelineState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  // 页面时钟以服务端 generatedAt 为基准（见 serverNow），每分钟走一次，让"x 分钟前"随时间变旧
  const [clock, setClock] = useState(() => ({ generatedAt: "", receivedAt: Date.now() }));
  const [tick, setTick] = useState(() => Date.now());
  // 每次重新请求都换一代；旧一代的响应（含进行中的"加载更多"）到达时直接丢弃
  const postsGeneration = useRef(0);
  const timelineGeneration = useRef(0);

  const loadTimeline = useCallback(async () => {
    const gen = ++timelineGeneration.current;
    const result = await getJson<CompanyLogResponse>(TIMELINE_URL);
    if (gen !== timelineGeneration.current) return;
    setTimeline(
      result.ok
        ? { status: "ready", items: result.data.items, nextCursor: result.data.nextCursor }
        : { status: "error", error: result.error },
    );
  }, []);

  const loadPosts = useCallback(async () => {
    const gen = ++postsGeneration.current;
    const result = await getJson<PostsCockpitResponse>(POSTS_URL);
    if (gen !== postsGeneration.current) return;
    if (result.ok) {
      setPosts({ status: "ready", data: result.data });
      setClock({ generatedAt: result.data.generatedAt, receivedAt: Date.now() });
    } else {
      setPosts({ status: "error", error: result.error });
    }
    setTick(Date.now());
  }, []);

  // 首屏与刷新共用：两个接口并发，各自到达各自渲染、各自独立成功 / 失败
  const load = useCallback(async () => {
    await Promise.all([loadPosts(), loadTimeline()]);
    setRefreshing(false);
  }, [loadPosts, loadTimeline]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const retry = useCallback(() => {
    setPosts({ status: "loading" });
    setTimeline({ status: "loading" });
    void load();
  }, [load]);

  const retryTimeline = useCallback(() => {
    setTimeline({ status: "loading" });
    void loadTimeline();
  }, [loadTimeline]);

  const loadMore = useCallback(async () => {
    if (timeline.status !== "ready" || !timeline.nextCursor || timeline.loadingMore) return;
    const cursor = timeline.nextCursor;
    const gen = timelineGeneration.current;
    setTimeline({ ...timeline, loadingMore: true, loadMoreFailed: false });
    const result = await getJson<CompanyLogResponse>(`${TIMELINE_URL}?cursor=${encodeURIComponent(cursor)}`);
    if (gen !== timelineGeneration.current) return;
    setTimeline((prev) => {
      if (prev.status !== "ready") return prev;
      if (!result.ok) return { ...prev, loadingMore: false, loadMoreFailed: true };
      return { status: "ready", items: [...prev.items, ...result.data.items], nextCursor: result.data.nextCursor };
    });
  }, [timeline]);

  return (
    <OrgCockpitView
      now={clock.generatedAt ? serverNow(clock.generatedAt, clock.receivedAt, tick) : new Date(tick)}
      posts={posts}
      timeline={timeline}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={retry}
      onRetryTimeline={retryTimeline}
      onLoadMore={() => void loadMore()}
    />
  );
}
