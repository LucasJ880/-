/**
 * Capability Catalog Read Model — 只读聚合，不建第二套继承。
 */

import { db } from "@/lib/db";
import { listSkills } from "@/lib/agent/skills/registry";
import { registry as toolRegistry } from "@/lib/agent-core/tool-registry";
import { resolveIndustryPack } from "@/lib/industry-packs/registry";
import { parseOrgModulesJson } from "@/lib/tenancy/modules";
import type { CapabilitiesAccessContext } from "../types";
import type { CatalogFilters, CatalogItem, CapabilityStatus } from "./types";

function matchesFilters(item: CatalogItem, f: CatalogFilters): boolean {
  if (f.type && item.type !== f.type) return false;
  if (f.status && item.status !== f.status) return false;
  if (f.sourceScope && item.sourceScope !== f.sourceScope) return false;
  if (f.workspaceId && item.workspaceId !== f.workspaceId) return false;
  if (
    f.riskLevel &&
    (item.riskLevel ?? "").toLowerCase() !== f.riskLevel.toLowerCase()
  )
    return false;
  if (
    typeof f.requiresApproval === "boolean" &&
    item.requiresApproval !== f.requiresApproval
  )
    return false;
  if (f.recentlyRun && !item.lastRunAt) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (
      !item.name.toLowerCase().includes(q) &&
      !(item.description ?? "").toLowerCase().includes(q) &&
      !item.id.toLowerCase().includes(q)
    ) {
      return false;
    }
  }
  return true;
}

async function loadOrgRunAggregate(orgId: string): Promise<{
  lastRunAt: string | null;
  callCount30d: number;
  successRate30d: number | null;
}> {
  const since = new Date(Date.now() - 30 * 86400000);
  const [total, ok, latest] = await Promise.all([
    db.agentRun.count({ where: { orgId, createdAt: { gte: since } } }),
    db.agentRun.count({
      where: {
        orgId,
        createdAt: { gte: since },
        status: { in: ["succeeded", "completed"] },
      },
    }),
    db.agentRun.findFirst({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, completedAt: true },
    }),
  ]);
  return {
    lastRunAt: (latest?.completedAt ?? latest?.createdAt)?.toISOString() ?? null,
    callCount30d: total,
    successRate30d: total > 0 ? Math.round((ok / total) * 1000) / 10 : null,
  };
}

