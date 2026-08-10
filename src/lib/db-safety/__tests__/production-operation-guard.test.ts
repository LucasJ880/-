/**
 * Production Operation Guard 纯逻辑测试（不需要真实 DB，纯 env 模拟）
 * 运行：npx tsx src/lib/db-safety/__tests__/production-operation-guard.test.ts
 */

import {
  assertProductionOperationAllowed,
  buildOperationConfirmationPhrase,
  evaluateProductionOperation,
  ProductionOperationGuardError,
  resolveDeclaredTargetEnvironment,
  verifyOperationDatabaseTarget,
  type ProductionOperationRequest,
} from "../production-operation-guard";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const SECRET_PW = "sup3r-secret-pw";
const PROD_URL = `postgresql://neondb_owner:${SECRET_PW}@ep-super-field-antfibsl-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require`;
const STAGING_URL = `postgresql://u:${SECRET_PW}@ep-floral-sea-au07ycff.c-10.us-east-1.aws.neon.tech/neondb`;
const UNKNOWN_URL = `postgresql://u:${SECRET_PW}@ep-mystery-branch-x1y2z3.c-9.us-east-1.aws.neon.tech/neondb`;
const LOCAL_URL = "postgresql://postgres:postgres@localhost:5432/qingyan_dev";

function baseReq(
  over: Partial<ProductionOperationRequest> & { env: NodeJS.ProcessEnv },
): ProductionOperationRequest {
  return {
    operationName: "BACKFILL_TRADE_PROSPECT_STAGE",
    operationType: "PRODUCTION_WRITE",
    targetEnvironment: "production",
    scriptName: "scripts/backfill-trade-prospect-stage.ts",
    scope: { kind: "global", reason: "跨组织字段归一化（无 org 维度）" },
    apply: false,
    dryRunCompleted: false,
    estimatedImpact: { kind: "known", rows: 218 },
    ...over,
  };
}

console.log("production-operation-guard");

// ── A. production target + dry-run → ALLOW PREVIEW ONLY / NO WRITE ──
{
  const v = evaluateProductionOperation(
    baseReq({ env: { DATABASE_URL: PROD_URL } }),
  );
  ok(
    v.safe && v.allowMode === "DRY_RUN_ONLY" && v.writeAllowed === false,
    "A1: 生产目标 + 默认 dry-run → DRY_RUN_ONLY，writeAllowed=false",
  );
  ok(
    v.expectedConfirmationPhrase ===
      "PRODUCTION:BACKFILL_TRADE_PROSPECT_STAGE:218",
    "A2: dry-run 给出 apply 所需 phrase（含行数）",
  );
}

// ── B. production + --apply 无 confirmation → BLOCK ──
{
  const v = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: PROD_URL },
      apply: true,
      dryRunCompleted: true,
    }),
  );
  ok(
    !v.safe && v.blockCodes.includes("CONFIRMATION_REQUIRED"),
    "B1: apply 无 confirmation → BLOCK",
  );
}

// ── C. production + confirmation 但无 prior/explicit dry-run → BLOCK ──
{
  const v = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: PROD_URL },
      apply: true,
      dryRunCompleted: false,
      confirmationToken: "PRODUCTION:BACKFILL_TRADE_PROSPECT_STAGE:218",
    }),
  );
  ok(
    !v.safe && v.blockCodes.includes("REQUIRE_DRY_RUN_FIRST"),
    "C1: apply 未先完成 dry-run 计算 → BLOCK",
  );
}

// ── D. production + apply + valid confirmation + impact known → ALLOW ──
{
  const v = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: PROD_URL },
      apply: true,
      dryRunCompleted: true,
      confirmationToken: "PRODUCTION:BACKFILL_TRADE_PROSPECT_STAGE:218",
    }),
  );
  ok(
    v.safe && v.allowMode === "WRITE_ALLOWED" && v.writeAllowed === true,
    "D1: apply + 正确 phrase + 已知影响 → WRITE_ALLOWED",
  );
  const v2 = evaluateProductionOperation(
    baseReq({
      env: {
        DATABASE_URL: PROD_URL,
        PRODUCTION_OPERATION_CONFIRM:
          "PRODUCTION:BACKFILL_TRADE_PROSPECT_STAGE:218",
      },
      apply: true,
      dryRunCompleted: true,
    }),
  );
  ok(
    v2.safe && v2.writeAllowed,
    "D2: confirmation 经 env PRODUCTION_OPERATION_CONFIRM 提供同样有效",
  );
}

