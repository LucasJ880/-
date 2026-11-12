/**
 * FLOW-H4b 交付前检查清单 — 纯逻辑测试
 * 运行：npx tsx src/lib/tender-submission-checklist/__tests__/checklist.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHECKLIST_ITEM_STATUSES, CHECKLIST_STATUS_ZH, CONDITION_NOT_FOUND_ZH, SUBMISSION_CATEGORY_ZH, SUBMISSION_CHECKLIST_CATEGORIES,
  buildSubmissionChecklist, checklistKeyOf, checklistSummaryZh, parseItemStatus,
  type ChecklistRequirement,
} from "../contract";
import { isSubmissionChecklistEnabledForOrgWithEnv } from "../flags";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const req = (o: Partial<ChecklistRequirement> & { requirementCode: string }): ChecklistRequirement => ({
  category: "submission", mandatory: true, reviewStatus: "CONFIRMED", complianceStatus: "NOT_ASSESSED",
  chineseTranslation: `中文 ${o.requirementCode}`, originalRequirement: `Original ${o.requirementCode}`, sourcePage: 3, ...o,
});
const build = (requirements: ChecklistRequirement[] | null, o: Partial<Parameters<typeof buildSubmissionChecklist>[0]> = {}) =>
  buildSubmissionChecklist({ requirements, analysisStatus: "APPROVED", statusByKey: {}, criticalFacts: {}, closeDate: null, questionCloseDate: null, canEdit: true, ...o });
const codes = (xs: Array<{ requirementCode: string }>) => xs.map((x) => x.requirementCode).join();

/* ---------- 1. 哪些要求进清单 ---------- */
console.log("哪些要求进清单");
{
  const v = build([
    req({ requirementCode: "R-001" }),
    req({ requirementCode: "R-002", reviewStatus: "AI_EXTRACTED" }),
    req({ requirementCode: "R-003", reviewStatus: "REJECTED" }),
  ]);
  ok("已确认的进「要备齐的」；还没确认的单列；已驳回的哪里都不出现", codes(v.toPrepare) === "R-001" && codes(v.unconfirmed) === "R-002" && !JSON.stringify(v).includes("R-003"));
  const w = build([
    req({ requirementCode: "P-1", category: "product" }),
    req({ requirementCode: "S-1", mandatory: false }),
    req({ requirementCode: "S-2", category: "technical", reviewStatus: "AI_EXTRACTED" }),
  ]);
  ok("不是提交类的、不是强制的：都不在「要备齐的」里，也不在「还没确认」里", w.toPrepare.length === 0 && w.unconfirmed.length === 0 && w.risks.length === 0);
  ok("提交类就是这七个类别，与招标分析生成提交清单时用的相同", SUBMISSION_CHECKLIST_CATEGORIES.join() === "submission,administrative,pricing,samples,shop_drawings,bonding,insurance" && (() => { const src = readFileSync(join(process.cwd(), "src/lib/tender-understanding/synthesize.ts"), "utf8"); const set = [...(src.match(/const SUBMISSION_CATEGORIES = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((m) => m[1].toLowerCase()).sort().join(); return set === [...SUBMISSION_CHECKLIST_CATEGORIES].sort().join(); })());
  const each = build(SUBMISSION_CHECKLIST_CATEGORIES.map((c, i) => req({ requirementCode: `C-${i}`, category: c })));
  ok("七个类别各一条：都进清单，各有中文类别名", each.toPrepare.length === 7 && each.toPrepare.every((i) => i.categoryZh === SUBMISSION_CATEGORY_ZH[i.category as keyof typeof SUBMISSION_CATEGORY_ZH] && i.categoryZh.length > 0));
  ok("类别在库里是小写；大写的不认（不猜）", build([req({ requirementCode: "U-1", category: "SUBMISSION" })]).toPrepare.length === 0);
  const sorted = build([req({ requirementCode: "R-10", category: "insurance" }), req({ requirementCode: "R-2", category: "submission" }), req({ requirementCode: "R-10", category: "submission" }), req({ requirementCode: "R-1", category: "bonding" })]);
  ok("顺序：先按类别（提交、行政、报价、样品、深化图、保证金、保险），同类别按编号（R-2 在 R-10 前）", sorted.toPrepare.map((i) => `${i.category}:${i.requirementCode}`).join() === "submission:R-2,submission:R-10,bonding:R-1,insurance:R-10");
  const line = build([req({ requirementCode: "R-7", chineseTranslation: "  须提交投标保函  ", originalRequirement: " Bid bond required. ", sourcePage: 12 })]).toPrepare[0];
  ok("每条带编号、中文、原文、出处页码", line.requirementCode === "R-7" && line.textZh === "须提交投标保函" && line.originalText === "Bid bond required." && line.sourcePage === 12);
  ok("没有中文时用原文", build([req({ requirementCode: "R-8", chineseTranslation: null })]).toPrepare[0].textZh === "Original R-8" && build([req({ requirementCode: "R-9", chineseTranslation: "   " })]).toPrepare[0].textZh === "Original R-9");
  ok("确定性：同样的输入两次结果相同；不改传进来的数组", (() => { const input = [req({ requirementCode: "B" }), req({ requirementCode: "A" })]; const snap = JSON.stringify(input); const a = JSON.stringify(build(input)), b = JSON.stringify(build(input)); return a === b && JSON.stringify(input) === snap; })());
}

/* ---------- 2. 没有分析 ---------- */
console.log("没有可用的分析");
{
  const v = build(null, { analysisStatus: null });
  ok("清单为空，并说明要先完成招标分析；不列提交条件", v.hasAnalysis === false && v.toPrepare.length === 0 && v.unconfirmed.length === 0 && v.risks.length === 0 && v.conditions.length === 0 && checklistSummaryZh(v).includes("先上传招标文件并完成分析"));
  const e = build([]);
  ok("有分析但一条要求都没有：照实说没有提交类的强制要求", e.hasAnalysis === true && checklistSummaryZh(e) === "这份招标分析里没有提交类的强制要求");
  ok("分析还在等审核：清单照常生成，并标明还没批准", build([req({ requirementCode: "R-1" })], { analysisStatus: "REVIEW_REQUIRED" }).analysisApproved === false && build([req({ requirementCode: "R-1" })]).analysisApproved === true);
}

/* ---------- 3. 废标风险与提交条件 ---------- */
console.log("废标风险与提交条件");
{
  const v = build([
    req({ requirementCode: "T-1", category: "technical", complianceStatus: "NON_COMPLIANT" }),
    req({ requirementCode: "S-1", complianceStatus: "NON_COMPLIANT" }),
    req({ requirementCode: "T-2", category: "technical", complianceStatus: "NON_COMPLIANT", reviewStatus: "REJECTED" }),
    req({ requirementCode: "T-3", category: "technical", complianceStatus: "NON_COMPLIANT", mandatory: false }),
    req({ requirementCode: "T-4", category: "technical", complianceStatus: "PARTIAL" }),
    req({ requirementCode: "T-5", category: "technical", complianceStatus: "NON_COMPLIANT", reviewStatus: "AI_EXTRACTED" }),
  ]);
  ok("判为不满足的强制要求（任何类别）进废标风险；已驳回的、不是强制的、只是部分满足的不进；还没确认的也进（先让人看到）", codes(v.risks) === "S-1,T-1,T-5", codes(v.risks));
  ok("提交类里判为不满足的那条：既在要备齐的里，也在废标风险里", codes(v.toPrepare) === "S-1");
  const cf = { submission_method: { status: "KNOWN", text: " 通过 MERX 门户在线提交 " }, bond: { status: "UNKNOWN", text: null }, closing_datetime: { status: "KNOWN", text: "2026-12-01 14:00 ET" } };
  const c = build([], { criticalFacts: cf }).conditions;
  ok("招标文件写明的：原样带出（去掉首尾空白）", c.find((x) => x.slot === "submission_method")?.found === true && c.find((x) => x.slot === "submission_method")?.textZh === "通过 MERX 门户在线提交" && c.find((x) => x.slot === "closing_datetime")?.textZh === "2026-12-01 14:00 ET");
  ok("分析里标为未找到的、这份分析里没有这一项的：写明没有找到、请自行核对——不留空、不编", c.find((x) => x.slot === "bond")?.found === false && c.find((x) => x.slot === "bond")?.textZh === CONDITION_NOT_FOUND_ZH && c.find((x) => x.slot === "insurance")?.found === false && c.find((x) => x.slot === "insurance")?.textZh === CONDITION_NOT_FOUND_ZH && c.every((x) => x.textZh.length > 0));
  ok("四项提交条件按固定顺序：提交方式、截标时间原文、保证金、保险", c.map((x) => x.slot).join() === "submission_method,closing_datetime,bond,insurance" && c.every((x) => x.labelZh.length > 0));
  ok("关键事实的形状不对（空、字符串、数组、文字不是字符串、状态已知但没有文字）：一律按没有找到", [null, "x", [], { bond: "yes" }, { bond: { status: "KNOWN", text: 5 } }, { bond: { status: "KNOWN", text: "  " } }, { bond: { status: "KNOWN" } }].every((x) => build([], { criticalFacts: x }).conditions.find((y) => y.slot === "bond")?.found === false));
  const d = build([], { closeDate: new Date("2026-12-01T19:00:00Z"), questionCloseDate: new Date("2026-11-20T22:00:00Z") });
  ok("项目上的截标时间与提问截止时间原样带出；没有的是空", d.closesAt === "2026-12-01T19:00:00.000Z" && d.questionCloseAt === "2026-11-20T22:00:00.000Z" && build([]).closesAt === null && build([]).questionCloseAt === null);
  ok("清单里没有金额、毛利、报价之类的字段", (() => { const keys = new Set<string>(); const walk = (x: unknown) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") for (const [k, val] of Object.entries(x)) { keys.add(k); walk(val); } }; walk(build([req({ requirementCode: "R-1" })], { criticalFacts: cf })); return ![...keys].some((k) => /price|amount|margin|cost|value|金额|毛利/i.test(k)) && [...keys].sort().join() === "analysisApproved,canEdit,category,categoryZh,closesAt,conditions,done,found,hasAnalysis,key,labelZh,originalText,pending,progress,questionCloseAt,requirementCode,risks,slot,sourcePage,status,textZh,tickable,toPrepare,total,unconfirmed,waived"; })());
}

/* ---------- 4. 状态与进度 ---------- */
console.log("状态与进度");
{
  const reqs = [req({ requirementCode: "R-1" }), req({ requirementCode: "R-2" }), req({ requirementCode: "R-3" }), req({ requirementCode: "R-4" })];
  const v = build(reqs, { statusByKey: { [checklistKeyOf("R-1")]: "DONE", [checklistKeyOf("R-2")]: "WAIVED", [checklistKeyOf("R-3")]: "IN_PROGRESS", req_other: "DONE" } });
  ok("交付物行上的状态带出来：备好了、不适用；库里别的值（进行中）与没有行的都按待办", v.toPrepare.map((i) => i.status).join() === "DONE,WAIVED,PENDING,PENDING");
  ok("进度：共 4 项，1 项备好了，1 项不适用，还差 2 项", JSON.stringify(v.progress) === JSON.stringify({ total: 4, done: 1, waived: 1, pending: 2 }));
  ok("没有任何状态时系统不会自己把哪一条标成备好了", build(reqs).toPrepare.every((i) => i.status === "PENDING") && build(reqs).progress.done === 0);
  ok("还没确认的、废标风险里的没有状态（不能标）", (() => { const x = build([req({ requirementCode: "U-1", reviewStatus: "AI_EXTRACTED" })], { statusByKey: { [checklistKeyOf("U-1")]: "DONE" } }); return x.unconfirmed.length === 1 && !("status" in x.unconfirmed[0]) && x.progress.total === 0; })());
  ok("键的派生：与招标分析投影交付物时相同的规则（小写、非字母数字换成下划线、去掉两端、最长 60、空的记 unknown）", checklistKeyOf("R-001") === "req_r_001" && checklistKeyOf("  Sub.Req #12 ") === "req_sub_req_12" && checklistKeyOf("要求一") === "req_unknown" && checklistKeyOf("A".repeat(100)) === `req_${"a".repeat(60)}` && (() => { const src = readFileSync(join(process.cwd(), "src/lib/tender-auto-analysis/deliverables.ts"), "utf8"); return src.includes('.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);') && src.includes('return `req_${slug || "unknown"}`;'); })());
  const dup = build([req({ requirementCode: "R-1" }), req({ requirementCode: "R 1" })], { statusByKey: { req_r_1: "DONE" } });
  ok("两条要求派生出同一个键：只有前一条能标、带着状态；后一条显示为待办且不能单独标（免得改到前一条）", dup.toPrepare.length === 2 && dup.toPrepare[0].tickable === true && dup.toPrepare[0].status === "DONE" && dup.toPrepare[1].tickable === false && dup.toPrepare[1].status === "PENDING" && dup.progress.done === 1);
  ok("状态只有三个，各有中文", CHECKLIST_ITEM_STATUSES.join() === "PENDING,DONE,WAIVED" && CHECKLIST_ITEM_STATUSES.every((s) => CHECKLIST_STATUS_ZH[s].length > 0));
  ok("标状态的请求体：三个值能过；别的值、小写、空、不是对象都不行", CHECKLIST_ITEM_STATUSES.every((s) => { const r = parseItemStatus({ status: s }); return r.ok && r.status === s; }) && [{ status: "IN_PROGRESS" }, { status: "done" }, { status: "" }, {}, null, "DONE", [{ status: "DONE" }], { status: 1 }].every((b) => !parseItemStatus(b).ok));
  ok("canEdit 原样带出", build([], { canEdit: false }).canEdit === false && build([]).canEdit === true);
}

/* ---------- 5. 最上面的一句话 ---------- */
console.log("最上面的一句话");
{
  const reqs = [req({ requirementCode: "R-1" }), req({ requirementCode: "R-2" }), req({ requirementCode: "R-3" })];
  ok("都没标：要备齐 3 项，0 项备好了，还差 3 项", checklistSummaryZh(build(reqs)) === "要备齐 3 项：0 项备好了，还差 3 项");
  ok("标了一些：备好了与不适用分开数", checklistSummaryZh(build(reqs, { statusByKey: { req_r_1: "DONE", req_r_2: "WAIVED" } })) === "要备齐 3 项：1 项备好了，1 项不适用，还差 1 项");
  ok("还有没确认的、有不满足的：都写在后面", checklistSummaryZh(build([...reqs, req({ requirementCode: "U-1", reviewStatus: "AI_EXTRACTED" }), req({ requirementCode: "T-1", category: "technical", complianceStatus: "NON_COMPLIANT" })])) === "要备齐 3 项：0 项备好了，还差 3 项；另有 1 项还没确认；1 项强制要求当前判为不满足");
  ok("一条已确认的都没有、但有没确认的：照实说（不说成「没有要求」）", checklistSummaryZh(build([req({ requirementCode: "U-1", reviewStatus: "AI_EXTRACTED" })])) === "还没有已确认的提交类强制要求；另有 1 项还没确认");
}

/* ---------- 6. 开关 ---------- */
console.log("开关");
{
  const on = (env: Record<string, string | undefined>, org: string | null = "org1") => isSubmissionChecklistEnabledForOrgWithEnv(org, env as NodeJS.ProcessEnv);
  ok("默认关；1 / true / on / yes 算开；别的值算关；没有组织算关", !on({}) && ["1", "true", "on", "yes"].every((v) => on({ TENDER_SUBMISSION_CHECKLIST_ENABLED: v })) && ["0", "false", "", "2"].every((v) => !on({ TENDER_SUBMISSION_CHECKLIST_ENABLED: v })) && !on({ TENDER_SUBMISSION_CHECKLIST_ENABLED: "1" }, null));
  ok("名单：不填 = 所有组织；填了只认名单里的", on({ TENDER_SUBMISSION_CHECKLIST_ENABLED: "1", TENDER_SUBMISSION_CHECKLIST_ORG_ALLOWLIST: "a, org1" }) && !on({ TENDER_SUBMISSION_CHECKLIST_ENABLED: "1", TENDER_SUBMISSION_CHECKLIST_ORG_ALLOWLIST: "a,b" }));
  ok("与提交记录、「下一步」的开关互不影响", !on({ TENDER_SUBMISSION_RECORD_ENABLED: "1", TENDER_WEB_NEXT_STEP_ENABLED: "1" }));
  const src = readFileSync(join(process.cwd(), "src/lib/tender-submission-checklist/contract.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  ok("规则是纯的：不访问数据库、不发请求、不调模型", !/@\/lib\/db|prisma|fetch\(|createCompletion|openai|anthropic/i.test(src));
}

console.log(`\n✓ submission-checklist: ${passed} 项断言全部通过`);
