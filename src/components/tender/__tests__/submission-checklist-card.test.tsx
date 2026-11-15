/**
 * FLOW-H4b 交付前检查清单渲染出来的内容（服务端静态渲染，无浏览器 / 无 DB）
 * （openspec change tender-submission-checklist，spec tender/submission-checklist）
 * 运行：npx tsx src/components/tender/__tests__/submission-checklist-card.test.tsx
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSubmissionChecklist, type ChecklistRequirement } from "@/lib/tender-submission-checklist/contract";
import { SubmissionChecklistBody, SubmissionChecklistLoadFailed, checklistLoadOutcome } from "../submission-checklist-card";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const req = (o: Partial<ChecklistRequirement> & { requirementCode: string }): ChecklistRequirement => ({
  category: "submission", mandatory: true, reviewStatus: "CONFIRMED", complianceStatus: "NOT_ASSESSED",
  chineseTranslation: `中文 ${o.requirementCode}`, originalRequirement: `Original ${o.requirementCode}`, sourcePage: 3, ...o,
});
const viewOf = (requirements: ChecklistRequirement[] | null, o: Partial<Parameters<typeof buildSubmissionChecklist>[0]> = {}) =>
  buildSubmissionChecklist({ requirements, analysisStatus: "APPROVED", statusByKey: {}, criticalFacts: {}, closeDate: new Date("2026-12-01T19:00:00Z"), questionCloseDate: null, canEdit: true, ...o });
const html = (view: ReturnType<typeof viewOf>, extra: Partial<React.ComponentProps<typeof SubmissionChecklistBody>> = {}) => renderToStaticMarkup(<SubmissionChecklistBody view={view} onSet={() => {}} {...extra} />);
const text = (m: string) => m.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"');
const items = (m: string) => [...m.matchAll(/data-item="([^"]+)" data-status="([A-Z_]+)"/g)].map((x) => `${x[1]}:${x[2]}`).join();
const pressed = (m: string) => [...m.matchAll(/aria-pressed="(true|false)"[^>]*data-testid="submission-checklist-set-([A-Z]+)"/g)].map((x) => `${x[2]}=${x[1]}`).join();

const reqs = [
  req({ requirementCode: "R-1", chineseTranslation: "须提交投标保函", originalRequirement: "Bid bond required.", category: "bonding", sourcePage: 12 }),
  req({ requirementCode: "R-2" }),
  req({ requirementCode: "U-1", reviewStatus: "AI_EXTRACTED" }),
  req({ requirementCode: "T-1", category: "technical", complianceStatus: "NON_COMPLIANT", chineseTranslation: "阻燃等级须达到 NFPA 701" }),
];

console.log("有清单");
{
  const m = html(viewOf(reqs, { statusByKey: { req_r_2: "DONE" }, criticalFacts: { submission_method: { status: "KNOWN", text: "通过 MERX 门户在线提交" } } }));
  const t = text(m);
  ok("最上面一句话照实数：要备齐 2 项、1 项备好了、还差 1 项、另有 1 项没确认、1 项不满足", t.includes("要备齐 2 项：1 项备好了，还差 1 项；另有 1 项还没确认；1 项强制要求当前判为不满足"));
  ok("要备齐的两条按类别排（提交在保证金前），各带自己的状态", items(m) === "req_r_2:DONE,req_r_1:PENDING", items(m));
  ok("每条显示中文、原文、编号、类别、出处页码", t.includes("须提交投标保函") && t.includes("Bid bond required.") && t.includes("R-1 · 保证金 / 保函 · 第 12 页"));
  ok("每条三个按钮：当前状态那个是按下的（且点不了），别的没按下", pressed(m) === "DONE=true,WAIVED=false,PENDING=false,DONE=false,WAIVED=false,PENDING=true", pressed(m));
  ok("没确认的单列一块，写明还没人看过；不带状态按钮", (() => { const block = m.slice(m.indexOf('data-testid="submission-checklist-unconfirmed"')); const end = block.indexOf('data-testid="submission-checklist-conditions"'); const seg = block.slice(0, end); return text(seg).includes("还没确认的 1 项") && text(seg).includes("中文 U-1") && !seg.includes("submission-checklist-set-"); })());
  ok("废标风险单列一块，写出是哪一条", (() => { const i = m.indexOf('data-testid="submission-checklist-risks"'); const seg = m.slice(i, m.indexOf('data-testid="submission-checklist-items"')); return i > 0 && text(seg).includes("废标风险：1 项强制要求当前判为不满足") && text(seg).includes("阻燃等级须达到 NFPA 701"); })());
  ok("提交条件：写明的原样显示；没找到的写「招标文件里没有找到，请自行核对」；截标时间带出", t.includes("通过 MERX 门户在线提交") && (t.match(/招标文件里没有找到，请自行核对/g) ?? []).length === 3 && t.includes("2026/12/1"));
  ok("写明状态由人来标、系统不会自己打勾", t.includes("系统不会自己打勾"));
  const priced = text(html(viewOf([req({ requirementCode: "P-1", category: "pricing", chineseTranslation: "投标总价不得超过预算 2,400,000 加元（含税）" })], { criticalFacts: { bond: { status: "KNOWN", text: "投标保证金 120,000 加元" } } })));
  ok("招标文件原文里的金额照原文显示（不改写、不另算）；页面上的金额只有原文里的这两个", priced.includes("投标总价不得超过预算 2,400,000 加元（含税）") && priced.includes("投标保证金 120,000 加元") && (priced.match(/\d{1,3}(?:,\d{3})+/g) ?? []).sort().join("|") === "120,000|2,400,000");
}

console.log("不能标的人、不能单独标的条目、正在保存");
{
  const ro = html(viewOf(reqs, { canEdit: false, statusByKey: { req_r_2: "WAIVED" } }));
  ok("只读成员：没有任何按钮，只显示状态文字", !ro.includes("submission-checklist-set-") && [...ro.matchAll(/data-testid="submission-checklist-status">([\s\S]*?)<\/span>/g)].map((x) => text(x[1])).join() === "不适用,待办");
  ok("不给 onSet（上层没接写入）：同样没有按钮", !renderToStaticMarkup(<SubmissionChecklistBody view={viewOf(reqs)} />).includes("submission-checklist-set-"));
  const dup = html(viewOf([req({ requirementCode: "R-1" }), req({ requirementCode: "R 1" })]));
  ok("两条编号派生出同一个键：只有前一条有按钮，后一条说明共用一个状态、请在上一条上标", (dup.match(/role="group"/g) ?? []).length === 1 && text(dup).includes("共用一个状态，请在上一条上标"));
  const dupDone = html(viewOf([req({ requirementCode: "R-1" }), req({ requirementCode: "R 1" })], { statusByKey: { req_r_1: "DONE" } }));
  ok("前一条标了备好了：后一条跟着显示备好了，进度到齐", items(dupDone) === "req_r_1:DONE,req_r_1:DONE" && text(dupDone).includes("要备齐 2 项：2 项备好了，还差 0 项"));
  const busy = html(viewOf(reqs), { busyKey: "req_r_1" });
  ok("正在保存的那一条：三个按钮都点不了；别的条目不受影响", (() => { const seg = busy.slice(busy.indexOf('data-item="req_r_1"')); return (seg.match(/disabled=""/g) ?? []).length === 3 && (busy.slice(busy.indexOf('data-item="req_r_2"'), busy.indexOf('data-item="req_r_1"')).match(/disabled=""/g) ?? []).length === 1; })());
  ok("出错时有一条提示（读屏能读到）", html(viewOf(reqs), { error: "清单里没有这一条" }).includes('role="alert"') && !html(viewOf(reqs)).includes('role="alert"'));
  ok("给了「去确认」的入口才显示它", html(viewOf(reqs), { onGoConfirm: () => {} }).includes("去确认") && !html(viewOf(reqs)).includes("去确认"));
}

console.log("没有分析、没有条目、还在审核");
{
  const none = html(viewOf(null, { analysisStatus: null }));
  ok("没有分析：说明要先完成招标分析；不显示条目、提交条件", text(none).includes("先上传招标文件并完成分析") && !none.includes('data-testid="submission-checklist-items"') && !none.includes('data-testid="submission-checklist-conditions"'));
  const empty = html(viewOf([]));
  ok("有分析但没有提交类强制要求：照实说；提交条件照样列", text(empty).includes("这份招标分析里没有提交类的强制要求") && empty.includes('data-testid="submission-checklist-conditions"') && !empty.includes('data-testid="submission-checklist-items"'));
  ok("分析还在等审核：提示批准前内容可能会变；已批准的不提示", text(html(viewOf(reqs, { analysisStatus: "REVIEW_REQUIRED" }))).includes("还在等审核") && !text(html(viewOf(reqs))).includes("还在等审核"));
}

console.log("清单来自哪一份分析");
{
  const at = new Date("2026-11-10T15:00:00Z");
  ok("写明清单所用的分析发起于哪天", text(html(viewOf(reqs, { analysisCreatedAt: at }))).includes("清单所用的招标分析发起于 2026/11/10"));
  ok("之后又发起了一次、还在进行：写明完成之后会换成新的", text(html(viewOf(reqs, { analysisCreatedAt: at, newerRunStatus: "EXTRACTING" }))).includes("之后又发起了一次分析，还在进行"));
  ok("之后那一次失败了：写明清单仍按这一份", text(html(viewOf(reqs, { analysisCreatedAt: at, newerRunStatus: "FAILED" }))).includes("之后又发起的一次分析失败了，清单仍按这一份"));
  ok("没有更新的那一次：不提", !text(html(viewOf(reqs, { analysisCreatedAt: at }))).includes("之后又发起"));
}

console.log("取清单的结果怎么处理");
{
  const v = viewOf(reqs);
  ok("200 带清单：显示", checklistLoadOutcome({ status: 200, ok: true }, { view: v }).kind === "show");
  ok("404（开关关闭、不是招投标项目）：不显示，上层照旧显示模型那份", checklistLoadOutcome({ status: 404, ok: false }, null).kind === "off");
  ok("200 说不可用（没有分析、旧的分析）：不显示，上层照旧", checklistLoadOutcome({ status: 200, ok: true }, { view: null, unavailable: "not_grounded" }).kind === "off" && checklistLoadOutcome({ status: 200, ok: true }, { view: null, unavailable: "no_analysis" }).kind === "off");
  ok("出错、网络失败或超时、响应形状不对：没取到——不退回模型那份", [checklistLoadOutcome({ status: 500, ok: false }, null), checklistLoadOutcome({ status: 403, ok: false }, null), checklistLoadOutcome(null, null), checklistLoadOutcome({ status: 200, ok: true }, null), checklistLoadOutcome({ status: 200, ok: true }, {}), checklistLoadOutcome({ status: 200, ok: true }, { view: null }), checklistLoadOutcome({ status: 200, ok: true }, "x")].every((o) => o.kind === "failed"));
  const failed = renderToStaticMarkup(<SubmissionChecklistLoadFailed onRetry={() => {}} />);
  ok("没取到：写明没取到、给一个重试（读屏能读到）", text(failed).includes("没有取到交付前检查清单") && text(failed).includes("重试") && failed.includes('role="alert"'));
}

console.log("接线");
{
  const card = readFileSync(join(process.cwd(), "src/components/tender/submission-checklist-card.tsx"), "utf8");
  ok("取数按上面的规则：显示清单或没取到时告诉上层不再显示模型那份；不可用时告诉上层照旧；超时会中止请求", card.includes("outcome = checklistLoadOutcome(res, res.ok ? await res.json().catch(() => null) : null);") && card.includes("outcome = checklistLoadOutcome(null, null);") && card.includes('onAvailable?.(outcome.kind !== "off");') && card.includes("setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS)") && card.includes("{ signal: controller.signal }") && card.includes("if (!view) return loadFailed ? <SubmissionChecklistLoadFailed onRetry={() => void load()} /> : null;"));
  ok("卡片把「去确认」原样交给呈现层", card.includes("onGoConfirm={onGoConfirm} />"));
  ok("写请求只有一处：标状态，且键做了转义", (card.match(/method: "PUT"/g) ?? []).length === 1 && card.includes("/submission-checklist/items/${encodeURIComponent(key)}") && !/method: "(POST|DELETE|PATCH)"/.test(card));
  ok("保存失败时重新取一次清单（它可能刚变了）", /if \(!res\.ok \|\| !data\?\.view\) \{[\s\S]{0,200}?void load\(\);/.test(card));
}

console.log(`\n✓ submission-checklist-card: ${passed} 项断言全部通过`);