// ── E. 声明 preview + 生产 DB → BLOCK ──
{
  const v = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: PROD_URL, DATABASE_ENVIRONMENT: "isolated" },
      targetEnvironment: "preview",
    }),
  );
  ok(
    !v.safe && v.blockCodes.includes("TARGET_DB_MISMATCH"),
    "E1: 声明 preview 连生产库 → BLOCK（isolated 标记救不回）",
  );
  const v2 = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: LOCAL_URL, DIRECT_URL: PROD_URL },
      targetEnvironment: "preview",
    }),
  );
  ok(
    !v2.safe,
    "E2: DIRECT_URL 指向生产（与 DATABASE_URL 身份不一致）→ BLOCK",
  );
}

// ── F. 声明 production + 非生产 DB → BLOCK ──
{
  const v = evaluateProductionOperation(
    baseReq({ env: { DATABASE_URL: STAGING_URL } }),
  );
  ok(
    !v.safe && v.blockCodes.includes("TARGET_DB_MISMATCH"),
    "F1: 声明 production 连 staging 库 → BLOCK",
  );
  const v2 = evaluateProductionOperation(
    baseReq({ env: { DATABASE_URL: LOCAL_URL } }),
  );
  ok(
    !v2.safe && v2.blockCodes.includes("TARGET_DB_MISMATCH"),
    "F2: 声明 production 连 localhost → BLOCK",
  );
}

// ── G. unknown remote DB → BLOCK ──
{
  const v = evaluateProductionOperation(
    baseReq({ env: { DATABASE_URL: UNKNOWN_URL } }),
  );
  ok(
    !v.safe && v.blockCodes.includes("UNKNOWN_DB_IDENTITY"),
    "G1: 声明 production + 未识别远程 host → BLOCK（rotation 后需先入名单）",
  );
  const v2 = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: UNKNOWN_URL },
      targetEnvironment: "staging",
    }),
  );
  ok(
    !v2.safe && v2.blockCodes.includes("UNKNOWN_DB_IDENTITY"),
    "G2: 声明 staging + 未识别远程 host → BLOCK",
  );
  const v3 = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: UNKNOWN_URL, DATABASE_ENVIRONMENT: "isolated" },
      targetEnvironment: "preview",
    }),
  );
  ok(
    v3.safe && v3.allowMode === "DRY_RUN_ONLY",
    "G3: 声明 preview + isolated 标记的未识别远程 → 放行（与 #76 口径一致）",
  );
}

// ── H. secret 永不打印 ──
{
  const token = "PRODUCTION:BACKFILL_TRADE_PROSPECT_STAGE:218";
  const req = baseReq({
    env: { DATABASE_URL: PROD_URL },
    apply: true,
    dryRunCompleted: true,
    confirmationToken: token,
  });
  const v = evaluateProductionOperation(req);
  ok(
    !JSON.stringify(v).includes(SECRET_PW),
    "H1: verdict 不含 DB 密码",
  );
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  console.error = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    assertProductionOperationAllowed(req);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  const joined = lines.join("\n");
  ok(
    !joined.includes(SECRET_PW) && !joined.includes(token),
    "H2: 报告/审计输出不含密码，也不回显操作者提供的 token 值",
  );
  ok(
    joined.includes("Confirmation: provided") &&
      joined.includes("[production-operation-audit]"),
    "H3: 报告仅标记 confirmation 存在性，且输出审计行",
  );
}

// ── I. delete impact unknown → BLOCK 或更强显式 override ──
{
  const common = {
    env: { DATABASE_URL: PROD_URL },
    operationType: "DESTRUCTIVE_PRODUCTION_WRITE" as const,
    operationName: "PURGE_STALE_QUOTA_POLICIES",
    apply: true,
    dryRunCompleted: true,
    estimatedImpact: {
      kind: "unknown" as const,
      reason: "级联删除行数依赖运行时数据",
    },
  };
  const v = evaluateProductionOperation(
    baseReq({
      ...common,
      confirmationToken: "PRODUCTION:PURGE_STALE_QUOTA_POLICIES:100",
    }),
  );
  ok(
    !v.safe && v.blockCodes.includes("CONFIRMATION_MISMATCH"),
    "I1: destructive + 影响未知 + 普通行数 phrase → BLOCK",
  );
  const v2 = evaluateProductionOperation(
    baseReq({
      ...common,
      confirmationToken:
        "PRODUCTION:PURGE_STALE_QUOTA_POLICIES:IMPACT_UNKNOWN:I_ACCEPT_UNPREDICTABLE_IMPACT",
    }),
  );
  ok(
    v2.safe && v2.writeAllowed,
    "I2: 更强显式 override phrase 才放行",
  );
  const v3 = evaluateProductionOperation(
    baseReq({
      ...common,
      noSafeDryRun: true,
      dryRunCompleted: false,
      confirmationToken:
        "PRODUCTION:PURGE_STALE_QUOTA_POLICIES:IMPACT_UNKNOWN:I_ACCEPT_UNPREDICTABLE_IMPACT",
    }),
  );
  ok(
    v3.safe && v3.writeAllowed,
    "I3: NO_SAFE_DRY_RUN 声明 + 更强 phrase → 放行（跳过 dry-run 前置）",
  );
}

