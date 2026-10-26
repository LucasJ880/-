/**
 * B-6 /revenue FDE V2 启动条件区块渲染（服务端静态渲染，无浏览器 / 无 DB）+ 源码静态断言
 * （openspec change fde-v2-readiness，spec revenue-spine/fde-v2-readiness「/revenue 启动条件区块」）
 * 运行：npx tsx src/components/revenue/__tests__/v2-readiness-panel.test.tsx
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeV2Readiness, type V2ReadinessInput } from "@/lib/revenue-spine/v2-readiness";
import { V2ReadinessSection, formatReadinessShare, type ReadinessState } from "../v2-readiness-panel";

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
/** 与 renderToStaticMarkup 相同的文本转义 */
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const NOW = new Date("2026-10-26T16:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const later = new Date(NOW.getTime() + 86_400_000);

function input(over: Partial<V2ReadinessInput> = {}): V2ReadinessInput {
  return {
    now: NOW,
    firstProposalAt: daysAgo(10),
    proposals: [
      { status: "executed", expiresAt: later, field: "moq" },
      { status: "rejected", expiresAt: later, field: "moq" },
      { status: "pending", expiresAt: daysAgo(1), field: "loadingPorts" },
    ],
    proposalsTruncated: false,
    appliedFields: ["moq"],
    appliedTruncated: false,
    snapshots: [
      { followUpStep: null, pendingInternalConfirmation: ["MOQ", "生产周期与交期"] },
      { followUpStep: null, pendingInternalConfirmation: ["pricing"] },
      { followUpStep: null, pendingInternalConfirmation: ["MOQ"] },
      { followUpStep: null, pendingInternalConfirmation: [] },
      { followUpStep: 1, pendingInternalConfirmation: ["MOQ"] },
    ],
    snapshotsTruncated: false,
    knowledge: { moq: true, productionLeadTime: false, certification: false, costBasis: false, samplePolicy: true },
    minimumMarginConfigured: true,
    historicalQuotes: 7,
    productCategories: 3,
    ...over,
  };
}

const NOT_READY = computeV2Readiness(input());
const READY = computeV2Readiness(input({ firstProposalAt: daysAgo(45), knowledge: { moq: true, productionLeadTime: true, certification: false, costBasis: false, samplePolicy: true } }));
const EMPTY = computeV2Readiness(input({ firstProposalAt: null, proposals: [], appliedFields: [], snapshots: [], knowledge: { moq: false, productionLeadTime: false, certification: false, costBasis: false, samplePolicy: false }, minimumMarginConfigured: false, historicalQuotes: 0, productCategories: 0 }));

function html(state: ReadinessState, expanded = true) {
  return renderToStaticMarkup(<V2ReadinessSection expanded={expanded} state={state} onToggle={() => {}} onRetry={() => {}} />);
}

console.log("v2-readiness-panel");

console.log("\n收起 / 加载中 / 失败");
{
  const h = html({ status: "idle" }, false);
  ok(h.includes("FDE V2 启动条件（只读）"), "收起态有标题");
  ok(h.includes("查看启动条件") && h.includes('aria-expanded="false"') && h.includes('aria-controls="revenue-v2-readiness-body"'), "收起态按钮带 aria-expanded / aria-controls");
  ok(!h.includes('id="revenue-v2-readiness-body"') && !h.includes("已满足") && !h.includes("未满足"), "收起态无内容区");
  const r = html({ status: "ready", data: NOT_READY }, false);
  ok(!r.includes("未满足") && !r.includes("首封草稿"), "已加载但收起时不渲染内容（数据保留在容器里）");
}
{
  const h = html({ status: "loading" });
  ok(h.includes('aria-busy="true"') && h.includes('role="status"') && h.includes("正在核对启动条件"), "加载中：aria-busy + 状态文案");
  ok(h.includes('aria-expanded="true"') && h.includes("收起"), "展开态按钮为收起");
}
{
  const h = html({ status: "error" });
  ok(h.includes("启动条件加载失败") && h.includes("重试"), "失败：错误文案 + 重试按钮");
}

console.log("\n就绪态");
{
  const h = html({ status: "ready", data: NOT_READY });
  ok(h.includes("未达到") && h.includes(esc(NOT_READY.verdict.summary)), "结论：未达到 + 列出未满足条件的说明");
  for (const c of NOT_READY.conditions) ok(h.includes(esc(c.label)) && h.includes(esc(c.detail)), `条件「${c.label}」的标签与依据都渲染`, c.detail);
  ok(
    h.includes('data-condition="fact_proposals_running" data-status="not_met"') &&
      h.includes('data-condition="moq_available" data-status="met"') &&
      h.includes('data-condition="production_lead_time_available" data-status="not_met"') &&
      h.includes('data-condition="category_level_facts" data-status="not_measurable"'),
    "四条条件按状态标记",
  );
  ok(h.includes("已满足") && h.includes("未满足") && h.includes("无法度量"), "状态有文字，不只靠颜色");
  ok(h.includes("商务事实目前是组织级、不分类目"), "条件 4 原样显示组织级说明");
  ok(h.includes("10 天前") && h.includes("新建</dt><dd class=\"tabular-nums\">3 张"), "提案依据：首张天数与新建张数");
  ok(h.includes("已过期</dt><dd class=\"tabular-nums\">1"), "提案依据：过期张数");
  ok(h.includes("起订量") && h.includes("装运港") && h.includes("目录链接"), "按字段分列六个字段");
  ok(h.includes("经提案写入过 1 次") && h.includes("大货周期来源</dt><dd class=\"tabular-nums\">未配置"), "来源：提案 / 未配置");
  ok(h.includes("首封草稿</dt><dd class=\"tabular-nums\">4 封") && h.includes("2 封 · 50.0%") && h.includes("1 封 · 25.0%"), "首封草稿：封数与占比（跟进不计）");
  ok(h.includes("认证清单</dt><dd class=\"tabular-nums\">未接入") && h.includes("最低毛利</dt><dd class=\"tabular-nums\">已配置") && h.includes("历史报价</dt><dd class=\"tabular-nums\">7 条"), "V2 其余数据源：只显示可用 / 已配置与条数");
  ok(!h.includes("读取上限") && !h.includes("只看最近"), "未截断时不显示截断提示");
}
{
  const h = html({ status: "ready", data: READY });
  ok(h.includes("已达到") && h.includes("已达到任务书建议的启动条件（组织级口径）") && h.includes("需人工判断"), "全部可度量条件满足：已达到 + 条件 4 需人工判断");
}
{
  const h = html({ status: "ready", data: EMPTY });
  ok(h.includes("尚无事实提案") && h.includes("首张提案</dt><dd class=\"tabular-nums\">尚无"), "没有提案：尚无");
  ok(h.includes("0 封 · —"), "没有首封草稿：占比显示 —");
  ok(formatReadinessShare(null) === "—" && formatReadinessShare(0.75) === "75.0%", "占比格式");
}
{
  const truncated = computeV2Readiness(input({ snapshotsTruncated: true, proposalsTruncated: true, appliedTruncated: true }));
  const h = html({ status: "ready", data: truncated });
  ok(h.includes("只看最近 300 封草稿") && h.includes("近 30 天事实提案超过读取上限") && h.includes("写入记录超过读取上限"), "截断提示");
}

console.log("\n源码");
{
  const panel = strip(read("src/components/revenue/v2-readiness-panel.tsx"));
  ok(/const res = await apiFetch\(READINESS_URL,/.test(panel) && panel.includes('const READINESS_URL = "/api/revenue/v2-readiness";'), "只请求 GET /api/revenue/v2-readiness");
  ok(!/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(panel) && !/clipboard|localStorage/.test(panel), "区块不写任何数据");
  ok(/if \(state\.status === "idle" \|\| state\.status === "error"\) void load\(\);/.test(panel), "只在没加载过或失败时请求（再展开不重复请求）");
  ok(!/from "@\/lib\/(db|revenue-spine\/(v2-readiness-read-model|factory-knowledge|policy))"/.test(panel), "客户端区块不 import 服务端模块");
  const page = strip(read("src/app/(main)/revenue/page.tsx"));
  const cal = page.indexOf("<ScoreCalibrationPanel />");
  const v2 = page.indexOf("<V2ReadinessPanel />");
  ok(cal > 0 && v2 > cal, "/revenue 在评分校准区块下方挂载", { cal, v2 });
}

console.log(`\nv2-readiness-panel: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
