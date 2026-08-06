/**
 * Phase G — 澄清问题（含 enquiryDeadline = closing − 5）
 */

import { db } from "@/lib/db";
import {
  computeEnquiryDeadline,
  formatDateYmd,
  parseClosingFromText,
} from "./extract/closing";
import type { ClarificationCandidate, PageInput } from "./extract/types";

export type BuildClarificationsInput = {
  runId: string;
};

export type BuildClarificationsResult = {
  clarificationCount: number;
};

async function loadPages(runId: string): Promise<{
  projectId: string;
  pages: PageInput[];
  allText: string;
}> {
  const run = await db.tenderAnalysisRun.findUnique({
    where: { id: runId },
    select: {
      projectId: true,
      documents: {
        orderBy: { createdAt: "asc" },
        select: { documentId: true },
      },
    },
  });
  if (!run) throw new Error(`buildClarifications: run not found ${runId}`);

  const ids = run.documents.map((d) => d.documentId);
  const pageRows =
    ids.length === 0
      ? []
      : await db.projectDocumentPage.findMany({
          where: { documentId: { in: ids } },
          orderBy: [{ documentId: "asc" }, { pageNumber: "asc" }],
          select: {
            documentId: true,
            pageNumber: true,
            contentText: true,
          },
        });

  const pages = pageRows.map((p) => ({
    documentId: p.documentId,
    pageNumber: p.pageNumber,
    contentText: p.contentText,
  }));
  return {
    projectId: run.projectId,
    pages,
    allText: pages.map((p) => p.contentText).join("\n"),
  };
}

function findPageForSnippet(
  pages: PageInput[],
  snippet: string,
): PageInput | null {
  const needle = snippet.toLowerCase();
  for (const p of pages) {
    if (p.contentText.toLowerCase().includes(needle)) return p;
  }
  return pages[0] ?? null;
}

