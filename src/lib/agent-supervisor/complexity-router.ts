/**
 * DIRECT vs SUPERVISOR 复杂度判断（规则优先，低成本）
 */

import { routeMarketingSkillIntent } from "@/lib/marketing/skill-router";
import {
  ComplexityResultSchema,
  type ComplexityResult,
  type WorkerId,
} from "./types";
import { findWorkerForSkill } from "./worker-registry";

const MULTI_STEP_HINT =
  /并|然后|接着|再|同时|安排|制定.*(计划|方案)|完整|持续|接下来|之后|以及|并且|拆解|多步/;

const SUPERVISOR_GOALS =
  /分析.*(并|再|然后)|安排本周|制定.*计划|准备.*(草稿|行动)|判断.*找出|是否值得投.*强制|销售问题|工作安排|获客计划/;

const DIRECT_SALES: Array<{ re: RegExp; slug: string }> = [
  { re: /下一(步|最佳)|最重要的.*跟进|today.*follow/i, slug: "sales-next-best-action" },
  { re: /管道|pipeline|forecast|预测.*销售/, slug: "sales-pipeline-forecast" },
  { re: /ICP|获客评分|线索评分/, slug: "sales-icp-prospect-scoring" },
  { re: /客户研究|account research/, slug: "sales-account-research" },
  { re: /ROI|方案价值/, slug: "sales-proposal-roi" },
];

const DIRECT_TENDER: Array<{ re: RegExp; slug: string }> = [
  { re: /是否值得投|去留|bid.?no.?bid/i, slug: "tender-bid-no-bid" },
  { re: /强制条件|合规矩阵/, slug: "tender-mandatory-compliance-matrix" },
  { re: /废标|disqualif/i, slug: "tender-disqualification-check" },
];

function pack(partial: {
  mode: "direct" | "supervisor";
  reason: string;
  confidence?: number;
  candidateWorker?: ComplexityResult["candidateWorker"];
  candidateSkills?: string[];
  requiresApproval?: boolean;
}): ComplexityResult {
  return ComplexityResultSchema.parse({
    mode: partial.mode,
    reason: partial.reason,
    confidence: partial.confidence ?? 0.75,
    candidateWorker: partial.candidateWorker ?? "",
    candidateSkills: partial.candidateSkills ?? [],
    requiresApproval: partial.requiresApproval ?? false,
  });
}

/**
 * 规则路由：简单单技能 → DIRECT；多域/多步/需连续决策 → SUPERVISOR
 */
function collectCandidateSkills(text: string): string[] {
  const skills: string[] = [];
  for (const x of DIRECT_SALES) if (x.re.test(text)) skills.push(x.slug);
  for (const x of DIRECT_TENDER) if (x.re.test(text)) skills.push(x.slug);
  const mkt = routeMarketingSkillIntent(text);
  if (mkt.slug) skills.push(mkt.slug);
  return Array.from(new Set(skills)).slice(0, 5);
}

