import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import {
  translateRequirementTexts,
  TRANSLATE_MAX_ITEMS,
} from "@/lib/tender-auto-analysis/requirement-translate";

/**
 * 存量 run 的要求中文化补翻（新分析已在管线内自动翻译）。
 * - 写权限门 + 60s 频控（防连点重复模型花费）
 * - 只更新翻译成功的条目 chineseTranslation；originalRequirement 不动
 * - 纯格式转换：不触碰 mandatory/complianceStatus 等语义字段
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
    return NextResponse.json(
      { error: "翻译刚执行过，请稍候再试" },
      { status: 429 },
    );
  }

  const rows = await db.tenderExtractedRequirement.findMany({
    where: { analysisRunId: run.id },
    orderBy: [{ mandatory: "desc" }, { requirementCode: "asc" }],
    take: TRANSLATE_MAX_ITEMS,
    select: { id: true, chineseTranslation: true },
  });

  const updates: { id: string; zh: string }[] = [];
  const outcome = await translateRequirementTexts(
    rows.map((r) => r.chineseTranslation),
    {
      // maxDuration=120：留 15s 给写库/响应
      timeoutMs: 100_000,
      apply: (idx, zh) => updates.push({ id: rows[idx]!.id, zh }),
    },
  );

  // 频控戳先落（即便零更新也占窗，防对同一批英文反复烧模型）
  await db.tenderAnalysisRun.update({
    where: { id: run.id },
    data: {
      summaryJson: JSON.parse(
        JSON.stringify({ ...sj, [RATE_KEY]: new Date().toISOString() }),
      ),
    },
  });
  if (updates.length > 0) {
    await db.$transaction(
      updates.map((u) =>
        db.tenderExtractedRequirement.update({
          where: { id: u.id },
          data: { chineseTranslation: u.zh },
        }),
      ),
    );
  }

  return NextResponse.json({ ok: true, ...outcome });
}
