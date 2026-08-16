/**
 * T5-P1 Segment 4 — canonical parity 比对（A=legacy full V2 vs B=Workforce 确定性 V2）
 *
 * 只比 canonical 语义域，不做 LLM 文案逐字节比较（真实模型本就非确定性）。
 * 用法：DATABASE_URL=… npx tsx scripts/t5-seg4-parity-compare.ts <legacyRunId> <workforceRunId>
 */

import { db } from "@/lib/db";

const [legacyRunId, workforceRunId] = process.argv.slice(2);
if (!legacyRunId || !workforceRunId) {
  console.error("usage: t5-seg4-parity-compare.ts <legacyRunId> <workforceRunId>");
  process.exit(1);
}

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

async function snap(runId: string) {
  const run = await db.tenderAnalysisRun.findUniqueOrThrow({
    where: { id: runId },
    select: { id: true, status: true, model: true, promptVersion: true, analysisVersion: true, summaryJson: true, projectId: true },
  });
  const sj = (run.summaryJson ?? {}) as Record<string, unknown>;
  const [facts, requirements, sourceRefs, sections, clarifications, deliverables] = await Promise.all([
    db.tenderAnalysisFact.findMany({
      where: { runId }, orderBy: { id: "asc" },
      select: { statementKind: true, contentZh: true, sourceRefs: { select: { documentId: true, pageNumber: true } } },
    }),
    db.tenderExtractedRequirement.findMany({
      where: { analysisRunId: runId }, orderBy: { requirementCode: "asc" },
      select: { requirementCode: true, category: true, originalRequirement: true, mandatory: true, evidenceRequired: true, sourcePage: true,
        sourceRefs: { select: { documentId: true, pageNumber: true } } },
    }),
    db.tenderAnalysisSourceRef.count({ where: { runId } }),
    db.tenderAnalysisSection.findMany({ where: { runId }, select: { sectionKey: true, structuredJson: true } }),
    db.tenderClarificationQuestion.findMany({ where: { analysisRunId: runId }, select: { question: true, priority: true } }),
    db.tenderDeliverable.findMany({ where: { analysisRunId: runId }, select: { deliverableKey: true, title: true, mandatory: true, sourcePage: true } }),
  ]);
  const rs = (sections.find((s) => s.sectionKey === "RISKS")?.structuredJson ?? {}) as Record<string, unknown>;
  const risks = Array.isArray(rs.risks) ? (rs.risks as Array<Record<string, unknown>>) : [];
  const checklist = Array.isArray(sj.submissionChecklist) ? (sj.submissionChecklist as Array<Record<string, unknown>>) : [];
  const docs = await db.projectDocument.findMany({ where: { projectId: run.projectId }, select: { id: true, title: true } });
  return { run, sj, facts, requirements, sourceRefs, sections, clarifications, deliverables, risks, checklist, docs };
}

/** 粗粒度语义键：去噪后的小写词集合，用于跨模型措辞差异的兼容匹配 */
function semKey(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9一-鿿 ]+/g, " ").split(/\s+/)
      .filter((w) => w.length > 3).slice(0, 40),
  );
}
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.min(a.size, b.size);
}
/** X/Y：X = 在对侧找到语义兼容项的抽样数 */
function sampleParity(aItems: string[], bItems: string[], threshold = 0.34) {
  const sample = aItems.slice(0, Math.min(10, aItems.length));
  if (sample.length === 0) return { matched: 0, total: 0, label: "0/0 N/A" };
  const bKeys = bItems.map(semKey);
  let matched = 0;
  for (const s of sample) {
    const k = semKey(s);
    if (bKeys.some((bk) => overlap(k, bk) >= threshold)) matched++;
  }
  return { matched, total: sample.length, label: `${matched}/${sample.length}` };
}

