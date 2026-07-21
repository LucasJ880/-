/**
 * Phase 1H — product-visual-builder 真实 smoke test 脚本
 *
 * 安全边界（极重要）：
 * - DATABASE_URL **只**从 .env.smoke 读取，绝不使用 .env / .env.local 的 DATABASE_URL，
 *   以彻底杜绝误连生产库。
 * - 必须通过 assertNonProductionDatabase 强制门禁，否则立即停止。
 * - Blob 上传使用与生产共享的 private store（Vercel Blob 无 branch 概念），
 *   路径带 smoke executionId 前缀，跑完可用 --cleanup 删除测试对象。
 *
 * 手动用法（不会自动运行）：
 *   npx tsx scripts/smoke-product-visual-builder.ts                  # 摘要 + 门禁 + DRY PLAN
 *   npx tsx scripts/smoke-product-visual-builder.ts --run            # 真实执行（migrate/seed/上传/生成/校验）
 *   npx tsx scripts/smoke-product-visual-builder.ts --run --cleanup  # 真实执行 + 结束后删除本次测试 Blob
 *
 * 前置：在项目根创建 .env.smoke（已被 .gitignore 的 .env* 规则忽略），至少包含：
 *   DATABASE_URL=postgres://...   # 指向 Neon 的 pvb-smoke branch（非生产）
 *   DIRECT_URL=postgres://...     # 同一 branch 的直连串（migrate 用）
 *   SMOKE_CONFIRM_NON_PROD=yes    # 显式确认当前为非生产 branch
 *   # 可选（缺省则回退到 .env / .env.local 的同名值，但 DATABASE_URL / DIRECT_URL 不回退）：
 *   # OPENAI_API_KEY=...  OPENAI_IMAGE_MODEL=...  OPENAI_BASE_URL=...  BLOB_PRIVATE_READ_WRITE_TOKEN=...
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";

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

/** 只从 .env.smoke 取 DATABASE_URL / DIRECT_URL；其它变量允许回退 .env/.env.local。 */
function loadSmokeEnv(): LoadedEnv {
  const smokePath = path.resolve(process.cwd(), ".env.smoke");
  const smokeExists = fs.existsSync(smokePath);
  const smoke = smokeExists ? parseEnvFile(smokePath) : {};
  const fallback: EnvMap = {
    ...parseEnvFile(path.resolve(process.cwd(), ".env")),
    ...parseEnvFile(path.resolve(process.cwd(), ".env.local")),
  };
  const env: EnvMap = { ...fallback, ...smoke };
  // 强制：DATABASE_URL / DIRECT_URL 只允许来自 .env.smoke（删除任何来自 fallback 的值）。
  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    if (smoke[key]) {
      env[key] = smoke[key];
    } else {
      delete env[key];
    }
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
 * 5) host/db 有 branch/dev/preview/smoke 标识，或 host 命中 .env.smoke 中
 *    显式声明的分支 endpoint 指纹（SMOKE_BRANCH_HOST_FRAGMENT，须与生产指纹不同；
 *    Neon 分支 endpoint id 不含语义字样，需人工/脚本先经 Neon API 核对归属）；
 * 6) 未显式确认 SMOKE_CONFIRM_NON_PROD=yes。
 */
export function assertNonProductionDatabase(
  databaseUrl: string | undefined,
  opts: { confirmed: boolean; expectedHostFragment?: string },
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
  const fragment = opts.expectedHostFragment?.trim();
  const fragmentOk =
    Boolean(fragment) &&
    fragment !== PROD_HOST_FRAGMENT &&
    fragment!.startsWith("ep-") &&
    info.host.includes(fragment!);
  if (!BRANCH_MARKERS.test(haystack) && !fragmentOk) {
    stop(
      "host/db 缺少 branch/dev/preview/smoke 标识，且未命中 SMOKE_BRANCH_HOST_FRAGMENT，无法确认非生产",
    );
  }
  if (!opts.confirmed) {
    stop(`缺少显式确认（${CONFIRM_KEY}=yes）`);
  }
}

