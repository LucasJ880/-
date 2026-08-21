import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import {
  translateAnalysisZh,
  TRANSLATE_MAX_ITEMS,
} from "@/lib/tender-auto-analysis/requirement-translate";

/**
 * 存量 run 的分析中文化补翻（新分析已在管线内自动翻译）：
 * 要求 chineseTranslation + 事实 contentZh + run.summaryJson.criticalFacts[*].text。
 * - 写权限门 + 60s 频控（防连点重复模型花费）
 * - 只更新翻译成功的条目；originalRequirement / contentOriginal 不动
 * - 纯格式转换：不触碰 mandatory/complianceStatus/status 等语义字段
 */

export const maxDuration = 120;

const RATE_KEY = "bidFitTranslateAt";
const RATE_WINDOW_MS = 60_000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const run = await db.tenderAnalysisRun.findFirst({
    where: { projectId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, summaryJson: true },
  });
  if (!run) {
    return NextResponse.json({ error: "该项目尚无已完成的分析" }, { status: 404 });
  }
  const sj = ((run.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const lastAt = Date.parse(String(sj[RATE_KEY] ?? "")) || 0;
  if (Date.now() - lastAt < RATE_WINDOW_MS) {
    return NextResponse.json({ error: "翻译刚执行过，请稍候再试" }, { status: 429 });
  }

  const reqRows = await db.tenderExtractedRequirement.findMany({
    where: { analysisRunId: run.id },
    orderBy: [{ mandatory: "desc" }, { requirementCode: "asc" }],
    take: TRANSLATE_MAX_ITEMS,
    select: { id: true, chineseTranslation: true },
  });
  const factRows = await db.tenderAnalysisFact.findMany({
    where: { runId: run.id },
    orderBy: { createdAt: "asc" },
    take: TRANSLATE_MAX_ITEMS,
    select: { id: true, contentZh: true },
  });
  const reqTargets = reqRows.map((r) => ({ id: r.id, chineseTranslation: r.chineseTranslation }));
  const factTargets = factRows.map((f) => ({ id: f.id, contentZh: f.contentZh ?? "" }));
  const before = {
    req: new Map(reqTargets.map((r) => [r.id, r.chineseTranslation])),
    fact: new Map(factTargets.map((f) => [f.id, f.contentZh])),
  };
  // criticalFacts 深拷贝后原地翻译，再整体写回 summaryJson
  const criticalFacts = JSON.parse(JSON.stringify(sj.criticalFacts ?? null)) as
    | Record<string, { status?: string; text?: string | null }>
    | null;

  const outcome = await translateAnalysisZh(
    { requirements: reqTargets, facts: factTargets, criticalFacts },
    { timeoutMs: 100_000 },
  );

  const reqUpdates = reqTargets.filter((r) => before.req.get(r.id) !== r.chineseTranslation);
  const factUpdates = factTargets.filter((f) => before.fact.get(f.id) !== f.contentZh);

  // 频控戳先落（即便零更新也占窗）；criticalFacts 一并写回
  await db.tenderAnalysisRun.update({
    where: { id: run.id },
    data: {
      summaryJson: JSON.parse(
        JSON.stringify({
          ...sj,
          ...(criticalFacts && outcome.byKind.criticalFacts > 0 ? { criticalFacts } : {}),
          [RATE_KEY]: new Date().toISOString(),
        }),
      ),
    },
  });
  if (reqUpdates.length > 0 || factUpdates.length > 0) {
    await db.$transaction([
      ...reqUpdates.map((u) =>
        db.tenderExtractedRequirement.update({
          where: { id: u.id },
          data: { chineseTranslation: u.chineseTranslation },
        }),
      ),
      ...factUpdates.map((u) =>
        db.tenderAnalysisFact.update({ where: { id: u.id }, data: { contentZh: u.contentZh } }),
      ),
    ]);
  }

  return NextResponse.json({ ok: true, ...outcome });
}
