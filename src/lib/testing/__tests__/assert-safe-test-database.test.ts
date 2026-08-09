/**
 * Production Database Test Guard 纯逻辑测试（不需要真实 DB）
 * 运行：npx tsx src/lib/testing/__tests__/assert-safe-test-database.test.ts
 */

import {
  assertSafeTestDatabase,
  DANGEROUS_OPT_IN_TOKEN,
  evaluateTestDatabaseSafety,
  KNOWN_PRODUCTION_DB_ENDPOINT_PREFIXES,
  TestDatabaseSafetyError,
} from "../assert-safe-test-database";

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

const PROD_PREFIX = KNOWN_PRODUCTION_DB_ENDPOINT_PREFIXES[0];
const PROD_POOLER = `postgresql://u:secret@${PROD_PREFIX}-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require`;
const PROD_DIRECT = `postgresql://u:secret@${PROD_PREFIX}.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require`;
const PREVIEW_DB =
  "postgresql://u:secret@ep-young-credit-awvyi6l6-pooler.c-12.us-east-1.aws.neon.tech/neondb";
const UNKNOWN_DB =
  "postgresql://u:secret@some-shared-db.internal.example.com/appdb";
const LOCAL_DB = "postgresql://postgres:postgres@localhost:5432/qingyan_test";

console.log("assert-safe-test-database guard");

// ── A. known production URL → BLOCK（任何信号组合都不能放行） ──
{
  const base = { NODE_ENV: "test", DATABASE_URL: PROD_POOLER };
  const v = evaluateTestDatabaseSafety(base as NodeJS.ProcessEnv);
  ok(
    !v.safe && v.blockCodes.includes("PRODUCTION_DATABASE_HOST"),
    "A1: 生产 pooler host → BLOCK",
  );
  const v2 = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    DATABASE_URL: PREVIEW_DB,
    DIRECT_URL: PROD_DIRECT,
  } as NodeJS.ProcessEnv);
  ok(
    !v2.safe && v2.blockCodes.includes("PRODUCTION_DATABASE_HOST"),
    "A2: DIRECT_URL 指向生产 direct host → BLOCK",
  );
  const v3 = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    DATABASE_URL: PROD_POOLER,
    DATABASE_ENVIRONMENT: "isolated",
    TEST_DATABASE_MODE: "isolated",
    DANGEROUS_ALLOW_DB_TESTS: DANGEROUS_OPT_IN_TOKEN,
  } as NodeJS.ProcessEnv);
  ok(
    !v3.safe && v3.blockCodes.includes("PRODUCTION_DATABASE_HOST"),
    "A3: 生产库 + isolated 标记 + opt-in token 仍 BLOCK（token 对生产无效）",
  );
  ok(
    !v.safe && !JSON.stringify(v).includes("secret"),
    "A4: verdict 不含密码",
  );
}

// ── B. VERCEL_ENV=production → BLOCK ──
{
  const v = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    VERCEL_ENV: "production",
    DATABASE_URL: PREVIEW_DB,
    DATABASE_ENVIRONMENT: "isolated",
  } as NodeJS.ProcessEnv);
  ok(
    !v.safe && v.blockCodes.includes("PRODUCTION_RUNTIME_ENV"),
    "B1: VERCEL_ENV=production → BLOCK（即使库是 preview）",
  );
  const v2 = evaluateTestDatabaseSafety({
    NODE_ENV: "production",
    DATABASE_URL: LOCAL_DB,
  } as NodeJS.ProcessEnv);
  ok(
    !v2.safe && v2.blockCodes.includes("PRODUCTION_RUNTIME_ENV"),
    "B2: NODE_ENV=production → BLOCK",
  );
}

// ── C. preview DB（isolated 标记 + 非生产 host）→ ALLOW ──
{
  const v = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    DATABASE_URL: PREVIEW_DB,
    DATABASE_ENVIRONMENT: "isolated",
  } as NodeJS.ProcessEnv);
  ok(
    v.safe && v.allowMode === "ISOLATED_REMOTE_DATABASE",
    "C1: Neon preview 分支 + DATABASE_ENVIRONMENT=isolated → ALLOW",
  );
  const v2 = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    DATABASE_URL: PREVIEW_DB,
    TEST_DATABASE_MODE: "isolated",
  } as NodeJS.ProcessEnv);
  ok(
    v2.safe && v2.allowMode === "ISOLATED_REMOTE_DATABASE",
    "C2: TEST_DATABASE_MODE=isolated 等价别名 → ALLOW",
  );
}

// ── D. localhost test DB → ALLOW ──
{
  const v = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    DATABASE_URL: LOCAL_DB,
  } as NodeJS.ProcessEnv);
  ok(v.safe && v.allowMode === "LOCAL_DATABASE", "D1: localhost → ALLOW");
  const v2 = evaluateTestDatabaseSafety({
    DATABASE_URL: "postgresql://u:p@127.0.0.1:5433/t",
  } as NodeJS.ProcessEnv);
  ok(
    v2.safe && v2.allowMode === "LOCAL_DATABASE",
    "D2: 127.0.0.1（无 NODE_ENV）→ ALLOW",
  );
}