async function main() {
  const A = await snap(legacyRunId);
  const B = await snap(workforceRunId);
  console.log("A(legacy)   ", JSON.stringify({ id: A.run.id, v: A.run.analysisVersion, status: A.run.status, model: A.run.model,
    facts: A.facts.length, reqs: A.requirements.length, refs: A.sourceRefs, sections: A.sections.length, clar: A.clarifications.length, risks: A.risks.length, checklist: A.checklist.length, deliv: A.deliverables.length }));
  console.log("B(workforce)", JSON.stringify({ id: B.run.id, v: B.run.analysisVersion, status: B.run.status, model: B.run.model,
    facts: B.facts.length, reqs: B.requirements.length, refs: B.sourceRefs, sections: B.sections.length, clar: B.clarifications.length, risks: B.risks.length, checklist: B.checklist.length, deliv: B.deliverables.length }));

  /* —— §8 canonical 契约完整性 —— */
  const domains: Array<[string, number, number]> = [
    ["facts", A.facts.length, B.facts.length],
    ["requirements", A.requirements.length, B.requirements.length],
    ["sourceRefs", A.sourceRefs, B.sourceRefs],
    ["sections", A.sections.length, B.sections.length],
    ["clarifications", A.clarifications.length, B.clarifications.length],
    ["risks", A.risks.length, B.risks.length],
    ["submissionChecklist", A.checklist.length, B.checklist.length],
  ];
  const oneSided = domains.filter(([, a, b]) => (a > 0 && b === 0) || (b > 0 && a === 0));
  ok(oneSided.length === 0, "CANONICAL_CONTRACT_PARITY：无任一 canonical domain 单边整体缺失", oneSided);

  const FIELDS = ["submissionChecklist", "criticalFacts", "conflicts", "addendumChanges", "unknowns", "evidenceCoverage", "analystSynthesis", "brief", "metadata"];
  const aMiss = FIELDS.filter((f) => A.sj[f] === undefined);
  const bMiss = FIELDS.filter((f) => B.sj[f] === undefined);
  ok(aMiss.length === 0 && bMiss.length === 0, "summaryJson 九个语义字段两路齐备", { aMiss, bMiss });
  ok(A.sections.length === 16 && B.sections.length === 16, "16 个报告章节两路齐备", { a: A.sections.length, b: B.sections.length });

  /* —— §9 抽样语义 parity —— */
  const factP = sampleParity(A.facts.map((f) => f.contentZh), B.facts.map((f) => f.contentZh));
  const reqP = sampleParity(A.requirements.map((r) => r.originalRequirement), B.requirements.map((r) => r.originalRequirement));
  const subP = sampleParity(A.checklist.map((c) => String(c.statement ?? "")), B.checklist.map((c) => String(c.statement ?? "")));
  const riskSevA = A.risks.filter((r) => ["CRITICAL", "HIGH"].includes(String(r.severity).toUpperCase()));
  const riskSevB = B.risks.filter((r) => ["CRITICAL", "HIGH"].includes(String(r.severity).toUpperCase()));
  const riskP = sampleParity(riskSevA.map((r) => String(r.description ?? "")), riskSevB.map((r) => String(r.description ?? "")));
  const clarP = sampleParity(A.clarifications.map((c) => c.question), B.clarifications.map((c) => c.question));
  console.log(`\nFACT_PARITY = ${factP.label}\nREQUIREMENT_PARITY = ${reqP.label}\nSUBMISSION_PARITY = ${subP.label}\nRISK_PARITY = ${riskP.label}\nCLARIFICATION_PARITY = ${clarP.label}`);
  ok(factP.matched >= Math.ceil(factP.total * 0.5), `FACT_PARITY ≥ 50%（${factP.label}）`);
  ok(reqP.matched >= Math.ceil(reqP.total * 0.5), `REQUIREMENT_PARITY ≥ 50%（${reqP.label}）`);
  ok(subP.matched >= Math.ceil(subP.total * 0.5), `SUBMISSION_PARITY ≥ 50%（${subP.label}）`);

  /* —— §11 证据可追 —— */
  const aReqRefs = A.requirements.slice(0, 10).filter((r) => r.sourceRefs.length > 0 || r.sourcePage != null).length;
  const bReqRefs = B.requirements.slice(0, 10).filter((r) => r.sourceRefs.length > 0 || r.sourcePage != null).length;
  const aFactRefs = A.facts.slice(0, 10).filter((f) => f.sourceRefs.length > 0).length;
  const bFactRefs = B.facts.slice(0, 10).filter((f) => f.sourceRefs.length > 0).length;
  const aDocIds = new Set(A.docs.map((d) => d.id));
  const bDocIds = new Set(B.docs.map((d) => d.id));
  const aRefDocsOk = A.facts.slice(0, 10).every((f) => f.sourceRefs.every((r) => aDocIds.has(r.documentId)));
  const bRefDocsOk = B.facts.slice(0, 10).every((f) => f.sourceRefs.every((r) => bDocIds.has(r.documentId)));
  ok(aReqRefs >= 8 && bReqRefs >= 8 && aFactRefs >= 8 && bFactRefs >= 8,
    `EVIDENCE_TRACEABILITY：抽样要求/事实均带来源（A ${aReqRefs}/10·${aFactRefs}/10，B ${bReqRefs}/10·${bFactRefs}/10）`);
  ok(aRefDocsOk && bRefDocsOk, "来源引用均指向本项目自己的文档（无跨项目/错文档）");

  /* —— §10 交付物（仅 B 路物化；A 路 legacy 在 V2 下不产静态模板） —— */
  const bKeyFor = (code: string) => "req_" + code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  const bReqByCode = new Map(B.requirements.map((r) => [r.requirementCode, r]));
  const bDelivByKey = new Map(B.deliverables.map((d) => [d.deliverableKey, d]));
  let matched = 0, missing = 0, unsupported = 0;
  for (const item of B.checklist) {
    const req = bReqByCode.get(String(item.requirementId));
    if (!req) { unsupported++; continue; }
    if (bDelivByKey.has(bKeyFor(req.requirementCode))) matched++; else missing++;
  }
  const extra = B.deliverables.length - matched;
  const STATIC = ["tech_proposal", "price_sheet", "bid_bond", "company_profile", "compliance_matrix"];
  const staticHits = B.deliverables.filter((d) => STATIC.includes(d.deliverableKey)).length;
  console.log(`\nCHECKLIST_COUNT = ${B.checklist.length}\nMATERIALIZED_COUNT = ${B.deliverables.length}\nMATCHED = ${matched}\nMISSING = ${missing}\nEXTRA = ${extra}\nUNSUPPORTED = ${unsupported}\nSTATIC_TEMPLATE_ITEMS = ${staticHits}`);
  ok(missing === 0 && extra === 0 && unsupported === 0 && staticHits === 0,
    "DELIVERABLE_PARITY：checklist 逐条物化、零缺零多零无依据、零静态模板");

  /* —— §12 addendum —— */
  const aAdd = Array.isArray(A.sj.addendumChanges) ? (A.sj.addendumChanges as unknown[]).length : 0;
  const bAdd = Array.isArray(B.sj.addendumChanges) ? (B.sj.addendumChanges as unknown[]).length : 0;
  console.log(`\nADDENDUM: A=${aAdd} B=${bAdd}`);
  ok(!(aAdd > 0 && bAdd === 0) && !(bAdd > 0 && aAdd === 0),
    `ADDENDUM_PRECEDENCE_PARITY = ${aAdd === 0 && bAdd === 0 ? "NA（本包无 addendum 变更）" : "PASS"}`);

  /* —— §14 hard fail：Workforce 不得产生第二套真相 —— */
  const bRiskShape = (B.sections.find((s) => s.sectionKey === "RISKS")?.structuredJson ?? {}) as Record<string, unknown>;
  ok(typeof bRiskShape.version !== "string",
    "B 路 RISKS 章节是 canonical V2 形状（非 Workforce 二次生成的 tender-workforce-risks/v1）", bRiskShape.version);

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("COMPARE_ERROR", e instanceof Error ? e.stack : e);
  await db.$disconnect();
  process.exit(1);
});
