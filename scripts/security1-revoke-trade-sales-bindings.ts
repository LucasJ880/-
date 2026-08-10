/**
 * 撤销 trade 用户误绑的 sales_rep PrincipalRoleBinding
 *
 * 默认 dry-run（只列出将撤销的 binding，不写库）：
 *   npx tsx scripts/security1-revoke-trade-sales-bindings.ts
 * 实际写入（Production Operation Guard 管控，见 docs/QINGYAN_PRODUCTION_OPERATION_GUARD.md）：
 *   PRODUCTION_OPERATION_CONFIRM=PRODUCTION:SECURITY1_REVOKE_TRADE_SALES_BINDINGS:<dry-run 条数> \
 *     npx tsx scripts/security1-revoke-trade-sales-bindings.ts --apply
 * 非生产库需显式 --target=preview|staging|local。
 */

import { db } from "../src/lib/db";
import {
  assertProductionOperationAllowed,
  resolveDeclaredTargetEnvironment,
  verifyOperationDatabaseTarget,
} from "../src/lib/db-safety/production-operation-guard";

const OPERATION_NAME = "SECURITY1_REVOKE_TRADE_SALES_BINDINGS";
const SCRIPT_NAME = "scripts/security1-revoke-trade-sales-bindings.ts";

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

  const tradeUsers = await db.user.findMany({
    where: { role: "trade" },
    select: { id: true, email: true },
  });
  if (tradeUsers.length === 0) {
    console.log("no trade users");
    return;
  }
  const ids = tradeUsers.map((u) => u.id);
  const bindings = await db.principalRoleBinding.findMany({
    where: {
      principalType: "HUMAN",
      principalId: { in: ids },
      status: "active",
      roleProfile: { key: "sales_rep" },
    },
    select: { id: true, principalId: true, orgId: true },
  });

  console.log(`将撤销的 sales_rep binding（${bindings.length} 条）:`);
  for (const b of bindings) {
    console.log(`  - binding ${b.id} user=${b.principalId} org=${b.orgId}`);
  }

  const verdict = assertProductionOperationAllowed({
    operationName: OPERATION_NAME,
    operationType: "PRODUCTION_WRITE",
    targetEnvironment: target,
    scriptName: SCRIPT_NAME,
    scope: {
      kind: "global",
      reason: "跨组织安全修复：撤销 trade 用户误绑的 sales_rep 绑定",
    },
    apply,
    dryRunCompleted: true,
    estimatedImpact: {
      kind: "known",
      rows: bindings.length,
      summary: "PrincipalRoleBinding.status active → inactive",
    },
  });

  if (!verdict.writeAllowed) {
    console.log("\n未执行写入（DRY_RUN_ONLY）。");
    return;
  }

  // 单条 updateMany 短事务，避免逐条循环写
  const r = await db.principalRoleBinding.updateMany({
    where: { id: { in: bindings.map((b) => b.id) } },
    data: { status: "inactive" },
  });
  console.log(`done: revoked ${r.count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
