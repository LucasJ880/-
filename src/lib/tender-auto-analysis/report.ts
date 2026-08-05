/**
 * Phase F — 基于已抽取事实生成中文标书分析章节（模板优先，LLM 可选）
 */

import { db } from "@/lib/db";
import { SECTION_KEYS, type SectionKey } from "./constants";
import { shouldUseTenderAnalysisLlm } from "./extract/llm-enrich";

export type GenerateReportInput = {
  runId: string;
};

export type GenerateReportResult = {
  sectionCount: number;
};

type FactRow = {
  statementKind: string;
  contentZh: string;
  contentOriginal: string | null;
  confidence: string;
};

function bulletFacts(facts: FactRow[], pred?: (f: FactRow) => boolean): string {
  const list = pred ? facts.filter(pred) : facts;
  if (list.length === 0) return "（本节暂无已核验原文要点；请人工复核招标全文。）";
  return list.map((f) => `- ${f.contentZh}`).join("\n");
}

function buildSectionsFromFacts(
  facts: FactRow[],
  requirementLines: string[],
): Record<SectionKey, { contentZh: string; structuredJson: Record<string, unknown>; confidence: string }> {
  const qtyFacts = facts.filter((f) =>
    /数量|1,?500|7,?500|call-up|评标|保证采购/i.test(f.contentZh),
  );
  const submitFacts = facts.filter((f) =>
    /PDF|5MB|提交|邮件|Reciprocal/i.test(f.contentZh),
  );
  const deliveryFacts = facts.filter((f) =>
    /DDP|30 days|交货|物流|Regina/i.test(f.contentZh),
  );
  const identityFacts = facts.filter((f) =>
    /项目名称|招标编号|采购方|截标|合同期/i.test(f.contentZh),
  );

  const reqBlock =
    requirementLines.length > 0
      ? requirementLines.map((l) => `- ${l}`).join("\n")
      : "- （尚未抽取到 M 代码强制要求，请人工核对 Mandatory Technical Criteria。）";

  const sections: Record<
    SectionKey,
    { contentZh: string; structuredJson: Record<string, unknown>; confidence: string }
  > = {
    EXECUTIVE_SUMMARY: {
      contentZh: [
        "【执行摘要｜AI 草稿，待人工复核】",
        "本报告依据招标文件页级原文抽取，不编造历史中标、供应商或工厂信息。",
        "",
        "关键要点：",
        bulletFacts(identityFacts),
        "",
        "数量与采购保障（务必注意歧义）：",
        bulletFacts(qtyFacts),
        "",
        "初步建议：在澄清数量口径、样品与海外制造限制前，宜保持审慎推进（HOLD 倾向），完成强制要求对照后再决策。",
      ].join("\n"),
      structuredJson: { kind: "executive_summary", factCount: facts.length },
      confidence: identityFacts.length ? "HIGH_CONFIDENCE" : "UNKNOWN",
    },
    PROJECT_INFORMATION: {
      contentZh: ["【项目基本信息】", bulletFacts(identityFacts)].join("\n"),
      structuredJson: { kind: "project_information" },
      confidence: "HIGH_CONFIDENCE",
    },
    PROCUREMENT_STRUCTURE: {
      contentZh: [
        "【采购结构】",
        bulletFacts(
          facts.filter((f) =>
            /Reciprocal|合同期|procurement|call-up|评标/i.test(f.contentZh),
          ),
        ),
        "",
        "说明：若存在 call-up 机制，实际下单量可能显著低于评标用评估量。",
      ].join("\n"),
      structuredJson: { kind: "procurement_structure" },
      confidence: "HIGH_CONFIDENCE",
    },
    PRODUCT_SCOPE: {
      contentZh: [
        "【产品范围与开发难度】",
        "- 标的为 Cadets 背包类制式装备（以原文标题为准）。",
        "- 面料（如 1000D）、防水、拉链/织带/缝线等性能标准需对照 M1–M15 与附件图纸。",
        "- 开发难度取决于是否可获得正式规格、测量方法及是否允许海外制造——上述点已列入澄清清单。",
        "",
        bulletFacts(
          facts.filter((f) => /背包|Backpack|1000D|样品|规格/i.test(f.contentZh + (f.contentOriginal ?? ""))),
        ),
      ].join("\n"),
      structuredJson: { kind: "product_scope" },
      confidence: "INFERRED",
    },
    MANDATORY_REQUIREMENTS: {
      contentZh: [
        "【强制技术要求 M1–M15】",
        "合规状态一律为未评估（NOT_ASSESSED），禁止自动勾选合规。",
        "",
        reqBlock,
      ].join("\n"),
      structuredJson: {
        kind: "mandatory_requirements",
        requirementCount: requirementLines.length,
      },
      confidence: requirementLines.length >= 15 ? "HIGH_CONFIDENCE" : "INFERRED",
    },
    SUBMISSION_REQUIREMENTS: {
      contentZh: [
        "【提交要求】",
        bulletFacts(submitFacts),
        "",
        "- 建议提前演练「三份 PDF + 邮件总大小 <5MB」打包流程，避免截标前技术性废标。",
      ].join("\n"),
      structuredJson: { kind: "submission_requirements" },
      confidence: "HIGH_CONFIDENCE",
    },
    PRICING_EVALUATION: {
      contentZh: [
        "【价格与评标】",
        bulletFacts(qtyFacts),
        "",
        "- 评标数量（如年度 1,500 或合计 7,500）仅用于比较报价，不得等同保证采购量。",
        "- 报价模型应能解释：评估量场景 vs 实际 call-up 场景的成本差异。",
      ].join("\n"),
      structuredJson: {
        kind: "pricing_evaluation",
        purchaseGuarantee: false,
        evaluationAggregateNotGuarantee: true,
      },
      confidence: "HIGH_CONFIDENCE",
    },
    DELIVERY_LOGISTICS: {
      contentZh: [
        "【供货与物流】",
        bulletFacts(deliveryFacts),
        "",
        "- DDP Regina 意味着卖方承担关税与末端交付责任，需单独核算跨境成本。",
      ].join("\n"),
      structuredJson: { kind: "delivery_logistics" },
      confidence: "HIGH_CONFIDENCE",
    },
    PAYMENT: {
      contentZh: [
        "【付款条件】",
        "- 原文付款条款需人工核对（本阶段未臆造具体账期/保留金比例）。",
        "- 建议在财务标中单独标注发票币种、税费与 DDP 成本归属。",
      ].join("\n"),
      structuredJson: { kind: "payment", awaitingFullClauseReview: true },
      confidence: "UNKNOWN",
    },
    CERTIFICATIONS: {
      contentZh: [
        "【认证与环保包装】",
        "- 可能涉及 OEM 证明、环保包装声明、独立报价声明、对等采购声明等（以交付物清单为准）。",
        "- 证书名称与出具主体必须以招标原文为准，禁止用推测证书顶替。",
        bulletFacts(
          facts.filter((f) => /证书|声明|包装|Reciprocal|OEM|认证/i.test(f.contentZh)),
        ),
      ].join("\n"),
      structuredJson: { kind: "certifications" },
      confidence: "INFERRED",
    },
    ELIGIBILITY: {
      contentZh: [
        "【供应商资格】",
        "- 关注 Reciprocal Procurement 及其他强制性声明。",
        "- 海外制造是否允许尚待澄清，在未确认前不得假设可全部境外生产。",
        bulletFacts(
          facts.filter((f) => /Reciprocal|资格|制造/i.test(f.contentZh)),
        ),
      ].join("\n"),
      structuredJson: { kind: "eligibility" },
      confidence: "INFERRED",
    },
    RISKS: {
      contentZh: [
        "【风险】",
        "1. 数量歧义：合同期上限 vs 年度评标量；7,500 仅为评估合计，非保证采购。",
        "2. 提交技术性风险：三份 PDF 与 5MB 邮件限制。",
        "3. 履约风险：DDP Regina + 短周期 call-up（如 30 days）对库存与物流的压力。",
        "4. 技术合规风险：M1–M15 未评估前存在样品/测试标准不清。",
        "5. 情报缺口：历史中标与竞争对手信息尚无可靠来源，本报告不予编造。",
      ].join("\n"),
      structuredJson: {
        kind: "risks",
        inventedHistoricalAwards: false,
      },
      confidence: "HIGH_CONFIDENCE",
    },
    COMMERCIAL_ANALYSIS: {
      contentZh: [
        "【商业分析】",
        "- 收入上限受 call-up 不确定性约束；勿按 7,500 保证销量做产能投资决策。",
        "- 成本端需覆盖：规格落地、可能的样品、DDP、认证与合规文件。",
        "- 在关键澄清未完成前，商业结论保持「可跟进但未达坚定 GO」。",
      ].join("\n"),
      structuredJson: { kind: "commercial_analysis", stance: "cautious" },
      confidence: "INFERRED",
    },
    BID_STRATEGY: {
      contentZh: [
        "【建议投标策略】",
        "1. 先发澄清：数量、样品、防水/拉链等测试标准、海外制造、1000D 范围、测量方法。",
        "2. 同步锁定背包工厂与正式规格，获取 OEM/EN 等证书路径（若适用）。",
        "3. 按三份 PDF 结构预演打包，并做 <5MB 邮件检查。",
        "4. 报价区分「评标量」与「实际 call-up」情景，避免被评估量误导。",
      ].join("\n"),
      structuredJson: { kind: "bid_strategy" },
      confidence: "INFERRED",
    },
    CLARIFICATION_QUESTIONS: {
      contentZh: [
        "【待澄清问题（摘要）】",
        "- Call-up 最小/最大/典型数量？",
        "- 「Up to 1500 per contract period」的法律与执行含义？",
        "- 投标阶段是否必须提交样品？",
        "- 防水测试标准具体是什么？",
        "- 是否允许海外制造？",
        "- 1000D 面料适用范围？",
        "- 尺寸测量方法？",
        "- 拉链/织带/缝线性能标准？",
        "",
        "完整问题列表见 clarifications 数据表；询价截止日按截标 − 5 个日历日估算。",
      ].join("\n"),
      structuredJson: { kind: "clarification_questions" },
      confidence: "HIGH_CONFIDENCE",
    },
    FINAL_RECOMMENDATION: {
      contentZh: [
        "【综合结论｜AI 草稿】",
        "- 审查状态：REVIEW_REQUIRED（需人工复核）。",
        "- 推荐倾向：审慎跟进（非自动 GO）。",
        "- 前提：完成数量歧义澄清、M1–M15 对照、关键证书与物流成本核算。",
        "- 禁令：不编造历史中标；不将 7,500 当作保证采购；不自动标记技术合规。",
      ].join("\n"),
      structuredJson: {
        kind: "final_recommendation",
        aiRecommendation: "HOLD_PENDING_CLARIFICATION",
        reviewStatus: "REVIEW_REQUIRED",
      },
      confidence: "INFERRED",
    },
  };

  return sections;
}

