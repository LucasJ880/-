/**
 * FLOW-H1b 项目页的阶段与进度条跟着实际进度显示 — 纯逻辑测试 + 接线断言
 * 运行：npx tsx src/lib/tender-next-step/__tests__/web-progress.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TENDER_STAGE_ORDER, getProjectCompletion, getProjectStage, getStageSteps, laterStage } from "@/lib/tender/stage";
import type { TenderProject, TenderStage } from "@/lib/tender/types";
import type { NextStepStage } from "../targets";
import { actualStageOf, decideWebNextStep, type WebNextStepInput } from "../web-next-step";

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

const NOW = new Date("2026-11-12T15:00:00Z");
const project = (o: Partial<TenderProject> = {}): TenderProject => ({
  createdAt: "2026-11-01T00:00:00Z", tenderStatus: null, publicDate: null, questionCloseDate: null, closeDate: "2026-12-20T17:00:00Z", dueDate: null,
  distributedAt: "2026-11-02T00:00:00Z", interpretedAt: null, supplierInquiredAt: null, supplierQuotedAt: null, submittedAt: null, awardDate: null, intakeStatus: "dispatched", ...o,
});

/* ---------- 1. 实际进度到了哪一段 ---------- */
console.log("实际进度到了哪一段");
{
  const f = (o: Partial<Parameters<typeof actualStageOf>[0]> = {}) => actualStageOf({ submittedAt: null, anyQuoted: false, anySent: false, hasUsableAnalysis: false, ...o });
  ok("什么都没有 → 立项", f() === "initiation");
  ok("有等待审核或已批准的分析 → 项目解读", f({ hasUsableAnalysis: true }) === "interpretation");
  ok("有供应商已发出 → 供应商询价（即使没有分析——有人直接手工发了）", f({ hasUsableAnalysis: true, anySent: true }) === "supplier_inquiry" && f({ anySent: true }) === "supplier_inquiry");
  ok("有供应商已报价 → 供应商报价", f({ hasUsableAnalysis: true, anySent: true, anyQuoted: true }) === "supplier_quote" && f({ anyQuoted: true }) === "supplier_quote");
  ok("有提交时间 → 项目提交（不管前面几项）", f({ submittedAt: NOW }) === "submission" && f({ submittedAt: NOW, anyQuoted: true, anySent: true, hasUsableAnalysis: true }) === "submission");
  const bools = [false, true];
  const every = bools.flatMap((a) => bools.flatMap((b) => bools.flatMap((c) => bools.map((d) => f({ submittedAt: a ? NOW : null, anyQuoted: b, anySent: c, hasUsableAnalysis: d })))));
  ok("十六种组合都核对：从不返回「项目分发」（有没有分发由阶段记录管）；越靠后的事实优先", every.length === 16 && every.every((s) => (s as string) !== "distribution") && every.filter((s) => s === "submission").length === 8 && every.filter((s) => s === "supplier_quote").length === 4 && every.filter((s) => s === "supplier_inquiry").length === 2 && every.filter((s) => s === "interpretation").length === 1 && every.filter((s) => s === "initiation").length === 1);
  ok("确定性：同样的事实两次结果相同", f({ anySent: true }) === f({ anySent: true }));
  // 经「下一步」的判断带出来
  const input: WebNextStepInput = {
    now: NOW, projectId: "p1", projectName: "示例标", closedLabelZh: null, won: false, closeDate: new Date("2026-12-20T17:00:00Z"), submittedAt: null,
    documentCount: 2, parsingActive: false, analysisStatus: "APPROVED", latestAnalysisFailed: false, unknownCriticalFacts: 0, mandatoryNonCompliant: 0, pendingRequirementCount: 0, confirmedRequirementCount: 3,
    pendingApprovals: [], latestRound: null, hasProjectQuote: false, hasUsableAnalysis: true, anySent: true, anyQuoted: true, chaseAfterDays: 3, canManage: true, workspace: null, rfqEntry: null,
  };
  ok("「下一步」的结果里带着实际进度", decideWebNextStep(input).actualStage === "supplier_quote" && decideWebNextStep({ ...input, anyQuoted: false }).actualStage === "supplier_inquiry");
  ok("项目已结束、已提交、截标已过这些提前返回的结果里同样带着", decideWebNextStep({ ...input, closedLabelZh: "未中标" }).actualStage === "supplier_quote" && decideWebNextStep({ ...input, submittedAt: NOW }).actualStage === "submission" && decideWebNextStep({ ...input, closeDate: new Date("2026-11-01T00:00:00Z") }).actualStage === "supplier_quote" && decideWebNextStep({ ...input, won: true }).actualStage === "supplier_quote");
  const all: NextStepStage[] = ["initiation", "distribution", "interpretation", "supplier_inquiry", "supplier_quote", "submission"];
  ok("接口里的阶段名与页面用的六段是同一组值、同一个顺序", all.join() === TENDER_STAGE_ORDER.join() && all.join() === STAGE_ORDER.join() && STAGE_ORDER.length === 6);
}

