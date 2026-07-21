/**
 * Phase 2B：企业经营指标定义（仅定义加载，不做复杂图表）
 */

import { db } from "@/lib/db";

export type MetricDefView = {
  id: string;
  orgId: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  unit: string;
  direction: string;
  status: string;
  displayOrder: number;
  configStatus: "ok" | "missing";
};

export async function listMetricDefinitions(orgId: string): Promise<{
  configStatus: "ok" | "missing";
  metrics: MetricDefView[];
  message?: string;
}> {
  const rows = await db.businessMetricDefinition.findMany({
    where: { orgId, status: "active" },
    orderBy: [{ displayOrder: "asc" }, { key: "asc" }],
  });

  if (rows.length === 0) {
    return {
      configStatus: "missing",
      metrics: [],
      message: "未配置企业经营指标定义（禁止写死 Sunny/梦馨到通用页面）",
    };
  }

  return {
    configStatus: "ok",
    metrics: rows.map((r) => ({
      id: r.id,
      orgId: r.orgId,
      key: r.key,
      name: r.name,
      description: r.description,
      category: r.category,
      unit: r.unit,
      direction: r.direction,
      status: r.status,
      displayOrder: r.displayOrder,
      configStatus: "ok" as const,
    })),
  };
}

export async function upsertMetricDefinition(params: {
  orgId: string;
  key: string;
  name: string;
  description?: string;
  category?: string;
  unit?: string;
  direction?: string;
  displayOrder?: number;
  sourceConfigJson?: unknown;
}): Promise<{ id: string }> {
  const existing = await db.businessMetricDefinition.findUnique({
    where: { orgId_key: { orgId: params.orgId, key: params.key } },
  });
  if (existing) {
    const updated = await db.businessMetricDefinition.update({
      where: { id: existing.id },
      data: {
        name: params.name,
        description: params.description,
        category: params.category ?? existing.category,
        unit: params.unit ?? existing.unit,
        direction: params.direction ?? existing.direction,
        displayOrder: params.displayOrder ?? existing.displayOrder,
        sourceConfigJson: (params.sourceConfigJson as object) ?? existing.sourceConfigJson,
        status: "active",
      },
    });
    return { id: updated.id };
  }
  const created = await db.businessMetricDefinition.create({
    data: {
      orgId: params.orgId,
      key: params.key,
      name: params.name,
      description: params.description,
      category: params.category ?? "operations",
      unit: params.unit ?? "count",
      direction: params.direction ?? "higher_better",
      displayOrder: params.displayOrder ?? 0,
      sourceConfigJson: (params.sourceConfigJson as object) ?? {},
    },
  });
  return { id: created.id };
}
