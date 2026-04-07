/**
 * 报价助手 Skill — 合并 recommend / draft / review 三个动作
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getQuoteTemplatePrompt, getQuoteDraftPrompt, getQuoteReviewPrompt } from "@/lib/ai/prompts";
import { getProjectAiMemory, buildMemoryBlock } from "@/lib/ai/memory";
import { runQuoteChecks, countByType } from "@/lib/quote/rules";
import type { QuoteHeaderData, QuoteLineItemData } from "@/lib/quote/types";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult, CheckReport, CheckIssue } from "../types";

type QuoteAction = "recommend" | "draft" | "review";

// ── 主入口 ────────────────────────────────────────────────────

async function execute(ctx: SkillContext): Promise<SkillResult> {
  const action = (ctx.input.action as QuoteAction) || "recommend";

  switch (action) {
    case "recommend":
      return executeRecommend(ctx);
    case "draft":
      return executeDraft(ctx);
    case "review":
      return executeReview(ctx);
    default:
      return { success: false, data: {}, summary: `未知报价动作: ${action}` };
  }
}

// ── recommend ─────────────────────────────────────────────────

async function executeRecommend(ctx: SkillContext): Promise<SkillResult> {
  try {
    const project = await db.project.findUnique({
      where: { id: ctx.projectId },
      select: {
        name: true, category: true, tenderStatus: true,
        clientOrganization: true, sourceSystem: true,
        estimatedValue: true, currency: true, location: true, description: true,
      },
    });

    if (!project) {
      return { success: false, data: {}, summary: "项目不存在", error: "Project not found" };
    }

    const prompt = getQuoteTemplatePrompt({ project });
    const raw = await createCompletion({
      systemPrompt: "你是报价模板推荐助手。只输出 JSON，不要输出其他内容。",
      userPrompt: prompt,
      mode: "normal",
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, data: {}, summary: "AI 返回格式异常", error: raw };
    }

    const result = JSON.parse(jsonMatch[0]) as {
      templateType: string;
      reason: string;
      confidence: string;
    };

    const validTypes = ["export_standard", "gov_procurement", "project_install", "service_labor"];
    if (!validTypes.includes(result.templateType)) {
      result.templateType = "export_standard";
    }

    return {
      success: true,
      data: { recommendation: result },
      summary: `推荐使用「${result.templateType}」模板，置信度 ${result.confidence}：${result.reason}`,
    };
  } catch (err) {
    return { success: false, data: {}, summary: "模板推荐失败", error: err instanceof Error ? err.message : String(err) };
  }
}

// ── draft ─────────────────────────────────────────────────────

async function executeDraft(ctx: SkillContext): Promise<SkillResult> {
  try {
    const templateType = (ctx.input.templateType as string) || "export_standard";

    const [project, inquiryItems, memory] = await Promise.all([
      db.project.findUnique({
        where: { id: ctx.projectId },
        select: { name: true, clientOrganization: true, description: true, closeDate: true, location: true, currency: true },
      }),
      db.inquiryItem.findMany({
        where: { inquiry: { projectId: ctx.projectId }, status: "quoted" },
        select: {
          unitPrice: true, totalPrice: true, currency: true, deliveryDays: true, quoteNotes: true,
          supplier: { select: { name: true } },
          inquiry: { select: { scope: true } },
        },
        take: 30,
      }),
      getProjectAiMemory(ctx.projectId),
    ]);

    if (!project) {
      return { success: false, data: {}, summary: "项目不存在", error: "Project not found" };
    }

    const memoryBlock = buildMemoryBlock(memory);
    const inquiryScope = inquiryItems.map((i) => i.inquiry.scope).find((s) => s?.trim()) ?? null;

    const prompt = getQuoteDraftPrompt({
      project: {
        name: project.name,
        clientOrganization: project.clientOrganization,
        description: project.description,
        closeDate: project.closeDate?.toISOString().slice(0, 10) ?? null,
        location: project.location,
        currency: project.currency,
      },
      supplierQuotes: inquiryItems.map((i) => ({
        supplierName: i.supplier.name,
        totalPrice: i.totalPrice != null ? String(i.totalPrice) : null,
        unitPrice: i.unitPrice != null ? String(i.unitPrice) : null,
        currency: i.currency,
        deliveryDays: i.deliveryDays,
        quoteNotes: i.quoteNotes,
      })),
      templateType,
      inquiryScope,
      memory: memoryBlock,
    });

    const raw = await createCompletion({
      systemPrompt: "你是专业的报价编制助手。根据上下文生成结构化报价草稿 JSON。只输出 JSON，不输出其他内容。",
      userPrompt: prompt,
      mode: "normal",
      maxTokens: 4000,
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, data: {}, summary: "AI 返回格式异常", error: raw.slice(0, 500) };
    }

    const draft = JSON.parse(jsonMatch[0]);
    const lineCount = Array.isArray(draft.lines) ? draft.lines.length : 0;

    return {
      success: true,
      data: { draft, templateType },
      summary: `已生成报价草稿：${lineCount} 个行项目，模板 ${templateType}`,
    };
  } catch (err) {
    return { success: false, data: {}, summary: "报价草稿生成失败", error: err instanceof Error ? err.message : String(err) };
  }
}

// ── review ────────────────────────────────────────────────────

async function executeReview(ctx: SkillContext): Promise<SkillResult> {
  try {
    let quoteId = ctx.input.quoteId as string | undefined;

    if (!quoteId) {
      const latestQuote = await db.projectQuote.findFirst({
        where: { projectId: ctx.projectId },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      if (latestQuote) {
        quoteId = latestQuote.id;
      } else {
        return { success: true, data: { skipped: true }, summary: "项目暂无报价单，跳过报价审查" };
      }
    }

    const quote = await db.projectQuote.findUnique({
      where: { id: quoteId },
      include: {
        lineItems: { orderBy: { sortOrder: "asc" } },
        project: {
          select: { name: true, description: true, clientOrganization: true, tenderStatus: true, estimatedValue: true, currency: true },
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
          category: l.category, itemName: l.itemName,
          quantity: l.quantity, unitPrice: l.unitPrice,
          totalPrice: l.totalPrice, costPrice: l.costPrice,
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
      .map((c) => ({ level: "urgent" as const, message: c.message, suggestion: c.suggestion }));

    const score = Math.max(0, 100 - ruleCounts.urgent * 20 - ruleCounts.issues * 5);

    const checkReport: CheckReport = { passed: blockers.length === 0, score, issues, blockers };

    return {
      success: true,
      data: { ruleChecks, ruleCounts, aiReview, checkReport },
      summary: `审查完成：评分 ${score}，${ruleCounts.passed} 项通过，${ruleCounts.issues} 项问题（${ruleCounts.urgent} 项高风险）`,
      checkReport,
    };
  } catch (err) {
    return { success: false, data: {}, summary: "报价审查失败", error: err instanceof Error ? err.message : String(err) };
  }
}

// ── 注册 ──────────────────────────────────────────────────────

registerSkill({
  id: "quote",
  name: "报价助手",
  domain: "quote",
  tier: "execution",
  version: "2.0.0",
  description: "报价全流程：模板推荐（recommend）→ 草稿生成（draft）→ 风险审查（review）。通过 input.action 指定动作。审查环节融合报价审查专家视角。",
  expertRoleId: "quote_reviewer",
  actions: ["recommend", "draft", "review"],
  riskLevel: "medium",
  requiresApproval: true,
  inputSchema: {
    action: "recommend | draft | review",
    templateType: "string（draft 时可选，recommend 输出可传入）",
    quoteId: "string（review 时可选，默认取最新报价）",
  },
  outputSchema: {
    recommendation: "{ templateType, reason, confidence }（recommend）",
    draft: "{ header, lines[], summary }（draft）",
    ruleChecks: "CheckItem[]（review）",
    aiReview: "AI 审查 JSON（review）",
    checkReport: "{ passed, score, issues, blockers }（review）",
  },
  dependsOn: ["project_understanding"],
  execute,
});
