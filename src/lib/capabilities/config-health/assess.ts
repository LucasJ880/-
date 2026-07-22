/**
 * 中台配置健康 — 扩展 listOrgConfigIssues，不重建第二套系统。
 */

import { db } from "@/lib/db";
import { listOrgConfigIssues } from "@/lib/org-rules/service";
import { resolveIndustryPack } from "@/lib/industry-packs/registry";
import { parseOrgModulesJson } from "@/lib/tenancy/modules";
import { getGovernanceProjection } from "@/lib/capabilities/governance/projection";
import { OPENAI_PRICING_VERSION } from "@/lib/capabilities/usage/pricing";
import type { CapabilitiesAccessContext } from "../types";
import type {
  ConfigHealthIssue,
  ConfigHealthReport,
  ConfigHealthStatus,
} from "./types";

function overallFrom(issues: ConfigHealthIssue[]): ConfigHealthStatus {
  if (issues.some((i) => i.status === "ERROR" || i.severity === "CRITICAL"))
    return "ERROR";
  if (issues.some((i) => i.status === "INCOMPATIBLE")) return "INCOMPATIBLE";
  if (issues.some((i) => i.status === "MISSING")) return "MISSING";
  if (issues.some((i) => i.status === "WARNING" || i.severity === "WARNING"))
    return "WARNING";
  return "HEALTHY";
}

