/**
 * Phase 2B：标准业务对象注册表（轻量，非知识图谱）
 */

import { db } from "@/lib/db";

export type ObjectResolveStatus = "ok" | "missing" | "generic";

export type BusinessObjectView = {
  id: string;
  orgId: string;
  objectKey: string;
  displayName: string;
  sourceModel: string | null;
  industryPackId: string | null;
  version: number;
  status: string;
};

/** 平台通用对象模板（企业可 adopt；不会自动进入另一企业） */
export const PLATFORM_OBJECT_TEMPLATES: Array<{
  objectKey: string;
  displayName: string;
  sourceModel?: string | null;
}> = [
  { objectKey: "Customer", displayName: "客户", sourceModel: "SalesCustomer" },
  { objectKey: "Opportunity", displayName: "商机", sourceModel: "SalesOpportunity" },
  { objectKey: "Quote", displayName: "报价", sourceModel: "SalesQuote" },
  { objectKey: "Project", displayName: "项目", sourceModel: "Project" },
  { objectKey: "Invoice", displayName: "发票", sourceModel: null },
  { objectKey: "Payment", displayName: "付款", sourceModel: null },
  { objectKey: "Order", displayName: "订单（通用）", sourceModel: null },
];

export async function resolveBusinessObject(params: {
  orgId: string;
  objectKey: string;
  allowGenericTemplate?: boolean;
}): Promise<{
  status: ObjectResolveStatus;
  object: BusinessObjectView | null;
  message?: string;
}> {
  const row = await db.businessObjectDefinition.findUnique({
    where: {
      orgId_objectKey: { orgId: params.orgId, objectKey: params.objectKey },
    },
  });

  if (row && row.status !== "disabled") {
    return {
      status: "ok",
      object: {
        id: row.id,
        orgId: row.orgId,
        objectKey: row.objectKey,
        displayName: row.displayName,
        sourceModel: row.sourceModel,
        industryPackId: row.industryPackId,
        version: row.version,
        status: row.status,
      },
    };
  }

  if (params.allowGenericTemplate) {
    const tmpl = PLATFORM_OBJECT_TEMPLATES.find(
      (t) => t.objectKey === params.objectKey,
    );
    if (tmpl) {
      return {
        status: "generic",
        object: {
          id: `generic:${tmpl.objectKey}`,
          orgId: params.orgId,
          objectKey: tmpl.objectKey,
          displayName: tmpl.displayName,
          sourceModel: tmpl.sourceModel ?? null,
          industryPackId: null,
          version: 0,
          status: "generic",
        },
        message: "使用平台通用模板（非其他企业定义）",
      };
    }
  }

  return {
    status: "missing",
    object: null,
    message: `未找到业务对象 ${params.objectKey}（禁止跨企业回退）`,
  };
}

export async function listBusinessObjects(orgId: string): Promise<BusinessObjectView[]> {
  const rows = await db.businessObjectDefinition.findMany({
    where: { orgId, status: { not: "disabled" } },
    orderBy: { objectKey: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    orgId: row.orgId,
    objectKey: row.objectKey,
    displayName: row.displayName,
    sourceModel: row.sourceModel,
    industryPackId: row.industryPackId,
    version: row.version,
    status: row.status,
  }));
}

export async function upsertBusinessObject(params: {
  orgId: string;
  objectKey: string;
  displayName: string;
  sourceModel?: string;
  industryPackId?: string;
  aliases?: string[];
  description?: string;
}): Promise<{ id: string; version: number }> {
  const existing = await db.businessObjectDefinition.findUnique({
    where: {
      orgId_objectKey: { orgId: params.orgId, objectKey: params.objectKey },
    },
  });
  if (existing) {
    const updated = await db.businessObjectDefinition.update({
      where: { id: existing.id },
      data: {
        displayName: params.displayName,
        sourceModel: params.sourceModel,
        industryPackId: params.industryPackId,
        aliasesJson: params.aliases ?? [],
        description: params.description,
        version: existing.version + 1,
        status: "active",
      },
    });
    return { id: updated.id, version: updated.version };
  }
  const created = await db.businessObjectDefinition.create({
    data: {
      orgId: params.orgId,
      objectKey: params.objectKey,
      displayName: params.displayName,
      sourceModel: params.sourceModel,
      industryPackId: params.industryPackId,
      aliasesJson: params.aliases ?? [],
      description: params.description,
    },
  });
  return { id: created.id, version: created.version };
}
