/**
 * AI 生成 Playbook 草稿 — 仅草稿，不提交不批准
 */

import { createCompletionDetailed } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import { db } from "@/lib/db";
import { getBrandContext } from "../brand-context";
import { createPlaybookDraft } from "./service";
import type { PlaybookContentFields } from "./types";
import { validatePlaybookContent } from "./validate";

const PROMPT_VERSION = "matrix-playbook-v1";

const SYSTEM = `你是社媒矩阵账号运营策划。根据给定品牌与账号信息，输出结构化账号运营方案 JSON。

硬性规则：
- 区分事实、推断、建议；不确定写入 missingInformation
- 不得编造历史业绩、客户数据、账号表现数字
- 不得编造未提供的产品能力或价格
- 内容支柱 3-5 个
- 只输出 JSON 对象，不要 markdown

JSON 字段：
{
  "accountRole": "",
  "businessObjective": "",
  "positioning": "",
  "personaBackground": "",
  "personality": "",
  "toneOfVoice": "",
  "operatingLanguage": "",
  "operatingRegion": "",
  "primaryProducts": "",
  "targetAudience": [],
  "contentPillars": [],
  "contentMix": [],
  "visualStyle": {},
  "postingRules": {},
  "ctaStrategy": {},
  "conversionPath": {},
  "kpiTargets": {},
  "forbiddenTopics": [],
  "exampleContent": [],
  "missingInformation": [],
  "riskFlags": [],
  "confidenceAssessment": [],
  "factNotes": [],
  "inferenceNotes": [],
  "suggestionNotes": []
}`;

type AiRaw = Record<string, unknown>;

function mapAiToContent(raw: AiRaw): PlaybookContentFields {
  return {
    accountRole: typeof raw.accountRole === "string" ? raw.accountRole : null,
    businessObjective:
      typeof raw.businessObjective === "string" ? raw.businessObjective : null,
    positioning: typeof raw.positioning === "string" ? raw.positioning : null,
    personaBackground:
      typeof raw.personaBackground === "string" ? raw.personaBackground : null,
    personality: typeof raw.personality === "string" ? raw.personality : null,
    toneOfVoice: typeof raw.toneOfVoice === "string" ? raw.toneOfVoice : null,
    operatingLanguage:
      typeof raw.operatingLanguage === "string" ? raw.operatingLanguage : null,
    operatingRegion:
      typeof raw.operatingRegion === "string" ? raw.operatingRegion : null,
    primaryProducts:
      typeof raw.primaryProducts === "string" ? raw.primaryProducts : null,
    targetAudienceJson: raw.targetAudience ?? null,
    contentPillarsJson: raw.contentPillars ?? null,
    contentMixJson: raw.contentMix ?? null,
    visualStyleJson: raw.visualStyle ?? null,
    postingRulesJson: raw.postingRules ?? null,
    ctaStrategyJson: raw.ctaStrategy ?? null,
    conversionPathJson: raw.conversionPath ?? null,
    kpiTargetsJson: raw.kpiTargets ?? null,
    forbiddenTopicsJson: raw.forbiddenTopics ?? null,
    exampleContentJson: raw.exampleContent ?? null,
  };
}

export async function generatePlaybookAiDraft(input: {
  orgId: string;
  accountId: string;
  userId: string;
  extraNotes?: string;
}) {
  if (!isAIConfigured()) {
    throw new Error("AI 未配置，无法生成草稿");
  }

  const account = await db.matrixAccount.findFirst({
    where: { id: input.accountId, orgId: input.orgId },
  });
  if (!account) throw new Error("账号不存在");

  const brandText = await getBrandContext(input.orgId);
  const userPrompt = [
    `平台：${account.platform}`,
    `账号：${account.handle}`,
    `显示名：${account.displayName ?? ""}`,
    `账号组显示名：${account.groupName}`,
    `档位：${account.tier}`,
    `既有 personaNotes（兼容，勿当作已证实业绩）：${account.personaNotes ?? "（无）"}`,
    `品牌档案：\n${brandText ?? "（未配置，请在 missingInformation 标明）"}`,
    input.extraNotes ? `运营补充：${input.extraNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await createCompletionDetailed({
    systemPrompt: SYSTEM,
    userPrompt,
    mode: "normal",
    temperature: 0.4,
    maxTokens: 8192,
    timeoutMs: 120_000,
    orgId: input.orgId,
    userId: input.userId,
  });

  const text = completion.content ?? "";
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let raw: AiRaw;
  try {
    raw = JSON.parse(jsonText) as AiRaw;
  } catch {
    throw new Error("AI 输出不是合法 JSON");
  }

  const content = mapAiToContent(raw);
  const validation = validatePlaybookContent(content);

  const meta = {
    promptVersion: PROMPT_VERSION,
    model: completion.model,
    sources: ["brand_profile", "matrix_account", "persona_notes"],
    missingInformation: Array.isArray(raw.missingInformation)
      ? raw.missingInformation
      : [],
    riskFlags: Array.isArray(raw.riskFlags) ? raw.riskFlags : [],
    confidenceAssessment: Array.isArray(raw.confidenceAssessment)
      ? raw.confidenceAssessment
      : [],
    factNotes: raw.factNotes ?? [],
    inferenceNotes: raw.inferenceNotes ?? [],
    suggestionNotes: raw.suggestionNotes ?? [],
    validation,
  };

  const draft = await createPlaybookDraft({
    orgId: input.orgId,
    accountId: input.accountId,
    userId: input.userId,
    content,
    changeSummary: "AI 生成草稿（未提交审批）",
    aiDraftMetaJson: meta,
  });

  return { draft, meta };
}
