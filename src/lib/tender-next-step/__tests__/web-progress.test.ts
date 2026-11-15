/**
 * FLOW-H1b 项目页的阶段与进度条跟着实际进度显示 — 纯逻辑测试 + 接线断言
 * 运行：npx tsx src/lib/tender-next-step/__tests__/web-progress.test.ts
 * 项目进度区渲染出来的内容另见 src/components/tender/__tests__/project-progress-section.test.tsx
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TENDER_STAGE_ORDER, asTenderStage, getProjectCompletion, getProjectStage, getStageSteps, isTerminalTenderStatus, laterStage, recordedStageOf } from "@/lib/tender/stage";
import type { TenderProject, TenderStage } from "@/lib/tender/types";
import type { NextStepStage } from "../targets";
import { actualStageOf, decideWebNextStep, shownStageOf, type WebNextStepInput } from "../web-next-step";

// 推进阶段用的那一份顺序与中文名（stage-transition.ts 会连数据库，这里只读它的源码）
const transitionSrc = readFileSync(join(process.cwd(), "src/lib/tender/stage-transition.ts"), "utf8");
const STAGE_ORDER = [...(transitionSrc.match(/export const STAGE_ORDER: TenderStage\[\] = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
const STAGE_LABEL = Object.fromEntries([...(transitionSrc.match(/export const STAGE_LABEL: Record<TenderStage, string> = \{([\s\S]*?)\};/)?.[1] ?? "").matchAll(/([a-z_]+): "([^"]+)"/g)].map((m) => [m[1], m[2]]));

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// 日期都相对「现在」算：进度条的状态要看真实的时钟（是否逾期、是否临近截标）
const DAY = 86_400_000;
const NOW = new Date();
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const project = (o: Partial<TenderProject> = {}): TenderProject => ({
  createdAt: iso(-12), tenderStatus: null, publicDate: null, questionCloseDate: null, closeDate: iso(40), dueDate: null,
  distributedAt: iso(-10), interpretedAt: null, supplierInquiredAt: null, supplierQuotedAt: null, submittedAt: null, awardDate: null, intakeStatus: "dispatched", ...o,
});
const ALL = TENDER_STAGE_ORDER as TenderStage[];

/* ---------- 1. 实际进度到了哪一段 ---------- */
console.log("实际进度到了哪一段");
const input: WebNextStepInput = {
  now: NOW, projectId: "p1", projectName: "示例标", closedLabelZh: null, won: false, closeDate: new Date(Date.now() + 40 * DAY), submittedAt: null,
  documentCount: 2, parsingActive: false, analysisStatus: "APPROVED", latestAnalysisFailed: false, unknownCriticalFacts: 0, mandatoryNonCompliant: 0, pendingRequirementCount: 0, confirmedRequirementCount: 3,
  pendingApprovals: [], latestRound: null, hasProjectQuote: false, hasUsableAnalysis: true, anySent: true, anyQuoted: true, recordedStage: "distribution", stageFrozen: false,
  chaseAfterDays: 3, canManage: true, workspace: null, rfqEntry: null,
};
{
  const f = (o: Partial<Parameters<typeof actualStageOf>[0]> = {}) => actualStageOf({ submittedAt: null, anyQuoted: false, hasProjectQuote: false, anySent: false, hasUsableAnalysis: false, ...o });
  ok("什么都没有 → 立项", f() === "initiation");
  ok("有等待审核或已批准的分析 → 项目解读", f({ hasUsableAnalysis: true }) === "interpretation");
  ok("有供应商已发出 → 供应商询价（即使没有分析——有人直接手工发了）", f({ hasUsableAnalysis: true, anySent: true }) === "supplier_inquiry" && f({ anySent: true }) === "supplier_inquiry");
  ok("有供应商已报价 → 供应商报价", f({ hasUsableAnalysis: true, anySent: true, anyQuoted: true }) === "supplier_quote" && f({ anyQuoted: true }) === "supplier_quote");
  ok("没有询价、有一份没作废的投标报价单 → 供应商报价（这时「下一步」说的是准备提交）", f({ hasProjectQuote: true }) === "supplier_quote" && f({ hasProjectQuote: true, hasUsableAnalysis: true, anySent: true }) === "supplier_quote");
  ok("有提交时间 → 项目提交（不管前面几项）", f({ submittedAt: NOW }) === "submission" && f({ submittedAt: NOW, anyQuoted: true, hasProjectQuote: true, anySent: true, hasUsableAnalysis: true }) === "submission");
  const bools = [false, true];
  const every = bools.flatMap((a) => bools.flatMap((b) => bools.flatMap((c) => bools.flatMap((d) => bools.map((e) => f({ submittedAt: a ? NOW : null, anyQuoted: b, hasProjectQuote: c, anySent: d, hasUsableAnalysis: e }))))));
  const count = (s: string) => every.filter((x) => x === s).length;
  ok("三十二种组合都核对：从不返回「项目分发」（有没有分发由阶段记录管）；越靠后的事实优先", every.length === 32 && count("distribution") === 0 && count("submission") === 16 && count("supplier_quote") === 12 && count("supplier_inquiry") === 2 && count("interpretation") === 1 && count("initiation") === 1, every);
  ok("确定性：同样的事实两次结果相同", f({ anySent: true }) === f({ anySent: true }));
  // 经「下一步」的判断带出来
  ok("「下一步」的结果里带着实际进度", decideWebNextStep(input).actualStage === "supplier_quote" && decideWebNextStep({ ...input, anyQuoted: false }).actualStage === "supplier_inquiry");
  ok("项目已结束、已中标、已提交、截标已过这些提前返回的结果里同样带着三项", [{ closedLabelZh: "未中标" }, { won: true }, { closeDate: new Date(Date.now() - 9 * DAY) }].every((o) => { const v = decideWebNextStep({ ...input, ...o }); return v.actualStage === "supplier_quote" && v.recordedStage === "distribution" && typeof v.shownStage === "string"; }) && decideWebNextStep({ ...input, submittedAt: NOW }).actualStage === "submission");
  ok("已结束的项目有提交时间：实际进度照样是项目提交", decideWebNextStep({ ...input, closedLabelZh: "未中标", stageFrozen: true, submittedAt: NOW, recordedStage: "submission" }).actualStage === "submission");
  ok("与有没有写权限无关：只读成员得到相同的三项", (() => { const a = decideWebNextStep(input), b = decideWebNextStep({ ...input, canManage: false }); return a.actualStage === b.actualStage && a.recordedStage === b.recordedStage && a.shownStage === b.shownStage; })());
  const all: NextStepStage[] = ["initiation", "distribution", "interpretation", "supplier_inquiry", "supplier_quote", "submission"];
  ok("接口里的阶段名与页面用的六段是同一组值、同一个顺序", all.join() === TENDER_STAGE_ORDER.join() && all.join() === STAGE_ORDER.join() && STAGE_ORDER.length === 6);
}

