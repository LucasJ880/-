/**
 * Phase 1H — product-visual-builder 真实 smoke test 脚本
 *
 * 安全边界（极重要）：
 * - DATABASE_URL **只**从 .env.smoke 读取，绝不使用 .env / .env.local 的 DATABASE_URL，
 *   以彻底杜绝误连生产库。
 * - 必须通过 assertNonProductionDatabase 强制门禁，否则立即停止。
 * - 本阶段（1H-Branch Setup Plan）**只实现安全门禁 + DRY PLAN，不执行任何真实操作**：
 *   不 migrate、不 seed、不调用 OpenAI、不上传 Blob、不写 SkillExecution / AuditLog。
 *
 * 手动用法（不会自动运行）：
 *   npx tsx scripts/smoke-product-visual-builder.ts          # 打印摘要 + 安全门禁 + DRY PLAN
 *   npx tsx scripts/smoke-product-visual-builder.ts --run    # 本阶段尚未启用真实流程（仅提示）
 *
 * 前置：在项目根创建 .env.smoke（已被 .gitignore 的 .env* 规则忽略），至少包含：
 *   DATABASE_URL=postgres://...   # 指向 Neon 的 pvb-smoke branch（非生产）
 *   SMOKE_CONFIRM_NON_PROD=yes    # 显式确认当前为非生产 branch
 *   # 可选（缺省则回退到 .env / .env.local 的同名值，但 DATABASE_URL 不回退）：
 *   # OPENAI_API_KEY=...  OPENAI_IMAGE_MODEL=...  OPENAI_BASE_URL=...  BLOB_READ_WRITE_TOKEN=...
 */

import fs from "node:fs";
import path from "node:path";

// ── 停止文案（门禁不通过时只能输出这一句到 stdout）──
const STOP_MESSAGE =
  "检测到 DATABASE_URL 指向生产或无法确认非生产，已停止，未执行真实联调。";

// ── 生产指纹与 branch 标识 ──
/** 生产 Neon 项目的 compute 端点 id 片段（pooler / direct 均以此开头）。 */
const PROD_HOST_FRAGMENT = "ep-super-field-antfibsl";
const PROD_DB_NAME = "neondb";
/** 必须出现的非生产标识之一（host 或 db name 中）。 */
const BRANCH_MARKERS = /(pvb-smoke|smoke|branch|dev|preview|staging|test)/i;
/** .env.smoke 中必须显式确认。 */
const CONFIRM_KEY = "SMOKE_CONFIRM_NON_PROD";

type EnvMap = Record<string, string>;

