/**
 * CHAIN-3b 投标准备度：本项目有没有 CHAIN-3 导入的进口记录（只读）
 *
 * 口径与进口线索读视图的 storedLeadCount（「已导入 N 条」）相同：本项目、本组织、进口记录平台、
 * import_lead_v1、不是在供应链页标为不采用（REJECTED）的。进口线索导入开关关时不查库、按没有。
 *
 * 这个文件会被投标工作区读取（以及成本核算接口、项目页「下一步」卡）带进去，所以只依赖 @/lib/db 与 ./flags；
 * 平台与 kind 两个值写成字面量，测试核对它们与 service.ts 的 IMPORT_LEAD_PLATFORM / IMPORT_LEAD_KIND 相同。
 */
import { db } from "@/lib/db";
import { isImportLeadsEnabledForOrg } from "./flags";

export const READINESS_IMPORT_LEAD_PLATFORM = "TRADE_DATA";
export const READINESS_IMPORT_LEAD_KIND = "import_lead_v1";

export async function hasImportLeadsForReadiness(input: { orgId: string; projectId: string }): Promise<boolean> {
  if (!isImportLeadsEnabledForOrg(input.orgId)) return false;
  const row = await db.supplierDiscoverySignal.findFirst({
    where: {
      orgId: input.orgId,
      projectId: input.projectId,
      platform: READINESS_IMPORT_LEAD_PLATFORM,
      status: { not: "REJECTED" },
      rawMetadataJson: { path: ["kind"], equals: READINESS_IMPORT_LEAD_KIND },
    },
    select: { id: true },
  });
  return row !== null;
}