export function routeComplexity(input: {
  content: string;
  pageContext?: {
    projectId?: string;
    customerId?: string;
    opportunityId?: string;
    quoteId?: string;
  };
  forceMode?: "auto" | "quick" | "supervisor" | "project_expert";
}): ComplexityResult {
  const text = (input.content || "").trim();

  // 强制模式仍需解析候选技能，否则 DIRECT 无 slug 可执行
  if (input.forceMode === "supervisor") {
    const skills = collectCandidateSkills(text);
    return pack({
      mode: "supervisor",
      reason: "用户指定主管模式",
      confidence: 1,
      candidateSkills: skills,
      candidateWorker: (findWorkerForSkill(skills[0] || "") || "") as WorkerId | "",
      requiresApproval: /邮件|草稿|行动|执行|发布|投放/.test(text),
    });
  }
  if (input.forceMode === "quick") {
    const skills = collectCandidateSkills(text);
    const slug = skills[0];
    return pack({
      mode: "direct",
      reason: "用户指定快速模式",
      confidence: 1,
      candidateSkills: skills,
      candidateWorker: (findWorkerForSkill(slug || "") || "") as WorkerId | "",
      requiresApproval: Boolean(slug?.includes("marketing") || /邮件|草稿/.test(text)),
    });
  }

  if (!text || text.length < 2) {
    return pack({
      mode: "direct",
      reason: "输入过短",
      confidence: 0.3,
    });
  }

  const multi = MULTI_STEP_HINT.test(text) && SUPERVISOR_GOALS.test(text);
  const multiSoft =
    MULTI_STEP_HINT.test(text) &&
    (DIRECT_SALES.some((x) => x.re.test(text)) ||
      DIRECT_TENDER.some((x) => x.re.test(text)) ||
      Boolean(routeMarketingSkillIntent(text).slug));

  if (multi || (multiSoft && /并|然后|再|接着|安排|制定/.test(text))) {
    let skills = collectCandidateSkills(text);
    // 多步命中但未抽到具体 slug 时，按域补默认候选，避免 Planner 落到无关技能
    if (skills.length === 0) {
      if (/销售|客户|跟进|管道|商机/.test(text)) {
        skills = [
          "sales-pipeline-forecast",
          "sales-next-best-action",
          "sales-account-research",
        ];
      } else if (/投标|值得投|强制条件|废标/.test(text)) {
        skills = [
          "tender-bid-no-bid",
          "tender-mandatory-compliance-matrix",
        ];
      } else if (/获客|营销|渠道|广告|投放/.test(text)) {
        skills = [
          "marketing-product-context",
          "marketing-prospecting-campaign",
          "marketing-copywriting",
        ];
      }
    }
    return pack({
      mode: "supervisor",
      reason: "目标包含多步骤或跨阶段安排",
      confidence: 0.86,
      candidateSkills: skills,
      candidateWorker: (findWorkerForSkill(skills[0] || "") ||
        "") as WorkerId | "",
      requiresApproval: /邮件|草稿|行动|执行/.test(text),
    });
  }

  for (const x of DIRECT_TENDER) {
    if (x.re.test(text) && !/找出全部|强制条件.*开始|接下来怎么/.test(text)) {
      return pack({
        mode: "direct",
        reason: "单一投标技能",
        confidence: 0.88,
        candidateWorker: "tender",
        candidateSkills: [x.slug],
      });
    }
  }

  // 「判断是否值得投 + 强制条件 + 接下来」→ supervisor
  if (
    /是否值得投|值得投/.test(text) &&
    (/强制条件|接下来|怎么开始|找出全部/.test(text) ||
      Boolean(input.pageContext?.projectId))
  ) {
    if (/强制条件|接下来|怎么开始|找出/.test(text)) {
      return pack({
        mode: "supervisor",
        reason: "投标去留后还需强制条件与启动建议",
        confidence: 0.9,
        candidateWorker: "tender",
        candidateSkills: [
          "tender-bid-no-bid",
          "tender-mandatory-compliance-matrix",
        ],
      });
    }
  }

  for (const x of DIRECT_SALES) {
    if (x.re.test(text) && !/安排本周|分析本月|并准备/.test(text)) {
      return pack({
        mode: "direct",
        reason: "单一销售技能",
        confidence: 0.85,
        candidateWorker: "sales",
        candidateSkills: [x.slug],
      });
    }
  }

  if (/分析本月销售|安排本周销售|最值得推进|准备本周行动/.test(text)) {
    return pack({
      mode: "supervisor",
      reason: "销售分析与行动编排",
      confidence: 0.9,
      candidateWorker: "sales",
      candidateSkills: [
        "sales-pipeline-forecast",
        "sales-next-best-action",
        "sales-account-research",
      ],
      requiresApproval: true,
    });
  }

  if (/获客计划|第一批执行|制定一套/.test(text)) {
    return pack({
      mode: "supervisor",
      reason: "营销获客多步计划",
      confidence: 0.88,
      candidateWorker: "marketing",
      candidateSkills: [
        "marketing-product-context",
        "marketing-prospecting-campaign",
        "marketing-copywriting",
      ],
      requiresApproval: true,
    });
  }

  const mkt = routeMarketingSkillIntent(text);
  if (mkt.slug) {
    const worker = findWorkerForSkill(mkt.slug) as WorkerId | null;
    return pack({
      mode: "direct",
      reason: mkt.reason,
      confidence: mkt.confidence,
      candidateWorker: worker || "marketing",
      candidateSkills: [mkt.slug],
      requiresApproval: mkt.requiresApproval,
    });
  }

  return pack({
    mode: "direct",
    reason: "默认快速路径（避免过度规划）",
    confidence: 0.55,
  });
}