/* ---------- 2. 显示的阶段 ---------- */
console.log("显示的阶段：没结束的项目取靠后的那个；已结束的项目取记录的");
{
  ok("靠后的那个：记录落后（项目分发）、实际已到供应商报价 → 供应商报价", laterStage("distribution", "supplier_quote") === "supplier_quote");
  ok("靠后的那个：记录超前、实际只到供应商询价 → 以记录为准", laterStage("supplier_quote", "supplier_inquiry") === "supplier_quote");
  ok("靠后的那个：实际进度是立项（最低），永远不会把记录的阶段拉回去", ALL.every((s) => laterStage(s, "initiation") === s));
  ok("靠后的那个：没有实际进度或认不出的值 → 就是记录的阶段", laterStage("distribution", null) === "distribution" && laterStage("distribution", undefined) === "distribution" && laterStage("distribution", "nonsense" as TenderStage) === "distribution");
  ok("靠后的那个：六段的每一对都核对一遍", ALL.every((a, i) => ALL.every((b, j) => laterStage(a, b) === TENDER_STAGE_ORDER[Math.max(i, j)])));

  const s = (o: Partial<WebNextStepInput>) => shownStageOf({ ...input, ...o });
  ok("没结束：记录项目分发、实际供应商报价 → 显示供应商报价", s({}) === "supplier_quote");
  ok("没结束：记录供应商报价（手工推进）、实际只发出了询价 → 显示供应商报价", s({ recordedStage: "supplier_quote", anyQuoted: false }) === "supplier_quote");
  ok("没结束：两者相同 → 就是它", s({ recordedStage: "supplier_quote" }) === "supplier_quote" && s({ recordedStage: "distribution", anyQuoted: false, anySent: false, hasUsableAnalysis: false }) === "distribution");
  ok("已结束：记录供应商询价、实际有报价 → 显示的就是记录的供应商询价（不把完成百分比抬高）", s({ stageFrozen: true, recordedStage: "supplier_inquiry" }) === "supplier_inquiry" && s({ stageFrozen: true, recordedStage: "initiation" }) === "initiation");
  ok("已结束：六段每一段都原样返回", ALL.every((r) => s({ stageFrozen: true, recordedStage: r }) === r));
  const v = decideWebNextStep(input);
  ok("「下一步」的结果：记录的阶段原样带出，显示的阶段按上面的规则", v.recordedStage === "distribution" && v.shownStage === "supplier_quote" && decideWebNextStep({ ...input, closedLabelZh: "未中标", stageFrozen: true }).shownStage === "distribution" && decideWebNextStep({ ...input, recordedStage: "submission" }).shownStage === "submission");

  // 记录的阶段：服务端与页面是同一套推导
  const cases: Array<Partial<TenderProject>> = [{}, { interpretedAt: iso(-5) }, { supplierInquiredAt: iso(-4) }, { supplierQuotedAt: iso(-3) }, { submittedAt: iso(-1) }, { distributedAt: null, intakeStatus: null }, { distributedAt: null, intakeStatus: null, tenderStatus: "pursuing" }, { distributedAt: null, intakeStatus: null, dispatchedAt: iso(-9) }, { distributedAt: null, intakeStatus: null, tenderStatus: "won" }];
  ok("记录的阶段：只给阶段记录那几项算出来的，与页面拿整个项目对象算的相同", cases.every((o) => { const p = project(o); return recordedStageOf({ tenderStatus: p.tenderStatus, intakeStatus: p.intakeStatus, distributedAt: p.distributedAt, dispatchedAt: p.dispatchedAt, interpretedAt: p.interpretedAt, supplierInquiredAt: p.supplierInquiredAt, supplierQuotedAt: p.supplierQuotedAt, submittedAt: p.submittedAt }) === getProjectStage(p); }) && cases.map((o) => getProjectStage(project(o))).join() === "distribution,interpretation,supplier_inquiry,supplier_quote,submission,initiation,interpretation,distribution,submission");
  ok("记录的阶段：时间是日期对象（服务端）与是字符串（页面）结果相同", recordedStageOf({ tenderStatus: null, supplierInquiredAt: new Date() }) === "supplier_inquiry" && recordedStageOf({ tenderStatus: null }) === "initiation");
  ok("招投标状态的终态：已提交、已中标、未中标、已放弃投标、已归档；其余不是", ["bid_submitted", "won", "lost", "passed", "archived"].every((x) => isTerminalTenderStatus(x)) && [null, undefined, "", "pursuing", "supplier_quote", "new"].every((x) => !isTerminalTenderStatus(x)));
  ok("认阶段名：六段各自认得；别的值、空值都是 null", ALL.every((x) => asTenderStage(x) === x) && [null, undefined, "", "nonsense", 3, {}, "Submission"].every((x) => asTenderStage(x) === null));
}

