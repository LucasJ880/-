"use client";

/**
 * 组织驾驶舱首页容器（A-3，openspec change org-cockpit-home）
 *
 * 首屏只并发调用 GET /api/cockpit/posts 与 GET /api/cockpit/timeline；时间线后续页在点击"加载更多"时按 nextCursor 请求。
 * 只读：不发任何非 GET 请求，审批等处理一律跳到既有页面完成。
 * 状态转移（过期响应丢弃、加载更多与刷新交错）在 src/lib/cockpit/home-state.ts 的纯 reducer 里。
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  INITIAL_POSTS,
  INITIAL_TIMELINE,
  postsReducer,
  timelineReducer,
  type Loaded,
} from "@/lib/cockpit/home-state";
import { errorKindFrom, serverNow } from "@/lib/cockpit/presentation";
import type { CompanyLogResponse, PostsCockpitResponse } from "@/lib/cockpit/posts-read-model";
import { OrgCockpitView } from "./org-cockpit-view";

const POSTS_URL = "/api/cockpit/posts";
const TIMELINE_URL = "/api/cockpit/timeline";
const CLOCK_TICK_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

/** 单个接口：请求、状态码、JSON 解析、超时各自兜底，一个失败不影响另一个 */
async function getJson<T>(url: string): Promise<Loaded<T>> {
  try {
    const res = await apiFetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: errorKindFrom(res.status, body) };
    if (body === null) return { ok: false, error: "server" };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: "server" };
  }
}

export function OrgCockpitHome() {
  const [posts, dispatchPosts] = useReducer(postsReducer, INITIAL_POSTS);
  const [timeline, dispatchTimeline] = useReducer(timelineReducer, INITIAL_TIMELINE);
  const [refreshing, setRefreshing] = useState(false);
  // 页面时钟以服务端时间为基准（见 serverNow），每分钟走一次，让"x 分钟前"随时间变旧
  const [clock, setClock] = useState(() => ({ serverAt: "", receivedAt: Date.now() }));
  const [tick, setTick] = useState(() => Date.now());
  // 每次请求的编号：reducer 只接受最近一次请求的响应
  const postsGen = useRef(0);
  const timelineGen = useRef(0);
  const loadGen = useRef(0);

  const loadPosts = useCallback(async (showLoading: boolean) => {
    const gen = ++postsGen.current;
    dispatchPosts({ type: "request", gen, showLoading });
    const result = await getJson<PostsCockpitResponse>(POSTS_URL);
    dispatchPosts({ type: "loaded", gen, result });
    if (result.ok && gen === postsGen.current) setClock({ serverAt: result.data.generatedAt, receivedAt: Date.now() });
    setTick(Date.now());
  }, []);

  const loadTimeline = useCallback(async (showLoading: boolean) => {
    const gen = ++timelineGen.current;
    dispatchTimeline({ type: "request", gen, showLoading });
    const result = await getJson<CompanyLogResponse>(TIMELINE_URL);
    dispatchTimeline({ type: "loaded", gen, result });
    // 岗位总览还没到时，时间线的相对时间先用时间线响应的窗口上沿作基准
    if (result.ok) setClock((c) => (c.serverAt ? c : { serverAt: result.data.window.to, receivedAt: Date.now() }));
  }, []);

  // 首屏与刷新共用：两个接口并发，各自到达各自渲染、各自独立成功 / 失败
  const load = useCallback(
    async (showLoading: boolean) => {
      const gen = ++loadGen.current;
      await Promise.all([loadPosts(showLoading), loadTimeline(showLoading)]);
      if (gen === loadGen.current) setRefreshing(false);
    },
    [loadPosts, loadTimeline],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load(false);
  }, [load]);

  const timelineView = timeline.view;
  const loadMore = useCallback(async () => {
    if (timelineView.status !== "ready" || !timelineView.nextCursor || timelineView.loadingMore) return;
    const cursor = timelineView.nextCursor;
    dispatchTimeline({ type: "more_request", cursor });
    const result = await getJson<CompanyLogResponse>(`${TIMELINE_URL}?cursor=${encodeURIComponent(cursor)}`);
    dispatchTimeline({ type: "more_loaded", cursor, result });
  }, [timelineView]);

  return (
    <OrgCockpitView
      now={clock.serverAt ? serverNow(clock.serverAt, clock.receivedAt, tick) : new Date(tick)}
      posts={posts.view}
      timeline={timelineView}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={() => void loadPosts(true)}
      onRetryTimeline={() => void loadTimeline(true)}
      onLoadMore={() => void loadMore()}
    />
  );
}