function parseEnvFile(file: string): EnvMap {
  const out: EnvMap = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

interface LoadedEnv {
  /** 合并后的环境（非 DB 机密可回退 .env/.env.local；DATABASE_URL 仅来自 .env.smoke）。 */
  env: EnvMap;
  smokeFileExists: boolean;
  dbFromSmoke: boolean;
}

/** 只从 .env.smoke 取 DATABASE_URL；其它变量允许回退 .env/.env.local。 */
function loadSmokeEnv(): LoadedEnv {
  const smokePath = path.resolve(process.cwd(), ".env.smoke");
  const smokeExists = fs.existsSync(smokePath);
  const smoke = smokeExists ? parseEnvFile(smokePath) : {};
  const fallback: EnvMap = {
    ...parseEnvFile(path.resolve(process.cwd(), ".env")),
    ...parseEnvFile(path.resolve(process.cwd(), ".env.local")),
  };
  const env: EnvMap = { ...fallback, ...smoke };
  // 强制：DATABASE_URL 只允许来自 .env.smoke（删除任何来自 fallback 的值）。
  if (smoke.DATABASE_URL) {
    env.DATABASE_URL = smoke.DATABASE_URL;
  } else {
    delete env.DATABASE_URL;
  }
  return { env, smokeFileExists: smokeExists, dbFromSmoke: Boolean(smoke.DATABASE_URL) };
}

interface DbInfo {
  host: string;
  db: string;
}

function dbInfo(url: string | undefined): DbInfo | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return { host: u.host, db: u.pathname.replace(/^\//, "") };
  } catch {
    return null;
  }
}

/** 门禁失败：只输出停止文案（stdout），reason 仅写 stderr 供排查（不含敏感值）。 */
function stop(reason: string): never {
  console.log(STOP_MESSAGE);
  console.error(`  (gate reason: ${reason})`);
  process.exit(1);
}

/**
 * 强制安全门禁：任意一条不满足立即停止。
 * 1) DATABASE_URL 不存在；
 * 2) 无法解析；
 * 3/4) host 命中生产端点（ep-super-field-antfibsl）或等于生产 host/db；
 * 5) host/db 无 branch/dev/preview/smoke 标识；
 * 6) 未显式确认 SMOKE_CONFIRM_NON_PROD=yes。
 */
export function assertNonProductionDatabase(
  databaseUrl: string | undefined,
  opts: { confirmed: boolean },
): void {
  if (!databaseUrl) stop("DATABASE_URL 不存在（必须在 .env.smoke 中定义）");

  const info = dbInfo(databaseUrl);
  if (!info) stop("DATABASE_URL 无法解析");

  const haystack = `${info.host}/${info.db}`;

  if (info.host.includes(PROD_HOST_FRAGMENT)) {
    stop(`host 命中生产端点片段 ${PROD_HOST_FRAGMENT}`);
  }
  if (info.host.includes(PROD_HOST_FRAGMENT) && info.db === PROD_DB_NAME) {
    stop("等于当前生产 host/db");
  }
  if (!BRANCH_MARKERS.test(haystack)) {
    stop("host/db 缺少 branch/dev/preview/smoke 标识，无法确认非生产");
  }
  if (!opts.confirmed) {
    stop(`缺少显式确认（${CONFIRM_KEY}=yes）`);
  }
}

const DRY_PLAN_STEPS: string[] = [
  "1) 读取 .env.smoke，强制 DATABASE_URL 仅来自该文件",
  "2) 打印非敏感摘要（host / db / 标识 / 模型 / key 存在性）",
  "3) assertNonProductionDatabase 门禁（不通过即停止）",
  "4) [下一轮] prisma migrate deploy —— 仅对 branch",
  "5) [下一轮] seed builtin skills（含 product-visual-builder）—— 仅对 branch",
  "6) [下一轮] 确认可用的 org / user",
  "7) [下一轮] 上传低敏测试图 → 取 sourceImageUrls（含 visual-builder/{orgId}/）",
  "8) [下一轮] 调真实生成（generateEnabled=true, dryRun=false, imageSize=1024x1024）",
  "9) [下一轮] 校验 outputImageUrls / model≠dry-run / humanReviewRequired / warnings",
  "10) [下一轮] 校验 SkillExecution.success=true 且 outputJson 含 outputImageUrls",
  "11) [下一轮] 校验 AuditLog requested/completed，且不含 prompt/sourceUrls/key",
  "12) [下一轮] 人工打开 outputImageUrls 验证可访问",
];

function printSummary(env: EnvMap, smokeFileExists: boolean): void {
  const info = dbInfo(env.DATABASE_URL);
  const marker = info ? BRANCH_MARKERS.test(`${info.host}/${info.db}`) : false;
  console.log("=== Phase 1H smoke — 非敏感摘要 ===");
  console.log(".env.smoke 存在:", smokeFileExists);
  console.log("DATABASE_URL present (来自 .env.smoke):", Boolean(env.DATABASE_URL));
  console.log("host:", info ? info.host : "(none/unparseable)");
  console.log("db:", info ? info.db : "(none)");
  console.log("含 branch/smoke/dev/preview 标识:", marker);
  console.log("OPENAI_IMAGE_MODEL:", env.OPENAI_IMAGE_MODEL || "(default gpt-image-2)");
  console.log("OPENAI_API_KEY present:", Boolean(env.OPENAI_API_KEY));
  console.log("OPENAI_BASE_URL present:", Boolean(env.OPENAI_BASE_URL));
  console.log("BLOB_READ_WRITE_TOKEN present:", Boolean(env.BLOB_READ_WRITE_TOKEN));
  console.log(
    `${CONFIRM_KEY}:`,
    env[CONFIRM_KEY] === "yes" ? "yes" : "(missing / !=yes)",
  );
}

function main(): void {
  const wantRun = process.argv.slice(2).includes("--run");

  const { env, smokeFileExists } = loadSmokeEnv();
  printSummary(env, smokeFileExists);

  // 强制门禁：不通过即 stop()（输出停止文案并退出）。
  assertNonProductionDatabase(env.DATABASE_URL, {
    confirmed: env[CONFIRM_KEY] === "yes",
  });

  console.log("\n✅ 安全门禁通过：DATABASE_URL 已确认为非生产 branch。");

  console.log("\n=== DRY PLAN（本阶段不执行任何真实操作）===");
  for (const step of DRY_PLAN_STEPS) console.log("  " + step);

  if (wantRun) {
    console.log(
      "\n⚠️ 已传入 --run，但 Phase 1H-Branch Setup Plan 阶段尚未启用真实 smoke 流程。",
    );
    console.log(
      "   请在「branch DATABASE_URL 已设置且确认是 pvb-smoke branch」后，由下一轮启用真实执行。",
    );
  } else {
    console.log("\n（默认仅 DRY PLAN；真实执行将在下一轮、确认 branch 后启用。）");
  }

  process.exit(0);
}

main();