/* ---------- 2. 显示的阶段取靠后的那个 ---------- */
console.log("显示的阶段：记录的与实际的里靠后的那个");
{
  ok("记录落后（项目分发）、实际已到供应商报价 → 显示供应商报价", laterStage("distribution", "supplier_quote") === "supplier_quote");
  ok("记录超前（有人手工推到了供应商报价）、实际只到供应商询价 → 以记录为准", laterStage("supplier_quote", "supplier_inquiry") === "supplier_quote");
  ok("两者相同 → 就是它", laterStage("interpretation", "interpretation") === "interpretation");
  ok("实际进度是立项（最低）：永远不会把记录的阶段拉回去", (TENDER_STAGE_ORDER as TenderStage[]).every((s) => laterStage(s, "initiation") === s));
  ok("没有实际进度（接口不可用）或认不出的值 → 就是记录的阶段", laterStage("distribution", null) === "distribution" && laterStage("distribution", undefined) === "distribution" && laterStage("distribution", "nonsense" as TenderStage) === "distribution");
  ok("六段的每一对都核对一遍：结果总是两者里靠后的", (TENDER_STAGE_ORDER as TenderStage[]).every((a, i) => (TENDER_STAGE_ORDER as TenderStage[]).every((b, j) => laterStage(a, b) === TENDER_STAGE_ORDER[Math.max(i, j)])));
  const sectionSrc = readFileSync(join(process.cwd(), "src/components/tender/project-progress-section.tsx"), "utf8");
  ok("项目进度区写的六段中文名与推进阶段时用的那一份相同", Object.keys(STAGE_LABEL).length === 6 && (TENDER_STAGE_ORDER as TenderStage[]).every((s) => sectionSrc.includes(`${s}: "${STAGE_LABEL[s]}"`)), STAGE_LABEL);
}

/* ---------- 3. 进度条与完成百分比 ---------- */
console.log("六段进度条与完成百分比");
{
  const p = project(); // 记录的阶段：项目分发
  ok("（前提）这个项目记录的阶段是项目分发", getProjectStage(p) === "distribution");
  const before = JSON.stringify([getStageSteps(p), getProjectCompletion(p)]);
  ok("不传「按这个阶段算」：与传记录的阶段逐字相同（原有的调用方不受影响）", JSON.stringify([getStageSteps(p, "distribution"), getProjectCompletion(p, "distribution")]) === before && JSON.stringify([getStageSteps(p, undefined), getProjectCompletion(p, undefined)]) === before);
  const steps = getStageSteps(p, "supplier_quote");
  ok("按供应商报价算：前四段已完成，供应商报价是当前，项目提交待办", steps.map((s) => `${s.key}:${s.status}`).join() === "initiation:completed,distribution:completed,interpretation:completed,supplier_inquiry:completed,supplier_quote:current,submission:pending", steps);
  ok("完成百分比：按供应商报价算是前四段的权重之和（40%），按记录的项目分发算是 0%", getProjectCompletion(p, "supplier_quote") === 40 && getProjectCompletion(p) === 0 && getProjectCompletion(p, "supplier_inquiry") === 20);
  ok("六段的权重加起来是 100", getStageSteps(p).reduce((sum, s) => sum + s.weight, 0) === 100);
  const submitted = project({ submittedAt: "2026-11-10T00:00:00Z" });
  ok("已提交的项目：传不传都一样（记录的已经是最后一段）", JSON.stringify(getStageSteps(submitted, laterStage(getProjectStage(submitted), "supplier_quote"))) === JSON.stringify(getStageSteps(submitted)) && getProjectCompletion(submitted, "submission") === 100);
  ok("算进度条不改项目对象", JSON.stringify(p) === JSON.stringify(project()));
}

