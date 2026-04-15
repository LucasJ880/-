/**
 * 青砚 AI 提示词 — 报价/采购类（报价分析、模板推荐、草稿生成、审查）
 */

import type {
  QuoteAnalysisContext,
  QuoteTemplateRecommendContext,
  QuoteDraftContext,
  QuoteReviewContext,
} from "./types";

// ── 报价对比分析提示词 ──────────────────────────────────────

export function getQuoteAnalysisPrompt(ctx: QuoteAnalysisContext): string {
  const lines: string[] = [
    `你是"青砚"报价分析助手。请分析以下供应商报价数据，给出专业的对比分析和选择建议。`,
    "",
    "## 项目信息",
    `- 项目名称: ${ctx.project.name}`,
  ];

  if (ctx.project.description) {
    lines.push(`- 项目描述: ${ctx.project.description.slice(0, 300)}`);
  }
  if (ctx.project.closeDate) {
    lines.push(`- 截止日期: ${ctx.project.closeDate}`);
  }

  lines.push("", "## 询价信息");
  lines.push(`- 第 ${ctx.inquiry.roundNumber} 轮询价`);
  if (ctx.inquiry.title) lines.push(`- 标题: ${ctx.inquiry.title}`);
  if (ctx.inquiry.scope) lines.push(`- 范围: ${ctx.inquiry.scope}`);

  lines.push("", "## 供应商报价数据");
  for (const q of ctx.quotes) {
    lines.push("");
    lines.push(`### ${q.supplierName}${q.isSelected ? "（当前选定）" : ""}`);
    if (q.totalPrice) lines.push(`- 总价: ${q.currency} ${q.totalPrice}`);
    if (q.unitPrice) lines.push(`- 单价: ${q.currency} ${q.unitPrice}`);
    if (q.deliveryDays !== null) lines.push(`- 交期: ${q.deliveryDays} 天`);
    if (q.quoteNotes) lines.push(`- 备注: ${q.quoteNotes}`);
  }

  lines.push("", "## 输出要求");
  lines.push("严格按以下 JSON 格式输出，不要输出其他内容：");
  lines.push("```json");
  lines.push(`{`);
  lines.push(`  "summary": "一句话总结（30字以内）",`);
  lines.push(`  "priceAnalysis": "价格对比分析（含价差比例、性价比评估）",`);
  lines.push(`  "deliveryAnalysis": "交期对比分析",`);
  lines.push(`  "risks": "潜在风险提示（如报价异常低、交期过长等）",`);
  lines.push(`  "recommendation": "推荐选择及理由",`);
  lines.push(`  "recommendedSupplier": "推荐的供应商名称（必须是上面列出的供应商之一）"`);
  lines.push(`}`);
  lines.push("```");
  lines.push("");
  lines.push("## 分析规则");
  lines.push("1. 客观：基于数据分析，不编造信息");
  lines.push("2. 务实：考虑价格、交期、风险的综合平衡");
  lines.push("3. 如果报价数据不足（如只有一家），如实说明无法做有效对比");
  lines.push("4. 价差分析用百分比，便于决策者快速判断");
  lines.push("5. 如有当前已选定供应商，评估该选择是否合理");

  return lines.join("\n");
}

// ── 报价模板推荐提示词 ──────────────────────────────────────────

export function getQuoteTemplatePrompt(ctx: QuoteTemplateRecommendContext): string {
  const lines = [
    `你是"青砚"报价助手。根据以下项目信息，推荐最适合的报价模板。`,
    "",
    "## 项目信息",
    `- 名称: ${ctx.project.name}`,
  ];
  if (ctx.project.clientOrganization) lines.push(`- 客户: ${ctx.project.clientOrganization}`);
  if (ctx.project.category) lines.push(`- 分类: ${ctx.project.category}`);
  if (ctx.project.sourceSystem) lines.push(`- 来源系统: ${ctx.project.sourceSystem}`);
  if (ctx.project.tenderStatus) lines.push(`- 招标状态: ${ctx.project.tenderStatus}`);
  if (ctx.project.location) lines.push(`- 地点: ${ctx.project.location}`);
  if (ctx.project.description) lines.push(`- 描述: ${ctx.project.description.slice(0, 500)}`);

  lines.push("", "## 可选模板");
  lines.push("1. export_standard — 外贸标准报价（海外客户、含 FOB/CIF 贸易条款、MOQ、原产地）");
  lines.push("2. gov_procurement — 政府采购投标（政府项目、需编号 + 单位 + 数量 + 单价 + 总价格式）");
  lines.push("3. project_install — 项目制安装报价（含安装/施工、需拆分材料费 + 人工费）");
  lines.push("4. service_labor — 服务/人工单价报价（纯服务、按工时计价）");

  lines.push("", "## 判断规则");
  lines.push("- 如果项目来源为 bidtogo 或有 tenderStatus，倾向 gov_procurement");
  lines.push("- 如果客户为海外组织或地点在国外，倾向 export_standard");
  lines.push("- 如果描述中提到安装、施工、现场，倾向 project_install");
  lines.push("- 如果描述中提到咨询、服务、人工，倾向 service_labor");
  lines.push("- 不确定时默认 export_standard");

  lines.push("", "## 输出要求");
  lines.push("严格按以下 JSON 格式输出，不要输出其他内容：");
  lines.push("```json");
  lines.push(`{ "templateType": "模板ID", "reason": "推荐理由（一句话）", "confidence": "high | medium | low" }`);
  lines.push("```");

  return lines.join("\n");
}

