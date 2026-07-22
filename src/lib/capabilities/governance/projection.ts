import { db } from "@/lib/db";
import { parseOrgModulesJson, ORG_MODULES } from "@/lib/tenancy/modules";
import { resolveIndustryPack } from "@/lib/industry-packs/registry";
import { loadAgentToolPolicyRule } from "@/lib/org-rules/service";
import { runVisibilityFromOrgSettings } from "../visibility";
import { ProviderRouter } from "@/lib/ai/model-registry/provider-router";
import { OpenAIModels } from "@/lib/ai/model-registry/openai";
import { ALL_QUOTA_METRICS } from "./defaults";
import { resolveEffectiveQuota } from "./resolve";
import type { GovernanceProjection } from "./types";

export async function getGovernanceProjection(opts: {
  orgId: string;
  workspaceId?: string | null;
}): Promise<GovernanceProjection> {
  const org = await db.organization.findUnique({
    where: { id: opts.orgId },
    select: {
      id: true,
      industryPackId: true,
      modulesJson: true,
      settingsJson: true,
    },
  });

  const pack = resolveIndustryPack(org?.industryPackId, {
    fallbackGenericOnMissing: false,
  });
  const industryPack = {
    id: org?.industryPackId ?? null,
    status:
      pack.status === "ok"
        ? ("OK" as const)
        : pack.status === "missing"
          ? ("MISSING" as const)
          : pack.status === "incompatible"
            ? ("INCOMPATIBLE" as const)
            : ("INVALID" as const),
  };

  const modulesCfg = parseOrgModulesJson(org?.modulesJson);
  const enabled = new Set(modulesCfg?.enabled ?? [...ORG_MODULES]);
  const modules = ORG_MODULES.map((key) => ({
    key,
    enabled: enabled.has(key),
    sourceScope: "ORGANIZATION",
  }));

  const toolRule = await loadAgentToolPolicyRule(opts.orgId);
  const disabled = new Set(toolRule.value?.disabledTools ?? []);
  const force = new Set(toolRule.value?.forceApprovalTools ?? []);
  const toolPolicies = [...new Set([...disabled, ...force])].map((toolKey) => ({
    toolKey,
    riskLevel: force.has(toolKey) ? "HIGH" : "MEDIUM",
    allowed: !disabled.has(toolKey),
    requiresApproval: force.has(toolKey),
    sourceScope: "ORGANIZATION" as const,
    version: toolRule.version,
  }));

  const visibilityPolicy = {
    value: runVisibilityFromOrgSettings(org?.settingsJson),
    sourceScope: "ORGANIZATION",
  };

  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  const providerStatus: GovernanceProjection["providerStatus"] = [
    {
      provider: "openai",
      status: openaiConfigured ? "ACTIVE" : "NOT_CONFIGURED",
      models: openaiConfigured
        ? [
            ProviderRouter.getChatModel("openai"),
            OpenAIModels.image,
            OpenAIModels.fast,
          ]
        : [],
    },
    {
      provider: "gemini",
      status: "NOT_IMPLEMENTED",
      models: [],
    },
    {
      provider: "qwen",
      status: "NOT_IMPLEMENTED",
      models: [],
    },
    {
      provider: "flux",
      status: "NOT_CONFIGURED",
      models: [],
    },
  ];

  const quotas = await Promise.all(
    ALL_QUOTA_METRICS.map((metric) =>
      resolveEffectiveQuota({
        orgId: opts.orgId,
        workspaceId: opts.workspaceId,
        metric,
      }),
    ),
  );

  return {
    orgId: opts.orgId,
    workspaceId: opts.workspaceId ?? null,
    industryPack,
    modules,
    toolPolicies,
    visibilityPolicy,
    providerStatus,
    quotas,
  };
}