// ── J. 错误 confirmation phrase → BLOCK ──
{
  const v = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: PROD_URL },
      apply: true,
      dryRunCompleted: true,
      confirmationToken: "PRODUCTION:BACKFILL_TRADE_PROSPECT_STAGE:217",
    }),
  );
  ok(
    !v.safe && v.blockCodes.includes("CONFIRMATION_MISMATCH"),
    "J1: 行数不符（dry-run 后数据变化）→ BLOCK，强制重跑 dry-run",
  );
  const v2 = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: PROD_URL },
      apply: true,
      dryRunCompleted: true,
      confirmationToken: "PRODUCTION:SOME_OTHER_OPERATION:218",
    }),
  );
  ok(
    !v2.safe && v2.blockCodes.includes("CONFIRMATION_MISMATCH"),
    "J2: phrase 属于别的操作 → BLOCK（无万能 secret）",
  );
}

// ── K. 运行时信号冲突 / org scope / 工具函数 ──
{
  const v = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: PROD_URL, QINGYAN_RUNTIME_ENV: "preview" },
    }),
  );
  ok(
    !v.safe && v.blockCodes.includes("RUNTIME_SIGNAL_CONFLICT"),
    "K1: QINGYAN_RUNTIME_ENV=preview 声明 production → BLOCK",
  );
  const v2 = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: PROD_URL, NODE_ENV: "test" },
      apply: true,
      dryRunCompleted: true,
      confirmationToken: "PRODUCTION:BACKFILL_TRADE_PROSPECT_STAGE:218",
    }),
  );
  ok(
    !v2.safe && v2.blockCodes.includes("RUNTIME_SIGNAL_CONFLICT"),
    "K2: NODE_ENV=test 下对生产 apply → BLOCK（属 assertSafeTestDatabase 管辖域）",
  );
  const v3 = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: PROD_URL },
      scope: { kind: "org", orgId: "", orgName: "" },
    }),
  );
  ok(
    !v3.safe && v3.blockCodes.includes("MISSING_ORG_SCOPE"),
    "K3: 租户操作缺 orgId/组织名 → BLOCK",
  );
  const v3g = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: PROD_URL },
      scope: { kind: "global", reason: "" },
    }),
  );
  ok(
    !v3g.safe && v3g.blockCodes.includes("MISSING_GLOBAL_SCOPE_REASON"),
    "K3b: global scope 空 reason → BLOCK（MISSING_GLOBAL_SCOPE_REASON）",
  );
  const v3g2 = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: PROD_URL },
      scope: { kind: "global", reason: "   " },
    }),
  );
  ok(
    !v3g2.safe && v3g2.blockCodes.includes("MISSING_GLOBAL_SCOPE_REASON"),
    "K3c: global scope 纯空白 reason → BLOCK（trim 后 fail-closed）",
  );
  const v3g3 = evaluateProductionOperation(
    baseReq({
      env: { DATABASE_URL: PROD_URL },
      scope: { kind: "global", reason: "跨组织字段归一化" },
    }),
  );
  ok(
    v3g3.safe && !v3g3.blockCodes.includes("MISSING_GLOBAL_SCOPE_REASON"),
    "K3d: global scope 非空 reason → 不因 scope 阻断",
  );
  ok(
    buildOperationConfirmationPhrase(
      "production",
      "rotate_org_unlock_code",
      { kind: "known", rows: 1 },
    ) === "PRODUCTION:ROTATE_ORG_UNLOCK_CODE:1",
    "K4: phrase 构造器归一化大小写",
  );
  ok(
    resolveDeclaredTargetEnvironment(
      ["node", "x.ts", "--target=staging"],
      {},
      "production",
    ) === "staging" &&
      resolveDeclaredTargetEnvironment(["node", "x.ts"], {}, "production") ===
        "production",
    "K5: --target= 解析与缺省回退",
  );
  let thrown: unknown = null;
  const origErr = console.error;
  console.error = () => {};
  try {
    verifyOperationDatabaseTarget(
      {
        operationName: "X",
        scriptName: "scripts/x.ts",
        targetEnvironment: "production",
      },
      { DATABASE_URL: STAGING_URL } as NodeJS.ProcessEnv,
    );
  } catch (e) {
    thrown = e;
  } finally {
    console.error = origErr;
  }
  ok(
    thrown instanceof ProductionOperationGuardError,
    "K6: verifyOperationDatabaseTarget 在查询前即阻断目标不一致",
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
