/**
 * Visualizer AI 安装模板真实 E2E（隔离 Neon branch）
 *
 * 要求工作树 .env.local 已指向非 production 的 visualizer-ai-template-e2e 库。
 * 不打印连接串 / 密钥；证据图写入 .data/e2e-evidence/（gitignore）。
 *
 *   npx tsx scripts/e2e-visualizer-ai-templates.ts
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { putPrivateBlob, readBlobBuffer } from "@/lib/files/blob-access";
import { fetchBuffer } from "@/lib/visualizer/image-ai";
import {
  CatalogTemplateError,
  generateCatalogInstallTemplate,
  resolveTemplateRoomUrl,
} from "@/lib/visualizer/catalog-template";
import { evaluateCatalogReadiness } from "@/lib/visualizer/catalog-readiness";
import {
  evaluateReferenceQuality,
  pickCatalogReferencesForRender,
  sortCatalogAssetsForRender,
} from "@/lib/visualizer/catalog-reference";
import { assetBadgeLabel } from "@/lib/visualizer/catalog-readiness";

const ASSETS = "/Users/user/.cursor/projects/Users-user-Desktop/assets";
const EVIDENCE_DIR = path.join(process.cwd(), ".data", "e2e-evidence");

type Check = { name: string; pass: boolean; detail?: string };
const checks: Check[] = [];
function check(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function sha16(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

function assertE2eDb() {
  const host = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  const branch = process.env.E2E_NEON_BRANCH_NAME || "";
  if (branch !== "visualizer-ai-template-e2e") {
    throw new Error("E2E_NEON_BRANCH_NAME 不是 visualizer-ai-template-e2e，已中止");
  }
  if (/super-field-antfibsl|green-boat/i.test(host)) {
    throw new Error("检测到疑似 production 连接，已中止");
  }
  if (!/curly-moon-an3uwdeg/i.test(host)) {
    throw new Error("DIRECT/DATABASE host 不是 e2e endpoint，已中止");
  }
  console.log(
    `DB gate: branch=${branch} host_ok=yes primary_forbidden=yes`,
  );
}

async function uploadAsset(args: {
  orgId: string;
  localPath: string;
  safeName: string;
}) {
  const buffer = fs.readFileSync(args.localPath);
  const pathname = `visualizer/catalog/${args.orgId}/e2e/${Date.now()}-${args.safeName}`;
  const put = await putPrivateBlob({
    pathname,
    body: buffer,
    contentType: "image/jpeg",
  });
  return { ...put, bytes: buffer.length, sha: sha16(buffer) };
}

async function main() {
  assertE2eDb();
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  // ── 底图 ──
  for (const t of [
    "standard_floor_to_ceiling_day",
    "modern_living_room_day",
  ] as const) {
    const url = resolveTemplateRoomUrl(t);
    const buf = url ? await fetchBuffer(url) : null;
    check(
      `room_readable:${t}`,
      !!(url?.startsWith("/api/files/") && buf && buf.length > 1000),
      `bytes=${buf?.length ?? 0}`,
    );
  }

  // ── 组织 / 用户 ──
  const membership = await db.organizationMember.findFirst({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
    select: { orgId: true, userId: true },
  });
  if (!membership) throw new Error("隔离库中无 active OrganizationMember");
  const { orgId, userId } = membership;
  console.log(`org/user selected (ids redacted lens=${orgId.length}/${userId.length})`);

  // ── 创建测试产品 ──
  const product = await db.visualizerCatalogProduct.create({
    data: {
      orgId,
      name: "E2E Ripple Fold Drapery",
      category: "drapery",
      categoryLabel: "布艺帘",
      defaultOpacity: 0.85,
      colorsJson: [{ name: "Warm White", hex: "#F5F0E6" }],
      mountingsJson: ["ceiling"],
      notes: "visualizer-ai-template-e2e temporary product",
      createdById: userId,
    },
  });

  const texture = await uploadAsset({
    orgId,
    localPath: path.join(
      ASSETS,
      "f8366d9a94069b0fcb69e35517365c9c-25ed387c-8ca1-43c6-b38d-a7d4aca16a98.png",
    ),
    safeName: "texture.jpg",
  });
  const swatch = await uploadAsset({
    orgId,
    localPath: path.join(
      ASSETS,
      "24b300aa1b83e732fe9e854f9ac48344-5ee1d4d3-458e-4afb-8edf-921f53c70bcd.png",
    ),
    safeName: "swatch.jpg",
  });
  const detail = await uploadAsset({
    orgId,
    localPath: path.join(
      ASSETS,
      "b27887a1e5ee0ff8bdfbb7f17a9287f3-55b30204-5870-4632-867c-72b8a7fb45d1.png",
    ),
    safeName: "detail.jpg",
  });

  await db.visualizerCatalogAsset.createMany({
    data: [
      {
        productId: product.id,
        role: "texture",
        fileUrl: texture.proxyUrl,
        fileName: "texture.jpg",
        mimeType: "image/jpeg",
        bytes: texture.bytes,
        sortOrder: 0,
        isPrimary: true,
        sourceType: "real",
        verificationStatus: "draft",
        createdById: userId,
      },
      {
        productId: product.id,
        role: "swatch",
        fileUrl: swatch.proxyUrl,
        fileName: "swatch.jpg",
        mimeType: "image/jpeg",
        bytes: swatch.bytes,
        sortOrder: 1,
        isPrimary: false,
        sourceType: "real",
        verificationStatus: "draft",
        createdById: userId,
      },
      {
        productId: product.id,
        role: "detail",
        fileUrl: detail.proxyUrl,
        fileName: "detail.jpg",
        mimeType: "image/jpeg",
        bytes: detail.bytes,
        sortOrder: 2,
        isPrimary: false,
        sourceType: "real",
        verificationStatus: "draft",
        createdById: userId,
      },
    ],
  });

  const beforeAssets = await db.visualizerCatalogAsset.findMany({
    where: { productId: product.id },
  });
  const readiness0 = evaluateCatalogReadiness(beforeAssets);
  check("initial_source_ready", readiness0.status === "source_ready", readiness0.status);
  check(
    "no_preexisting_installed_or_ai",
    !beforeAssets.some(
      (a) =>
        (a.role === "installed" && a.sourceType === "real") ||
        (a.role === "style_reference" && a.sourceType === "ai_generated"),
    ),
  );

  // ── 重复点击保护：人工插入 running Job ──
  const blocker = await db.visualizerCatalogTemplateJob.create({
    data: {
      productId: product.id,
      templateType: "standard_floor_to_ceiling_day",
      status: "running",
      createdById: userId,
      startedAt: new Date(),
    },
  });
  let dupBlocked = false;
  try {
    await generateCatalogInstallTemplate({
      productId: product.id,
      orgId,
      userId,
      templateType: "standard_floor_to_ceiling_day",
    });
  } catch (err) {
    dupBlocked =
      err instanceof CatalogTemplateError && err.code === "JOB_IN_PROGRESS";
  }
  check("duplicate_click_job_in_progress", dupBlocked);
  await db.visualizerCatalogTemplateJob.delete({ where: { id: blocker.id } });

  // ── 失败路径：无素材产品 ──
  const emptyProduct = await db.visualizerCatalogProduct.create({
    data: {
      orgId,
      name: "E2E Empty Incomplete",
      category: "drapery",
      categoryLabel: "布艺帘",
      colorsJson: [],
      mountingsJson: ["ceiling"],
      createdById: userId,
    },
  });
  let failCode: string | null = null;
  try {
    await generateCatalogInstallTemplate({
      productId: emptyProduct.id,
      orgId,
      userId,
      templateType: "modern_living_room_day",
    });
  } catch (err) {
    failCode = err instanceof CatalogTemplateError ? err.code : "OTHER";
  }
  check("incomplete_fails_source_incomplete", failCode === "SOURCE_INCOMPLETE", failCode ?? "none");
  const emptyJobs = await db.visualizerCatalogTemplateJob.findMany({
    where: { productId: emptyProduct.id },
  });
  // 失败发生在 Job 创建前（素材校验），不应留下伪成功资产
  const emptyAssets = await db.visualizerCatalogAsset.count({
    where: { productId: emptyProduct.id },
  });
  check("incomplete_no_fake_assets", emptyAssets === 0, `jobs=${emptyJobs.length}`);

  // ── 真实生成 1：standard ──
  const roomStd = await fetchBuffer(
    resolveTemplateRoomUrl("standard_floor_to_ceiling_day")!,
  );
  const roomStdSha = sha16(roomStd!);

  console.log("\n→ generating standard_floor_to_ceiling_day (real model)...");
  const gen1 = await generateCatalogInstallTemplate({
    productId: product.id,
    orgId,
    userId,
    templateType: "standard_floor_to_ceiling_day",
  });
  const job1 = await db.visualizerCatalogTemplateJob.findUniqueOrThrow({
    where: { id: gen1.jobId },
  });
  const asset1 = await db.visualizerCatalogAsset.findUniqueOrThrow({
    where: { id: gen1.assetId },
  });
  const buf1 = await readBlobBuffer(asset1.fileUrl);
  if (buf1?.buffer) {
    fs.writeFileSync(path.join(EVIDENCE_DIR, "standard-ai-template.jpg"), buf1.buffer);
  }
  check("std_job_succeeded", job1.status === "succeeded", job1.status);
  check("std_job_type", job1.templateType === "standard_floor_to_ceiling_day");
  check("std_job_output", !!job1.outputAssetId && job1.outputAssetId === asset1.id);
  check("std_job_completedAt", !!job1.completedAt);
  check("std_job_no_error", !job1.errorCode && !job1.errorMessage);
  check(
    "std_asset_fields",
    asset1.role === "style_reference" &&
      asset1.sourceType === "ai_generated" &&
      asset1.verificationStatus === "ai_reference",
  );
  check(
    "std_blob_private_proxy",
    asset1.fileUrl.startsWith("/api/files/") &&
      !/blob\.vercel-storage\.com/i.test(asset1.fileUrl),
  );
  check(
    "std_blob_readable",
    !!(buf1?.buffer && buf1.buffer.length > 5000),
    `bytes=${buf1?.buffer?.length ?? 0}`,
  );
  check(
    "std_not_room_copy",
    !!(buf1?.buffer && sha16(buf1.buffer) !== roomStdSha),
    `out=${buf1 ? sha16(buf1.buffer) : "?"} room=${roomStdSha}`,
  );
  check(
    "std_badge_label",
    assetBadgeLabel({
      role: "style_reference",
      sourceType: "ai_generated",
      verificationStatus: "ai_reference",
    }) === "AI 生成参考",
  );

  let assets = await db.visualizerCatalogAsset.findMany({
    where: { productId: product.id },
  });
  let readiness = evaluateCatalogReadiness(assets);
  check("after_std_ai_template_ready", readiness.status === "ai_template_ready", readiness.status);

  // ── 真实生成 2：living ──
  const roomLiv = await fetchBuffer(
    resolveTemplateRoomUrl("modern_living_room_day")!,
  );
  const roomLivSha = sha16(roomLiv!);
  console.log("\n→ generating modern_living_room_day (real model)...");
  const gen2 = await generateCatalogInstallTemplate({
    productId: product.id,
    orgId,
    userId,
    templateType: "modern_living_room_day",
  });
  const job2 = await db.visualizerCatalogTemplateJob.findUniqueOrThrow({
    where: { id: gen2.jobId },
  });
  const asset2 = await db.visualizerCatalogAsset.findUniqueOrThrow({
    where: { id: gen2.assetId },
  });
  const buf2 = await readBlobBuffer(asset2.fileUrl);
  if (buf2?.buffer) {
    fs.writeFileSync(path.join(EVIDENCE_DIR, "living-ai-template.jpg"), buf2.buffer);
  }
  check("liv_job_succeeded", job2.status === "succeeded", job2.status);
  check("liv_job_type", job2.templateType === "modern_living_room_day");
  check("liv_job_output", !!job2.outputAssetId && job2.outputAssetId === asset2.id);
  check("liv_job_completedAt", !!job2.completedAt);
  check("liv_job_no_error", !job2.errorCode && !job2.errorMessage);
  check(
    "liv_asset_fields",
    asset2.role === "style_reference" &&
      asset2.sourceType === "ai_generated" &&
      asset2.verificationStatus === "ai_reference",
  );
  check(
    "liv_blob_readable",
    !!(buf2?.buffer && buf2.buffer.length > 5000),
    `bytes=${buf2?.buffer?.length ?? 0}`,
  );
  check(
    "liv_not_room_copy",
    !!(buf2?.buffer && sha16(buf2.buffer) !== roomLivSha),
  );
  check(
    "jobs_independent",
    job1.id !== job2.id && asset1.id !== asset2.id,
    `jobIds=${job1.id.slice(0, 6)}…/${job2.id.slice(0, 6)}…`,
  );
  check(
    "assets_both_retained",
    (await db.visualizerCatalogAsset.count({
      where: {
        productId: product.id,
        role: "style_reference",
        sourceType: "ai_generated",
      },
    })) >= 2,
  );

  // ── AI-only HD 质量 ──
  assets = await db.visualizerCatalogAsset.findMany({
    where: { productId: product.id },
  });
  const qAi = evaluateReferenceQuality(assets);
  check("hd_ai_only_quality", qAi.referenceQuality === "ai_only", qAi.referenceQuality);
  check(
    "hd_ai_only_warning",
    !!(qAi.warning && qAi.warning.includes("未使用真实安装案例")),
    qAi.warning ?? "",
  );
  const pickedAi = pickCatalogReferencesForRender(assets);
  const sortedAi = sortCatalogAssetsForRender(assets);
  check(
    "render_order_texture_before_ai",
    sortedAi.findIndex((a) => a.role === "texture") <
      sortedAi.findIndex(
        (a) => a.role === "style_reference" && a.sourceType === "ai_generated",
      ),
  );
  check(
    "picked_includes_ai_template",
    pickedAi.some(
      (a) => a.role === "style_reference" && a.sourceType === "ai_generated",
    ),
  );

  // ── 补真实安装图后优先级 ──
  const installedUp = await uploadAsset({
    orgId,
    localPath: path.join(
      ASSETS,
      "f8366d9a94069b0fcb69e35517365c9c-25ed387c-8ca1-43c6-b38d-a7d4aca16a98.png",
    ),
    safeName: "installed.jpg",
  });
  await db.visualizerCatalogAsset.create({
    data: {
      productId: product.id,
      role: "installed",
      fileUrl: installedUp.proxyUrl,
      fileName: "installed.jpg",
      mimeType: "image/jpeg",
      bytes: installedUp.bytes,
      sortOrder: 0,
      isPrimary: true,
      sourceType: "real",
      verificationStatus: "real_unverified",
      createdById: userId,
    },
  });
  assets = await db.visualizerCatalogAsset.findMany({
    where: { productId: product.id },
  });
  readiness = evaluateCatalogReadiness(assets);
  const qReal = evaluateReferenceQuality(assets);
  const sortedReal = sortCatalogAssetsForRender(assets);
  const aiCountAfter = assets.filter(
    (a) => a.role === "style_reference" && a.sourceType === "ai_generated",
  ).length;
  check("after_installed_real_ready", readiness.status === "real_install_ready");
  check("hd_not_ai_only_anymore", qReal.referenceQuality !== "ai_only", qReal.referenceQuality);
  check(
    "real_install_first",
    sortedReal[0]?.role === "installed" && sortedReal[0]?.sourceType === "real",
  );
  check("ai_templates_retained", aiCountAfter >= 2, `aiCount=${aiCountAfter}`);

  // ── 报告 JSON（无密钥） ──
  const report = {
    branch: process.env.E2E_NEON_BRANCH_NAME,
    branchId: process.env.E2E_NEON_BRANCH_ID,
    endpointHost: process.env.E2E_NEON_ENDPOINT_HOST,
    productIdPrefix: product.id.slice(0, 8),
    jobs: [
      {
        idPrefix: job1.id.slice(0, 8),
        type: job1.templateType,
        status: job1.status,
        resolvedModel: job1.resolvedModel,
      },
      {
        idPrefix: job2.id.slice(0, 8),
        type: job2.templateType,
        status: job2.status,
        resolvedModel: job2.resolvedModel,
      },
    ],
    checks,
    passed: checks.filter((c) => c.pass).length,
    failed: checks.filter((c) => !c.pass).length,
    evidenceDir: ".data/e2e-evidence/",
  };
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "e2e-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `\nE2E summary: ${report.passed} passed, ${report.failed} failed (of ${checks.length})`,
  );
  if (report.failed > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