// ── E. unknown remote DB → BLOCK（NODE_ENV=test 不是放行理由） ──
{
  const v = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    DATABASE_URL: UNKNOWN_DB,
  } as NodeJS.ProcessEnv);
  ok(
    !v.safe &&
      v.blockCodes.includes("UNKNOWN_REMOTE_HOST_WITHOUT_ISOLATION"),
    "E1: 未识别远程 host 且无 isolated 标记 → BLOCK",
  );
  const v2 = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    DATABASE_URL: UNKNOWN_DB,
    DANGEROUS_ALLOW_DB_TESTS: DANGEROUS_OPT_IN_TOKEN,
  } as NodeJS.ProcessEnv);
  ok(
    v2.safe && v2.allowMode === "DANGEROUS_EXPLICIT_OPT_IN",
    "E2: 未识别远程 host + 显式高危 token → ALLOW（带警告）",
  );
  const v3 = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    DATABASE_URL: UNKNOWN_DB,
    DANGEROUS_ALLOW_DB_TESTS: "yes",
  } as NodeJS.ProcessEnv);
  ok(!v3.safe, "E3: token 值不完全匹配 → 仍 BLOCK");
}

// ── F. malformed / missing URL → BLOCK ──
{
  const v = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv);
  ok(
    !v.safe && v.blockCodes.includes("MISSING_DATABASE_URL"),
    "F1: DATABASE_URL 缺失 → BLOCK",
  );
  const v2 = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    DATABASE_URL: "not-a-valid-url",
    DATABASE_ENVIRONMENT: "isolated",
  } as NodeJS.ProcessEnv);
  ok(
    !v2.safe && v2.blockCodes.includes("MALFORMED_DATABASE_URL"),
    "F2: DATABASE_URL 无法解析 → BLOCK（isolated 标记也救不回）",
  );
  const v3 = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    DATABASE_URL: LOCAL_DB,
    DIRECT_URL: "postgres://",
  } as NodeJS.ProcessEnv);
  ok(
    !v3.safe && v3.blockCodes.includes("MALFORMED_DATABASE_URL"),
    "F3: DIRECT_URL 配置了但无法解析 → BLOCK",
  );
}

// ── H. Qingyan production 信号（不可覆盖的 hard block） ──
{
  const v = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    QINGYAN_RUNTIME_ENV: "production",
    DATABASE_URL: UNKNOWN_DB,
    DATABASE_ENVIRONMENT: "isolated",
    TEST_DATABASE_MODE: "isolated",
    DANGEROUS_ALLOW_DB_TESTS: DANGEROUS_OPT_IN_TOKEN,
  } as NodeJS.ProcessEnv);
  ok(
    !v.safe && v.blockCodes.includes("PRODUCTION_RUNTIME_ENV"),
    "H1: QINGYAN_RUNTIME_ENV=production → BLOCK（isolated + token 均不可覆盖）",
  );
  const v2 = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    QINGYAN_EXPECTED_DB_PLANE: "production",
    DATABASE_URL: UNKNOWN_DB,
    DATABASE_ENVIRONMENT: "isolated",
  } as NodeJS.ProcessEnv);
  ok(
    !v2.safe && v2.blockCodes.includes("PRODUCTION_DB_PLANE_EXPECTED"),
    "H2: QINGYAN_EXPECTED_DB_PLANE=production → BLOCK（isolated 不可覆盖）",
  );
  const v3 = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    QINGYAN_RUNTIME_ENV: "preview",
    QINGYAN_EXPECTED_DB_PLANE: "other",
    DATABASE_URL: PREVIEW_DB,
    DATABASE_ENVIRONMENT: "isolated",
  } as NodeJS.ProcessEnv);
  ok(
    v3.safe && v3.allowMode === "ISOLATED_REMOTE_DATABASE",
    "H3: 正常 Preview（runtime=preview + plane=other + isolated）→ ALLOW",
  );
  const v4 = evaluateTestDatabaseSafety({
    NODE_ENV: "test",
    QINGYAN_RUNTIME_ENV: "production",
    QINGYAN_EXPECTED_DB_PLANE: "production",
    DATABASE_URL: LOCAL_DB,
  } as NodeJS.ProcessEnv);
  ok(
    !v4.safe &&
      v4.blockCodes.includes("PRODUCTION_RUNTIME_ENV") &&
      v4.blockCodes.includes("PRODUCTION_DB_PLANE_EXPECTED"),
    "H4: 生产信号下连 localhost 也 BLOCK（信号冲突本身即不安全）",
  );
}

// ── assertSafeTestDatabase 抛错行为 ──
{
  let thrown: unknown = null;
  try {
    assertSafeTestDatabase({
      scriptName: "guard-self-test",
      env: { NODE_ENV: "test", DATABASE_URL: PROD_POOLER } as NodeJS.ProcessEnv,
    });
  } catch (e) {
    thrown = e;
  }
  ok(
    thrown instanceof TestDatabaseSafetyError &&
      !String((thrown as Error).message).includes("secret"),
    "G1: 生产库 assert 抛 TestDatabaseSafetyError 且消息不含密码",
  );
  const v = assertSafeTestDatabase({
    scriptName: "guard-self-test",
    env: { NODE_ENV: "test", DATABASE_URL: LOCAL_DB } as NodeJS.ProcessEnv,
  });
  ok(v.safe, "G2: localhost assert 正常返回");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
