/**
 * 企业业务规则服务 — 按 orgId 读写，带版本与归属元数据
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  PLATFORM_DEFAULT_AGENT_TOOL_POLICY,
  PLATFORM_DEFAULT_PROJECT_RISK,
  PLATFORM_DEFAULT_QUOTE_AUTO_SEND,
  PLATFORM_DEFAULT_QUOTE_MARGIN,
  type AgentToolPolicyOverride,
  type ConfigLoadResult,
  type ProjectRiskConfig,
  type QuoteAutoSendConfig,
  type QuoteMarginConfig,
  type RuleKey,
} from "./types";

function asObject(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

async function loadActiveRule(
  orgId: string,
  ruleKey: RuleKey,
): Promise<{
  configJson: unknown;
  version: number;
  effectiveAt: Date;
  updatedById: string | null;
} | null> {
  const row = await db.orgBusinessRule.findFirst({
    where: { orgId, ruleKey, status: "active" },
    orderBy: { version: "desc" },
    select: {
      configJson: true,
      version: true,
      effectiveAt: true,
      updatedById: true,
    },
  });
  return row;
}

/** 写入新版本：旧 active → superseded */
export async function publishOrgRule(params: {
  orgId: string;
  ruleKey: RuleKey;
  config: unknown;
  userId: string;
  effectiveAt?: Date;
}): Promise<{ version: number; id: string }> {
  const latest = await db.orgBusinessRule.findFirst({
    where: { orgId: params.orgId, ruleKey: params.ruleKey },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (latest?.version ?? 0) + 1;

  await db.orgBusinessRule.updateMany({
    where: { orgId: params.orgId, ruleKey: params.ruleKey, status: "active" },
    data: { status: "superseded" },
  });

  const created = await db.orgBusinessRule.create({
    data: {
      orgId: params.orgId,
      ruleKey: params.ruleKey,
      version: nextVersion,
      status: "active",
      configJson: params.config as Prisma.InputJsonValue,
      effectiveAt: params.effectiveAt ?? new Date(),
      createdById: params.userId,
      updatedById: params.userId,
    },
    select: { id: true, version: true },
  });

  return { id: created.id, version: created.version };
}

export async function loadQuoteMarginRule(
  orgId: string,
): Promise<ConfigLoadResult<QuoteMarginConfig>> {
  const row = await loadActiveRule(orgId, "quote_margin");
  if (!row) {
    return {
      status: "missing",
      value: { ...PLATFORM_DEFAULT_QUOTE_MARGIN },
      orgId,
      ruleKey: "quote_margin",
      version: null,
      effectiveAt: null,
      updatedById: null,
      message: "未配置毛利规则，使用平台通用默认（非其他企业配置）",
    };
  }
  const obj = asObject(row.configJson);
  if (!obj) {
    return {
      status: "invalid",
      value: { ...PLATFORM_DEFAULT_QUOTE_MARGIN },
      orgId,
      ruleKey: "quote_margin",
      version: row.version,
      effectiveAt: row.effectiveAt,
      updatedById: row.updatedById,
      message: "毛利规则 JSON 无效",
    };
  }
  const urgent = Number(obj.urgentBelowPct);
  const warn = Number(obj.warnBelowPct);
  const high = Number(obj.highAbovePct);
  if (![urgent, warn, high].every((n) => Number.isFinite(n))) {
    return {
      status: "invalid",
      value: { ...PLATFORM_DEFAULT_QUOTE_MARGIN },
      orgId,
      ruleKey: "quote_margin",
      version: row.version,
      effectiveAt: row.effectiveAt,
      updatedById: row.updatedById,
      message: "毛利规则字段类型无效",
    };
  }
  return {
    status: "ok",
    value: { urgentBelowPct: urgent, warnBelowPct: warn, highAbovePct: high },
    orgId,
    ruleKey: "quote_margin",
    version: row.version,
    effectiveAt: row.effectiveAt,
    updatedById: row.updatedById,
  };
}

export async function loadQuoteAutoSendRule(
  orgId: string,
): Promise<ConfigLoadResult<QuoteAutoSendConfig>> {
  const row = await loadActiveRule(orgId, "quote_auto_send");
  if (!row) {
    return {
      status: "missing",
      value: { ...PLATFORM_DEFAULT_QUOTE_AUTO_SEND },
      orgId,
      ruleKey: "quote_auto_send",
      version: null,
      effectiveAt: null,
      updatedById: null,
      message: "未配置自动发送规则，默认禁止直发（maxRisk=l2_soft）",
    };
  }
  const obj = asObject(row.configJson);
  if (!obj) {
    return {
      status: "invalid",
      value: { ...PLATFORM_DEFAULT_QUOTE_AUTO_SEND },
      orgId,
      ruleKey: "quote_auto_send",
      version: row.version,
      effectiveAt: row.effectiveAt,
      updatedById: row.updatedById,
      message: "自动发送规则无效",
    };
  }
  const sessionMaxRisk = String(obj.sessionMaxRisk ?? "l2_soft");
  if (
    !["l0_read", "l1_internal_write", "l2_soft", "l3_strong"].includes(
      sessionMaxRisk,
    )
  ) {
    return {
      status: "incompatible",
      value: { ...PLATFORM_DEFAULT_QUOTE_AUTO_SEND },
      orgId,
      ruleKey: "quote_auto_send",
      version: row.version,
      effectiveAt: row.effectiveAt,
      updatedById: row.updatedById,
      message: "自动发送规则版本不兼容（sessionMaxRisk）",
    };
  }
  return {
    status: "ok",
    value: {
      allowDirectSend: obj.allowDirectSend === true,
      sessionMaxRisk: sessionMaxRisk as QuoteAutoSendConfig["sessionMaxRisk"],
    },
    orgId,
    ruleKey: "quote_auto_send",
    version: row.version,
    effectiveAt: row.effectiveAt,
    updatedById: row.updatedById,
  };
}

export async function loadProjectRiskRule(
  orgId: string,
): Promise<ConfigLoadResult<ProjectRiskConfig>> {
  const row = await loadActiveRule(orgId, "project_risk");
  if (!row) {
    return {
      status: "missing",
      value: {
        ...PLATFORM_DEFAULT_PROJECT_RISK,
        staleDaysByStage: { ...PLATFORM_DEFAULT_PROJECT_RISK.staleDaysByStage },
      },
      orgId,
      ruleKey: "project_risk",
      version: null,
      effectiveAt: null,
      updatedById: null,
      message: "未配置项目风险阈值，使用平台通用默认",
    };
  }
  const obj = asObject(row.configJson);
  if (!obj) {
    return {
      status: "invalid",
      value: {
        ...PLATFORM_DEFAULT_PROJECT_RISK,
        staleDaysByStage: { ...PLATFORM_DEFAULT_PROJECT_RISK.staleDaysByStage },
      },
      orgId,
      ruleKey: "project_risk",
      version: row.version,
      effectiveAt: row.effectiveAt,
      updatedById: row.updatedById,
      message: "项目风险规则无效",
    };
  }
  const defaultStaleDays = Number(obj.defaultStaleDays);
  const stale = asObject(obj.staleDaysByStage) ?? {};
  const staleDaysByStage: Record<string, number> = {};
  for (const [k, v] of Object.entries(stale)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) staleDaysByStage[k] = n;
  }
  if (!Number.isFinite(defaultStaleDays) || defaultStaleDays <= 0) {
    return {
      status: "invalid",
      value: {
        ...PLATFORM_DEFAULT_PROJECT_RISK,
        staleDaysByStage: { ...PLATFORM_DEFAULT_PROJECT_RISK.staleDaysByStage },
      },
      orgId,
      ruleKey: "project_risk",
      version: row.version,
      effectiveAt: row.effectiveAt,
      updatedById: row.updatedById,
      message: "项目风险 defaultStaleDays 无效",
    };
  }
  return {
    status: "ok",
    value: { defaultStaleDays, staleDaysByStage },
    orgId,
    ruleKey: "project_risk",
    version: row.version,
    effectiveAt: row.effectiveAt,
    updatedById: row.updatedById,
  };
}

export async function loadAgentToolPolicyRule(
  orgId: string,
): Promise<ConfigLoadResult<AgentToolPolicyOverride>> {
  const row = await loadActiveRule(orgId, "agent_tool_policy");
  if (!row) {
    return {
      status: "missing",
      value: {
        disabledTools: [...(PLATFORM_DEFAULT_AGENT_TOOL_POLICY.disabledTools ?? [])],
        forceApprovalTools: [
          ...(PLATFORM_DEFAULT_AGENT_TOOL_POLICY.forceApprovalTools ?? []),
        ],
      },
      orgId,
      ruleKey: "agent_tool_policy",
      version: null,
      effectiveAt: null,
      updatedById: null,
      message: "未配置 Agent 工具政策，使用平台通用默认",
    };
  }
  const obj = asObject(row.configJson);
  if (!obj) {
    return {
      status: "invalid",
      value: {
        disabledTools: [],
        forceApprovalTools: [
          ...(PLATFORM_DEFAULT_AGENT_TOOL_POLICY.forceApprovalTools ?? []),
        ],
      },
      orgId,
      ruleKey: "agent_tool_policy",
      version: row.version,
      effectiveAt: row.effectiveAt,
      updatedById: row.updatedById,
      message: "Agent 工具政策无效",
    };
  }
  const disabledTools = Array.isArray(obj.disabledTools)
    ? obj.disabledTools.filter((x): x is string => typeof x === "string")
    : [];
  const forceApprovalTools = Array.isArray(obj.forceApprovalTools)
    ? obj.forceApprovalTools.filter((x): x is string => typeof x === "string")
    : [...(PLATFORM_DEFAULT_AGENT_TOOL_POLICY.forceApprovalTools ?? [])];
  return {
    status: "ok",
    value: { disabledTools, forceApprovalTools },
    orgId,
    ruleKey: "agent_tool_policy",
    version: row.version,
    effectiveAt: row.effectiveAt,
    updatedById: row.updatedById,
  };
}

/** 经营中心：汇总配置健康（缺失/无效） */
export async function listOrgConfigIssues(orgId: string): Promise<
  Array<{
    ruleKey: string;
    status: string;
    message: string;
    version: number | null;
  }>
> {
  const issues: Array<{
    ruleKey: string;
    status: string;
    message: string;
    version: number | null;
  }> = [];

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { industryPackId: true, quoteDiscountSettings: { select: { id: true, version: true } } },
  });

  if (!org?.industryPackId) {
    issues.push({
      ruleKey: "industry_pack",
      status: "missing",
      message: "未配置 Industry Pack，高风险行业语义任务应停止或使用 generic_business_v1",
      version: null,
    });
  }

  if (!org?.quoteDiscountSettings) {
    issues.push({
      ruleKey: "quote_discounts",
      status: "missing",
      message: "未配置企业折扣规则，报价使用平台通用默认折扣",
      version: null,
    });
  }

  for (const loader of [
    loadQuoteMarginRule,
    loadQuoteAutoSendRule,
    loadProjectRiskRule,
    loadAgentToolPolicyRule,
  ] as const) {
    const r = await loader(orgId);
    if (r.status !== "ok") {
      issues.push({
        ruleKey: r.ruleKey,
        status: r.status,
        message: r.message ?? r.status,
        version: r.version,
      });
    }
  }

  return issues;
}