const DRY_PLAN_STEPS: string[] = [
  "1) 读取 .env.smoke，强制 DATABASE_URL / DIRECT_URL 仅来自该文件",
  "2) 打印非敏感摘要（host / db / 标识 / 模型 / key 存在性）",
  "3) assertNonProductionDatabase 门禁（不通过即停止）",
  "4) prisma migrate deploy —— 仅对 branch",
  "5) seed builtin skills（含 product-visual-builder）—— 仅对 branch",
  "6) 确认可用的 org / user",
  "7) 上传低敏测试图（程序生成的纯色 PNG）→ 取 sourceImageUrls",
  "8) 调真实生成（generateEnabled=true, dryRun=false, imageSize=1024x1024）",
  "9) 校验 outputImageUrls / model≠dry-run / humanReviewRequired / warnings",
  "10) 校验 SkillExecution.success=true 且 outputJson 含 outputImageUrls",
  "11) 校验 AuditLog requested/completed，且不含 prompt/sourceUrls/key",
  "12) 校验 output Blob 可经 SDK 读取（--cleanup 时随后删除测试对象）",
];

// ── 真实执行 ─────────────────────────────────────────────────

/** 程序生成一张 64x64 纯色 PNG（低敏测试图，不含任何真实产品/隐私）。 */
function makeTestPng(): Buffer {
  const width = 64;
  const height = 64;
  // 每行: filter byte(0) + RGB 像素
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = 180; // R
      raw[p + 1] = 200; // G
      raw[p + 2] = 220; // B
    }
  }
  const crc32 = (buf: Buffer): number => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function fail(step: string, detail: string): never {
  console.error(`\n❌ SMOKE FAILED @ ${step}: ${detail}`);
  process.exit(1);
}