// ── 报价草稿生成提示词 ──────────────────────────────────────────

export function getQuoteDraftPrompt(ctx: QuoteDraftContext): string {
  const lines = [
    `你是"青砚"报价草稿助手。根据项目资料和供应商报价，生成一份结构化报价草稿。`,
    "",
    "## 核心原则",
    "1. 基于真实供应商报价推算，不编造价格",
    "2. 如无供应商报价，只生成行项目结构框架，价格字段留 null",
    "3. 外贸加价参考 25-40%，政府采购按定额",
    "4. 必须包含模板建议的所有成本项（运费、关税、包装等按需）",
    "5. costPrice 是内部成本参考，不展示给客户",
    "6. quantity × unitPrice = totalPrice，务必计算准确",
  ];

  lines.push("", "## 项目信息");
  lines.push(`- 名称: ${ctx.project.name}`);
  if (ctx.project.clientOrganization) lines.push(`- 客户: ${ctx.project.clientOrganization}`);
  if (ctx.project.description) lines.push(`- 描述: ${ctx.project.description.slice(0, 500)}`);
  if (ctx.project.closeDate) lines.push(`- 截止: ${ctx.project.closeDate}`);
  if (ctx.project.location) lines.push(`- 地点: ${ctx.project.location}`);
  if (ctx.inquiryScope) lines.push(`- 询价范围: ${ctx.inquiryScope}`);

  lines.push(``, `## 使用模板: ${ctx.templateType}`);

  if (ctx.supplierQuotes.length > 0) {
    lines.push("", "## 供应商报价参考（以此推算对客户报价）");
    for (const q of ctx.supplierQuotes) {
      lines.push(`### ${q.supplierName}`);
      if (q.totalPrice) lines.push(`- 总价: ${q.currency} ${q.totalPrice}`);
      if (q.unitPrice) lines.push(`- 单价: ${q.currency} ${q.unitPrice}`);
      if (q.deliveryDays != null) lines.push(`- 交期: ${q.deliveryDays} 天`);
      if (q.quoteNotes) lines.push(`- 备注: ${q.quoteNotes}`);
    }
  } else {
    lines.push("", "## 供应商报价：暂无数据，请生成行项目结构，价格留 null");
  }

  if (ctx.memory) lines.push("", "## AI 历史记忆", ctx.memory);

  lines.push("", "## 输出要求");
  lines.push("严格按以下 JSON 格式输出，不要输出其他内容：");
  lines.push("```json");
  lines.push(`{`);
  lines.push(`  "title": "报价单标题",`);
  lines.push(`  "currency": "CAD",`);
  lines.push(`  "tradeTerms": "FOB Shanghai（外贸模板必填，其他可为空字符串）",`);
  lines.push(`  "paymentTerms": "T/T 30/70",`);
  lines.push(`  "deliveryDays": 45,`);
  lines.push(`  "validUntil": "YYYY-MM-DD（30天后）",`);
  lines.push(`  "moq": null,`);
  lines.push(`  "originCountry": "China",`);
  lines.push(`  "lineItems": [`);
  lines.push(`    {`);
  lines.push(`      "category": "product | shipping | customs | packaging | labor | overhead | tax | other",`);
  lines.push(`      "itemName": "品名",`);
  lines.push(`      "specification": "规格",`);
  lines.push(`      "unit": "单位",`);
  lines.push(`      "quantity": 100,`);
  lines.push(`      "unitPrice": 28.50,`);
  lines.push(`      "totalPrice": 2850.00,`);
  lines.push(`      "costPrice": 18.00,`);
  lines.push(`      "remarks": ""`);
  lines.push(`    }`);
  lines.push(`  ],`);
  lines.push(`  "internalNotes": "AI 生成说明",`);
  lines.push(`  "reasoning": "定价依据简要说明"`);
  lines.push(`}`);
  lines.push("```");

  return lines.join("\n");
}

