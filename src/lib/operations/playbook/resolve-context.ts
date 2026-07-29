/**
 * resolveEffectiveAccountContext — 可解释继承
 *
 * 优先级：
 * 任务明确输入 > 单账号 Playbook(approved，或显式 preview draft)
 * > 账号组策略 > BrandProfile > MarketingBrandProfile
 * 兼容降级：personaNotes / groupName（不得视为已批准策略）
 */

import { db } from "@/lib/db";
import { defaultMergeMode, mergeField, readOverrides } from "./merge";
import type {
  EffectiveAccountContext,
  FieldSource,
  MergeMode,
  SourceTraceEntry,
} from "./types";
import { JSON_FIELDS, TEXT_FIELDS } from "./types";

export type ResolveAccountContextInput = {
  orgId: string;
  accountId: string;
  campaignId?: string | null;
  contentPlanItemId?: string | null;
  /** 允许用 draft 预览（不计入 hasApprovedPlaybook） */
  allowDraftPreview?: boolean;
  /** 本次任务显式覆盖 */
  taskInput?: Partial<Record<string, unknown>>;
};

function asText(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function resolveEffectiveAccountContext(
  input: ResolveAccountContextInput,
): Promise<EffectiveAccountContext> {
  const warnings: string[] = [];
  const sourceTrace: SourceTraceEntry[] = [];

  const account = await db.matrixAccount.findFirst({
    where: { id: input.accountId, orgId: input.orgId },
  });
  if (!account) {
    throw new Error("账号不存在或不属于当前组织");
  }

  const [brand, marketingBrand, approvedAccountPb, draftAccountPb, groupApproved] =
    await Promise.all([
      db.brandProfile.findUnique({ where: { orgId: input.orgId } }),
      db.marketingBrandProfile.findUnique({ where: { orgId: input.orgId } }),
      db.matrixAccountPlaybook.findFirst({
        where: {
          orgId: input.orgId,
          accountId: account.id,
          status: "approved",
          isEffective: true,
        },
      }),
      input.allowDraftPreview
        ? db.matrixAccountPlaybook.findFirst({
            where: {
              orgId: input.orgId,
              accountId: account.id,
              status: { in: ["draft", "submitted", "rejected"] },
            },
            orderBy: { version: "desc" },
          })
        : Promise.resolve(null),
      account.groupId
        ? db.matrixGroupPlaybook.findFirst({
            where: {
              orgId: input.orgId,
              groupId: account.groupId,
              status: "approved",
              isEffective: true,
            },
          })
        : Promise.resolve(null),
    ]);

  const group = account.groupId
    ? await db.matrixAccountGroup.findUnique({ where: { id: account.groupId } })
    : null;

  if (!account.groupId) {
    warnings.push("账号未绑定稳定 groupId，仅兼容 groupName/personaNotes");
  }
  if (!approvedAccountPb) {
    warnings.push("无已批准账号 Playbook；不得用于自动发布策略");
  }

  const usingDraftPreview = Boolean(!approvedAccountPb && draftAccountPb);
  const accountPb = approvedAccountPb ?? (usingDraftPreview ? draftAccountPb : null);

  type Layer = {
    source: FieldSource;
    text: Partial<Record<(typeof TEXT_FIELDS)[number], string | null>>;
    json: Partial<Record<(typeof JSON_FIELDS)[number], unknown>>;
    overrides?: Record<string, MergeMode>;
  };

  const layers: Layer[] = [];

  // 底层：MarketingBrandProfile（事实）
  if (marketingBrand) {
    layers.push({
      source: "marketing_brand_profile",
      text: {
        operatingRegion: [marketingBrand.city, marketingBrand.region, marketingBrand.country]
          .filter(Boolean)
          .join(", ") || null,
        primaryProducts: null,
      },
      json: {
        targetAudienceJson: marketingBrand.targetAudiencesJson ?? null,
        contentPillarsJson: null,
        forbiddenTopicsJson: marketingBrand.forbiddenContextsJson ?? null,
        exampleContentJson: marketingBrand.productsJson ?? null,
      },
    });
  }

  // BrandProfile
  if (brand) {
    layers.push({
      source: "brand_profile",
      text: {
        toneOfVoice: brand.toneOfVoice,
        positioning: brand.positioning,
      },
      json: {
        targetAudienceJson: brand.targetAudience
          ? { summary: brand.targetAudience }
          : null,
        forbiddenTopicsJson: brand.forbiddenClaims
          ? [brand.forbiddenClaims]
          : null,
      },
    });
  }

  // 兼容 groupName / personaNotes（非批准策略）
  if (account.personaNotes?.trim()) {
    layers.push({
      source: "persona_notes",
      text: { personality: account.personaNotes },
      json: {},
    });
  }

  if (groupApproved) {
    layers.push({
      source: "group_playbook",
      text: {
        accountRole: groupApproved.accountRole,
        businessObjective: groupApproved.businessObjective,
        positioning: groupApproved.positioning,
        personaBackground: groupApproved.personaBackground,
        personality: groupApproved.personality,
        toneOfVoice: groupApproved.toneOfVoice,
        operatingLanguage: groupApproved.operatingLanguage,
        operatingRegion: groupApproved.operatingRegion,
        primaryProducts: groupApproved.primaryProducts,
      },
      json: {
        targetAudienceJson: groupApproved.targetAudienceJson,
        contentPillarsJson: groupApproved.contentPillarsJson,
        contentMixJson: groupApproved.contentMixJson,
        visualStyleJson: groupApproved.visualStyleJson,
        postingRulesJson: groupApproved.postingRulesJson,
        ctaStrategyJson: groupApproved.ctaStrategyJson,
        conversionPathJson: groupApproved.conversionPathJson,
        kpiTargetsJson: groupApproved.kpiTargetsJson,
        forbiddenTopicsJson: groupApproved.forbiddenTopicsJson,
        exampleContentJson: groupApproved.exampleContentJson,
      },
    });
  }

  if (accountPb) {
    layers.push({
      source: "account_playbook",
      text: {
        accountRole: accountPb.accountRole,
        businessObjective: accountPb.businessObjective,
        positioning: accountPb.positioning,
        personaBackground: accountPb.personaBackground,
        personality: accountPb.personality,
        toneOfVoice: accountPb.toneOfVoice,
        operatingLanguage: accountPb.operatingLanguage,
        operatingRegion: accountPb.operatingRegion,
        primaryProducts: accountPb.primaryProducts,
      },
      json: {
        targetAudienceJson: accountPb.targetAudienceJson,
        contentPillarsJson: accountPb.contentPillarsJson,
        contentMixJson: accountPb.contentMixJson,
        visualStyleJson: accountPb.visualStyleJson,
        postingRulesJson: accountPb.postingRulesJson,
        ctaStrategyJson: accountPb.ctaStrategyJson,
        conversionPathJson: accountPb.conversionPathJson,
        kpiTargetsJson: accountPb.kpiTargetsJson,
        forbiddenTopicsJson: accountPb.forbiddenTopicsJson,
        exampleContentJson: accountPb.exampleContentJson,
      },
      overrides: readOverrides(accountPb.overridesJson),
    });
  }

  // Campaign soft context
  if (input.campaignId) {
    const campaign = await db.marketingCampaign.findFirst({
      where: { id: input.campaignId, orgId: input.orgId },
      select: { name: true, objective: true },
    });
    if (campaign) {
      layers.push({
        source: "campaign",
        text: {
          businessObjective: campaign.objective || campaign.name,
        },
        json: {},
      });
    }
  }

  const effectiveText: Record<string, string | null> = {};
  const effectiveJson: Record<string, unknown> = {};

  const applyText = (
    field: (typeof TEXT_FIELDS)[number],
    value: string | null | undefined,
    source: FieldSource,
  ) => {
    if (!asText(value)) return;
    effectiveText[field] = asText(value);
    const existing = sourceTrace.find((t) => t.field === field);
    if (existing) {
      existing.source = source;
      existing.note = `overridden by ${source}`;
    } else {
      sourceTrace.push({ field, source, mergeMode: "replace" });
    }
  };

  const applyJson = (
    field: (typeof JSON_FIELDS)[number],
    value: unknown,
    source: FieldSource,
    mode: MergeMode,
  ) => {
    if (value == null) return;
    const prev = effectiveJson[field];
    effectiveJson[field] = mergeField({ base: prev, override: value, mode });
    const existing = sourceTrace.find((t) => t.field === field);
    if (existing) {
      existing.source = source;
      existing.mergeMode = mode;
      existing.note = `merged via ${mode} from ${source}`;
    } else {
      sourceTrace.push({ field, source, mergeMode: mode });
    }
  };

  for (const layer of layers) {
    for (const f of TEXT_FIELDS) {
      applyText(f, layer.text[f], layer.source);
    }
    for (const f of JSON_FIELDS) {
      const mode = layer.overrides?.[f] ?? defaultMergeMode(f);
      if (mode === "disabled") {
        sourceTrace.push({
          field: f,
          source: layer.source,
          mergeMode: "disabled",
          note: "override disabled — keep lower layer",
        });
        continue;
      }
      applyJson(f, layer.json[f], layer.source, mode);
    }
  }

  // 任务输入最高优先
  if (input.taskInput) {
    for (const f of TEXT_FIELDS) {
      if (f in input.taskInput) {
        applyText(f, asText(input.taskInput[f]), "task_input");
      }
    }
    for (const f of JSON_FIELDS) {
      if (f in input.taskInput) {
        applyJson(f, input.taskInput[f], "task_input", "replace");
      }
    }
  }

  const effectiveContext: Record<string, unknown> = {
    ...effectiveText,
    ...effectiveJson,
  };

  return {
    orgId: input.orgId,
    accountId: account.id,
    groupId: account.groupId,
    groupKey: group?.groupKey ?? null,
    groupDisplayName: group?.displayName ?? account.groupName,
    hasApprovedPlaybook: Boolean(approvedAccountPb),
    usingDraftPreview,
    brandContext: {
      brandName: brand?.brandName ?? marketingBrand?.brandName ?? null,
      toneOfVoice: brand?.toneOfVoice ?? null,
      targetAudience: brand?.targetAudience ?? null,
      forbiddenClaims: brand?.forbiddenClaims ?? null,
      positioning: brand?.positioning ?? null,
    },
    objective: effectiveText.businessObjective ?? null,
    targetAudience: effectiveJson.targetAudienceJson ?? null,
    contentPillars: effectiveJson.contentPillarsJson ?? null,
    toneOfVoice: effectiveText.toneOfVoice ?? null,
    visualStyle: effectiveJson.visualStyleJson ?? null,
    ctaStrategy: effectiveJson.ctaStrategyJson ?? null,
    conversionPath: effectiveJson.conversionPathJson ?? null,
    forbiddenTopics: effectiveJson.forbiddenTopicsJson ?? null,
    postingRules: effectiveJson.postingRulesJson ?? null,
    kpiTargets: effectiveJson.kpiTargetsJson ?? null,
    personaSummary:
      effectiveText.personaBackground ||
      effectiveText.personality ||
      account.personaNotes ||
      null,
    accountRole: effectiveText.accountRole ?? null,
    positioning: effectiveText.positioning ?? null,
    effectiveContext,
    sourceTrace,
    warnings,
  };
}
