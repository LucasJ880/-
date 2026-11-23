/**
 * POST /api/projects/[id]/inquiries/[inquiryId]/compare/analysis（项目读权限）
 *
 * P1-6：先用代码出落地价比价矩阵（compare-service），LLM 只拿矩阵写"解读"——
 * 不再把原始报价行交给 LLM 自己算。summary / recommendedSupplier 来自矩阵（代码），
 * priceAnalysis / deliveryAnalysis / risks / recommendation 来自 LLM 的解读。
 * 响应结构与 QuoteAnalysisPanel 兼容，另附 matrix。
 *
 * P1-6G：返回前用代码复核解读里的数字（interpretation-guard）——必须能在交给 LLM 的输入里找到，
 * 找不到的就地标注「［矩阵中无此数］」，并在 numberCheck 里列出；界面据此提示以矩阵为准。
 *
 * CHAIN-2e：没有财务查看权的人（与成本核算同一判定）——矩阵先裁剪（落地价、换算说明、带金额的结论去掉），
 * 模型只拿裁剪后的矩阵（仍是这一次调用，提示词写明不提供落地价），数字校验用同一份输入；响应（含 502）只带裁剪后的矩阵与 costHidden。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { toPrismaHttpError } from "@/lib/inquiry/service";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import { loadCompareMatrix } from "@/lib/tender-rfq/compare-service";
import { buildInterpretationPayload, buildMatrixInterpretationPrompt, compareMatrixFinanceView } from "@/lib/tender-rfq/compare";
import { resolveFinanceViewSafe } from "@/lib/project-finance/access";
import { checkInterpretationNumbers, collectAllowedNumbers } from "@/lib/tender-rfq/interpretation-guard";

type Params = { params: Promise<{ id: string; inquiryId: string }> };

type Interpretation = { priceAnalysis: string; deliveryAnalysis: string; risks: string; recommendation: string };

function readInterpretation(raw: string): Interpretation | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return { priceAnalysis: str(o.priceAnalysis), deliveryAnalysis: str(o.deliveryAnalysis), risks: str(o.risks), recommendation: str(o.recommendation) };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  if (!isAIConfigured()) {
    return NextResponse.json({ error: "AI 功能未配置" }, { status: 503 });
  }

  try {
    const r = await loadCompareMatrix({ projectId, inquiryId });
    if (!r.ok) {
      if (r.errorCode === "NO_QUOTES") {
        return NextResponse.json({ error: "暂无已报价的供应商，无法进行分析" }, { status: 400 });
      }
      return NextResponse.json({ error: "询价轮次不存在" }, { status: 404 });
    }

    const finance = await resolveFinanceViewSafe(access.user, access.project.orgId, access.project.ownerId);
    const matrix = compareMatrixFinanceView(r.matrix, { canView: finance.canReadAll, firstTierQty: r.firstTierQty });
    const hidden = matrix.costHidden ? { costHidden: true as const } : {};
    const ctx = { projectName: r.projectName, roundNumber: r.roundNumber, closeDate: r.closeDate };
    const prompt = buildMatrixInterpretationPrompt(matrix, ctx);
    const raw = await createCompletion({ ...prompt, mode: "normal", temperature: 0.2, workflow: "tender_rfq_compare_interpret" });
    const interpretation = readInterpretation(raw);
    if (!interpretation) {
      // 解读失败不影响矩阵：数字与推荐都来自代码
      return NextResponse.json({ error: "AI 解读返回格式异常", matrix, raw, ...hidden }, { status: 502 });
    }

    // 解读里的每个数字都要在矩阵（即交给 LLM 的输入）里找得到；找不到的标注出来，不静默放行
    const check = checkInterpretationNumbers(interpretation, collectAllowedNumbers(buildInterpretationPayload(matrix, ctx)));
    if (!check.ok) console.warn("[tender-rfq/compare/analysis] 解读含矩阵外数字", { projectId, inquiryId, unverified: check.unverified });

    const recommended = matrix.recommendedItemId ? matrix.rows.find((x) => x.itemId === matrix.recommendedItemId) : null;
    return NextResponse.json({
      analysis: {
        summary: matrix.summaryZh,
        recommendedSupplier: recommended?.supplierName ?? "",
        ...check.annotated,
      },
      numberCheck: { ok: check.ok, unverified: check.unverified },
      matrix,
      quotesCount: matrix.rows.length,
      generatedAt: matrix.generatedAt,
      ...hidden,
    });
  } catch (err) {
    const { msg, status } = toPrismaHttpError(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