// ── 报价审查提示词 ──────────────────────────────────────────

export function getQuoteReviewPrompt(ctx: QuoteReviewContext): string {
  const lines = [
    `你是"青砚"报价审查专家，精通成本核算和定价策略。请检查以下报价单，找出潜在问题和改进建议。`,
    "",
    "## 审查维度",
    "1. 完整性：是否缺少必要行项目（运费/关税/包装/安装/保险/管理费）",
    "2. 成本核算：精确核算全成本（采购+物流+包材+平台扣点+推广摊销+售后），利润率是否在合理区间",
    "3. 格式规范：是否符合所选模板的要求，政府采购需符合 unit price / quantity / total 结构",
    "4. 商务条款：付款/交期/有效期是否齐全合理",
    "5. 一致性：数量×单价是否等于行总价，分项合计是否与总价一致",
    "6. 竞争力：与行业常见报价和竞品价格对比是否合理",
    "7. 利润红线：毛利率低于行业基线时必须预警，绝不'先冲量再算账'",
    "8. 价格体系保护：不同版本间价格是否一致，避免渠道冲突",
  ];

  lines.push("", `## 模板类型: ${ctx.templateType}`);

  lines.push("", "## 报价头信息");
  lines.push(`- 币种: ${ctx.header.currency}`);
  if (ctx.header.tradeTerms) lines.push(`- 贸易方式: ${ctx.header.tradeTerms}`);
  if (ctx.header.paymentTerms) lines.push(`- 付款条款: ${ctx.header.paymentTerms}`);
  if (ctx.header.deliveryDays != null) lines.push(`- 交期: ${ctx.header.deliveryDays} 天`);
  if (ctx.header.validUntil) lines.push(`- 有效期: ${ctx.header.validUntil}`);
  if (ctx.header.moq != null) lines.push(`- MOQ: ${ctx.header.moq}`);
  if (ctx.header.originCountry) lines.push(`- 原产地: ${ctx.header.originCountry}`);

  lines.push("", "## 行项目明细");
  for (const item of ctx.lineItems) {
    const parts = [`[${item.category}] ${item.itemName}`];
    if (item.quantity != null) parts.push(`数量:${item.quantity}`);
    if (item.unitPrice != null) parts.push(`单价:${item.unitPrice}`);
    if (item.totalPrice != null) parts.push(`总价:${item.totalPrice}`);
    if (item.costPrice != null) parts.push(`成本:${item.costPrice}`);
    lines.push(`- ${parts.join(" | ")}`);
  }

  lines.push("", "## 汇总");
  lines.push(`- 报价总额: ${ctx.totals.subtotal}`);
  lines.push(`- 内部成本: ${ctx.totals.internalCost}`);
  lines.push(`- 利润率: ${ctx.totals.profitMargin != null ? ctx.totals.profitMargin + "%" : "未知"}`);
  lines.push(`- 参考供应商报价数: ${ctx.supplierQuoteCount}`);

  if (ctx.projectDescription) {
    lines.push("", "## 项目描述（用于判断是否遗漏特殊要求）");
    lines.push(ctx.projectDescription.slice(0, 500));
  }

  lines.push("", "## 输出要求");
  lines.push("严格按以下 JSON 格式输出，不要输出其他内容：");
  lines.push("```json");
  lines.push(`{`);
  lines.push(`  "overallRisk": "low | medium | high",`);
  lines.push(`  "summary": "一句话总结（20字以内）",`);
  lines.push(`  "issues": [`);
  lines.push(`    {`);
  lines.push(`      "severity": "info | warning | urgent",`);
  lines.push(`      "field": "对应字段名",`);
  lines.push(`      "message": "问题描述",`);
  lines.push(`      "suggestion": "改进建议"`);
  lines.push(`    }`);
  lines.push(`  ],`);
  lines.push(`  "strengths": ["做得好的方面"],`);
  lines.push(`  "suggestions": ["额外改进建议"]`);
  lines.push(`}`);
  lines.push("```");
  lines.push("");
  lines.push("## 审查规则");
  lines.push("1. 客观：基于数据分析，不编造");
  lines.push("2. 如果报价整体合理，overallRisk 为 low，issues 可以为空");
  lines.push("3. 利润率 < 5% 必须标记 urgent");
  lines.push("4. 缺少关键条款标记 warning");
  lines.push("5. strengths 至少列出 1 条");

  return lines.join("\n");
}
