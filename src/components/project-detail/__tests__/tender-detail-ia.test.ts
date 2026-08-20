/**
 * T1A — Tender 详情 IA 静态审计（源级契约，防结构回归）
 *
 * A1 一套主导航：详情页恰好渲染 5 个一级 tab，读取 ?tab= 深链
 * A2 旧路由 SAFE REDIRECT：intelligence-room / quotes / quality 均跳转且无循环
 * A3 平台面收敛：AgentTask 面板仅经 InternalAgentToolsSection（isPlatformAdmin 门控）
 * A4 Requirement→Evidence 行内可达；分析面板拆分挂载正确
 * A5 单一写入口：投标调查启动 / 情报主卡 各只在一个 tab 渲染
 * A6 诚实空态：情报未来 Slot 不渲染伪造数字；进度横幅不透出原始 errorMessage
 * A7 移动端：5-tab 为等宽分段（grid-cols-5），非横向溢出导航
 *
 * 运行：npx tsx src/components/project-detail/__tests__/tender-detail-ia.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.equal(condition, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("tender-detail-ia (static audit)");

const page = read("src/app/(main)/projects/[id]/page.tsx");
const workbench = read("src/components/project-detail/tabs/workbench-tab.tsx");
const requirements = read("src/components/project-detail/tabs/requirements-tab.tsx");
const bid = read("src/components/project-detail/tabs/bid-tab.tsx");
const intel = read("src/components/project-detail/tabs/intel-tab.tsx");
const submission = read("src/components/project-detail/tabs/submission-tab.tsx");
const allTabs = [workbench, requirements, bid, intel, submission];

// ── A1 一套主导航 + 深链 ──
ok("详情页使用 TENDER_DETAIL_TAB_KEYS 渲染一级导航", page.includes("TENDER_DETAIL_TAB_KEYS.map"));
for (const key of ["workbench", "requirements", "bid", "intel", "submission"]) {
  ok(`详情页渲染 ${key} tab 内容`, page.includes(`activeTab === "${key}"`));
}
ok("详情页读取 ?tab= 深链（B4 修复）", page.includes('searchParams.get("tab")'));
ok("详情页经 resolveTenderDetailTab 解析（含旧值别名）", page.includes("resolveTenderDetailTab("));
ok("旧 4-tab 联合类型已移除", !page.includes('"overview" | "files" | "quotes" | "ai"'));

// ── A2 SAFE REDIRECT，无循环 ──
const roomPage = read("src/app/(main)/projects/[id]/intelligence-room/page.tsx");
ok("调查室路由重定向到情报 tab", roomPage.includes("redirect(`/projects/${id}?tab=intel`)"));
ok("调查室路由不再渲染旧客户端", !roomPage.includes("IntelligenceRoomClient"));
ok("调查室路由不再直连 db", !roomPage.includes("@/lib/db"));

const quotesPage = read("src/app/(main)/projects/[id]/quotes/page.tsx");
ok("quotes 索引路由重定向到标书与报价 tab", quotesPage.includes("redirect(`/projects/${id}?tab=bid`)"));
ok("报价编辑器子路由仍然存在", existsSync(join(ROOT, "src/app/(main)/projects/[id]/quotes/[quoteId]/page.tsx")));

const qualityPage = read("src/app/(main)/projects/[id]/quality/page.tsx");
ok("quality 路由重定向回项目详情", qualityPage.includes("redirect(`/projects/${id}`)"));

// 重定向目标是详情页本身（不含二级路由），详情页不做服务端 redirect → 无循环
ok("详情页自身不做服务端 redirect（无循环）", !page.includes("redirect("));

// ── A3 平台面收敛 ──
ok(
  "业务 tab 不引用 AgentTask 面板组件",
  allTabs.every((src) => !src.includes("agent-tasks/")),
);
ok(
  "AgentTask 面板仅经 InternalAgentToolsSection 挂载",
  read("src/components/project-detail/internal-agent-tools.tsx").includes("ProjectAgentTasks"),
);
ok(
  "InternalAgentToolsSection 由 isPlatformAdmin 门控",
  /isPlatformAdmin \? \(\s*<InternalAgentToolsSection/.test(page),
);
ok("「项目 AI 记忆」读时聚合卡退出主 UX", !page.includes("ProjectAiMemory") && allTabs.every((s) => !s.includes("ProjectAiMemory")));
ok("文件管理器只经资料抽屉挂载", !page.includes("ProjectFileManager") && page.includes("ProjectFilesDrawer"));

// ── A4 Requirement→Evidence + 分析面板拆分 ──
const analysisPanel = read("src/components/tender-analysis/analysis-panel.tsx");
ok("Requirement 行内可查看来源证据", analysisPanel.includes("r.sources[0]"));
ok(
  "招标要求 tab 挂载 requirements/risks/clarifications/report/sources 分区",
  requirements.includes('sections={["requirements", "risks", "clarifications", "report", "sources"]}'),
);
ok(
  "提交 tab 挂载 deliverables/tasks 分区（安静空态，不带运行控制）",
  submission.includes('sections={["deliverables", "tasks"]}') &&
    submission.includes("showRunControls={false}") &&
    submission.includes("quietEmpty"),
);
ok("招标要求 tab 顶部有分析进度条", requirements.includes("AnalysisProgressBanner"));

// ── A5 单一写入口 ──
const startPanelCount = allTabs.filter((s) => s.includes("StartIntelligencePanel")).length;
ok("投标调查启动面板只在工作台一处渲染", startPanelCount === 1 && workbench.includes("StartIntelligencePanel"));
const intelCardCount = allTabs.filter((s) => s.includes("BidToGoIntelligenceCard")).length;
ok("BidToGo 情报主卡只在情报 tab 一处渲染", intelCardCount === 1 && intel.includes("BidToGoIntelligenceCard"));
ok("旧调查室客户端第二实例已随重构移除", !existsSync(join(ROOT, "src/components/bid-workflow/intelligence-room-client.tsx")));

// ── A6 诚实空态（情报阶段1：槽位改挂 T4 投影组件，不变量=诚实空态不变） ──
const intelSlots = read("src/components/tender-intel/org-award-intel-slots.tsx");
ok(
  "情报槽位组件挂载且保留诚实空态（暂无数据 + 如何让它有）",
  intel.includes("OrgAwardIntelSlots") &&
    intelSlots.includes("暂无数据") &&
    intelSlots.includes("样本不足时如实显示暂无"),
);
ok(
  "情报槽位不含硬编码 0 数值",
  !/[">]0 个/.test(intelSlots) && !/\$0/.test(intelSlots),
);
const banner = read("src/components/tender-analysis/analysis-progress-banner.tsx");
ok("分析进度条不再向业务用户透出原始 errorMessage", !banner.includes("{run.errorMessage}"));
ok("分析进度条链接指向招标要求 tab", banner.includes("?tab=requirements") && !banner.includes("intelligence-room"));

// ── 站内旧入口全部改指 5-tab ──
const startPanel = read("src/components/bid-workflow/start-intelligence-panel.tsx");
ok("调查启动面板不再链接调查室路由", !startPanel.includes("intelligence-room"));
ok("调查启动面板供应商链接指向标书与报价", startPanel.includes("?tab=bid#project-suppliers"));

// ── A7 移动端 ──
ok("5-tab 为等宽紧凑分段（grid-cols-5）", page.includes("grid-cols-5"));
ok("移动端使用短标签", page.includes("shortLabel"));

console.log(`结果: ${passed} passed`);