function buildSummaryJson(
  facts: FactRow[],
  factKeys: Map<string, FactRow>,
): Record<string, unknown> {
  // 尝试从 contentOriginal / contentZh 还原摘要字段
  const find = (re: RegExp) =>
    facts.find((f) => re.test(f.contentZh) || re.test(f.contentOriginal ?? ""));

  const projectName =
    find(/Backpacks\s+for\s+Cadets/i)?.contentOriginal ??
    find(/项目名称/)?.contentOriginal ??
    null;
  const solicitation =
    find(/M5000-/i)?.contentOriginal?.match(/M5000-[0-9A-Z-]+/i)?.[0] ??
    find(/招标编号/)?.contentOriginal ??
    null;
  const closing = find(/截标|Closing/i)?.contentOriginal ?? null;
  const contractPeriod = find(/合同期|contract period/i)?.contentOriginal ?? null;

  const topRisks = [
    "数量口径歧义（Annex A 上限 vs Annex B 评标量；7,500 非保证采购）",
    "提交格式/邮件大小技术性废标风险",
    "DDP Regina 与短周期履约压力",
    "M1–M15 未评估与测试标准不清",
  ];

  return {
    projectName,
    solicitationNumber: solicitation,
    procurementType: find(/Reciprocal/i)
      ? "Government RFP / Reciprocal Procurement"
      : "Government RFP",
    closing,
    contractPeriod,
    evaluationMethod: "价格评标（含评估量）",
    evaluationQuantity: find(/1,?500|评标/)
      ? "1,500/year（评标）；7,500 可为评估合计"
      : null,
    purchaseGuarantee: "无保证采购；7,500 不得视为 guaranteed purchase",
    topRisks,
    aiRecommendation: "HOLD_PENDING_CLARIFICATION",
    reviewStatus: "REVIEW_REQUIRED",
    factKeyCount: factKeys.size,
  };
}

