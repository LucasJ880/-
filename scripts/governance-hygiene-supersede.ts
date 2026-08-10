/**
 * Governance Hygiene Gate — 存量数据一次性清理
 *
 * 目标不变量：同一 (orgId, workspaceId, metric) 下最多只有一条 enabled 的
 * 配额策略（version 最高者为 current）。
 *
 * 历史上 createQuotaPolicy 不会 supersede 旧版本，导致同一 metric 可能
 * 存在多条 enabled 行（如生产上出现过的 23 条）。本脚本把每组中除最高
 * version 之外的 enabled 行置为 enabled=false, effectiveTo=now。
 *
 * 用法（Production Operation Guard 管控，见 docs/QINGYAN_PRODUCTION_OPERATION_GUARD.md）：
 *   npx tsx scripts/governance-hygiene-supersede.ts            # dry-run（默认，只读）
 *   PRODUCTION_OPERATION_CONFIRM=PRODUCTION:GOVERNANCE_HYGIENE_SUPERSEDE:<dry-run 行数> \
 *     npx tsx scripts/governance-hygiene-supersede.ts --apply  # 实际写入
 * 非生产库需显式 --target=preview|staging|local。
 */

import { db } from "../src/lib/db";
import {
  assertProductionOperationAllowed,
  resolveDeclaredTargetEnvironment,
  verifyOperationDatabaseTarget,
} from "../src/lib/db-safety/production-operation-guard";

const OPERATION_NAME = "GOVERNANCE_HYGIENE_SUPERSEDE";
const SCRIPT_NAME = "scripts/governance-hygiene-supersede.ts";

async function main() {
  const apply = process.argv.includes("--apply");
  const target = resolveDeclaredTargetEnvironment(
    process.argv,
    process.env,
    "production",
  );

  // 任何查询之前先校验目标：声明环境必须与实际 DB 身份一致
  verifyOperationDatabaseTarget({
    operationName: OPERATION_NAME,
    scriptName: SCRIPT_NAME,
    targetEnvironment: target,
  });

  console.log(`[hygiene] mode = ${apply ? "APPLY" : "DRY-RUN"}`);

  const enabledRows = await db.capabilityQuotaPolicy.findMany({
    where: { enabled: true },
    select: {
      id: true,
      orgId: true,
      workspaceId: true,
      metric: true,
      version: true,
      hardLimit: true,
    },
    orderBy: [{ orgId: "asc" }, { metric: "asc" }, { version: "desc" }],
  });

  const groups = new Map<string, typeof enabledRows>();
  for (const row of enabledRows) {
    const key = `${row.orgId}|${row.workspaceId ?? "_"}|${row.metric}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const staleIds: string[] = [];
  let groupsWithDup = 0;
  for (const [key, rows] of groups) {
    if (rows.length <= 1) continue;
    groupsWithDup += 1;
    // rows 已按 version desc 排序；保留第一条，其余 supersede
    const keep = rows[0];
    const stale = rows.slice(1);
    console.log(
      `[hygiene] ${key}: ${rows.length} enabled → keep v${keep.version} (${keep.id}), supersede ${stale.length}`,
    );
    for (const s of stale) {
      console.log(`  - supersede v${s.version} (${s.id}) hard=${s.hardLimit}`);
    }
    staleIds.push(...stale.map((s) => s.id));
  }

  const verdict = assertProductionOperationAllowed({
    operationName: OPERATION_NAME,
    operationType: "PRODUCTION_WRITE",
    targetEnvironment: target,
    scriptName: SCRIPT_NAME,
    scope: {
      kind: "global",
      reason: "跨组织治理不变量维护（enabled 配额策略去重）",
    },
    apply,
    dryRunCompleted: true,
    estimatedImpact: {
      kind: "known",
      rows: staleIds.length,
      summary: `CapabilityQuotaPolicy enabled→false（${groupsWithDup} 组重复）`,
    },
  });

  if (!verdict.writeAllowed) {
    console.log(
      `[hygiene] would supersede ${staleIds.length} rows across ${groupsWithDup} groups（未写入）`,
    );
    await db.$disconnect();
    return;
  }

  // 单条 updateMany 短事务收敛全部 stale 行
  const res = await db.capabilityQuotaPolicy.updateMany({
    where: { id: { in: staleIds } },
    data: { enabled: false, effectiveTo: new Date() },
  });
  console.log(
    `[hygiene] superseded ${res.count} rows across ${groupsWithDup} groups`,
  );
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
