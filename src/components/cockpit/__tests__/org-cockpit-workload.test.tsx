/**
 * A-4 首页工作量区块渲染（服务端静态渲染，无浏览器 / 无 DB）+ 源码静态断言
 * （openspec change org-cockpit-workload，spec cockpit/workload「首页工作量区块」）
 * 运行：npx tsx src/components/cockpit/__tests__/org-cockpit-workload.test.tsx
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_WORKLOAD_THRESHOLDS,
  TRADE_SHOW_ROW,
  UNATTRIBUTED_ROW,
  WORKLOAD_AVAILABILITY,
  WORKLOAD_ROW_ORDER,
  emptyCounts,
  localDayKeys,
  workloadRowName,
  workloadRowNav,
  type WorkloadCounts,
  type WorkloadRow,
} from "@/lib/cockpit/workload";
import type { WorkloadResponse } from "@/lib/cockpit/workload-read-model";
import { OrgCockpitView } from "../org-cockpit-view";
import { Sparkline, WorkloadPanel, WorkloadSection } from "../org-cockpit-workload";

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

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const NOW = new Date("2026-10-26T16:00:00Z");
const DAYS = localDayKeys(NOW, "America/Toronto", 14);

function counts(o: Partial<WorkloadCounts> = {}): WorkloadCounts {
  return { ...emptyCounts(), ...o };
}

function wrow(key: (typeof WORKLOAD_ROW_ORDER)[number], o: Partial<WorkloadRow> = {}): WorkloadRow {
  return {
    key,
    name: workloadRowName(key),
    nav: workloadRowNav(key),
    daily: DAYS.map(() => counts()),
    last7: counts(),
    costRecorded: false,
    signals: [],
    ...o,
  };
}

function response(o: Partial<WorkloadResponse> = {}): WorkloadResponse {
  return {
    orgId: "org-1",
    generatedAt: NOW.toISOString(),
    timezone: "America/Toronto",
    days: DAYS,
    signalWindowDays: 7,
    thresholds: { ...DEFAULT_WORKLOAD_THRESHOLDS },
    availability: WORKLOAD_AVAILABILITY,
    truncated: false,
    rows: WORKLOAD_ROW_ORDER.map((key) => {
      if (key === "inbound_sales") {
        return wrow(key, {
          daily: DAYS.map((_, i) => counts({ agentRuns: i % 3, proposed: i % 2 })),
          last7: counts({ agentRuns: 1234, automationRuns: 2016, proposed: 9, approved: 1, rejected: 4, expired: 1, cancelled: 2, guardrailBlocked: 3, cost: 0.4321, inputTokens: 9000, outputTokens: 3500 }),
          costRecorded: true,
          signals: [{ code: "high_reject_rate", message: "近 7 天驳回 4/5（80%），超过 50%" }],
        });
      }
      if (key === "tender") return wrow(key, { last7: counts({ automationRuns: 5208 }) });
      return wrow(key);
    }),
    ...o,
  };
}

const html = renderToStaticMarkup(<WorkloadPanel data={response()} onCollapse={() => {}} />);
const rowHtml = (key: string) => {
  const start = html.indexOf(`data-workload-row="${key}"`);
  const end = html.indexOf("</tr>", start);
  return start === -1 ? "" : html.slice(start, end);
};

console.log("收起 / 加载中 / 失败");
{
  const collapsed = renderToStaticMarkup(<WorkloadSection state={{ status: "collapsed" }} onExpand={() => {}} />);
  ok(collapsed.includes("查看近 14 天工作量") && !collapsed.includes("<table"), "默认收起：只有按钮，没有表格（spec 场景）");
  ok(collapsed.includes('aria-labelledby="cockpit-workload-heading"') && collapsed.includes(">工作量</h2>"), "区块有标题");
  const loading = renderToStaticMarkup(<WorkloadSection state={{ status: "loading" }} />);
  ok(loading.includes("正在汇总") && loading.includes('aria-busy="true"'), "加载中：提示 + aria-busy");
  const error = renderToStaticMarkup(<WorkloadSection state={{ status: "error" }} onRetry={() => {}} />);
  ok(error.includes("工作量加载失败") && error.includes("重试"), "加载失败：错误态 + 重试（spec 场景）");
  const ready = renderToStaticMarkup(<WorkloadSection state={{ status: "ready", data: response() }} onCollapse={() => {}} />);
  ok(ready.includes("<table") && ready.includes("收起"), "就绪：表格 + 收起");
}

console.log("表格");
{
  const sales = rowHtml("inbound_sales");
  ok(["1,234", "2,016", ">9<", ">1<", ">4<", ">3<"].every((s) => sales.includes(s)), "近 7 天合计：AI 运行 / 平台自动化 / 提出 / 批准 / 驳回 / 护栏拦截（千分位）", sales.slice(0, 600));
  ok(sales.includes("$0.43") && sales.includes("12.5k token"), "成本美元两位 + token 合计");
  ok(sales.includes("取消 2"), "次要结局（取消等）在岗位名下方");
  ok(rowHtml("tender").includes("未入账") && !rowHtml("tender").includes("$0"), "无记账 → 未入账，不显示 0 成本（spec 场景）");
  ok(rowHtml("tender").includes("5,208"), "平台自动化列显示平台级次数");
  const order = [...html.matchAll(/data-workload-row="([a-z_]+)"/g)].map((m) => m[1]);
  ok(JSON.stringify(order) === JSON.stringify(WORKLOAD_ROW_ORDER.filter((k) => k !== TRADE_SHOW_ROW && k !== UNATTRIBUTED_ROW)), "行按响应顺序；展会与未归属全为 0 时隐藏（spec 场景）", order);
  const withTrade = renderToStaticMarkup(
    <WorkloadPanel data={response({ rows: response().rows.map((r) => (r.key === TRADE_SHOW_ROW ? { ...r, last7: counts({ proposed: 1 }), daily: DAYS.map((_, i) => counts({ proposed: i === 13 ? 1 : 0 })) } : r)) })} />,
  );
  ok(withTrade.includes(`data-workload-row="${TRADE_SHOW_ROW}"`) && withTrade.includes("询盘销售 · 展会"), "展会行有数据时显示");
  ok(/<th scope="col"[^>]*>AI 运行<\/th>/.test(html) && /<th scope="row"/.test(html), "表头与行头带 scope");
}

console.log("窄区块卡片");
{
  const cardHtml = (key: string) => {
    const start = html.indexOf(`data-workload-card="${key}"`);
    return start === -1 ? "" : html.slice(start, html.indexOf("</li>", start));
  };
  const cards = [...html.matchAll(/data-workload-card="([a-z_]+)"/g)].map((m) => m[1]);
  const tableRows = [...html.matchAll(/data-workload-row="([a-z_]+)"/g)].map((m) => m[1]);
  ok(JSON.stringify(cards) === JSON.stringify(tableRows), "卡片与表格是同一组行、同一顺序");
  ok(/<ul class="[^"]*@4xl:hidden/.test(html) && /<div class="hidden overflow-x-auto @4xl:block">/.test(html) && html.includes('<div class="@container">'), "按区块宽度切换：≥ 896px 表格，更窄卡片（container query）");
  const sales = cardHtml("inbound_sales");
  ok(sales.includes('data-flagged="true"') && sales.includes("近 7 天驳回 4/5（80%），超过 50%") && sales.includes("1,234") && sales.includes("$0.43"), "卡片同样标红、给原因、显示合计与成本");
  ok(cardHtml("tender").includes("未入账") && cardHtml("tender").includes("<svg"), "卡片显示未入账与走势");
  ok(/<dl class="mt-2 grid grid-cols-\[repeat\(4,minmax\(0,1fr\)\)\]/.test(sales) && !/\bgrid-cols-4\b/.test(html), "卡片数值 4 列（任意值写法，避开 globals.css 的网格覆盖）");
}

console.log("规则命中标红");
{
  const sales = rowHtml("inbound_sales");
  ok(sales.includes('data-flagged="true"') && sales.includes("bg-danger-bg") && sales.includes("text-danger"), "命中规则的行危险色（spec 场景）");
  ok(sales.includes("近 7 天驳回 4/5（80%），超过 50%"), "显示原因文本");
  ok(!rowHtml("tender").includes('data-flagged="true"'), "未命中的行不标红");
  ok(html.includes("1 个岗位疑似无用功"), "顶部汇总命中岗位数");
  const clean = renderToStaticMarkup(<WorkloadPanel data={response({ rows: response().rows.map((r) => ({ ...r, signals: [] })) })} />);
  ok(clean.includes("暂无疑似无用功"), "无命中时提示暂无");
}

console.log("说明");
{
  ok(html.includes("改过再批：未接入") && html.includes("自动执行：不适用"), "改过再批未接入、自动执行不适用的说明（spec 场景）");
  ok(!/改过再批[^<]*\d+ 件|自动执行[^<]*\d+ 件/.test(html), "两项不出现数字");
  ok(html.includes("平台自动化是平台级运行次数") && html.includes("未入账"), "平台级与未入账说明");
  ok(html.includes("驳回率 &gt; 50%") && html.includes("已决策 ≥ 4 件才判"), "判定规则用生效阈值");
  ok(!html.includes("数据量超过上限"), "未触顶不提示");
  ok(renderToStaticMarkup(<WorkloadPanel data={response({ truncated: true })} />).includes("数据量超过上限，部分统计不完整"), "触顶提示（spec 场景）");
}

console.log("走势小图");
{
  const svg = renderToStaticMarkup(<Sparkline row={response().rows[0]} days={DAYS} />);
  const bars = (cls: string) => (svg.match(new RegExp(`class="${cls}"`, "g")) ?? []).length;
  ok(bars("fill-muted/60") === DAYS.filter((_, i) => i % 3 > 0).length && bars("fill-accent") === DAYS.filter((_, i) => i % 2 > 0).length, "两条柱带：AI 运行（灰）与提出（强调色），0 不画柱");
  ok((svg.match(/<title>/g) ?? []).length === 14 && svg.includes("10-26：AI 运行"), "每天一个悬停目标，带当天数值");
  ok(/role="img"/.test(svg) && /aria-label="询盘销售近 14 天：AI 运行 \d+ 次，提出 \d+ 件"/.test(svg), "读屏摘要");
  ok(html.includes("上：AI 运行") && html.includes("下：提出"), "图例（两条序列）");
  const empty = renderToStaticMarkup(<Sparkline row={wrow("content")} days={DAYS} />);
  ok(!empty.includes("fill-accent") && !empty.includes("fill-muted"), "全 0 只画基线");
}

console.log("页面只读与首页接入");
{
  ok(!/<form|type="submit"|批准<\/button>|驳回<\/button>|执行<\/button>|停用<\/button>/.test(html), "区块没有任何改变数据的操作（spec「首页工作量区块」）");
  const page = renderToStaticMarkup(
    <OrgCockpitView
      now={NOW}
      posts={{ status: "loading" }}
      timeline={{ status: "loading" }}
      workloadSlot={<WorkloadSection state={{ status: "collapsed" }} />}
    />,
  );
  const cards = page.indexOf("cockpit-posts-heading");
  const workload = page.indexOf("cockpit-workload-heading");
  const log = page.indexOf("cockpit-log-heading");
  ok(cards !== -1 && cards < workload && workload < log, "区块位于岗位卡片与 company.log 之间");
}

console.log("源码静态断言");
{
  const raw = read("src/components/cockpit/org-cockpit-workload.tsx");
  const src = stripComments(raw);
  const home = stripComments(read("src/components/cockpit/org-cockpit-home.tsx"));
  ok(/^"use client";/.test(raw), "区块容器是客户端组件");
  const apis = [...new Set([...src.matchAll(/["'`](\/api\/[^"'`?$]+)/g)].map((m) => m[1]))];
  ok(JSON.stringify(apis) === '["/api/cockpit/workload"]', "区块只请求工作量接口", apis);
  ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(src), "区块不发非 GET 请求");
  ok(!home.includes("/api/cockpit/workload") && /workloadSlot=\{<OrgCockpitWorkload \/>\}/.test(home), "首页容器不直接请求工作量接口，只放入区块（首屏仍两个请求，spec 场景）");
  const loadIdx = src.indexOf("const load = useCallback");
  ok(loadIdx !== -1 && !/useEffect/.test(src), "没有挂载即请求的 effect：只在点击后加载");
  const panel = src.slice(src.indexOf("export function WorkloadSection"));
  ok(!/\buse(State|Effect|Callback|Memo|Ref|Reducer)\b/.test(panel), "展示部分（WorkloadSection 及以下）无 hooks");
  ok(!/from "@\/lib\/cockpit\/(workload|workload-read-model)"/.test(src.replace(/import type[^;]+;/g, "")), "只以 import type 引用工作量模块（不把读模型打进浏览器）");
  ok(raw.includes(`"${TRADE_SHOW_ROW}"`) && raw.includes(`"${UNATTRIBUTED_ROW}"`), "隐藏行的键与 workload.ts 常量一致");
}

console.log(`\n组织驾驶舱工作量区块渲染: ${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
