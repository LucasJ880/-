/**
 * 报价审查 Skill — 硬编码规则 + AI 深度审查并行执行
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getQuoteReviewPrompt } from "@/lib/ai/prompts";
import { runQuoteChecks, countByType } from "@/lib/quote/rules";
import type { QuoteHeaderData, QuoteLineItemData } from "@/lib/quote/types";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult, CheckReport, CheckIssue } from "../types";

async function execute(ctx: SkillContext): Promise<SkillResult> {
  try {
    const quoteId = ctx.input.quoteId as string | undefined;

    if (!quoteId) {
      return { success: false, data: {}, summary: "缺少 quoteId", error: "quoteId required" };
    }

    const quote = await db.projectQuote.findUnique({
      where: { id: quoteId },
      include: {
        lineItems: { orderBy: { sortOrder: "asc" } },
        project: {
          select: {
            name: true,
            description: true,
            clientOrganization: true,
            tenderStatus: true,
            estimatedValue: true,
            currency: true,
          },
        },
      },
    });

    if (!quote) {
      return { success: false, data: {}, summary: "报价单不存在", error: "Quote not found" };
    }

    const supplierQuoteCount = await db.inquiryItem.count({
      where: { inquiry: { projectId: quote.projectId }, status: "quoted" },
    });

    function decToNum(v: { toString: () => string } | null | undefined): number | null {
      if (v == null) return null;
      const n = Number(v.toString());
      return Number.isFinite(n) ? n : null;
    }

    const header: QuoteHeaderData = {
      title: quote.title ?? "",
      templateType: quote.templateType as QuoteHeaderData["templateType"],
      currency: quote.currency,
      tradeTerms: quote.tradeTerms ?? "",
      paymentTerms: quote.paymentTerms ?? "",
      deliveryDays: quote.deliveryDays ?? null,
      validUntil: quote.validUntil?.toISOString().slice(0, 10) ?? "",
      moq: quote.moq ?? null,
      originCountry: quote.originCountry ?? "",
      internalNotes: quote.internalNotes ?? "",
    };

    const lines: QuoteLineItemData[] = quote.lineItems.map((l) => ({
      sortOrder: l.sortOrder,
      category: l.category as QuoteLineItemData["category"],
      itemName: l.itemName,
      specification: l.specification ?? "",
      unit: l.unit ?? "",
      quantity: decToNum(l.quantity),
      unitPrice: decToNum(l.unitPrice),
      totalPrice: decToNum(l.totalPrice),
      remarks: l.remarks ?? "",
      costPrice: decToNum(l.costPrice),
      isInternal: l.isInternal,
    }));

    // 并行：硬编码规则 + AI 审查
    const ruleChecks = runQuoteChecks(header, lines);
    const ruleCounts = countByType(ruleChecks);

    let aiReview: Record<string, unknown> | null = null;
    try {
      const prompt = getQuoteReviewPrompt({
        templateType: quote.templateType,
        header: {
          currency: header.currency,
          tradeTerms: header.tradeTerms,
          paymentTerms: header.paymentTerms,
          deliveryDays: header.deliveryDays,
          validUntil: header.validUntil,
          moq: header.moq,
          originCountry: header.originCountry,
        },
        lineItems: lines.map((l) => ({
          category: l.category,
          itemName: l.itemName,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          totalPrice: l.totalPrice,
          costPrice: l.costPrice,
        })),
        totals: {
          subtotal: decToNum(quote.subtotal) ?? 0,
          internalCost: decToNum(quote.internalCost) ?? 0,
          profitMargin: decToNum(quote.profitMargin),
        },
        projectDescription: quote.project.description,
        supplierQuoteCount,
      });

      const raw = await createCompletion({
        systemPrompt: "你是报价审查专家。输出 JSON 审查报告。只输出 JSON。",
        userPrompt: prompt,
        mode: "normal",
        maxTokens: 3000,
      });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiReview = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // AI 审查失败时继续用规则检查结果
    }

    const issues: CheckIssue[] = ruleChecks
      .filter((c) => c.severity === "warning" || c.severity === "urgent")
      .map((c) => ({
        level: c.severity === "urgent" ? "urgent" as const : "warning" as const,
        message: c.message,
        suggestion: c.suggestion,
      }));

    const blockers: CheckIssue[] = ruleChecks
      .filter((c) => c.severity === "urgent")
      .map((c) => ({
        level: "urgent" as const,
        message: c.message,
        suggestion: c.suggestion,
      }));

    const score = Math.max(0, 100 - ruleCounts.urgent * 20 - ruleCounts.issues * 5);

    const checkReport: CheckReport = {
      passed: blockers.length === 0,
      score,
      issues,
      blockers,
    };

    return {
      success: true,
      data: {
        ruleChecks,
        ruleCounts,
        aiReview,
        checkReport,
      },
      summary: `审查完成：评分 ${score}，${ruleCounts.passed} 项通过，${ruleCounts.issues} 项问题（${ruleCounts.urgent} 项高风险）`,
      checkReport,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "报价审查失败",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerSkill({
  id: "quote_review",
  name: "报价审查",
  domain: "quote",
  description: "使用硬编码规则 + AI 深度审查对报价单进行检查，输出风险评分和改进建议",
  riskLevel: "low",
  requiresApproval: false,
  inputDescription: "quoteId",
  outputDescription: "ruleChecks, aiReview, checkReport (score, issues, blockers)",
  execute,
});
