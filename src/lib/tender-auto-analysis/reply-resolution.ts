/**
 * FB-15 — 业主回复 ↔ 原问题 自动关联
 *
 * 复用 V2 corpus-resolution 引擎（RESOLVE prompt：必须给出逐字引文+页码才算回答，
 * 绝不编造）。对每个「已发送未回答」的 ProjectQuestion，在提问之后新上传的文档中
 * 检索答案；命中 → status="replied"（schema 预留值）+ 证据写入最新 READY run 的
 * summaryJson.replyResolutions（SCHEMA=NONE）。
 *
 * 触发：worker FINALIZE 后 best-effort（与 auto-enqueue 同模式，失败不阻断分析）
 *       + 手动端点 POST /questions/check-replies 兜底。
 */

import { db } from "@/lib/db";
import {
  callStructured,
  createUnifiedRuntimeInvoker,
  type LlmInvoker,
} from "@/lib/tender-understanding/llm";
import {
  PROMPT_RESOLVE,
  RESOLVE_SYSTEM_PROMPT,
  buildResolveUserPrompt,
} from "@/lib/tender-understanding/prompts";
import { resolutionOutputSchema } from "@/lib/tender-understanding/contract";
import { normalizeForMatch } from "@/lib/tender-understanding/normalize";

const MAX_QUESTIONS_PER_PASS = 10;
const MAX_CANDIDATE_PAGES = 12;
const READY = ["REVIEW_REQUIRED", "APPROVED"];

export type ReplyResolution = {
  questionId: string;
  questionTitle: string;
  answerSummary: string;
  documentId: string;
  documentTitle: string | null;
  pageNumber: number;
  answerSnippet: string;
  resolvedAt: string;
};

export type ResolveOwnerRepliesResult = {
  checked: number;
  resolved: number;
  results: ReplyResolution[];
};

/** 简易相关性排序：问题词元与页面文本的重叠计分（与 clarify 检索同思路，独立实现避免耦合内部类型） */
function rankPages(
  pages: Array<{ documentId: string; pageNumber: number; contentText: string; documentTitle: string | null }>,
  query: string,
): typeof pages {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/)
    .filter((t) => t.length >= 2);
  const scored = pages.map((p) => {
    const text = p.contentText.toLowerCase();
    let score = 0;
    for (const t of terms) if (text.includes(t)) score += 1;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_CANDIDATE_PAGES).map((s) => s.p);
}

