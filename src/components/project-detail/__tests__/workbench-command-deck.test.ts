/**
 * 工作台指挥台重构（纯平面，零 DB / 零浏览器）
 *
 * 诊断→方案（2026-08-18 用户批准）：14+ 卡瀑布、AI 简报泛文本无硬字段、
 * 情报摘要读 BidToGo 遗留空壳、项目摘要必须跳转 → 指挥台三卡
 * （关键信息条 / 项目摘要内联 / 情报摘要真数据）+ 泛文本折叠 + 排序重整。
 *
 * WB-*  组合与数据契约探针；反例守卫：空壳卡与假数据不得回潮。
 *
 * 运行：npx tsx src/components/project-detail/__tests__/workbench-command-deck.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

console.log("工作台指挥台重构");

const tab = read("src/components/project-detail/tabs/workbench-tab.tsx");
const deck = read("src/components/tender/workbench-command-deck.tsx");
const api = read("src/app/api/projects/[id]/workbench-summary/route.ts");

ok(
  tab.includes("WorkbenchCommandDeck") && !tab.includes("IntelSummaryCard"),
  "WB-01: 指挥台挂载；BidToGo 空壳情报卡退役",
);
ok(
  tab.includes("<details") &&
    tab.includes("ProjectAiSummaryCard") &&
    tab.includes("ProjectProgressSummary"),
  "WB-02: AI 简报泛文本默认折叠（内容不删，屏幕还给硬字段）",
);
ok(
  tab.indexOf("NeedsYouCard pendingActions") < tab.indexOf("TenderBenchmarkCard projectId"),
  "WB-03: 待你处理提到对标卡之前（排序重整）",
);

const FACTS = [
  "采购方", "招标编号", "截止", "预估金额", "分析状态",
  "要求（强制）", "风险", "澄清问题", "外部情报", "投标结果",
];
ok(
  FACTS.every((f) => deck.includes(`label="${f}"`)),
  "WB-04: 关键信息条十项硬字段齐备（零跳转回答十个关键问题）",
);
ok(
  deck.includes("/workbench-summary") &&
    (deck.match(/apiJson</g) ?? []).length === 1,
  "WB-05: 单次聚合请求供给三卡（不做 N 次瀑布请求）",
);
ok(
  deck.includes('value ?? "—"') || deck.includes("value ?? “") || deck.includes("{value ?? "),
  "WB-06: 缺数据显示 —（诚实空态）",
);
ok(
  !deck.includes("project.intelligence"),
  "WB-07（反例守卫）: 指挥台不读 BidToGo 遗留 intelligence 字段",
);
ok(
  deck.includes("bidStrategyAuto") === false && deck.includes("strategy") && deck.includes("keyPoints"),
  "WB-08: 情报摘要渲染 AI 策略草案（经聚合端点，不直读房间 JSON）",
);
ok(
  deck.includes("stale") && deck.includes("摘要可能过期"),
  "WB-09: 项目摘要沿用 30 秒看懂 stale 语义（文件更新如实提示）",
);

ok(
  api.includes("requireProjectReadAccess") &&
    api.includes("getExecutiveBrief") &&
    api.includes("EXTERNAL_INTEL_STATUS_KEY"),
  "WB-10: 聚合端点=读权限门 + 复用 30 秒看懂投影 + 情报显式状态（单一事实源）",
);
ok(
  api.includes("counts = {") && /counts[\s\S]{0,200}null/.test(api) && api.includes("禁假数据"),
  "WB-11（反例守卫）: 无分析 run 时计数为 null 而非 0",
);

// ── 项目团队选人组合框（2026-08-19 用户报告：应可输入+下拉选人） ──
ok(
  tab.includes('data-testid="member-picker"') &&
    tab.includes("/api/organizations/") &&
    tab.includes("filteredCandidates"),
  "WB-12: 添加成员=组合框（组织成员候选 + 输入过滤下拉）",
);
ok(
  !tab.includes("用户 ID（须已加入所属组织）"),
  "WB-13（反例守卫）: 手输 userId（cuid）的旧输入框已退役",
);
ok(
  tab.includes("!selectedUser") && tab.includes("activeMemberIds"),
  "WB-14: 提交必须来自选择 + 已是项目成员的不出现在候选",
);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
