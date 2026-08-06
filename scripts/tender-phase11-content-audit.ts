/**
 * Post-E2E content audit against isolated DB (no secrets printed).
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
    throw new Error("DATABASE_ENVIRONMENT must be isolated");
  }
  const db = new PrismaClient();
  try {
    const run = await db.tenderAnalysisRun.findFirst({
      where: { status: "APPROVED" },
      orderBy: { createdAt: "desc" },
    });
    if (!run) throw new Error("no approved run");

    const facts = await db.tenderAnalysisFact.findMany({
      where: { runId: run.id },
      include: { sourceRefs: { select: { id: true, pageNumber: true } } },
    });
    const byKind: Record<string, number> = {};
    for (const f of facts) {
      byKind[f.statementKind] = (byKind[f.statementKind] || 0) + 1;
    }
    const withSrc = facts.filter((f) => f.sourceRefs.length > 0).length;
    const confirmed = facts.filter((f) => f.statementKind === "CONFIRMED_FACT");
    const confirmedWithSrc = confirmed.filter((f) => f.sourceRefs.length > 0).length;

    const reqs = await db.tenderExtractedRequirement.findMany({
      where: { analysisRunId: run.id },
      orderBy: { requirementCode: "asc" },
    });
    const clar = await db.tenderClarificationQuestion.findMany({
      where: { analysisRunId: run.id },
      select: { question: true, reason: true, enquiryDeadline: true, priority: true },
    });
    const dels = await db.tenderDeliverable.findMany({
      where: { analysisRunId: run.id },
      select: { title: true, deliverableKey: true, mandatory: true },
    });
    const tasks = await db.task.findMany({
      where: { projectId: run.projectId, sourceId: run.id },
      select: { title: true, sourceTemplateKey: true, status: true },
    });
    const sections = await db.tenderAnalysisSection.findMany({
      where: { runId: run.id },
      select: { sectionKey: true, contentZh: true },
    });
    const blob = [
      ...sections.map((s) => s.contentZh),
      ...facts.map((f) => `${f.contentZh}\n${f.contentOriginal}`),
      ...clar.map((c) => c.question),
      ...dels.map((d) => d.title),
      ...tasks.map((t) => t.title),
    ].join("\n");
    const needles = [
      "M5000-25-3574",
      "RCMP",
      "Backpacks",
      "RISO",
      "2026-08-18",
      "MDT",
      "选择期",
      "5MB",
      "ZIP",
      "90",
      "最低价",
      "DDP",
      "Regina",
      "30天",
      "24小时",
      "环保",
      "Reciprocal",
      "Forced Labour",
      "7,500",
      "7500",
      "1500",
      "样品",
      "防泼水",
      "海外",
      "1000D",
      "拉链",
    ];
    const contentHits = Object.fromEntries(needles.map((n) => [n, blob.includes(n)]));
    const qtyFacts = facts
      .filter((f) =>
        /1500|7500|7,?500|quantity|保证|ambigu/i.test(
          `${f.contentZh} ${f.contentOriginal}`,
        ),
      )
      .map((f) => ({
        kind: f.statementKind,
        zh: (f.contentZh || "").slice(0, 180),
        pages: f.sourceRefs.map((s) => s.pageNumber),
      }));
    const room = await db.bidIntelligenceRoom.findFirst({
      where: { projectId: run.projectId },
      select: { summaryText: true, goDecision: true },
    });
    const addRun = await db.tenderAnalysisRun.findFirst({
      where: { projectId: run.projectId, runKind: "INCREMENTAL" },
      select: { id: true, parentRunId: true, status: true },
    });
    const changeCandidates = addRun
      ? await db.tenderAnalysisChangeCandidate.count({ where: { runId: addRun.id } })
      : 0;

    const falseGuaranteed = /保证采购|guaranteed purchase|guaranteed quantity/i.test(blob);
    const fabricated = {
      sampleRequiredAsFact: /必须提供样品|sample is mandatory/i.test(
        sections.find((s) => s.sectionKey === "MANDATORY_REQUIREMENTS")?.contentZh || "",
      ),
      historicalWinner: /历史中标|previous awardee|incumbent supplier/i.test(blob),
      budgetInvented: /采购预算为|budget is CAD/i.test(blob),
    };

    console.log(
      JSON.stringify(
        {
          runId: run.id,
          status: run.status,
          model: run.model,
          promptVersion: run.promptVersion,
          analysisVersion: run.analysisVersion,
          attemptCount: run.attemptCount,
          factKinds: byKind,
          factsTotal: facts.length,
          factsWithSource: withSrc,
          sourceCoverage: facts.length ? withSrc / facts.length : 0,
          confirmedFactCount: confirmed.length,
          confirmedWithSource: confirmedWithSrc,
          reqs: reqs.map((r) => ({
            code: r.requirementCode,
            mandatory: r.mandatory,
            compliance: r.complianceStatus,
            review: r.reviewStatus,
            page: r.sourcePage,
            hasOrig: Boolean(r.originalRequirement?.trim()),
            hasZh: Boolean(r.chineseTranslation?.trim()),
          })),
          clarCount: clar.length,
          clarSample: clar.map((c) => c.question.slice(0, 120)),
          clarDeadlines: clar.map((c) => c.enquiryDeadline?.toISOString() ?? null),
          deliverables: dels.map((d) => ({ key: d.deliverableKey, title: d.title })),
          tasks: tasks.map((t) => ({ title: t.title, key: t.sourceTemplateKey })),
          sectionLens: Object.fromEntries(
            sections.map((s) => [s.sectionKey, s.contentZh.length]),
          ),
          contentHits,
          qtyFacts,
          roomSummaryLen: room?.summaryText?.length ?? 0,
          roomSummaryPreview: (room?.summaryText || "").slice(0, 240),
          goDecision: room?.goDecision ?? null,
          addRun,
          changeCandidates,
          falseGuaranteed,
          fabricated,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