async function runRealSmoke(env: EnvMap, cleanup: boolean): Promise<void> {
  // 把合并后的 env 应用到 process.env（此后 import 的模块统一读到 branch DB）。
  for (const [k, v] of Object.entries(env)) process.env[k] = v;

  // ── 步骤 4：migrate deploy（仅 branch）──
  console.log("\n[4] prisma migrate deploy（branch）...");
  const mig = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: process.env,
  });
  if (mig.status !== 0) fail("migrate deploy", `exit=${mig.status}`);

  // env 就绪后再加载业务模块（避免模块加载期读到旧 env）。
  const { db } = await import("../src/lib/db");
  const { seedBuiltinSkills } = await import("../src/lib/agent-core/skills/seed");
  const { runProductVisualBuilder, PRODUCT_VISUAL_BUILDER_SLUG } = await import(
    "../src/lib/skills/product-visual-builder/service"
  );
  const { uploadVisualBuilderImage } = await import(
    "../src/lib/skills/product-visual-builder/storage"
  );
  const { readBlobBuffer, deleteBlob } = await import("../src/lib/files/blob-access");

  const blobPathsToCleanup: string[] = [];
  try {
    // ── 步骤 5/6：确认 org / user 并 seed skills ──
    const org = await db.organization.findFirst({
      where: { code: "sunny-shutter-bid-lead" },
      select: { id: true, name: true },
    });
    if (!org) fail("org", "未找到 sunny-shutter-bid-lead 组织（branch 数据异常）");
    const member = await db.organizationMember.findFirst({
      where: { orgId: org.id, status: "active" },
      select: { userId: true },
      orderBy: { joinedAt: "asc" },
    });
    if (!member) fail("user", "该组织没有 active 成员");
    console.log(`[5/6] org=${org.name}(${org.id}) user=${member.userId}`);

    const seeded = await seedBuiltinSkills(org.id);
    console.log(`[5] seedBuiltinSkills 新建 ${seeded} 个（已存在则 0，幂等）`);
    const skill = await db.agentSkill.findUnique({
      where: { orgId_slug: { orgId: org.id, slug: PRODUCT_VISUAL_BUILDER_SLUG } },
      select: { id: true },
    });
    if (!skill) fail("seed", `org 缺少 ${PRODUCT_VISUAL_BUILDER_SLUG} 技能`);

    // ── 步骤 7：上传低敏测试图 ──
    const smokeBatchId = `smoke-${Date.now()}`;
    console.log(`\n[7] 上传测试 source 图（batch=${smokeBatchId}）...`);
    const uploaded = await uploadVisualBuilderImage({
      orgId: org.id,
      executionId: smokeBatchId,
      assetRole: "source",
      index: 0,
      ext: "png",
      mimeType: "image/png",
      buffer: makeTestPng(),
    });
    blobPathsToCleanup.push(uploaded.pathname);
    console.log(`[7] sourceImageUrl = ${uploaded.url}`);

    // ── 步骤 8：真实生成 ──
    console.log("\n[8] 调用真实生成（generateEnabled=true, dryRun=false）...");
    const output = await runProductVisualBuilder({
      orgId: org.id,
      userId: member.userId,
      input: {
        orgId: org.id,
        userId: member.userId,
        productType: "blanket",
        productName: "Smoke Test Blanket",
        useCase: "internal_review",
        style: "white_background",
        sourceImageUrls: [uploaded.url],
        sourceImageRoles: ["front"],
        productFacts: { material: "100% polyester (smoke test)" },
        language: "en",
      },
      options: { dryRun: false, generateEnabled: true, imageSize: "1024x1024" },
    });

    // ── 步骤 9：校验输出 ──
    console.log("\n[9] 校验输出...");
    if (output.status !== "completed") fail("output.status", output.status);
    if (!output.executionId) fail("output.executionId", "missing");
    if (output.model === "dry-run" || !output.model) fail("output.model", String(output.model));
    if (output.outputImageUrls.length === 0) fail("outputImageUrls", "empty");
    if (output.humanReviewRequired !== true) fail("humanReviewRequired", "not true");
    if (output.warnings.length === 0) fail("warnings", "empty");
    console.log(`[9] OK: model=${output.model} images=${output.outputImageUrls.length}`);
    console.log(`[9] outputImageUrls: ${output.outputImageUrls.join(", ")}`);
    for (const u of output.outputImageUrls) blobPathsToCleanup.push(u);

    // ── 步骤 10：校验 SkillExecution ──
    const exec = await db.skillExecution.findUnique({
      where: { id: output.executionId },
      select: { success: true, outputJson: true, skillId: true, userId: true },
    });
    if (!exec) fail("SkillExecution", "record missing");
    if (!exec.success) fail("SkillExecution.success", "false");
    if (!exec.outputJson?.includes(output.outputImageUrls[0])) {
      fail("SkillExecution.outputJson", "不含 outputImageUrls");
    }
    if (exec.skillId !== skill.id || exec.userId !== member.userId) {
      fail("SkillExecution", "skillId/userId 不匹配");
    }
    console.log("[10] SkillExecution OK（success=true，outputJson 含图片 URL）");

    // ── 步骤 11：校验 AuditLog ──
    const audits = await db.auditLog.findMany({
      where: {
        orgId: org.id,
        targetType: "visual_builder",
        action: { in: ["visual_builder.generate.requested", "visual_builder.generate.completed"] },
      },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { action: true, afterData: true, targetId: true },
    });
    const hasRequested = audits.some((a) => a.action === "visual_builder.generate.requested");
    const completed = audits.find(
      (a) =>
        a.action === "visual_builder.generate.completed" &&
        a.targetId === output.executionId,
    );
    if (!hasRequested || !completed) fail("AuditLog", "requested/completed 记录缺失");
    const auditText = JSON.stringify(audits.map((a) => a.afterData));
    if (auditText.includes(output.finalPrompt.slice(0, 50))) {
      fail("AuditLog", "afterData 泄露 prompt");
    }
    if (auditText.includes(uploaded.url)) fail("AuditLog", "afterData 泄露 source URL");
    console.log("[11] AuditLog OK（requested + completed，无 prompt / URL 泄露）");

    // ── 步骤 12：校验 output Blob 可读 ──
    const blobRead = await readBlobBuffer(output.outputImageUrls[0]);
    if (!blobRead || blobRead.buffer.length === 0) fail("blob read", "生成图片不可读");
    console.log(
      `[12] Blob 可读 OK（${blobRead.buffer.length} bytes, ${blobRead.contentType}）`,
    );

    console.log("\n✅ Phase 1H 真实 smoke 全部通过。");
  } finally {
    if (cleanup && blobPathsToCleanup.length > 0) {
      console.log(`\n[cleanup] 删除 ${blobPathsToCleanup.length} 个测试 Blob 对象...`);
      for (const p of blobPathsToCleanup) {
        await deleteBlob(p).catch(() => undefined);
      }
      console.log("[cleanup] 完成（DB 记录留在 branch，随分支删除一并销毁）");
    } else if (blobPathsToCleanup.length > 0) {
      console.log("\n[cleanup] 未传 --cleanup，保留测试 Blob 对象：");
      for (const p of blobPathsToCleanup) console.log("  -", p);
    }
    await db.$disconnect().catch(() => undefined);
  }
}

