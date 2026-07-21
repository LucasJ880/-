/**
 * 梦馨家纺素色浴袍 — Product Content Director 验收脚本
 *
 * 阶段：
 *   1) stopOnMissing=true  → 验证 NEEDS_INPUT（不伪造缺字段）
 *   2) INTERNAL_DRAFT dry-run → 完整草稿流水线（真实读图 buffer）
 *   3) --real-images       → PRODUCT_CONTENT_IMAGE_DRY_RUN=0 真实出图
 *
 * 用法：
 *   PRODUCT_CONTENT_LOCAL_STORE=1 npx tsx scripts/e2e-product-content-mengxin.ts
 *   PRODUCT_CONTENT_LOCAL_STORE=1 npx tsx scripts/e2e-product-content-mengxin.ts --real-images
 *   PRODUCT_CONTENT_LOCAL_STORE=1 npx tsx scripts/e2e-product-content-mengxin.ts --job-id <id> --real-images
 */

import fs from "fs";
import path from "path";

function loadEnvFile(rel: string) {
  const abs = path.join(process.cwd(), rel);
  if (!fs.existsSync(abs)) return;
  for (const line of fs.readFileSync(abs, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

import { db } from "../src/lib/db";
import { putPrivateBlob } from "../src/lib/files/blob-access";
import {
  addJobInput,
  createProductContentJob,
  updateJobDocumentPurpose,
  upsertProductFactsFromExtraction,
  confirmProductFact,
  lockProductFact,
  getProductContentJobDetail,
} from "../src/lib/product-content/jobs/service";
import { analyzeJobInputs } from "../src/lib/product-content/intake/analyze";
import { runProductContentPipeline } from "../src/lib/product-content/jobs/runtime";
import { generateProductDocuments } from "../src/lib/product-content/documents/generate";
import { summarizeJobCost } from "../src/lib/product-content/cost/ledger";

const IMG_DIR =
  "/Users/user/Desktop/梦馨家纺网站/2026 产品图片/浴袍 bathrobe/素色浴袍 SOLID BATHROBE";
const EXCEL_PATH = "/Users/user/Desktop/梦馨家纺网站/2026 产品图片/产品汇总.xlsx";

const ORG_CODE = process.env.SMOKE_ORG_CODE || "sunny-home-deco";
const REAL_IMAGES = process.argv.includes("--real-images");
const EXISTING_JOB = (() => {
  const i = process.argv.indexOf("--job-id");
  return i >= 0 ? process.argv[i + 1] : null;
})();

function pickImages() {
  // 主图 / 细节 / 纹理（文件名中 -1/-2 多为细节视角）
  const primary = path.join(IMG_DIR, "MX-BR-S202601.jpg");
  const detail = path.join(IMG_DIR, "MX-BR-S202602-1.jpg");
  const texture = path.join(IMG_DIR, "MX-BR-S202603-1.jpg");
  for (const p of [primary, detail, texture]) {
    if (!fs.existsSync(p)) throw new Error(`缺少图片: ${p}`);
  }
  return { primary, detail, texture };
}

async function resolveOrgUser() {
  const org = await db.organization.findFirst({ where: { code: ORG_CODE } });
  if (!org) throw new Error(`组织不存在: ${ORG_CODE}`);
  const mem = await db.organizationMember.findFirst({
    where: { orgId: org.id, status: "active" },
    select: { userId: true },
  });
  if (!mem) throw new Error(`组织无活跃成员: ${ORG_CODE}`);
  return { orgId: org.id, userId: mem.userId, orgCode: org.code };
}

async function uploadLocalFile(opts: {
  orgId: string;
  jobId: string;
  localPath: string;
  role: string;
  subdir: string;
}) {
  const buf = fs.readFileSync(opts.localPath);
  const fileName = path.basename(opts.localPath).replace(/[^A-Za-z0-9._-]/g, "_");
  const pathname = `product-content/${opts.orgId}/${opts.jobId}/${opts.subdir}/${Date.now()}-${fileName}`;
  const mime = fileName.toLowerCase().endsWith(".png")
    ? "image/png"
    : fileName.toLowerCase().endsWith(".xlsx")
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "image/jpeg";
  await putPrivateBlob({ pathname, body: buf, contentType: mime });
  return { pathname, mime, fileName, bytes: buf.byteLength };
}

async function phaseNeedsInput(orgId: string, userId: string) {
  console.log("\n═══ Phase A: 验证 NEEDS_INPUT（不伪造缺字段）═══");
  const job = await createProductContentJob({
    orgId,
    userId,
    title: "梦馨素色浴袍 MX-BR-S202601 验收",
    executionMode: "AUTOPILOT",
    industryPack: "home_textile",
    selectedSku: "MX-BR-S202601",
  });
  await updateJobDocumentPurpose({
    orgId,
    userId,
    jobId: job.id,
    documentPurpose: "INTERNAL_DRAFT",
  });

  const images = pickImages();
  const primaryUp = await uploadLocalFile({
    orgId,
    jobId: job.id,
    localPath: images.primary,
    role: "primary",
    subdir: "01_Source",
  });
  await addJobInput({
    orgId,
    userId,
    jobId: job.id,
    inputType: "image",
    blobPathname: primaryUp.pathname,
    mimeType: primaryUp.mime,
    fileName: primaryUp.fileName,
    purpose: "primary",
  });

  if (fs.existsSync(EXCEL_PATH)) {
    const excelUp = await uploadLocalFile({
      orgId,
      jobId: job.id,
      localPath: EXCEL_PATH,
      role: "excel",
      subdir: "01_Source",
    });
    await addJobInput({
      orgId,
      userId,
      jobId: job.id,
      inputType: "excel",
      blobPathname: excelUp.pathname,
      mimeType: excelUp.mime,
      fileName: excelUp.fileName,
    });
  }

  // 仅写入资料中真实存在的字段，不补造材质/GSM/尺寸
  await addJobInput({
    orgId,
    userId,
    jobId: job.id,
    inputType: "text",
    textContent: [
      "产品名称: 素色浴袍",
      "SKU: MX-BR-S202601",
      "品类: bathrobe",
      "品牌: 梦馨家纺",
      "中文说明: 素色浴袍，OEM/ODM 出口款，具体材质克重尺寸以工厂规格书为准（当前资料未提供）。",
    ].join("\n"),
  });

  const analyzed = await analyzeJobInputs(orgId, job.id, userId);
  console.log("analyze status:", analyzed.status);
  console.log(
    "missing:",
    analyzed.missingFields?.map((f: { key: string }) => f.key) ?? analyzed,
  );

  const stopped = await runProductContentPipeline(orgId, job.id, userId, {
    dryRunVisuals: true,
    stopOnMissing: true,
  });
  console.log("stopOnMissing result:", stopped);
  if (stopped.status !== "NEEDS_INPUT") {
    throw new Error(`期望 NEEDS_INPUT，实际 ${stopped.status}`);
  }
  console.log("✅ Phase A 通过：缺字段正确进入 NEEDS_INPUT");
  return job.id;
}

async function phaseDryRunDraft(orgId: string, userId: string, jobId: string) {
  console.log("\n═══ Phase B: INTERNAL_DRAFT Dry Run 完整流水线 ═══");
  process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN = "1";
  process.env.PRODUCT_CONTENT_MULTIMODAL_QA = "0";

  const images = pickImages();
  for (const [role, localPath] of [
    ["detail", images.detail],
    ["texture", images.texture],
  ] as const) {
    const up = await uploadLocalFile({
      orgId,
      jobId,
      localPath,
      role,
      subdir: "01_Source",
    });
    await addJobInput({
      orgId,
      userId,
      jobId,
      inputType: "image",
      blobPathname: up.pathname,
      mimeType: up.mime,
      fileName: up.fileName,
      purpose: role,
    });
    console.log(`uploaded ${role}: ${up.bytes} bytes → ${up.pathname}`);
  }

  const result = await runProductContentPipeline(orgId, jobId, userId, {
    dryRunVisuals: true,
    allowDraftContinue: true,
  });
  console.log("pipeline result:", result);

  const detail = await getProductContentJobDetail(orgId, jobId, userId);
  const visualCount = detail.visualJobs?.length ?? 0;
  const outputCount =
    detail.visualJobs?.reduce(
      (n: number, v: { outputs: unknown[] }) => n + (v.outputs?.length ?? 0),
      0,
    ) ?? 0;
  const docs = detail.documents ?? [];
  const cost = await summarizeJobCost(orgId, jobId);

  console.log("status:", detail.status);
  console.log("visualJobs:", visualCount, "outputs:", outputCount);
  console.log(
    "docs:",
    docs.map((d: { docType: string; version: number }) => `${d.docType}@v${d.version}`),
  );
  console.log("cost:", cost);
  console.log(
    "missingFieldsJson:",
    detail.missingFieldsJson,
  );

  // 抽样验证 image-engine 元数据（dry-run 也应读到 bytes）
  for (const vj of detail.visualJobs ?? []) {
    for (const out of vj.outputs ?? []) {
      const meta = (out.metadata ?? {}) as Record<string, unknown>;
      console.log("visual meta:", {
        scene: vj.sceneType,
        mode: vj.mode,
        provider: out.provider,
        primaryBytes: meta.primaryBytes,
        referenceCount: meta.referenceCount,
        dryRun: meta.dryRun ?? meta.placeholder,
        qa: out.qaOverallScore,
      });
      if (!(Number(meta.primaryBytes) > 0)) {
        throw new Error(`场景 ${vj.sceneType} primaryBytes 未证明 > 0`);
      }
    }
  }

  if (detail.status !== "READY_FOR_REVIEW" && detail.status !== "AWAITING_APPROVAL") {
    throw new Error(`Dry Run 未到 READY_FOR_REVIEW，实际 ${detail.status}`);
  }
  if (outputCount < 4) {
    throw new Error(`期望 4 张视觉输出，实际 ${outputCount}`);
  }
  console.log("✅ Phase B 通过：Dry Run 草稿闭环");
  return detail;
}

async function phaseManualOps(orgId: string, userId: string, jobId: string) {
  console.log("\n═══ Phase C: 人工审核动作（事实/锁定/文案）═══");
  const detail = await getProductContentJobDetail(orgId, jobId, userId);
  const facts = detail.facts ?? [];
  const skuFact = facts.find((f: { fieldKey: string }) => f.fieldKey === "sku");
  const nameFact = facts.find((f: { fieldKey: string }) => f.fieldKey === "product_name");

  if (skuFact) {
    await confirmProductFact({ orgId, userId, factId: skuFact.id });
    await lockProductFact({ orgId, userId, factId: skuFact.id });
    console.log("locked sku fact:", skuFact.id);
  }
  if (nameFact) {
    await confirmProductFact({ orgId, userId, factId: nameFact.id });
    console.log("confirmed product_name:", nameFact.id);
  }

  // 故意写入冲突：同字段不同值
  await upsertProductFactsFromExtraction({
    orgId,
    jobId,
    userId,
    facts: [
      {
        fieldKey: "sku",
        value: "MX-BR-S202601-CONFLICT",
        sourceType: "ai_inference",
        confidence: 0.2,
      },
    ],
  });

  const after = await getProductContentJobDetail(orgId, jobId, userId);
  const lockedSku = (after.facts ?? []).find(
    (f: { fieldKey: string; locked: boolean }) => f.fieldKey === "sku" && f.locked,
  );
  if (!lockedSku || String(lockedSku.value).includes("CONFLICT")) {
    // locked 行应仍保留原值
    const skuValues = (after.facts ?? [])
      .filter((f: { fieldKey: string }) => f.fieldKey === "sku")
      .map((f: { value: unknown; locked: boolean; status: string }) => ({
        value: f.value,
        locked: f.locked,
        status: f.status,
      }));
    console.log("sku facts after conflict inject:", skuValues);
    const locked = skuValues.find((x) => x.locked);
    if (!locked || String(locked.value).includes("CONFLICT")) {
      throw new Error("锁定事实被覆盖");
    }
  }
  console.log("✅ Phase C 通过：锁定不被 AI 推断覆盖");
}

async function phaseRealImages(orgId: string, userId: string, jobId: string) {
  console.log("\n═══ Phase D: 真实出图（4 张）═══");
  process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN = "0";
  process.env.PRODUCT_CONTENT_IMAGE_GENERATE_ENABLED = "1";
  process.env.PRODUCT_CONTENT_MULTIMODAL_QA = "1";

  // 重置视觉相关：通过 REVISION → GENERATING 路径较复杂；直接再跑 pipeline
  // 先把 job 拉回可重跑状态
  const job = await db.productContentJob.findFirst({ where: { id: jobId, orgId } });
  if (!job) throw new Error("job missing");

  if (job.status === "READY_FOR_REVIEW" || job.status === "NEEDS_INPUT") {
    // READY_FOR_REVIEW 允许 GENERATING_VISUALS
  }

  const { createVisualsForJob } = await import(
    "../src/lib/product-content/jobs/runtime"
  );
  const { generateExecutionPlan, setJobStatus } = await import(
    "../src/lib/product-content/jobs/service"
  );

  // 清掉 dry-run 占位视觉，避免场景被跳过或混入正式包
  await db.visualQaResult.deleteMany({
    where: { orgId, visualOutput: { visualJob: { jobId } } },
  });
  await db.visualOutput.deleteMany({
    where: { orgId, visualJob: { jobId } },
  });
  await db.visualGenerationJob.deleteMany({ where: { orgId, jobId } });

  const { plan } = await generateExecutionPlan({ orgId, jobId, userId });
  const cur = await db.productContentJob.findFirst({ where: { id: jobId } });
  if (cur?.status === "NEEDS_INPUT") {
    await setJobStatus({ orgId, userId, jobId, status: "PLAN_READY" });
  } else if (cur?.status === "READY_FOR_REVIEW") {
    // READY_FOR_REVIEW → GENERATING_VISUALS 合法
  }
  await setJobStatus({ orgId, userId, jobId, status: "GENERATING_VISUALS" });

  const t0 = Date.now();
  const outputs = await createVisualsForJob({
    orgId,
    jobId,
    userId,
    plan,
    dryRunVisuals: false,
  });
  const elapsed = Date.now() - t0;
  console.log("real visual outputs:", outputs, "elapsedMs:", elapsed);

  const detail = await getProductContentJobDetail(orgId, jobId, userId);
  for (const vj of detail.visualJobs ?? []) {
    for (const out of vj.outputs ?? []) {
      const meta = (out.metadata ?? {}) as Record<string, unknown>;
      console.log({
        scene: vj.sceneType,
        status: out.status,
        provider: out.provider,
        model: out.model,
        blob: out.blobPathname,
        primaryBytes: meta.primaryBytes,
        referenceCount: meta.referenceCount,
        latencyMs: meta.latencyMs,
        estimatedCostCents: meta.estimatedCostCents,
        qaScore: out.qaOverallScore,
        qaStatus: out.qaResult?.recommendedStatus,
        changes: out.qaResult?.detectedChangesJson,
      });
    }
  }

  const cost = await summarizeJobCost(orgId, jobId);
  console.log("cost after real images:", cost);

  // 生成内部草稿文档（基于当前 live 数据）
  await generateProductDocuments(orgId, jobId, userId, {
    purpose: "INTERNAL_DRAFT",
  });

  console.log("✅ Phase D 完成（请人工在 /product-content/" + jobId + " 审核）");
  return detail;
}

async function main() {
  console.log("REAL_IMAGES=", REAL_IMAGES, "ORG=", ORG_CODE);
  const { orgId, userId } = await resolveOrgUser();
  console.log({ orgId, userId });

  let jobId = EXISTING_JOB;
  if (!jobId) {
    jobId = await phaseNeedsInput(orgId, userId);
    await phaseDryRunDraft(orgId, userId, jobId);
    await phaseManualOps(orgId, userId, jobId);
  } else {
    console.log("复用 job:", jobId);
  }

  if (REAL_IMAGES) {
    await phaseRealImages(orgId, userId, jobId);
  } else {
    console.log("\n（未传 --real-images，跳过真实出图）");
  }

  console.log("\n════════════════════════════════");
  console.log("验收 Job ID:", jobId);
  console.log(`审核页: /product-content/${jobId}`);
  console.log("════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ E2E 失败:", err);
    process.exit(1);
  });
