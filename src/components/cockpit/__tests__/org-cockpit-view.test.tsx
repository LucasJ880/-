/**
 * A-3 岗位视图渲染（服务端静态渲染，无浏览器 / 无 DB）+ 首页与容器源码静态断言
 * （openspec change org-cockpit-home，spec cockpit/home-view）
 * 运行：npx tsx src/components/cockpit/__tests__/org-cockpit-view.test.tsx
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PostCardView, PostsCockpitResponse } from "@/lib/cockpit/posts-read-model";
import { POST_REGISTRY } from "@/lib/cockpit/posts";
import type { TimelineEntry } from "@/lib/cockpit/timeline";
import { COCKPIT_REDACTED } from "@/lib/cockpit/waiting";
import { OrgCockpitView, type PostsState, type TimelineState } from "../org-cockpit-view";

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

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const NOW = new Date("2026-10-26T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function post(key: string, o: Partial<PostCardView> = {}): PostCardView {
  const def = POST_REGISTRY.find((p) => p.key === key)!;
  return {
    key: def.key,
    name: def.name,
    nav: def.nav,
    health: "on_time",
    heartbeat: { automationKey: def.automationKeys[0], status: "succeeded", startedAt: minsAgo(5), completedAt: minsAgo(4) },
    nextDueAt: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
    automations: def.automationKeys.map((k) => ({ key: k, name: `自动化 ${k}`, health: "on_time", lastRun: null, nextDueAt: null, maxGapMinutes: 60 })),
    pendingApprovals: 0,
    needsYou: 0,
    actions7d: { automationRuns: 10, agentRuns: 2 },
    kpi: { status: "unavailable", reason: "未接入" },
    ...o,
  } as PostCardView;
}

function fixture(o: Partial<PostsCockpitResponse> = {}): PostsCockpitResponse {
  return {
    orgId: "org-1",
    generatedAt: minsAgo(1),
    timezone: "America/Toronto",
    heartbeatScope: "platform",
    quotaHit: false,
    waitingForYou: {
      total: 5,
      truncated: false,
      unattributed: 1,
      href: "/capabilities/approvals",
      items: [
        { kind: "pending_action", id: "pa1", title: "回复 ACME 询盘", post: "inbound_sales", at: minsAgo(30), href: "/capabilities/approvals" },
        { kind: "pending_action", id: "pa2", title: COCKPIT_REDACTED, post: "inbound_sales", at: minsAgo(60), href: "/capabilities/approvals" },
        { kind: "workforce_job", id: "job-2", title: "需要澄清", post: "tender", at: minsAgo(90), href: "/workforce/job-2" },
        { kind: "pending_action", id: "pa3", title: "日历提醒", post: null, at: minsAgo(120), href: "/capabilities/approvals" },
      ],
    },
    posts: [
      post("inbound_sales", {
        pendingApprovals: 2,
        needsYou: 1,
        kpi: {
          status: "ok",
          window: { kind: "rolling_days", days: 30 },
          metrics: [
            { label: "首响中位（分钟）", format: "minutes", value: 42 },
            { label: "24 小时回复率", format: "rate", value: 0.8 },
            { label: "护栏拦截", format: "count", value: 3 },
          ],
        },
      }),
      post("tender", {
        health: "failed",
        automations: [
          { key: "tender-watch", name: "招标公告盯梢", health: "failed", lastRun: null, nextDueAt: null, maxGapMinutes: 60 },
          { key: "tender-auto-analysis", name: "招标自动分析队列", health: "late", lastRun: null, nextDueAt: null, maxGapMinutes: 2 },
          { key: "tender-rfq-inbound", name: "询价回信入站（报价自动入表）", health: "on_time", lastRun: null, nextDueAt: null, maxGapMinutes: 10 },
        ],
        kpi: {
          status: "ok",
          window: { kind: "rolling_days", days: 365 },
          metrics: [
            { label: "已投标", format: "count", value: 12 },
            { label: "中标", format: "count", value: 3 },
            { label: "中标率", format: "percentage_string", value: "25.0" },
          ],
        },
      }),
      post("marketing", { health: "not_configured", kpi: { status: "error" } }),
      post("service", { kpi: { status: "unavailable", reason: "客服线没有只读读函数" } }),
      post("projects", { health: "never_ran", heartbeat: null }),
      post("ops_knowledge", { health: "quota_hit" }),
      post("content", { health: "n/a", kpi: { status: "disabled", reason: "未开启" } }),
    ],
    ...o,
  };
}

const entries: TimelineEntry[] = [
  { id: "event:e1", at: minsAgo(10), post: "tender", actor: "ai", actorName: null, kind: "agent_event", summary: "作业等待人工", href: "/workforce/run-1" },
  { id: "audit:a1", at: minsAgo(20), post: "inbound_sales", actor: "u9", actorName: "Ann", kind: "audit", summary: "PENDING_ACTION_APPROVED · pending_action", href: null },
  { id: "run:r1", at: minsAgo(30), post: "ops_knowledge", actor: "system", actorName: null, kind: "automation_run", summary: "发布漂移检查（代码 vs 生产库迁移）：失败", href: null },
  { id: "audit:a2", at: minsAgo(40), post: null, actor: "u9", actorName: null, kind: "audit", summary: COCKPIT_REDACTED, href: null },
];

const render = (posts: PostsState, timeline: TimelineState, extra: Partial<React.ComponentProps<typeof OrgCockpitView>> = {}) =>
  renderToStaticMarkup(<OrgCockpitView now={NOW} posts={posts} timeline={timeline} onRefresh={() => {}} onRetry={() => {}} onRetryTimeline={() => {}} onLoadMore={() => {}} {...extra} />);

// ── 完整渲染 ──────────────────────────────────────────────────
console.log("完整渲染");
const html = render({ status: "ready", data: fixture() }, { status: "ready", items: entries, nextCursor: "c1" });
{
  const order = [...html.matchAll(/data-post="([a-z_]+)"/g)].map((m) => m[1]);
  ok(JSON.stringify(order) === JSON.stringify(POST_REGISTRY.map((p) => p.key)), "七张岗位卡片按接口顺序", order);
  for (const p of POST_REGISTRY) {
    const anchor = html.match(new RegExp(`<a[^>]*data-post="${p.key}"[^>]*>`))?.[0] ?? "";
    ok(anchor.includes(`href="${p.nav}"`), `${p.key} 卡片链接到 ${p.nav}`, anchor);
  }
  ok(html.includes("心跳与自动化次数为平台级"), "页头注明心跳与自动化次数为平台级");
  const shuffled = fixture();
  shuffled.posts = [...shuffled.posts].reverse();
  const shuffledOrder = [...render({ status: "ready", data: shuffled }, { status: "loading" }).matchAll(/data-post="([a-z_]+)"/g)].map((m) => m[1]);
  ok(JSON.stringify(shuffledOrder) === JSON.stringify(shuffled.posts.map((p) => p.key)), "卡片顺序跟随接口返回，组件不自行排序", shuffledOrder);
  ok(/<section[^>]*aria-labelledby="cockpit-posts-heading"[^>]*class="@container/.test(html) && html.includes("@2xl:grid-cols-2") && html.includes("@4xl:grid-cols-[repeat(3,minmax(0,1fr))]"), "卡片列数按内容区宽度（container query）");
  ok(/<h2 id="cockpit-posts-heading" class="sr-only">岗位<\/h2>/.test(html), "岗位区有读屏标题");
  ok(html.includes("时区 America/Toronto") && html.includes("更新于 1 分钟前"), "页头显示时区与更新时间");
}
console.log("等你 N 件横幅");
{
  ok(/data-waiting-count=""[^>]*>5</.test(html), "横幅显示总数 5");
  ok(html.includes('href="/capabilities/approvals"') && html.includes("去审批"), "横幅链接到 /capabilities/approvals");
  ok(html.includes("回复 ACME 询盘") && html.includes('href="/workforce/job-2"'), "列出条目，作业条目跳自己的页面");
  ok(html.includes("30 分钟前") && html.includes("询盘销售"), "条目带岗位名与时间");
  ok(html.includes("其中 1 件暂无法归到具体岗位"), "未归属条数提示");
  ok(html.includes(COCKPIT_REDACTED), "脱敏提示原样显示");
  const truncated = render({ status: "ready", data: fixture({ waitingForYou: { ...fixture().waitingForYou, total: 100, truncated: true } }) }, { status: "ready", items: [], nextCursor: null });
  ok(/data-waiting-count=""[^>]*>100\+</.test(truncated), "被截断 → 显示 100+");
  const none = render({ status: "ready", data: fixture({ waitingForYou: { total: 0, truncated: false, unattributed: 0, items: [], href: "/capabilities/approvals" } }) }, { status: "ready", items: [], nextCursor: null });
  ok(none.includes("暂无待你处理的事项") && /data-waiting-count=""[^>]*>0</.test(none), "总数为 0 → 暂无待你处理的事项");
}
console.log("岗位卡片");
{
  const card = (key: string) => {
    const start = html.indexOf(`data-post="${key}"`);
    const next = html.indexOf("data-post=", start + 10);
    return html.slice(start, next === -1 ? html.indexOf('aria-labelledby="cockpit-log-heading"') : next);
  };
  const tender = card("tender");
  ok(tender.includes("失败") && tender.includes("bg-danger-bg text-danger"), "投标失败 → 危险色『失败』");
  ok(tender.includes(">12<") && tender.includes(">3<") && tender.includes(">25.0%<") && tender.includes("近 365 天"), "投标 KPI 12 / 3 / 25.0% 与口径");
  ok(tender.includes("招标公告盯梢") && tender.includes("招标自动分析队列") && !tender.includes("询价回信入站"), "列出异常自动化（失败 / 迟到），正常的不列");
  const sales = card("inbound_sales");
  ok(sales.includes("正常") && sales.includes("bg-success-bg text-success"), "正常 → 成功色");
  ok(sales.includes(">42 分钟<") && sales.includes(">80%<") && sales.includes("近 30 天"), "询盘 KPI 格式化");
  ok(/<dl class="grid grid-cols-\[repeat\(3,minmax\(0,1fr\)\)\]/.test(sales) && !/<dl class="[^"]*\bgrid-cols-3\b/.test(html), "KPI 行不用 grid-cols-3（globals.css 在 iPad 宽度把它强制改成两列）");
  ok(sales.includes("待审批 2") && sales.includes("需要你 1"), "待审批 / 需要你");
  ok(sales.includes("7 天 AI 2 次 · 平台自动化 10 次"), "近 7 天 AI 次数与平台自动化次数分开显示，不相加");
  const big = render({ status: "ready", data: fixture({ posts: [post("inbound_sales", { pendingApprovals: 1200, actions7d: { automationRuns: 12345, agentRuns: 2048 } })] }) }, { status: "loading" });
  ok(big.includes("待审批 1,200") && big.includes("AI 2,048 次") && big.includes("平台自动化 12,345 次"), "计数带千分位");
  ok(/<dt class="line-clamp-2[^"]*" title="首响中位（分钟）">/.test(sales), "KPI 标签最多两行，悬停看全称");
  ok(sales.includes("心跳 5 分钟前") && sales.includes("下次 10 分钟后"), "心跳相对时间与下次应跑");
  ok(card("marketing").includes('data-kpi-status="error"') && card("marketing").includes("KPI 暂不可用"), "KPI error → 暂不可用");
  ok(card("service").includes("KPI 未接入"), "KPI unavailable → 未接入");
  ok(card("content").includes("KPI 未开启"), "KPI disabled → 未开启");
  const serviceText = card("service").replace(/<[^>]+>/g, " ");
  ok(!/\d/.test(serviceText.split("KPI")[1]?.split("待审批")[0] ?? "x"), "KPI 不可用时 KPI 区不显示数字", serviceText);
  ok(card("projects").includes("暂无运行记录") && card("projects").includes("未运行过") && card("projects").includes("bg-warning-bg"), "无心跳 → 暂无运行记录；未运行过 → 警示色");
  ok(card("ops_knowledge").includes("配额已满") && card("ops_knowledge").includes("bg-danger-bg"), "配额已满 → 危险色");
  ok(card("marketing").includes("未配置") && card("content").includes("按需"), "未配置 / 按需标签");
}
console.log("配额提示");
{
  ok(!html.includes("今日 AI 运行配额已满"), "未命中配额时不显示提示");
  const quota = render({ status: "ready", data: fixture({ quotaHit: true }) }, { status: "ready", items: [], nextCursor: null });
  ok(quota.includes("今日 AI 运行配额已满"), "quotaHit → 显示配额已满提示");
}
console.log("company.log");
{
  ok(html.includes('href="/workforce/run-1"') && html.includes("作业等待人工"), "有 href 的条目可点击");
  ok(html.includes(">AI<") && html.includes(">系统<") && html.includes(">Ann<") && html.includes(">成员<"), "操作者：AI / 系统 / 用户名 / 成员");
  ok(html.includes(">投标<") && html.includes(">未归属<"), "条目岗位名，空为未归属");
  ok(html.includes("加载更多"), "有 nextCursor → 加载更多");
  const empty = render({ status: "ready", data: fixture() }, { status: "ready", items: [], nextCursor: null });
  ok(empty.includes("最近 7 天暂无记录") && !empty.includes("加载更多"), "无条目 → 最近 7 天暂无记录");
  const logError = render({ status: "ready", data: fixture() }, { status: "error", error: "server" });
  ok(logError.includes("时间线加载失败") && logError.includes("data-post="), "时间线失败不影响岗位卡片");
  const logErrorNoRetry = render({ status: "ready", data: fixture() }, { status: "error", error: "server" }, { onRetryTimeline: undefined });
  ok(logError.includes("时间线加载失败</span><button") && logErrorNoRetry.includes("时间线加载失败</span></div>"), "时间线重试走独立回调（不传则不显示按钮）");
  const moreFailed = render({ status: "ready", data: fixture() }, { status: "ready", items: entries, nextCursor: "c1", loadMoreFailed: true });
  ok(moreFailed.includes("加载失败，点此重试") && moreFailed.includes("作业等待人工"), "加载更多失败 → 保留已加载条目，按钮变为重试");
}
console.log("空态与错误态");
{
  const selection = render({ status: "error", error: "org_selection" }, { status: "error", error: "org_selection" });
  ok(selection.includes("请先选择工作组织") && !selection.includes("data-post="), "需要选择组织 → 提示且不显示卡片");
  const forbidden = render({ status: "error", error: "forbidden" }, { status: "error", error: "forbidden" });
  ok(forbidden.includes("暂无权限查看岗位视图") && !forbidden.includes("重试"), "无权限 → 提示，不给重试");
  const noOrg = render({ status: "error", error: "no_org" }, { status: "error", error: "no_org" });
  ok(noOrg.includes("你还没有加入任何组织") && !noOrg.includes("重试"), "无组织 → 提示，不给重试");
  const expired = render({ status: "error", error: "session_expired" }, { status: "error", error: "session_expired" });
  ok(expired.includes("登录已过期") && expired.includes('href="/login?next=%2F"'), "登录过期 → 重新登录链接");
  const server = render({ status: "error", error: "server" }, { status: "ready", items: entries, nextCursor: null });
  ok(server.includes("岗位视图加载失败") && server.includes("重试") && !server.includes("data-post="), "服务端错误 → 错误态 + 重试");
  ok(server.includes("cockpit-log-heading") && server.includes("作业等待人工"), "岗位总览服务端错误不影响已加载的时间线");
  ok(!selection.includes("cockpit-log-heading") && !forbidden.includes("cockpit-log-heading"), "鉴权类错误收起整页（两个接口同一套鉴权）");
  const disabled = render({ status: "error", error: "account_disabled" }, { status: "error", error: "account_disabled" });
  ok(disabled.includes("账号已停用") && !disabled.includes("只对组织管理员开放"), "账号停用 → 专门提示，不误导为管理员权限问题");
  const logAuth = render({ status: "ready", data: fixture() }, { status: "error", error: "session_expired" });
  ok(logAuth.includes("时间线：登录已过期") && !logAuth.includes("时间线加载失败</span><button"), "时间线鉴权类错误：显示原因，不给无效的重试");
  const loading = render({ status: "loading" }, { status: "loading" });
  ok(loading.includes("animate-pulse") && !loading.includes("data-post=") && (loading.match(/aria-busy="true"/g) ?? []).length === 2, "加载中 → 骨架屏，两块区域标 aria-busy");
}
console.log("页面只读");
{
  ok(!/<form|type="submit"|批准|驳回|执行|关停/.test(html), "没有表单提交，没有批准 / 驳回 / 执行 / 关停");
  ok(!/毛利|估值|最终报价|winningBidPrice|中标金额/.test(html.replaceAll(COCKPIT_REDACTED, "")), "除脱敏提示外不出现毛利 / 估值 / 报价字样");
}

// ── 源码静态断言 ──────────────────────────────────────────────
console.log("首页与容器源码");
{
  const page = stripComments(read("src/app/(main)/page.tsx"));
  ok(/resolveWorkspaceContextFromCookies\(\)/.test(page) && /redirect\("\/login"\)/.test(page), "首页保留登录检查");
  ok(/resolveHomeRedirect\(session\.ctx\)/.test(page) && /if \(dest\) redirect\(dest\)/.test(page), "首页保留非管理层重定向");
  ok(!page.includes("ManagementDashboardClient") && /<OrgCockpitHome \/>/.test(page), "首页渲染 OrgCockpitHome，不再引用旧仪表盘");
  const home = stripComments(read("src/components/cockpit/org-cockpit-home.tsx"));
  const apis = [...new Set([...home.matchAll(/["'`](\/api\/[^"'`?$]+)/g)].map((m) => m[1]))].sort();
  ok(JSON.stringify(apis) === '["/api/cockpit/posts","/api/cockpit/timeline"]', "容器只调用两个接口", apis);
  ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(home), "容器不发非 GET 请求");
  ok(/Promise\.all\(\[loadPosts\(showLoading\), loadTimeline\(showLoading\)\]\)/.test(home) && /getJson<PostsCockpitResponse>\(POSTS_URL\)/.test(home) && /getJson<CompanyLogResponse>\(TIMELINE_URL\)/.test(home), "首屏两个接口并发请求，各自独立");
  ok(/useReducer\(postsReducer, INITIAL_POSTS\)/.test(home) && /useReducer\(timelineReducer, INITIAL_TIMELINE\)/.test(home), "状态转移走 home-state 的纯 reducer（交错顺序见 home-state.test.ts）");
  ok(/dispatchTimeline\(\{ type: "more_loaded", cursor, result \}\)/.test(home) && /dispatchTimeline\(\{ type: "loaded", gen, result \}\)/.test(home), "加载更多与整页响应都带上请求时的游标 / 编号");
  ok(/if \(gen === loadGen\.current\) setRefreshing\(false\)/.test(home), "只有最近一次刷新完成才结束刷新状态");
  ok(/onRetry=\{\(\) => void loadPosts\(true\)\}/.test(home) && /onRetryTimeline=\{\(\) => void loadTimeline\(true\)\}/.test(home), "岗位总览与时间线各自重试");
  ok(/res\.json\(\)\.catch\(/.test(home) && /errorKindFrom\(res\.status, body\)/.test(home), "JSON 解析失败与错误码各自兜底");
  ok(/^"use client";/.test(read("src/components/cockpit/org-cockpit-home.tsx")), "容器是客户端组件");
  const view = stripComments(read("src/components/cockpit/org-cockpit-view.tsx"));
  ok(!/\buse(State|Effect|Callback|Memo|Ref|SyncExternalStore)\b/.test(view), "展示组件无 hooks");
  for (const [name, src] of [["容器", home], ["展示组件", view]] as const) {
    ok(!/from "@\/lib\/cockpit\/(posts-read-model|schedule|timeline|waiting)"/.test(src.replace(/import type[^;]+;/g, "")), `${name}：只以 import type 引用读模型 / 调度（不把数据库代码打进浏览器）`);
    ok(!/from "@\/lib\/db"/.test(src), `${name}：不引用数据库`);
  }
}

console.log(`\n组织驾驶舱岗位视图渲染: ${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