/* ---------- 3. 进度条与完成百分比 ---------- */
console.log("六段进度条与完成百分比");
{
  const p = project(); // 记录的阶段：项目分发；截标在 40 天后
  const line = (steps: ReturnType<typeof getStageSteps>) => steps.map((x) => `${x.key}:${x.status}`).join();
  ok("（前提）这个项目记录的阶段是项目分发", getProjectStage(p) === "distribution");
  const before = JSON.stringify([getStageSteps(p), getProjectCompletion(p)]);
  ok("不传「按这个阶段算」：与传记录的阶段逐字相同（原有的调用方不受影响）", JSON.stringify([getStageSteps(p, "distribution"), getProjectCompletion(p, "distribution")]) === before && JSON.stringify([getStageSteps(p, undefined), getProjectCompletion(p, undefined)]) === before);
  ok("按供应商报价算：前四段已完成，供应商报价是当前，项目提交待办", line(getStageSteps(p, "supplier_quote")) === "initiation:completed,distribution:completed,interpretation:completed,supplier_inquiry:completed,supplier_quote:current,submission:pending", getStageSteps(p, "supplier_quote"));
  ok("六段的权重：立项 0、项目分发 10、项目解读 10、供应商询价 20、供应商报价 50、项目提交 10", getStageSteps(p).map((x) => x.weight).join() === "0,10,10,20,50,10");
  ok("完成百分比逐段：立项 0、项目分发 0、项目解读 10、供应商询价 20、供应商报价 40、项目提交 90", ALL.map((x) => getProjectCompletion(p, x)).join() === "0,0,10,20,40,90" && getProjectCompletion(p) === 0);
  // 已逾期（截标已过、没有提交）
  const overdue = project({ closeDate: iso(-2) });
  ok("已逾期的项目按供应商询价算：前三段已完成，供应商询价及之后都是逾期", line(getStageSteps(overdue, "supplier_inquiry")) === "initiation:completed,distribution:completed,interpretation:completed,supplier_inquiry:overdue,supplier_quote:overdue,submission:overdue" && getProjectCompletion(overdue, "supplier_inquiry") === 20, getStageSteps(overdue, "supplier_inquiry"));
  ok("已逾期的项目不传：从记录的项目分发起都是逾期（与原来相同）", line(getStageSteps(overdue)) === "initiation:completed,distribution:overdue,interpretation:overdue,supplier_inquiry:overdue,supplier_quote:overdue,submission:overdue");
  // 已结束的项目：页面不会传一个比记录靠后的阶段（显示的阶段就是记录的）；这里把函数自身的行为钉住
  const lost = project({ tenderStatus: "lost", interpretedAt: iso(-8), supplierInquiredAt: iso(-6) });
  ok("未中标的项目不传：记录的供应商询价画成已完成，40%（与原来相同）", line(getStageSteps(lost)) === "initiation:completed,distribution:completed,interpretation:completed,supplier_inquiry:completed,supplier_quote:pending,submission:pending" && getProjectCompletion(lost) === 40);
  ok("（钉住）未中标的项目若按供应商报价算会变成 90%——所以已结束的项目显示的阶段取记录的", getProjectCompletion(lost, "supplier_quote") === 90 && line(getStageSteps(lost, "supplier_quote")).includes("supplier_quote:completed,submission:pending") && shownStageOf({ ...input, stageFrozen: true, recordedStage: "supplier_inquiry" }) === "supplier_inquiry");
  const submitted = project({ submittedAt: iso(-1) });
  ok("已提交的项目：传不传都一样（记录的已经是最后一段），100%", JSON.stringify(getStageSteps(submitted, "submission")) === JSON.stringify(getStageSteps(submitted)) && getProjectCompletion(submitted, "submission") === 100 && getProjectCompletion(submitted) === 100);
  ok("算进度条不改项目对象", (() => { const q = project(); const snap = JSON.stringify(q); getStageSteps(q, "supplier_quote"); getProjectCompletion(q, "supplier_quote"); return JSON.stringify(q) === snap; })());
  ok("项目进度区写的六段中文名与推进阶段时用的那一份相同", Object.keys(STAGE_LABEL).length === 6 && ALL.every((x) => readFileSync(join(process.cwd(), "src/components/tender/project-progress-section.tsx"), "utf8").includes(`${x}: "${STAGE_LABEL[x]}"`)), STAGE_LABEL);
}

