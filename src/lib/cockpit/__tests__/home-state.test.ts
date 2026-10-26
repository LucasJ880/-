/**
 * A-3 首页取数状态机（openspec change org-cockpit-home，spec cockpit/home-view）
 * 运行：npx tsx src/lib/cockpit/__tests__/home-state.test.ts
 */
import {
  INITIAL_POSTS,
  INITIAL_TIMELINE,
  hidesWholePage,
  postsReducer,
  timelineReducer,
  type Loaded,
  type TimelineAction,
  type TimelineModel,
} from "../home-state";
import type { CompanyLogResponse, PostsCockpitResponse } from "../posts-read-model";
import type { TimelineEntry } from "../timeline";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 400)}`}`);
  }
}

const entry = (id: string): TimelineEntry => ({
  id,
  at: "2026-10-26T12:00:00.000Z",
  post: null,
  actor: "system",
  actorName: null,
  kind: "automation_run",
  source: "system",
  summary: id,
  href: null,
});
const page = (ids: string[], nextCursor: string | null): Loaded<CompanyLogResponse> => ({
  ok: true,
  data: { items: ids.map(entry), nextCursor, window: { from: "2026-10-19T12:00:00.000Z", to: "2026-10-26T12:00:00.000Z" } },
});
const failed: Loaded<CompanyLogResponse> = { ok: false, error: "server" };
const run = (actions: TimelineAction[], from: TimelineModel = INITIAL_TIMELINE) => actions.reduce(timelineReducer, from);
const ids = (m: TimelineModel) => (m.view.status === "ready" ? m.view.items.map((e) => e.id) : m.view.status);

console.log("时间线：首屏与翻页");
{
  const first = run([{ type: "request", gen: 1, showLoading: false }, { type: "loaded", gen: 1, result: page(["a", "b"], "c1") }]);
  ok(JSON.stringify(ids(first)) === '["a","b"]' && first.view.status === "ready" && first.view.nextCursor === "c1", "首屏加载");
  const more = run([{ type: "more_request", cursor: "c1" }, { type: "more_loaded", cursor: "c1", result: page(["c", "d"], null) }], first);
  ok(JSON.stringify(ids(more)) === '["a","b","c","d"]' && more.view.status === "ready" && more.view.nextCursor === null, "加载更多追加，游标前进");
  const dupe = run([{ type: "more_request", cursor: "c1" }, { type: "more_loaded", cursor: "c1", result: page(["b", "c"], null) }], first);
  ok(JSON.stringify(ids(dupe)) === '["a","b","c"]', "与已有条目重复的 id 不重复追加");
  const moreFailed = run([{ type: "more_request", cursor: "c1" }, { type: "more_loaded", cursor: "c1", result: failed }], first);
  ok(
    moreFailed.view.status === "ready" && moreFailed.view.loadMoreFailed === true && !moreFailed.view.loadingMore && JSON.stringify(ids(moreFailed)) === '["a","b"]',
    "加载更多失败：保留已加载条目，标记可重试",
  );
  const retried = run([{ type: "more_request", cursor: "c1" }], moreFailed);
  ok(retried.view.status === "ready" && retried.view.loadingMore === true && retried.view.loadMoreFailed === false, "失败后再点：重新进入加载中");
  const twice = run([{ type: "more_request", cursor: "c1" }, { type: "more_request", cursor: "c1" }], first);
  ok(twice.view.status === "ready" && twice.view.loadingMore === true, "加载中重复点击不重复发起（状态不变）");
  ok(run([{ type: "more_request", cursor: "stale" }], first) === first, "游标与当前列表不符的加载更多请求被忽略");
}