export async function assessConfigHealth(
  access: CapabilitiesAccessContext,
): Promise<ConfigHealthReport> {
  const orgId = access.orgId;
  const issues: ConfigHealthIssue[] = [];
  const checkedAt = new Date().toISOString();

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      industryPackId: true,
      modulesJson: true,
      _count: { select: { members: true } },
    },
  });

  if (!org) {
    return {
      orgId,
      overall: "ERROR",
      checkedAt,
      issues: [
        {
          code: "ORG_NOT_FOUND",
          severity: "CRITICAL",
          status: "ERROR",
          scope: "ORGANIZATION",
          title: "组织不可读",
          message: "无法加载组织，不伪造 HEALTHY",
        },
      ],
      summary: { healthy: 0, warning: 0, error: 1, missing: 0, incompatible: 0 },
    };
  }

  // membership
  if (org._count.members === 0) {
    issues.push({
      code: "NO_MEMBERSHIP",
      severity: "ERROR",
      status: "MISSING",
      scope: "ORGANIZATION",
      scopeId: orgId,
      title: "无活跃成员",
      message: "企业没有任何活跃成员",
      actionHref: "/organizations",
    });
  }

  // modulesJson
  const modules = parseOrgModulesJson(org.modulesJson);
  if (!modules?.enabled?.length) {
    issues.push({
      code: "MODULES_EMPTY",
      severity: "WARNING",
      status: "WARNING",
      scope: "ORGANIZATION",
      scopeId: orgId,
      title: "模块配置为空或未解析",
      message: "modulesJson 未配置启用模块；导航业务入口可能异常",
      recommendedAction: "在企业管理中检查模块开关",
      actionHref: "/organizations",
    });
  }

  // Industry Pack — 禁止静默回退
  const pack = resolveIndustryPack(org.industryPackId);
  if (pack.status === "missing") {
    issues.push({
      code: "INDUSTRY_PACK_MISSING",
      severity: "ERROR",
      status: "MISSING",
      scope: "ORGANIZATION",
      scopeId: orgId,
      title: "未配置 Industry Pack",
      message: pack.message,
      recommendedAction: "为企业配置 Industry Pack，禁止静默回退家纺",
      actionHref: "/capabilities/config-health",
    });
  } else if (pack.status === "invalid") {
    issues.push({
      code: "INDUSTRY_PACK_INCOMPATIBLE",
      severity: "CRITICAL",
      status: "INCOMPATIBLE",
      scope: "ORGANIZATION",
      scopeId: orgId,
      title: "Industry Pack 无效",
      message: pack.message,
    });
  }

  // 复用经营中心规则检查
  const legacy = await listOrgConfigIssues(orgId);
  for (const row of legacy) {
    if (row.ruleKey === "industry_pack") continue; // 已覆盖
    const status: ConfigHealthStatus =
      row.status === "missing"
        ? "MISSING"
        : row.status === "invalid"
          ? "INCOMPATIBLE"
          : "WARNING";
    issues.push({
      code: `RULE_${row.ruleKey.toUpperCase()}`,
      severity: status === "MISSING" ? "WARNING" : "ERROR",
      status,
      scope: "ORGANIZATION",
      scopeId: orgId,
      title: `业务规则：${row.ruleKey}`,
      message: row.message,
      actionHref: "/operations/center",
    });
  }

  // Brand Truth — best-effort
  try {
    const { getOrgBrandTruth } = await import("@/lib/brand/org-brand-truth");
    const brand = await getOrgBrandTruth(orgId);
    const empty =
      !brand ||
      brand.status === "missing" ||
      brand.status === "facts_missing";
    if (empty) {
      issues.push({
        code: "BRAND_TRUTH_MISSING",
        severity: "WARNING",
        status: "MISSING",
        scope: "ORGANIZATION",
        title: "Brand Truth 未配置",
        message: "企业品牌事实库为空或不可用",
        actionHref: "/knowledge",
      });
    }
  } catch {
    issues.push({
      code: "BRAND_TRUTH_UNREADABLE",
      severity: "WARNING",
      status: "WARNING",
      scope: "ORGANIZATION",
      title: "Brand Truth 不可读",
      message: "无法读取 Brand Truth，不伪造 HEALTHY",
    });
  }

  try {
    const gloss = await db.organizationGlossaryTerm
      .count({ where: { orgId } })
      .catch(() => -1);
    if (gloss === 0) {
      issues.push({
        code: "GLOSSARY_MISSING",
        severity: "INFO",
        status: "MISSING",
        scope: "ORGANIZATION",
        title: "术语表为空",
        message: "组织术语表尚无条目",
        actionHref: "/knowledge",
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const objs = await db.businessObjectDefinition
      .count({ where: { orgId } })
      .catch(() => -1);
    if (objs === 0) {
      issues.push({
        code: "BUSINESS_OBJECTS_MISSING",
        severity: "INFO",
        status: "MISSING",
        scope: "ORGANIZATION",
        title: "业务对象未定义",
        message: "尚无 Business Object Definition",
      });
    }
  } catch {
    /* ignore */
  }

  // Workspace
  try {
    const wsCount = await db.workspace.count({
      where: { orgId, status: "active" },
    });
    if (wsCount === 0) {
      issues.push({
        code: "WORKSPACE_NONE",
        severity: "INFO",
        status: "MISSING",
        scope: "ORGANIZATION",
        title: "无活跃 Workspace",
        message: "企业尚未创建 Workspace",
        actionHref: "/organizations",
      });
    }
  } catch {
    issues.push({
      code: "WORKSPACE_UNREADABLE",
      severity: "WARNING",
      status: "WARNING",
      scope: "ORGANIZATION",
      title: "Workspace 不可读",
      message: "无法校验 Workspace 配置",
    });
  }

  // Provider / OpenAI
  const projection = await getGovernanceProjection({ orgId });
  for (const p of projection.providerStatus) {
    if (p.provider === "openai" && p.status !== "ACTIVE") {
      issues.push({
        code: "OPENAI_NOT_CONFIGURED",
        severity: "CRITICAL",
        status: "MISSING",
        scope: "PLATFORM",
        title: "OpenAI 未配置",
        message: "服务端未配置 OPENAI_API_KEY；不得显示为可用 Provider",
        recommendedAction: "配置环境变量后重试",
      });
    }
    if (
      p.provider !== "openai" &&
      (p.status === "NOT_IMPLEMENTED" || p.status === "NOT_CONFIGURED")
    ) {
      // 信息不轰炸：仅 INFO
      issues.push({
        code: `PROVIDER_${p.provider.toUpperCase()}_UNAVAILABLE`,
        severity: "INFO",
        status: "MISSING",
        scope: "PLATFORM",
        title: `${p.provider} 未接入`,
        message: `${p.provider} 状态=${p.status}，不得显示为 ACTIVE`,
      });
    }
  }

  // 定价版本 / 账本可写性
  issues.push({
    code: "PRICING_VERSION",
    severity: "INFO",
    status: "HEALTHY",
    scope: "PLATFORM",
    title: "定价版本",
    message: `当前定价版本 ${OPENAI_PRICING_VERSION}（历史不重算）`,
  });

  try {
    await db.aiUsageLedger.findFirst({
      where: { orgId },
      select: { id: true },
    });
  } catch {
    issues.push({
      code: "LEDGER_UNREADABLE",
      severity: "ERROR",
      status: "ERROR",
      scope: "ORGANIZATION",
      title: "AiUsageLedger 不可读",
      message: "账本查询失败，不伪造 HEALTHY",
    });
  }

  // 配额策略
  const quotaPolicies = await db.capabilityQuotaPolicy.count({
    where: { orgId, enabled: true },
  });
  if (quotaPolicies === 0) {
    issues.push({
      code: "QUOTA_POLICY_DEFAULT_ONLY",
      severity: "INFO",
      status: "WARNING",
      scope: "ORGANIZATION",
      title: "仅使用平台默认配额",
      message: "企业未自定义配额策略",
      actionHref: "/capabilities/governance",
    });
  }

  // 过期未清理 / 长时间 RESERVED
  const stale = await db.capabilityQuotaReservation.count({
    where: {
      orgId,
      status: "RESERVED",
      expiresAt: { lt: new Date(Date.now() - 60 * 60_000) },
    },
  });
  if (stale > 0) {
    issues.push({
      code: "STALE_RESERVATIONS",
      severity: "WARNING",
      status: "WARNING",
      scope: "ORGANIZATION",
      title: "存在过期未结算预留",
      message: `${stale} 条 RESERVED 已超过 1 小时未结算`,
      recommendedAction: "检查流式结算与清理任务",
      actionHref: "/capabilities/governance",
    });
  }

  const failedSettle = await db.capabilityQuotaReservation.count({
    where: { orgId, status: "SETTLEMENT_FAILED" },
  });
  if (failedSettle > 0) {
    issues.push({
      code: "SETTLEMENT_FAILED",
      severity: "ERROR",
      status: "ERROR",
      scope: "ORGANIZATION",
      title: "存在结算失败预留",
      message: `${failedSettle} 条 SETTLEMENT_FAILED`,
      actionHref: "/capabilities/governance",
    });
  }

  const summary = {
    healthy: issues.filter((i) => i.status === "HEALTHY").length,
    warning: issues.filter((i) => i.status === "WARNING").length,
    error: issues.filter(
      (i) => i.status === "ERROR" || i.severity === "CRITICAL",
    ).length,
    missing: issues.filter((i) => i.status === "MISSING").length,
    incompatible: issues.filter((i) => i.status === "INCOMPATIBLE").length,
  };

  // 排序：CRITICAL > ERROR > WARNING > INFO
  const rank = { CRITICAL: 0, ERROR: 1, WARNING: 2, INFO: 3 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    orgId,
    overall: overallFrom(issues.filter((i) => i.status !== "HEALTHY")),
    checkedAt,
    issues,
    summary,
  };
}