/* ---------- 4. 接线（源码断言） ---------- */
console.log("接线");
{
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const page = read("src/app/(main)/projects/[id]/page.tsx");
  const tab = read("src/components/project-detail/tabs/workbench-tab.tsx");
  const section = read("src/components/tender/project-progress-section.tsx");
  const service = read("src/lib/tender-next-step/service.ts");
  const route = read("src/app/api/projects/[id]/next-step/route.ts");
  const pure = read("src/lib/tender-next-step/web-next-step.ts");
  const flat = (x: string) => x.replace(/\s+/g, " ");

  ok("页面文件仍然默认导出页面组件", /^export default function ProjectDetailPage\(\) \{/m.test(page) && /^function ProjectDetailContent\(\) \{/m.test(page));
  ok("页面显示的阶段 = 接口给出的显示的阶段；没有「下一步」、或给的值认不出时就是页面上记录的阶段", flat(page).includes("const displayStage = useMemo( () => (nextStepWanted && nextStep ? (asTenderStage(nextStep.shownStage) ?? tenderStage) : tenderStage), [nextStepWanted, nextStep, tenderStage], );"), flat(page).match(/const displayStage = useMemo\(.{0,260}/)?.[0]);
  ok("决策摘要与右侧项目上下文用的是显示的阶段，并随它重算", page.includes("stage: displayStage,") && !page.includes("stage: tenderStage,") && /stage: displayStage,[\s\S]{0,900}?\n {4}\[[\s\S]{0,400}?\bdisplayStage,[\s\S]{0,200}?\],/.test(page));
  ok("页面不写阶段记录：没有调用推进阶段的接口，也没有往项目上写阶段时间", !/advance-stage/.test(page) && !/supplierQuotedAt\s*[:=]|submittedAt\s*[:=]|interpretedAt\s*[:=]/.test(page) && !/advance-stage|supplierQuotedAt|interpretedAt/.test(section) && !/advance-stage/.test(tab));
  ok("取数只读：没有任何写库的调用", !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$transaction)\(/.test(service));
  ok("实际进度看取数时读出来的所有没取消的轮次（与取当前这一轮是同一次查询，最多 20 轮）", service.includes('where: { projectId, project: { orgId }, status: { not: "canceled" } },') && /take: 20,/.test(service) && service.includes('anySent: rounds.some((r) => r.items.some((i) => i.status !== "pending")),') && service.includes('anyQuoted: rounds.some((r) => r.items.some((i) => i.status === "quoted")),') && service.includes("hasUsableAnalysis: !!usableRun,"));
  ok("记录的阶段取自这次请求读到的项目记录；已放弃、已归档、招投标状态是终态都算已结束", service.includes("recordedStage: recordedStageOf(project),") && service.includes("stageFrozen: closedLabelOf(project) !== null || isTerminalTenderStatus(project.tenderStatus),") && ["intakeStatus", "distributedAt", "dispatchedAt", "interpretedAt", "supplierInquiredAt", "supplierQuotedAt"].every((k) => route.includes(`${k}: project.${k} ?? null,`)));
  ok("判断是纯函数、不调模型", pure.includes("export function actualStageOf(") && pure.includes("export function shownStageOf(") && !/fetch\(|@\/lib\/db|openai|anthropic/i.test(pure) && !/@\/lib\/db|fetch\(/.test(read("src/lib/tender/stage.ts")));
  ok("工作台把接口给的两项交给项目进度区；没有时传空（与原来相同）", tab.includes("shownStage={nextStep?.shownStage ?? null}") && tab.includes("recordedStageNow={nextStep?.recordedStage ?? null}"));
  ok("三步卡：有「下一步」卡片时不渲染，没有时照旧", /\{tenderish && !\(nextStep && onOpenNextStep\) \? \(\s*<ProjectOnboardingGuide/.test(tab) && tab.includes("{tenderish && nextStep && onOpenNextStep ? ("));
  ok("三步卡的代码还在（开关关闭时页面与原来相同）", read("src/components/project-onboarding/project-onboarding-guide.tsx").includes("export function ProjectOnboardingGuide"));
}

console.log(`\n✓ web-progress: ${passed} 项断言全部通过`);