export async function resolveOwnerReplies(input: {
  projectId: string;
  invoker?: LlmInvoker;
}): Promise<ResolveOwnerRepliesResult> {
  const invoker = input.invoker ?? createUnifiedRuntimeInvoker();

  const questions = await db.projectQuestion.findMany({
    where: { projectId: input.projectId, status: "sent" },
    orderBy: { updatedAt: "asc" },
    take: MAX_QUESTIONS_PER_PASS,
    select: {
      id: true,
      title: true,
      description: true,
      clarificationNeeded: true,
      updatedAt: true,
    },
  });
  if (questions.length === 0) return { checked: 0, resolved: 0, results: [] };

  const earliestSent = questions[0].updatedAt;
  // 候选 = 提问之后新上传的用户文档（业主回复必然晚于提问）
  const docs = await db.projectDocument.findMany({
    where: {
      projectId: input.projectId,
      source: "upload",
      parseStatus: "done",
      createdAt: { gt: earliestSent },
    },
    select: { id: true, title: true, contentText: true, createdAt: true },
  });
  if (docs.length === 0) return { checked: questions.length, resolved: 0, results: [] };

  const pageRows = await db.projectDocumentPage.findMany({
    where: { documentId: { in: docs.map((d) => d.id) } },
    select: { documentId: true, pageNumber: true, contentText: true },
  });
  const titleByDoc = new Map(docs.map((d) => [d.id, d.title] as const));
  const allPages: Array<{
    documentId: string;
    pageNumber: number;
    contentText: string;
    documentTitle: string | null;
  }> = pageRows.map((p) => ({
    documentId: p.documentId,
    pageNumber: p.pageNumber,
    contentText: p.contentText,
    documentTitle: titleByDoc.get(p.documentId) ?? null,
  }));
  // 非 PDF 回复（docx/txt 无页级行）→ 以 contentText 合成单页候选（引文仍须逐字来自该文本）
  for (const d of docs) {
    if (!allPages.some((p) => p.documentId === d.id) && d.contentText?.trim()) {
      allPages.push({
        documentId: d.id,
        pageNumber: 1,
        contentText: d.contentText.slice(0, 8000),
        documentTitle: d.title,
      });
    }
  }
  if (allPages.length === 0) {
    return { checked: questions.length, resolved: 0, results: [] };
  }

  const results: ReplyResolution[] = [];
  for (const q of questions) {
    const docsAfter = docs.filter((d) => d.createdAt > q.updatedAt).map((d) => d.id);
    const pool = allPages.filter((p) => docsAfter.includes(p.documentId));
    if (pool.length === 0) continue;
    const queryText = [q.title, q.clarificationNeeded ?? ""].join(" ");
    const candidates = rankPages(pool, queryText);
    const res = await callStructured(
      invoker,
      {
        promptName: PROMPT_RESOLVE.name,
        promptVersion: PROMPT_RESOLVE.version,
        systemPrompt: RESOLVE_SYSTEM_PROMPT,
        userPrompt: buildResolveUserPrompt({
          question: q.title,
          whatIsUnknown: (q.clarificationNeeded || q.description).slice(0, 400),
          candidatePages: candidates.map((c) => ({
            documentId: c.documentId,
            pageNumber: c.pageNumber,
            contentText: c.contentText,
          })),
        }),
        maxTokens: 3_000,
        timeoutMs: 60_000,
      },
      resolutionOutputSchema,
    );
    if (
      res.ok &&
      res.value.resolved &&
      res.value.answerDocumentId &&
      res.value.answerPageNumber != null &&
      res.value.answerSnippet &&
      res.value.answerSummary
    ) {
      // 证据硬验证（与 clarify.ts verifyResolutionEvidence 同纪律）：
      // 引用的 文档+页 必须在候选集内，且逐字引文必须真实出现在该页文本中。
      // 幻觉引用一律拒收——问题保持「待回复」，绝不伪造已回答状态与页码。
      const cited = candidates.find(
        (c) =>
          c.documentId === res.value.answerDocumentId &&
          c.pageNumber === res.value.answerPageNumber,
      );
      const snippetVerified =
        cited != null &&
        normalizeForMatch(cited.contentText).includes(
          normalizeForMatch(res.value.answerSnippet),
        );
      if (snippetVerified) {
        results.push({
          questionId: q.id,
          questionTitle: q.title,
          answerSummary: res.value.answerSummary,
          documentId: res.value.answerDocumentId,
          documentTitle: titleByDoc.get(res.value.answerDocumentId) ?? null,
          pageNumber: res.value.answerPageNumber,
          answerSnippet: res.value.answerSnippet,
          resolvedAt: new Date().toISOString(),
        });
      }
    }
  }

  if (results.length > 0) {
    for (const r of results) {
      await db.projectQuestion.update({
        where: { id: r.questionId },
        data: { status: "replied" },
      });
    }
    // 证据写入最新 READY run summaryJson.replyResolutions（append 去重）
    const run = await db.tenderAnalysisRun.findFirst({
      where: { projectId: input.projectId, status: { in: READY } },
      orderBy: { createdAt: "desc" },
      select: { id: true, summaryJson: true },
    });
    if (run) {
      const sj = (run.summaryJson as Record<string, unknown>) ?? {};
      const prev = Array.isArray(sj.replyResolutions)
        ? (sj.replyResolutions as ReplyResolution[])
        : [];
      const seen = new Set(prev.map((p) => p.questionId));
      const merged = [...prev, ...results.filter((r) => !seen.has(r.questionId))];
      await db.tenderAnalysisRun.update({
        where: { id: run.id },
        data: { summaryJson: { ...sj, replyResolutions: merged } },
      });
    }
  }

  return { checked: questions.length, resolved: results.length, results };
}

export function readReplyResolutions(summaryJson: unknown): ReplyResolution[] {
  if (!summaryJson || typeof summaryJson !== "object") return [];
  const raw = (summaryJson as Record<string, unknown>).replyResolutions;
  return Array.isArray(raw) ? (raw as ReplyResolution[]) : [];
}
