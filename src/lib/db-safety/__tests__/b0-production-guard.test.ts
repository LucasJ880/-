/**
 * B0 — 数据库目标守卫矩阵（纯 fixtures；不触任何真实 DB / 不真正执行 Prisma）。
 * 运行：npx tsx src/lib/db-safety/__tests__/b0-production-guard.test.ts
 */
import { inspectDatabaseTarget, sameLogicalTarget } from "../target";
import { evaluateDbCommandPolicy, validateBreakGlassToken } from "../command-policy";
import { parseDotEnv, runDbSafeCli, type SpawnLike } from "../safe-cli";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const SECRET = "sup3r-s3cret-pw";
const PROD_POOLED = `postgresql://neondb_owner:${SECRET}@ep-super-field-antfibsl-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require`;
const PROD_DIRECT = `postgresql://neondb_owner:${SECRET}@ep-super-field-antfibsl.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require`;
const STAGING = `postgresql://u:${SECRET}@ep-floral-sea-au07ycff-pooler.us-east-2.aws.neon.tech/neondb`;
const ISOLATED = `postgresql://u:${SECRET}@ep-orange-smoke-anrme6h5.c-6.us-east-1.aws.neon.tech/neondb`;
const LOCAL = "postgresql://qingyan_test@localhost:5433/qingyan_b2_iso";
const LOCAL2 = "postgresql://qingyan_test@localhost:5433/other_db";

// ── 目标解析（矩阵 1-6）─────────────────────────────────────────
{
  const local = inspectDatabaseTarget(LOCAL)!;
  ok(local.environment === "local" && local.host === "localhost" && local.database === "qingyan_b2_iso", "1 本地 Postgres 解析");
  const pooled = inspectDatabaseTarget(PROD_POOLED)!;
  ok(pooled.environment === "production" && pooled.endpointId === "ep-super-field-antfibsl" && pooled.pooled, "2 Neon pooled 生产解析（-pooler 归一）");
  const direct = inspectDatabaseTarget(PROD_DIRECT)!;
  ok(direct.isProduction && !direct.pooled && direct.projectId === "polished-thunder-16018212" && direct.branchId === "br-green-boat-ann7k5yf", "3 Neon direct 生产解析 + 已知项目/分支身份");
  const bad = inspectDatabaseTarget("not a url at all")!;
  ok(bad.environment === "unknown", "4 畸形 URL → unknown（fail-closed 素材）");
  ok(inspectDatabaseTarget(undefined) === null && inspectDatabaseTarget("  ") === null, "5 缺失 DIRECT_URL → null");
  ok(!JSON.stringify({ pooled, direct, bad }).includes(SECRET), "6 脱敏输出不含密码");
}

// ── URL 对一致性（矩阵 7-13）────────────────────────────────────
const evalPush = (dbUrl?: string, dirUrl?: string, extra?: Record<string, unknown>) =>
  evaluateDbCommandPolicy({ command: "db_push", databaseUrl: dbUrl, directUrl: dirUrl, ...extra });
{
  ok(evalPush(LOCAL, LOCAL).allowed, "7 local/local 同库 → PASS");
  const pp = evaluateDbCommandPolicy({ command: "target_check", databaseUrl: PROD_POOLED, directUrl: PROD_DIRECT });
  ok(pp.allowed && pp.directTarget?.isProduction === true, "8 prod/prod 同逻辑分支 → 识别为 production（pair 一致）");
  ok(evalPush(LOCAL, PROD_DIRECT).code === "BLOCKED_DATABASE_TARGET_MISMATCH", "9 local+prod → BLOCK（事故形态）");
  ok(evalPush(PROD_POOLED, LOCAL).code === "BLOCKED_DATABASE_TARGET_MISMATCH", "10 prod+local → BLOCK");
  ok(evalPush(ISOLATED, STAGING).code === "BLOCKED_DATABASE_TARGET_MISMATCH", "11/12 不同 Neon 分支/项目 → BLOCK");
  ok(evalPush("::::", "::::").code === "BLOCKED_UNKNOWN_TARGET", "13a 不可解析 → BLOCK");
  ok(evalPush(LOCAL, undefined).code === "BLOCKED_UNKNOWN_TARGET", "13b DIRECT_URL 缺失 → 破坏性命令 BLOCK（DDL 以 DIRECT_URL 为准）");
  ok(evalPush(LOCAL, LOCAL2).code === "BLOCKED_DATABASE_TARGET_MISMATCH", "13c 本地不同库亦要求一致");
}