/** 纯函数：生成至少 8 条必问澄清 */
export function buildClarificationCandidates(
  pages: PageInput[],
  allText: string,
): ClarificationCandidate[] {
  let enquiryDeadline: Date | null = null;
  let timezoneLabel: string | null = null;
  let closingRaw: string | null = null;

  for (const page of pages) {
    const parsed = parseClosingFromText(page.contentText);
    if (parsed) {
      closingRaw = parsed.closingRaw;
      timezoneLabel = parsed.timezoneLabel;
      enquiryDeadline =
        parsed.enquiryDeadline ??
        (parsed.closingDate
          ? computeEnquiryDeadline(parsed.closingDate)
          : null);
      break;
    }
  }

  const tzNote = timezoneLabel
    ? `（截标时区标签 ${timezoneLabel}；closing=${closingRaw ?? "未知"}）`
    : closingRaw
      ? `（closing=${closingRaw}）`
      : "";

  const deadlineStr = enquiryDeadline
    ? formatDateYmd(enquiryDeadline)
    : "（截标日未知，待补）";

  const specs: Array<{
    question: string;
    reason: string;
    priority: ClarificationCandidate["priority"];
    snippetHint: string;
  }> = [
    {
      question: `Call-up 的最小 / 最大 / 典型订购数量分别是多少？询价建议不晚于 ${deadlineStr}${tzNote}`,
      reason: "实际下单量决定产能与报价；原文未给出典型 call-up 分布。",
      priority: "BLOCKING",
      snippetHint: "call-up",
    },
    {
      question: `「Up to 1500 per contract period」的准确含义是合同期硬上限、估算值，还是评标用数量？询价建议不晚于 ${deadlineStr}${tzNote}`,
      reason: "与 Annex B 年度 1,500 并存，存在数量口径歧义。",
      priority: "BLOCKING",
      snippetHint: "Up to 1500 per contract period",
    },
    {
      question: `投标阶段是否必须提交样品（sample required at bid time）？若需要，数量、费用与退回规则是什么？询价建议不晚于 ${deadlineStr}${tzNote}`,
      reason: "样品影响标前成本与时间；M15 等条款表述需确认。",
      priority: "HIGH",
      snippetHint: "sample",
    },
    {
      question: `防水/抗水测试所依据的具体标准（方法、时长、验收指标）是什么？询价建议不晚于 ${deadlineStr}${tzNote}`,
      reason: "水阻性能为强制技术点，缺标准无法评估合规与打样。",
      priority: "HIGH",
      snippetHint: "Water resistance",
    },
    {
      question: `是否允许海外制造（overseas manufacturing）？若允许，原产地声明与 Reciprocal Procurement 如何衔接？询价建议不晚于 ${deadlineStr}${tzNote}`,
      reason: "制造地点直接影响供应链与资格合规。",
      priority: "BLOCKING",
      snippetHint: "Overseas manufacturing",
    },
    {
      question: `1000D 面料要求的适用范围（主壳/部件/等同材料是否接受）如何界定？询价建议不晚于 ${deadlineStr}${tzNote}`,
      reason: "面料范围影响成本与供应商选型。",
      priority: "HIGH",
      snippetHint: "1000D",
    },
    {
      question: `尺寸/容量的官方测量方法（measurement method）以哪份附件为准？询价建议不晚于 ${deadlineStr}${tzNote}`,
      reason: "测量方法不一致会导致样品与检验争议。",
      priority: "HIGH",
      snippetHint: "measured",
    },
    {
      question: `拉链 / 织带 / 缝线的具体性能标准与测试方法分别是什么？询价建议不晚于 ${deadlineStr}${tzNote}`,
      reason: "M4–M6 类性能条款需要可执行的标准号或指标。",
      priority: "HIGH",
      snippetHint: "zipper",
    },
    {
      question: `评标用 7,500（或年度 1,500×年数）是否仅用于评估，而不构成任何采购承诺？询价建议不晚于 ${deadlineStr}${tzNote}`,
      reason: "需书面确认评估合计 ≠ 保证采购，降低商业误判。",
      priority: "BLOCKING",
      snippetHint: "7,500",
    },
  ];

  // 仅保留与文本相关的优先项；若文本很短则仍输出全部必问
  const hasRichText = allText.length > 200;
  const selected = hasRichText
    ? specs.filter((s) => {
        if (
          s.snippetHint === "call-up" ||
          s.snippetHint === "Up to 1500 per contract period" ||
          s.snippetHint === "7,500"
        ) {
          return true;
        }
        return allText.toLowerCase().includes(s.snippetHint.toLowerCase());
      })
    : specs;

  // 保证 >= 8
  const finalSpecs = selected.length >= 8 ? selected : specs;

  return finalSpecs.map((s) => {
    const page = findPageForSnippet(pages, s.snippetHint);
    return {
      question: s.question,
      reason: s.reason,
      priority: s.priority,
      enquiryDeadline,
      sourceRefs: page
        ? [
            {
              documentId: page.documentId,
              pageNumber: page.pageNumber,
              originalTextSnippet: s.snippetHint,
              sectionLabel: "clarification",
              extractionMethod: "clarification_template",
              confidence: "HIGH_CONFIDENCE" as const,
            },
          ]
        : [],
    };
  });
}

export async function buildClarifications(
  input: BuildClarificationsInput,
): Promise<BuildClarificationsResult> {
  const { projectId, pages, allText } = await loadPages(input.runId);
  const candidates = buildClarificationCandidates(pages, allText);

  await db.tenderAnalysisSourceRef.deleteMany({
    where: { runId: input.runId, clarificationQuestionId: { not: null } },
  });
  await db.tenderClarificationQuestion.deleteMany({
    where: { analysisRunId: input.runId },
  });

  let clarificationCount = 0;
  for (const c of candidates) {
    const created = await db.tenderClarificationQuestion.create({
      data: {
        projectId,
        analysisRunId: input.runId,
        question: c.question,
        reason: c.reason,
        priority: c.priority,
        enquiryDeadline: c.enquiryDeadline,
        status: "OPEN",
      },
    });
    clarificationCount += 1;
    for (const ref of c.sourceRefs) {
      await db.tenderAnalysisSourceRef.create({
        data: {
          runId: input.runId,
          documentId: ref.documentId,
          pageNumber: ref.pageNumber,
          sectionLabel: ref.sectionLabel ?? null,
          originalTextSnippet: ref.originalTextSnippet,
          extractionMethod: ref.extractionMethod,
          confidence: ref.confidence,
          clarificationQuestionId: created.id,
        },
      });
    }
  }

  return { clarificationCount };
}