export async function listCapabilityCatalog(
  access: CapabilitiesAccessContext,
  filters: CatalogFilters = {},
): Promise<{ items: CatalogItem[]; orgId: string; total: number }> {
  const orgId = access.orgId;
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      industryPackId: true,
      modulesJson: true,
    },
  });
  if (!org) {
    return { items: [], orgId, total: 0 };
  }

  const modules = parseOrgModulesJson(org.modulesJson);
  const enabledModules = new Set(modules?.enabled ?? []);
  const runAgg = await loadOrgRunAggregate(orgId);
  const items: CatalogItem[] = [];

  const packRes = resolveIndustryPack(org.industryPackId);
  let packStatus: CapabilityStatus = "ACTIVE";
  if (packRes.status === "missing") packStatus = "MISSING_CONFIG";
  else if (packRes.status === "invalid") packStatus = "INCOMPATIBLE";
  items.push({
    id: `pack:${org.industryPackId ?? "none"}`,
    name: packRes.pack?.name ?? "Industry Pack",
    type: "INDUSTRY_PACK",
    status: packStatus,
    sourceScope: "ORGANIZATION",
    workspaceId: null,
    version: packRes.pack?.id ?? org.industryPackId ?? null,
    riskLevel: packStatus === "ACTIVE" ? "LOW" : "HIGH",
    requiresApproval: false,
    enabled: packStatus === "ACTIVE",
    lastRunAt: null,
    successRate30d: null,
    callCount30d: null,
    description:
      packRes.status === "ok"
        ? `${packRes.pack.name} (${packRes.pack.id})`
        : packRes.message,
  });

  for (const skill of listSkills()) {
    const moduleHint = (skill.domain || "").toLowerCase();
    const moduleOk =
      enabledModules.size === 0 ||
      !moduleHint ||
      [...enabledModules].some(
        (m) => moduleHint.includes(m) || m.includes(moduleHint),
      );
    const status: CapabilityStatus = moduleOk ? "ACTIVE" : "DISABLED";
    items.push({
      id: `skill:${skill.id}`,
      name: skill.name,
      type: "SKILL",
      status,
      sourceScope: "PLATFORM",
      workspaceId: null,
      version: skill.tier ?? null,
      riskLevel: skill.riskLevel ?? null,
      requiresApproval: Boolean(skill.requiresApproval),
      enabled: status === "ACTIVE",
      lastRunAt: runAgg.lastRunAt,
      successRate30d: runAgg.successRate30d,
      callCount30d: null,
      description: skill.description,
    });
  }

  for (const tool of toolRegistry.list()) {
    const risk = tool.riskLevel ?? "low";
    const requiresApproval = ["high", "critical"].includes(
      String(risk).toLowerCase(),
    );
    items.push({
      id: `tool:${tool.name}`,
      name: tool.name,
      type: "TOOL",
      status: "ACTIVE",
      sourceScope: "PLATFORM",
      workspaceId: null,
      version: null,
      riskLevel: String(risk).toUpperCase(),
      requiresApproval,
      enabled: true,
      lastRunAt: null,
      successRate30d: null,
      callCount30d: null,
      description: tool.description ?? null,
    });
  }

  // 项目知识库（经 project.orgId 过滤）
  try {
    const kbs = await db.knowledgeBase.findMany({
      where: { project: { orgId } },
      select: {
        id: true,
        name: true,
        status: true,
        updatedAt: true,
        projectId: true,
      },
      take: 100,
    });
    for (const kb of kbs) {
      const st: CapabilityStatus =
        kb.status === "active" || kb.status === "ready"
          ? "ACTIVE"
          : kb.status === "disabled"
            ? "DISABLED"
            : "MISSING_CONFIG";
      items.push({
        id: `kb:${kb.id}`,
        name: kb.name,
        type: "KNOWLEDGE_BASE",
        status: st,
        sourceScope: "PROJECT",
        workspaceId: null,
        version: null,
        riskLevel: "LOW",
        requiresApproval: false,
        enabled: st === "ACTIVE",
        lastRunAt: kb.updatedAt?.toISOString() ?? null,
        successRate30d: null,
        callCount30d: null,
      });
    }
  } catch {
    items.push({
      id: "kb:unavailable",
      name: "知识库",
      type: "KNOWLEDGE_BASE",
      status: "ERROR",
      sourceScope: "ORGANIZATION",
      workspaceId: null,
      version: null,
      riskLevel: null,
      requiresApproval: false,
      enabled: false,
      lastRunAt: null,
      successRate30d: null,
      callCount30d: null,
      description: "无法读取知识库配置",
    });
  }

  // Agent 能力：用近期 AgentRun 意图/类型投影，无数据则 MISSING_CONFIG
  if (runAgg.callCount30d > 0) {
    items.push({
      id: "agent:runtime",
      name: "Agent Runtime",
      type: "AGENT",
      status: "ACTIVE",
      sourceScope: "ORGANIZATION",
      workspaceId: null,
      version: null,
      riskLevel: "MEDIUM",
      requiresApproval: false,
      enabled: true,
      lastRunAt: runAgg.lastRunAt,
      successRate30d: runAgg.successRate30d,
      callCount30d: runAgg.callCount30d,
      description: "企业 Agent 运行时（近 30 天有执行）",
    });
  } else {
    items.push({
      id: "agent:runtime",
      name: "Agent Runtime",
      type: "AGENT",
      status: "MISSING_CONFIG",
      sourceScope: "ORGANIZATION",
      workspaceId: null,
      version: null,
      riskLevel: "MEDIUM",
      requiresApproval: false,
      enabled: false,
      lastRunAt: null,
      successRate30d: null,
      callCount30d: 0,
      description: "近 30 天无 Agent 运行记录",
    });
  }

  items.push({
    id: "workflow:org-default",
    name: "企业工作流",
    type: "WORKFLOW",
    status: "MISSING_CONFIG",
    sourceScope: "ORGANIZATION",
    workspaceId: null,
    version: null,
    riskLevel: null,
    requiresApproval: false,
    enabled: false,
    lastRunAt: null,
    successRate30d: null,
    callCount30d: null,
    description: "统一 Workflow 目录尚未配置",
  });
  items.push({
    id: "prompt:org-templates",
    name: "Prompt 模板",
    type: "PROMPT_TEMPLATE",
    status: "MISSING_CONFIG",
    sourceScope: "ORGANIZATION",
    workspaceId: null,
    version: null,
    riskLevel: null,
    requiresApproval: false,
    enabled: false,
    lastRunAt: null,
    successRate30d: null,
    callCount30d: null,
    description: "企业 Prompt 模板库待配置",
  });

  const filtered = items.filter((i) => matchesFilters(i, filters));
  filtered.sort(
    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
  );

  return { items: filtered, orgId, total: filtered.length };
}