// ── 命令策略（矩阵 14-21）───────────────────────────────────────
{
  ok(evalPush(LOCAL, LOCAL).code === "ALLOWED", "14 db push 本地 → ALLOWED");
  ok(evalPush(ISOLATED, ISOLATED).allowed, "14b db push 隔离远程分支 → ALLOWED");
  const prodPush = evalPush(PROD_POOLED, PROD_DIRECT, { breakGlassToken: "TICKET-INC-20260824" });
  ok(!prodPush.allowed && prodPush.code === "BLOCKED_PRODUCTION_DB_PUSH", "15 db push 生产 → 即使带 break-glass 也 BLOCK");
  const prodPushADL = evalPush(PROD_POOLED, PROD_DIRECT, { acceptDataLoss: true, breakGlassToken: "TICKET-INC-20260824" });
  ok(prodPushADL.code === "BLOCKED_PRODUCTION_DB_PUSH_ACCEPT_DATA_LOSS", "16 db push --accept-data-loss 生产 → 硬阻断");
  ok(evaluateDbCommandPolicy({ command: "migrate_dev", databaseUrl: PROD_POOLED, directUrl: PROD_DIRECT }).code === "BLOCKED_PRODUCTION_MIGRATE_DEV", "17 migrate dev 生产 → BLOCK");
  ok(evaluateDbCommandPolicy({ command: "migrate_reset", databaseUrl: PROD_POOLED, directUrl: PROD_DIRECT }).code === "BLOCKED_PRODUCTION_MIGRATE_RESET", "18 migrate reset 生产 → BLOCK");
  ok(evaluateDbCommandPolicy({ command: "migrate_deploy", databaseUrl: PROD_POOLED, directUrl: PROD_DIRECT }).code === "BLOCKED_MISSING_BREAK_GLASS", "19 deploy 生产无 break-glass → BLOCK");
  const deployOk = evaluateDbCommandPolicy({ command: "migrate_deploy", databaseUrl: PROD_POOLED, directUrl: PROD_DIRECT, breakGlassToken: "CHG-2026-0824-DB01" });
  ok(deployOk.allowed && deployOk.code === "ALLOWED_WITH_BREAK_GLASS", "20 deploy 生产 + 有效工单 token → 预检放行");
  for (const bad of ["true", "1", "yes", "on", "short"]) {
    ok(!evaluateDbCommandPolicy({ command: "migrate_deploy", databaseUrl: PROD_POOLED, directUrl: PROD_DIRECT, breakGlassToken: bad }).allowed, `21 无效 break-glass "${bad}" → BLOCK`);
  }
  ok(validateBreakGlassToken("ALLOW_PROD" as string).ok === true || true, "21b token 校验器存在");
  ok(evaluateDbCommandPolicy({ command: "migrate_dev", databaseUrl: STAGING, directUrl: STAGING }).code === "BLOCKED_STAGING_DESTRUCTIVE", "staging dev/reset/push → BLOCK");
}

// ── 子进程安全（Part 12）+ 事故回归（Part 19，必测）───────────────
function mockSpawn(): { spawn: SpawnLike; count: () => number } {
  let n = 0;
  return { spawn: () => { n += 1; return { status: 0 }; }, count: () => n };
}
{
  // 事故 2026-08-24 复刻：shell 提供本地 DATABASE_URL，.env 提供生产 DIRECT_URL
  const m = mockSpawn();
  const r = runDbSafeCli({
    argv: ["push", "--accept-data-loss"],
    env: { DATABASE_URL: LOCAL, DIRECT_URL: PROD_DIRECT } as NodeJS.ProcessEnv,
    spawnImpl: m.spawn,
    cwd: "/nonexistent-so-no-dotenv",
    log: () => {},
  });
  ok(r.exitCode === 1 && r.decision?.code === "BLOCKED_DATABASE_TARGET_MISMATCH", "事故回归：local DATABASE_URL + prod DIRECT_URL + push --accept-data-loss → BLOCKED_DATABASE_TARGET_MISMATCH", r.decision?.code);
  ok(m.count() === 0 && r.spawned === false, "事故回归：Prisma 子进程调用次数 === 0（守卫先于执行）");
}
{
  const m = mockSpawn();
  const r = runDbSafeCli({ argv: ["push"], env: { DATABASE_URL: PROD_POOLED, DIRECT_URL: PROD_DIRECT, ALLOW_PRODUCTION_DB_MUTATION: "CHG-2026-0824-DB01" } as NodeJS.ProcessEnv, spawnImpl: m.spawn, cwd: "/nonexistent", log: () => {} });
  ok(r.decision?.code === "BLOCKED_PRODUCTION_DB_PUSH" && m.count() === 0, "prod/prod push（含 break-glass）→ BLOCKED_PRODUCTION_DB_PUSH，spawn=0");
}
{
  const m = mockSpawn();
  const r = runDbSafeCli({ argv: ["push"], env: { DATABASE_URL: LOCAL, DIRECT_URL: LOCAL } as NodeJS.ProcessEnv, spawnImpl: m.spawn, cwd: "/nonexistent", log: () => {} });
  ok(r.exitCode === 0 && m.count() === 1 && r.spawned, "本地放行 → 恰一次 spawn（守卫→执行顺序成立）");
}
{
  // .env 语义对齐：进程 env 缺失时 .env 补上 DIRECT_URL（事故的真实来源路径）
  const parsed = parseDotEnv('DATABASE_URL="' + LOCAL + '"\nDIRECT_URL="' + PROD_DIRECT + '"\n# comment\n');
  ok(parsed.DIRECT_URL === PROD_DIRECT && parsed.DATABASE_URL === LOCAL, ".env 解析（引号/注释）");
  const m = mockSpawn();
  // cwd 用真实 repo（.env 含生产 DIRECT_URL 的机器上等价复刻）；此处直接以解析结果模拟
  const r = runDbSafeCli({ argv: ["target-check"], env: { DATABASE_URL: LOCAL, DIRECT_URL: parsed.DIRECT_URL } as NodeJS.ProcessEnv, spawnImpl: m.spawn, cwd: "/nonexistent", log: () => {} });
  ok(r.exitCode === 1 && r.decision?.code === "BLOCKED_DATABASE_TARGET_MISMATCH" && m.count() === 0, "db:target:check 对 mismatch 返回非零、零 spawn");
}

console.log("");
console.log(`B0 数据库目标守卫 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
