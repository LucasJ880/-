/**
 * B-4 /revenue 评分校准区块渲染（服务端静态渲染，无浏览器 / 无 DB）+ 源码静态断言
 * （openspec change fde-score-calibration，spec revenue-spine/score-calibration「/revenue 评分校准区块」）
 * 运行：npx tsx src/components/revenue/__tests__/score-calibration-panel.test.tsx
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_REVENUE_SPINE_POLICY } from "@/lib/revenue-spine/policy";
import {
  CALIBRATION_DIMENSIONS,
  computeScoreCalibration,
  type CalibrationDimensionKey,
  type CalibrationRow,
  type ScoreCalibrationReport,
} from "@/lib/revenue-spine/score-calibration";
import { ScoreCalibrationSection, formatLift, formatShare, type CalibrationState, type CopyState } from "../score-calibration-panel";

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
const W = DEFAULT_REVENUE_SPINE_POLICY.scoring.weights;

function dims(s: Partial<Record<CalibrationDimensionKey, number>>) {
  return CALIBRATION_DIMENSIONS.map(({ key, label }) => ({ key, label, score: s[key] ?? 0, max: W[key], reason: "x" }));
}
const times = <T,>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));
const row = (stage: string, s: Partial<Record<CalibrationDimensionKey, number>>, grade = "HOT", quoteSent = false): CalibrationRow => ({
  stage,
  grade,
  dimensions: dims(s),
  quoteSent,
  onboardingTest: false,
});

// 与 score-calibration.test.ts 的固定样本同构：建议 21 / 21 / 27 / 21 / 10 / 0
const A = { productFit: 25, commercialPotential: 20, buyerQuality: 14, intent: 15, completeness: 10, strategicValue: 0 };
const B = { productFit: 5, commercialPotential: 8, buyerQuality: 10, intent: 3, completeness: 10, strategicValue: 0 };
const C = { productFit: 5, commercialPotential: 8, buyerQuality: 6, intent: 3, completeness: 10, strategicValue: 10 };
const OK_ROWS = [
  ...times(10, () => row("won", A, "HOT")),
  ...times(2, () => row("won", B, "MEDIUM")),
  ...times(15, (i) => row("lost", C, "LOW", i < 5)),
  ...times(5, () => row("lost", A, "HIGH", true)),
];
const report = (rows: CalibrationRow[], truncated = false): ScoreCalibrationReport =>
  computeScoreCalibration(rows, { weights: W, windowDays: 90, now: NOW, truncated });

const OK = report(OK_ROWS);
const INSUFFICIENT = report(OK_ROWS.slice(0, 29));
const NO_SIGNAL = report([...times(15, () => row("won", {})), ...times(15, () => row("lost", { ...A, completeness: 10 }))]);

function html(state: CalibrationState, expanded = true, copyState: CopyState = "idle") {
  return renderToStaticMarkup(
    <ScoreCalibrationSection expanded={expanded} state={state} copyState={copyState} onToggle={() => {}} onRetry={() => {}} onCopy={() => {}} />,
  );
}

console.log("\n前提");
ok(OK.status === "ok" && INSUFFICIENT.status === "insufficient" && INSUFFICIENT.sample.decided === 29 && NO_SIGNAL.status === "no_signal", "三种状态的样本构造正确", [
  OK.status,
  INSUFFICIENT.status,
  INSUFFICIENT.sample.decided,
  NO_SIGNAL.status,
]);

console.log("\n收起 / 加载中 / 失败");
{
  const h = html({ status: "idle" }, false);
  ok(h.includes("评分校准（只报不改）"), "收起态有标题");
  ok(h.includes("查看近 90 天校准") && h.includes('aria-expanded="false"') && h.includes('aria-controls="revenue-score-calibration-body"'), "收起态按钮带 aria-expanded / aria-controls");
  ok(!h.includes('id="revenue-score-calibration-body"') && !h.includes("命中率") && !h.includes("Product Fit"), "收起态不含统计");
  const r = html({ status: "ready", data: OK }, false);
  ok(!r.includes("Product Fit"), "已加载但收起时不渲染统计（数据保留在容器里）");
}
{
  const h = html({ status: "loading" });
  ok(h.includes('aria-busy="true"') && h.includes('role="status"') && h.includes("正在对账近 90 天的评分与结局"), "加载中：aria-busy + 状态文案");
  ok(h.includes('aria-expanded="true"') && h.includes("收起"), "展开态按钮为收起");
}
{
  const h = html({ status: "error" });
  ok(h.includes("评分校准加载失败") && h.includes("重试"), "失败：错误文案 + 重试按钮");
}

console.log("\n样本不足 / 无信号");
{
  const h = html({ status: "ready", data: INSUFFICIENT });
  ok(h.includes("样本不足") && h.includes("已定 29 / 30"), "样本不足：显示「样本不足」与「已定 29 / 30」");
  ok(!h.includes("复制为 policy 片段") && !h.includes("建议权重</th>") && !h.includes("<pre"), "样本不足：无建议列、无复制按钮、无片段");
  ok(CALIBRATION_DIMENSIONS.every((d) => h.includes(d.label)), "样本不足：六维统计照常显示");
}
{
  const h = html({ status: "ready", data: NO_SIGNAL });
  ok(h.includes("无信号") && h.includes("区分度都不为正"), "无信号：显示原因");
  ok(!h.includes("复制为 policy 片段") && !h.includes("建议权重</th>"), "无信号：无建议列、无复制按钮");
}

console.log("\n正常态");
{
  const h = html({ status: "ready", data: OK });
  ok(CALIBRATION_DIMENSIONS.every((d) => h.includes(d.label)), "六维都在");
  ok(h.includes("建议权重</th>") && h.includes("复制为 policy 片段"), "有建议列与复制按钮");
  ok(h.includes("仅供参考") && h.includes("人工判断后再发布"), "提示建议仅供参考");
  ok(h.includes(">27<") && h.includes("+7") && h.includes("−4") && h.includes("−10") && h.includes("不变"), "建议值与相对现有权重的变化（27 / +7 / −4 / −10 / 不变）");
  ok(h.includes("&quot;scoring&quot;") && h.includes("&quot;buyerQuality&quot;: 27"), "片段显示在只读 <pre> 里");
  ok(h.includes("近 90 天首次评分") && h.includes("32 个") && h.includes("赢 12 / 输 20") && h.includes("37.5%"), "样本计数与总赢单率");
  ok(h.includes("入驻测试 0 · 不合格 0"), "排除计数");
  ok(h.includes("+54.9 个百分点") && h.includes("−70.6 个百分点") && h.includes("无法评估"), "区分度带符号；完整度无法评估");
  ok(h.includes("25 / 32"), "命中数 / 已定数");
  ok(["HOT", "HIGH", "MEDIUM", "LOW"].every((g) => h.includes(`>${g}</th>`)) && h.includes("按首次评分等级"), "等级表四级");
  ok(h.includes("—"), "空比率（Product Fit 中桶无样本）显示 —");
  ok(h.includes("overflow-x-auto") && h.includes("min-w-[720px]"), "表格可横向滑动，不撑破页面");
  ok(!h.includes("USD") && !h.includes("$"), "不显示金额");
}
{
  ok(html({ status: "ready", data: OK }, true, "copied").includes("已复制到剪贴板"), "复制成功提示");
  ok(html({ status: "ready", data: OK }, true, "failed").includes("复制失败，请手动选中下方文本"), "复制失败提示");
}
{
  const h = html({ status: "ready", data: report(OK_ROWS, true) });
  ok(h.includes("只统计了最早的 5000 条"), "截断提示");
}

console.log("\n格式");
ok(formatShare(null) === "—" && formatShare(0.375) === "37.5%" && formatShare(1) === "100.0%" && formatShare(0) === "0.0%", "formatShare");
ok(formatLift(null) === "无法评估" && formatLift(0.5) === "+50.0 个百分点" && formatLift(-0.25) === "−25.0 个百分点" && formatLift(0) === "0.0 个百分点" && formatLift(-0.00001) === "0.0 个百分点", "formatLift");

console.log("\n源码静态断言");
{
  const panel = stripComments(read("src/components/revenue/score-calibration-panel.tsx"));
  ok(!/\buseEffect\b/.test(panel), "区块没有 useEffect：不会在打开 /revenue 时自动请求");
  ok(/if \(state\.status === "idle" \|\| state\.status === "error"\) void load\(\);/.test(panel), "再展开只在未加载或失败时请求");
  ok((panel.match(/void load\(\)/g) ?? []).length === 2, "load 只由展开与重试触发", panel.match(/void load\(\)/g));
  ok(/navigator\.clipboard\.writeText\(calibrationSnippetText\(state\.data\.policySnippet\)\)/.test(panel), "复制按钮只写剪贴板");
  ok(panel.includes('"/api/revenue/score-calibration"') && !/method:/.test(panel), "只发 GET 请求校准接口");
  const page = stripComments(read("src/app/(main)/revenue/page.tsx"));
  ok(!page.includes("/api/revenue/score-calibration"), "/revenue 页本身不请求校准接口（首屏请求不变）");
  const reorder = page.indexOf("Reorder Opportunity");
  const mount = page.indexOf("<ScoreCalibrationPanel />");
  ok(reorder > 0 && mount > reorder, "区块挂在队列网格之后", { reorder, mount });
}

console.log(`\nscore-calibration-panel: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