console.log("时间线：刷新与加载更多交错（交叉审查发现的竞态）");
{
  const first = run([{ type: "request", gen: 1, showLoading: false }, { type: "loaded", gen: 1, result: page(["a", "b"], "c1") }]);
  // 刷新开始 → 用户点加载更多（旧游标 c1）→ 刷新响应到达（新第 1 页、新游标 c1'）→ 旧加载更多响应到达
  const raced = run(
    [
      { type: "request", gen: 2, showLoading: false },
      { type: "more_request", cursor: "c1" },
      { type: "loaded", gen: 2, result: page(["n", "a"], "c1'") },
      { type: "more_loaded", cursor: "c1", result: page(["old-c", "old-d"], null) },
    ],
    first,
  );
  ok(JSON.stringify(ids(raced)) === '["n","a"]' && raced.view.status === "ready" && raced.view.nextCursor === "c1'" && !raced.view.loadingMore, "刷新后到达的旧游标结果被丢弃", raced);
  // 刷新结果与旧列表游标相同（期间无新事件）：旧加载更多仍丢弃，用户再点一次即可
  const sameCursor = run(
    [
      { type: "request", gen: 2, showLoading: false },
      { type: "more_request", cursor: "c1" },
      { type: "loaded", gen: 2, result: page(["a", "b"], "c1") },
      { type: "more_loaded", cursor: "c1", result: page(["c"], null) },
    ],
    first,
  );
  ok(JSON.stringify(ids(sameCursor)) === '["a","b"]' && sameCursor.view.status === "ready" && sameCursor.view.nextCursor === "c1", "刷新替换列表后，进行中的加载更多一律作废");
  // 加载更多在刷新响应之前到达：正常拼接，随后刷新替换整页
  const moreFirst = run(
    [
      { type: "request", gen: 2, showLoading: false },
      { type: "more_request", cursor: "c1" },
      { type: "more_loaded", cursor: "c1", result: page(["c"], null) },
      { type: "loaded", gen: 2, result: page(["n", "a"], "c1'") },
    ],
    first,
  );
  ok(JSON.stringify(ids(moreFirst)) === '["n","a"]', "加载更多先到、刷新后到：以刷新结果为准");
  // 首屏响应慢于刷新响应：旧编号的响应被丢弃
  const slowMount = run([
    { type: "request", gen: 1, showLoading: false },
    { type: "request", gen: 2, showLoading: false },
    { type: "loaded", gen: 2, result: page(["new"], null) },
    { type: "loaded", gen: 1, result: page(["old"], "c-old") },
  ]);
  ok(JSON.stringify(ids(slowMount)) === '["new"]', "旧编号的整页响应被丢弃");
  // 单独重试时间线：进入加载中；失败后保持错误
  const retry = run([{ type: "request", gen: 3, showLoading: true }], first);
  ok(retry.view.status === "loading" && retry.gen === 3, "单独重试 → 加载中");
  const retryFailed = run([{ type: "loaded", gen: 3, result: { ok: false, error: "session_expired" } }], retry);
  ok(retryFailed.view.status === "error" && retryFailed.view.error === "session_expired", "失败 → 错误态带错误类型");
  // 错误态下的加载更多响应不会把列表"复活"
  ok(run([{ type: "more_loaded", cursor: "c1", result: page(["x"], null) }], retryFailed) === retryFailed, "错误态忽略加载更多响应");
}

console.log("岗位总览");
{
  const data = { orgId: "o", generatedAt: "2026-10-26T12:00:00.000Z" } as PostsCockpitResponse;
  const loaded = [
    { type: "request" as const, gen: 1, showLoading: false },
    { type: "loaded" as const, gen: 1, result: { ok: true as const, data } },
  ].reduce(postsReducer, INITIAL_POSTS);
  ok(loaded.view.status === "ready" && loaded.view.data === data, "首屏加载");
  const refreshing = postsReducer(loaded, { type: "request", gen: 2, showLoading: false });
  ok(refreshing.view === loaded.view && refreshing.gen === 2, "刷新期间保留旧数据");
  const stale = postsReducer(refreshing, { type: "loaded", gen: 1, result: { ok: false, error: "server" } });
  ok(stale === refreshing, "旧编号响应被丢弃");
  const err = postsReducer(refreshing, { type: "loaded", gen: 2, result: { ok: false, error: "server" } });
  ok(err.view.status === "error" && err.view.error === "server", "失败 → 错误态");
  const retry = postsReducer(err, { type: "request", gen: 3, showLoading: true });
  ok(retry.view.status === "loading", "重试 → 加载中");
}

console.log("错误态范围");
ok(!hidesWholePage("server"), "服务端错误只影响岗位区，时间线照常显示");
ok((["org_selection", "no_org", "forbidden", "account_disabled", "session_expired"] as const).every(hidesWholePage), "鉴权类错误收起整页");

console.log(`\n组织驾驶舱首页状态机: ${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
