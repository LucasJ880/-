/**
 * 组织驾驶舱首页 — 取数状态机（A-3，openspec change org-cockpit-home）
 *
 * 岗位总览与时间线各一份状态，状态转移写成纯 reducer，便于把"刷新 / 加载更多 / 单独重试"
 * 的交错顺序做成表驱动测试。容器只负责发请求、给每次请求编号（gen）、把结果 dispatch 进来。
 */

import type { CockpitLoadError } from "./presentation";
import type { CompanyLogResponse, PostsCockpitResponse } from "./posts-read-model";
import type { TimelineEntry } from "./timeline";

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: CockpitLoadError };

export type PostsState =
  | { status: "loading" }
  | { status: "error"; error: CockpitLoadError }
  | { status: "ready"; data: PostsCockpitResponse };

export type TimelineState =
  | { status: "loading" }
  | { status: "error"; error: CockpitLoadError }
  | { status: "ready"; items: TimelineEntry[]; nextCursor: string | null; loadingMore?: boolean; loadMoreFailed?: boolean };

/** gen：最近一次发出的请求编号；编号不等的响应一律丢弃 */
export interface PostsModel {
  gen: number;
  view: PostsState;
}

export interface TimelineModel {
  gen: number;
  view: TimelineState;
}

export const INITIAL_POSTS: PostsModel = { gen: 0, view: { status: "loading" } };
export const INITIAL_TIMELINE: TimelineModel = { gen: 0, view: { status: "loading" } };

export type PostsAction =
  | { type: "request"; gen: number; showLoading: boolean }
  | { type: "loaded"; gen: number; result: Loaded<PostsCockpitResponse> };

export function postsReducer(state: PostsModel, action: PostsAction): PostsModel {
  switch (action.type) {
    case "request":
      return { gen: action.gen, view: action.showLoading ? { status: "loading" } : state.view };
    case "loaded":
      if (action.gen !== state.gen) return state;
      return {
        gen: state.gen,
        view: action.result.ok ? { status: "ready", data: action.result.data } : { status: "error", error: action.result.error },
      };
  }
}

export type TimelineAction =
  | { type: "request"; gen: number; showLoading: boolean }
  | { type: "loaded"; gen: number; result: Loaded<CompanyLogResponse> }
  | { type: "more_request"; cursor: string }
  | { type: "more_loaded"; cursor: string; result: Loaded<CompanyLogResponse> };

/**
 * "加载更多"的结果只在列表仍停在发请求时的那一页（nextCursor 相同且仍在加载中）才拼接；
 * 期间刷新或单独重试替换了列表，旧游标的结果直接丢弃，不会把旧第 2 页拼到新第 1 页后面。
 */
export function timelineReducer(state: TimelineModel, action: TimelineAction): TimelineModel {
  const view = state.view;
  switch (action.type) {
    case "request":
      return { gen: action.gen, view: action.showLoading ? { status: "loading" } : view };
    case "loaded":
      if (action.gen !== state.gen) return state;
      return {
        gen: state.gen,
        view: action.result.ok
          ? { status: "ready", items: action.result.data.items, nextCursor: action.result.data.nextCursor }
          : { status: "error", error: action.result.error },
      };
    case "more_request":
      if (view.status !== "ready" || view.loadingMore || view.nextCursor !== action.cursor) return state;
      return { gen: state.gen, view: { ...view, loadingMore: true, loadMoreFailed: false } };
    case "more_loaded": {
      if (view.status !== "ready" || !view.loadingMore || view.nextCursor !== action.cursor) return state;
      if (!action.result.ok) return { gen: state.gen, view: { ...view, loadingMore: false, loadMoreFailed: true } };
      const seen = new Set(view.items.map((e) => e.id));
      return {
        gen: state.gen,
        view: {
          status: "ready",
          items: [...view.items, ...action.result.data.items.filter((e) => !seen.has(e.id))],
          nextCursor: action.result.data.nextCursor,
        },
      };
    }
  }
}

/** 岗位总览失败时是否连时间线一起收起：鉴权类错误（两个接口同一套鉴权）收起；服务端错误不影响时间线 */
export function hidesWholePage(error: CockpitLoadError): boolean {
  return error !== "server";
}
