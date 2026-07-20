/**
 * 投标数字员工技能包（Phase 1 · 3 条）
 */

import {
  ENTERPRISE_SKILL_SAFETY,
  type EnterpriseSkillSeed,
} from "./enterprise-types";

export const TENDER_ENTERPRISE_SKILLS: EnterpriseSkillSeed[] = [
  {
    slug: "tender-bid-no-bid",
    name: "投标去留判断",
    description:
      "判断项目应推进、条件推进、等待信息还是放弃；可提议更新 aiAdviceStatus，须人工确认",
    domain: "project",
    tier: "analysis",
    temperature: 0.2,
    maxTokens: 5000,
    outputFormat: "json",
    mayProposePendingAction: true,
    requiredTools:
      "project_get_tender_summary,project_risk_scan,project_search_similar_projects,org_search_knowledge",
    systemPrompt: `你是青砚投标数字员工的「投标去留」决策顾问。
${ENTERPRISE_SKILL_SAFETY}

decision 只能是：advance | conditional | wait_info | abandon。
不得自动修改项目 tenderStatus；若建议更新 aiAdviceStatus，只能放在 pendingActionProposal（如 grader.internal_note / grader.project_task）供人工确认。
输出 JSON：{ "decision", "confidence", "summary", "mandatoryFit", "commercialFit", "deliveryFit", "risks", "conditions", "missingInformation", "nextActions", "pendingActionProposal" }`,
    userPromptTemplate: `项目摘要：{{projectSummary}}
强制要求：{{mandatoryRequirements}}
评分标准：{{evaluationCriteria}}
交付要求：{{deliveryRequirements}}
保险与保证金：{{insuranceAndBonding}}
技术要求：{{technicalRequirements}}
预估金额：{{estimatedValue}}
预估成本：{{estimatedCost}}
内部产能：{{internalCapacity}}
竞争信号：{{competitionSignals}}
历史项目：{{historicalProjects}}
未决问题：{{openQuestions}}
项目ID（工具用，可空）：{{projectId}}
品牌语料：{{brandContext}}`,
    inputSchema: {
      type: "object",
      properties: {
        projectSummary: { type: "string" },
        mandatoryRequirements: { type: "string" },
        evaluationCriteria: { type: "string" },
        deliveryRequirements: { type: "string" },
        insuranceAndBonding: { type: "string" },
        technicalRequirements: { type: "string" },
        estimatedValue: { type: "string" },
        estimatedCost: { type: "string" },
        internalCapacity: { type: "string" },
        competitionSignals: { type: "string" },
        historicalProjects: { type: "string" },
        openQuestions: { type: "string" },
        projectId: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["projectSummary"],
    },
    outputSchema: {
      type: "object",
      required: [
        "decision",
        "confidence",
        "summary",
        "risks",
        "missingInformation",
        "nextActions",
      ],
    },
  },
  {
    slug: "tender-mandatory-compliance-matrix",
    name: "招标强制条件与响应矩阵",
    description:
      "提取强制条件、评分项、证据要求与责任人；保留原文引用；不得把评分项误判为强制项",
    domain: "project",
    tier: "analysis",
    temperature: 0.15,
    maxTokens: 8000,
    outputFormat: "json",
    requiredTools:
      "project_get_project_documents,project_get_project_requirements,project_document_summary,project_tender_analysis",
    systemPrompt: `你是青砚投标数字员工的「强制条件与响应矩阵」编制员。
${ENTERPRISE_SKILL_SAFETY}

requirementType：mandatory | rated | informational | contractual — 不得把 rated 标成 mandatory。
每条必须含 sourceReference（文件名/页码/章节/条款，未知则写 unknown）。
complianceStatus：met | partial | missing | unknown。
输出 JSON：{ "requirements": [], "summary": {}, "criticalGaps": [], "questionsToBuyer": [], "missingData": [] }`,
    userPromptTemplate: `项目ID：{{projectId}}
已解析文档要点：{{parsedDocumentNotes}}
强制/评分条款摘录：{{clauseExcerpts}}
补充说明：{{manualNotes}}
品牌语料：{{brandContext}}`,
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        parsedDocumentNotes: { type: "string" },
        clauseExcerpts: { type: "string" },
        manualNotes: { type: "string" },
        brandContext: { type: "string" },
      },
      required: [],
    },
    outputSchema: {
      type: "object",
      required: ["requirements", "summary", "criticalGaps"],
    },
  },
  {
    slug: "tender-disqualification-check",
    name: "投标废标风险检查",
    description:
      "提交前检查可能导致无效投标或严重扣分的问题；未能核实项必须标 unverified",
    domain: "project",
    tier: "analysis",
    temperature: 0.1,
    maxTokens: 7000,
    outputFormat: "json",
    requiredTools:
      "project_get_tender_summary,project_get_project_documents,project_get_project_quotes,project_risk_scan",
    systemPrompt: `你是青砚投标数字员工的「废标风险」检查员。
${ENTERPRISE_SKILL_SAFETY}

检查类别包括但不限于：漏签字/盖章/表格、Addendum 未确认、价格表不完整、税费、有效期、Bond、保险、安全文件、原产地、强制认证、格式/命名/页数、上传位置、截止日期与时区、Mandatory 未答、报价与技术范围冲突、公司名不一致、交货期、条款接受。
未能核实的项目必须放入 unverifiedItems，不得默认通过。
submissionStatus：ready | ready_with_conditions | not_ready。
输出 JSON：{ "submissionStatus", "criticalIssues", "warnings", "verifiedItems", "unverifiedItems", "submissionChecklist", "finalRecommendation" }`,
    userPromptTemplate: `项目ID：{{projectId}}
提交包说明：{{submissionPackageNotes}}
已核对清单：{{checkedItems}}
已知缺口：{{knownGaps}}
时区与截标：{{deadlineContext}}
品牌语料：{{brandContext}}`,
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        submissionPackageNotes: { type: "string" },
        checkedItems: { type: "string" },
        knownGaps: { type: "string" },
        deadlineContext: { type: "string" },
        brandContext: { type: "string" },
      },
      required: [],
    },
    outputSchema: {
      type: "object",
      required: [
        "submissionStatus",
        "criticalIssues",
        "warnings",
        "verifiedItems",
        "unverifiedItems",
        "finalRecommendation",
      ],
    },
  },
];