/* ---------- 4. 接线（源码断言） ---------- */
console.log("接线");
{
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const page = read("src/app/(main)/projects/[id]/page.tsx");
  const tab = read("src/components/project-detail/tabs/workbench-tab.tsx");
  const section = read("src/components/tender/project-progress-section.tsx");
  const service = read("src/lib/tender-next-step/service.ts");
  const pure = read("src/lib/tender-next-step/web-next-step.ts");

  ok("页面文件仍然默认导出页面组件", /^export default function ProjectDetailPage\(\) \{/m.test(page) && /^function ProjectDetailContent\(\) \{/m.test(page));
  ok("页面显示的阶段 = 记录的阶段与实际进度里靠后的那个；没有「下一步」时就是记录的阶段", page.includes("() => (nextStepWanted && nextStep ? laterStage(tenderStage, nextStep.actualStage) : tenderStage),") && page.includes("stage: displayStage,") && !page.includes("stage: tenderStage,"));
  ok("页面不写阶段记录：没有调用推进阶段的接口，也没有往项目上写阶段时间", !/advance-stage/.test(page) && !/supplierQuotedAt\s*[:=]|submittedAt\s*[:=]|interpretedAt\s*[:=]/.test(page) && !/advance-stage|supplierQuotedAt|interpretedAt/.test(section) && !/advance-stage/.test(tab));
  ok("取数只读：没有任何写库的调用（实际进度是从已经读出来的轮次里算的）", !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$transaction)\(/.test(service) && service.includes('anySent: rounds.some((r) => r.items.some((i) => i.status !== "pending")),') && service.includes('anyQuoted: rounds.some((r) => r.items.some((i) => i.status === "quoted")),') && service.includes("hasUsableAnalysis: !!usableRun,"));
  ok("实际进度看的轮次不含已取消的（与取当前这一轮用的是同一次查询）", service.includes('where: { projectId, project: { orgId }, status: { not: "canceled" } },'));
  ok("实际进度的判断是纯函数、不调模型", pure.includes("export function actualStageOf(") && !/fetch\(|@\/lib\/db|openai|anthropic/i.test(pure));
  ok("项目进度区：显示的阶段、进度条、百分比都按「靠后的那个」算", section.includes("const currentStage = laterStage(recordedStage, actualStage);") && section.includes("const stages = getStageSteps(project, currentStage);") && section.includes("const completion = getProjectCompletion(project, currentStage);"));
  ok("两者不一致时才出现说明，说明里写出记录的阶段", /\{currentStage !== recordedStage && \(\s*<p[^>]*data-testid="progress-stage-note"/.test(section) && section.includes("记录的阶段还是「{STAGE_LABELS[recordedStage] || recordedStage}」") && section.includes("阶段记录没有自动推进"));
  ok("工作台把接口给的实际进度交给项目进度区；没有时传空（与原来相同）", tab.includes("actualStage={nextStep?.actualStage ?? null}"));
  ok("三步卡：有「下一步」卡片时不渲染，没有时照旧", tab.includes("{tenderish && !(nextStep && onOpenNextStep) ? (") && /\{tenderish && !\(nextStep && onOpenNextStep\) \? \(\s*<ProjectOnboardingGuide/.test(tab) && tab.includes("{tenderish && nextStep && onOpenNextStep ? ("));
  ok("三步卡的代码还在（开关关闭时页面与原来相同）", read("src/components/project-onboarding/project-onboarding-guide.tsx").includes("export function ProjectOnboardingGuide"));
}

console.log(`\n✓ web-progress: ${passed} 项断言全部通过`);