async function maybePolishSection(
  sectionKey: string,
  contentZh: string,
): Promise<string> {
  if (!shouldUseTenderAnalysisLlm()) return contentZh;
  try {
    const { createCompletion } = await import("@/lib/ai/client");
    const polished = await createCompletion({
      systemPrompt:
        "你是中文投标顾问。只润色语气，不得新增历史中标、供应商、工厂名或保证采购量。保持要点完整。",
      userPrompt: `章节 ${sectionKey}:\n${contentZh}`,
      mode: "fast",
      maxTokens: 2048,
      timeoutMs: 20_000,
    });
    return polished.trim() || contentZh;
  } catch {
    return contentZh;
  }
}

/**
 * 幂等写入全部 SECTION_KEYS，并更新 run.summaryJson / summaryText。
 */
export async function generateReportSections(
  input: GenerateReportInput,
): Promise<GenerateReportResult> {
  const facts = await db.tenderAnalysisFact.findMany({
    where: { runId: input.runId },
    orderBy: { createdAt: "asc" },
    select: {
      statementKind: true,
      contentZh: true,
      contentOriginal: true,
      confidence: true,
    },
  });

  const requirements = await db.tenderExtractedRequirement.findMany({
    where: { analysisRunId: input.runId },
    orderBy: { requirementCode: "asc" },
    select: {
      requirementCode: true,
      chineseTranslation: true,
      originalRequirement: true,
      complianceStatus: true,
    },
  });

  const requirementLines = requirements.map(
    (r) =>
      `${r.requirementCode}｜${r.chineseTranslation}｜原文: ${r.originalRequirement.slice(0, 160)}｜合规: ${r.complianceStatus}`,
  );

  const built = buildSectionsFromFacts(facts, requirementLines);
  const factKeyMap = new Map(facts.map((f, i) => [`f_${i}`, f]));
  const summaryJson = buildSummaryJson(facts, factKeyMap);

  let sectionCount = 0;
  for (const sectionKey of SECTION_KEYS) {
    const draft = built[sectionKey];
    const contentZh = await maybePolishSection(sectionKey, draft.contentZh);
    await db.tenderAnalysisSection.upsert({
      where: {
        runId_sectionKey: { runId: input.runId, sectionKey },
      },
      create: {
        runId: input.runId,
        sectionKey,
        contentZh,
        structuredJson: draft.structuredJson,
        confidence: draft.confidence,
        reviewStatus: "AI_DRAFT",
      },
      update: {
        contentZh,
        structuredJson: draft.structuredJson,
        confidence: draft.confidence,
        reviewStatus: "AI_DRAFT",
      },
    });
    sectionCount += 1;
  }

  const summaryText = [
    `项目：${summaryJson.projectName ?? "（待核）"}`,
    `编号：${summaryJson.solicitationNumber ?? "（待核）"}`,
    `截标：${summaryJson.closing ?? "（待核）"}`,
    `建议：${summaryJson.aiRecommendation}`,
    `审查：${summaryJson.reviewStatus}`,
  ].join("｜");

  await db.tenderAnalysisRun.update({
    where: { id: input.runId },
    data: {
      summaryJson: summaryJson as object,
      summaryText,
    },
  });

  return { sectionCount };
}

/** 纯函数：供单测验证章节覆盖 */
export function buildReportSectionKeys(): readonly SectionKey[] {
  return SECTION_KEYS;
}

export function buildReportDraftForFacts(
  facts: FactRow[],
  requirementLines: string[] = [],
): ReturnType<typeof buildSectionsFromFacts> {
  return buildSectionsFromFacts(facts, requirementLines);
}