function printSummary(env: EnvMap, smokeFileExists: boolean): void {
  const info = dbInfo(env.DATABASE_URL);
  const marker = info ? BRANCH_MARKERS.test(`${info.host}/${info.db}`) : false;
  console.log("=== Phase 1H smoke — 非敏感摘要 ===");
  console.log(".env.smoke 存在:", smokeFileExists);
  console.log("DATABASE_URL present (来自 .env.smoke):", Boolean(env.DATABASE_URL));
  console.log("host:", info ? info.host : "(none/unparseable)");
  console.log("db:", info ? info.db : "(none)");
  console.log("含 branch/smoke/dev/preview 标识:", marker);
  console.log(
    "OPENAI_IMAGE_MODEL:",
    env.OPENAI_IMAGE_MODEL || "(default via ModelRegistry.image)",
  );
  console.log("OPENAI_API_KEY present:", Boolean(env.OPENAI_API_KEY));
  console.log("OPENAI_BASE_URL present:", Boolean(env.OPENAI_BASE_URL));
  console.log("DIRECT_URL present (来自 .env.smoke):", Boolean(env.DIRECT_URL));
  console.log("BLOB_READ_WRITE_TOKEN present:", Boolean(env.BLOB_READ_WRITE_TOKEN));
  console.log(
    "BLOB_PRIVATE_READ_WRITE_TOKEN present:",
    Boolean(env.BLOB_PRIVATE_READ_WRITE_TOKEN),
  );
  console.log(
    `${CONFIRM_KEY}:`,
    env[CONFIRM_KEY] === "yes" ? "yes" : "(missing / !=yes)",
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const wantRun = argv.includes("--run");
  const wantCleanup = argv.includes("--cleanup");

  const { env, smokeFileExists } = loadSmokeEnv();
  printSummary(env, smokeFileExists);

  // 强制门禁：DATABASE_URL 与 DIRECT_URL（migrate 直连）都必须是非生产 branch。
  const gateOpts = {
    confirmed: env[CONFIRM_KEY] === "yes",
    expectedHostFragment: env.SMOKE_BRANCH_HOST_FRAGMENT,
  };
  assertNonProductionDatabase(env.DATABASE_URL, gateOpts);
  if (env.DIRECT_URL) {
    assertNonProductionDatabase(env.DIRECT_URL, gateOpts);
  } else {
    stop("DIRECT_URL 不存在（必须在 .env.smoke 中定义，migrate 需要直连串）");
  }

  console.log("\n✅ 安全门禁通过：DATABASE_URL / DIRECT_URL 已确认为非生产 branch。");

  if (!wantRun) {
    console.log("\n=== DRY PLAN（未传 --run，不执行任何真实操作）===");
    for (const step of DRY_PLAN_STEPS) console.log("  " + step);
    console.log("\n（真实执行：npx tsx scripts/smoke-product-visual-builder.ts --run [--cleanup]）");
    process.exit(0);
  }

  await runRealSmoke(env, wantCleanup);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n❌ SMOKE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
