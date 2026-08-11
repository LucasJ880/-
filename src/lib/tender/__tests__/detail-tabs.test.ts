/**
 * T1A — Tender 详情 5-tab 解析契约（行为测试，替代旧的纯字符串断言假绿）
 * 运行：npx tsx src/lib/tender/__tests__/detail-tabs.test.ts
 */

import assert from "node:assert/strict";
import {
  TENDER_DETAIL_TAB_KEYS,
  TENDER_DETAIL_TAB_LABELS,
  isTenderDetailTab,
  resolveTenderDetailTab,
  tenderDetailTabHref,
} from "../detail-tabs";
import { PROJECT_AI_TAB_HREF_SUFFIX, projectAiTabHref } from "@/lib/bid-workflow/display-labels";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.equal(condition, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("tender-detail-tabs");

// ── 一级入口恰好 5 个（任务书 gate：TENDER_PRIMARY_TABS = 5） ──
ok("一级业务入口恰好 5 个", TENDER_DETAIL_TAB_KEYS.length === 5);
ok(
  "五个入口为 工作台/招标要求/标书与报价/情报/提交",
  JSON.stringify(TENDER_DETAIL_TAB_KEYS) ===
    JSON.stringify(["workbench", "requirements", "bid", "intel", "submission"]),
);
ok(
  "五个入口的中文标签齐全",
  [
    TENDER_DETAIL_TAB_LABELS.workbench.label === "工作台",
    TENDER_DETAIL_TAB_LABELS.requirements.label === "招标要求",
    TENDER_DETAIL_TAB_LABELS.bid.label === "标书与报价",
    TENDER_DETAIL_TAB_LABELS.intel.label === "情报",
    TENDER_DETAIL_TAB_LABELS.submission.label === "提交",
  ].every(Boolean),
);
ok(
  "移动端短标签均不超过 3 个字符（紧凑分段可容纳）",
  TENDER_DETAIL_TAB_KEYS.every(
    (k) => TENDER_DETAIL_TAB_LABELS[k].shortLabel.length <= 3,
  ),
);

// ── 新值直接解析 ──
for (const key of TENDER_DETAIL_TAB_KEYS) {
  const resolved = resolveTenderDetailTab(key);
  ok(`新值 ${key} 解析为自身且不弹抽屉`, resolved?.tab === key && !resolved.openFiles && !resolved.openChat);
}

// ── 旧 4-tab 别名（深链兼容；T0 审计 B4 修复） ──
ok("overview → 工作台", resolveTenderDetailTab("overview")?.tab === "workbench");
const files = resolveTenderDetailTab("files");
ok("files → 工作台 + 打开资料抽屉", files?.tab === "workbench" && files?.openFiles === true);
ok("quotes → 标书与报价", resolveTenderDetailTab("quotes")?.tab === "bid");
const ai = resolveTenderDetailTab("ai");
ok("ai → 工作台 + 打开问青砚抽屉", ai?.tab === "workbench" && ai?.openChat === true);

// ── 非法值 ──
ok("未知值返回 null（调用方回落工作台）", resolveTenderDetailTab("nonsense") === null);
ok("空值返回 null", resolveTenderDetailTab(null) === null && resolveTenderDetailTab("") === null);
ok("isTenderDetailTab 拒绝旧值", !isTenderDetailTab("overview") && !isTenderDetailTab("ai"));

// ── 既有深链生成器与解析器行为闭环（不再是纯字符串假绿） ──
const suffixParam = new URLSearchParams(PROJECT_AI_TAB_HREF_SUFFIX.replace(/^\?/, "")).get("tab");
const suffixResolved = resolveTenderDetailTab(suffixParam);
ok(
  "PROJECT_AI_TAB_HREF_SUFFIX 的 tab 参数可被解析（工作台 + 问青砚）",
  suffixResolved?.tab === "workbench" && suffixResolved?.openChat === true,
);
const aiHref = projectAiTabHref("proj_1");
ok("projectAiTabHref 指向项目详情且带可解析 tab 参数", aiHref.startsWith("/projects/proj_1?tab="));

// ── href 生成 ──
ok(
  "tenderDetailTabHref 形如 /projects/[id]?tab=<key>",
  tenderDetailTabHref("p1", "intel") === "/projects/p1?tab=intel",
);

console.log(`结果: ${passed} passed`);
