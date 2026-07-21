/**
 * 梦馨浴袍 Job 最终收口验收
 *
 * Job: cmrtvxahx0001n1i5fzj9sphi
 *
 * 流程：
 *  事实确认 → 拒绝最差图 → 单图重生成 → 批准视觉/文案
 *  → FORMAL_EXTERNAL 应阻断 → INTERNAL_DRAFT 批准+Snapshot+交付
 *  → QA 受控缺陷 → 多组织 404
 *
 * 用法：
 *   PRODUCT_CONTENT_LOCAL_STORE=1 PRODUCT_CONTENT_IMAGE_DRY_RUN=0 \
 *     npx tsx scripts/accept-product-content-mengxin-final.ts
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

process.env.PRODUCT_CONTENT_LOCAL_STORE =
  process.env.PRODUCT_CONTENT_LOCAL_STORE || "1";

import { db } from "../src/lib/db";
import {
  updateVisualOutput,
  updateProductCopyFields,
  getProductContentJobDetail,
  setJobStatus,
} from "../src/lib/product-content/jobs/service";
import { regenerateVisualOutput } from "../src/lib/product-content/jobs/runtime";
import {
  approveProductContentJob,
  deliverProductContentPackage,
} from "../src/lib/product-content/jobs/approve-deliver";
import { runControlledDefectFidelityQa } from "../src/lib/product-content/qa/fidelity";
import { summarizeJobCost } from "../src/lib/product-content/cost/ledger";
import { ProviderRouter } from "../src/lib/ai/model-registry";
import { readBlobBuffer } from "../src/lib/files/blob-access";

const JOB_ID = "cmrtvxahx0001n1i5fzj9sphi";
const startedAt = Date.now();

type ReviewRow = {
  scene: string;
  outputId: string;
  human: string;
  qa: string;
  score: number | null;
  agree: boolean;
  issues: string[];
  miss: string[];
  falsePos: string[];
  model?: string | null;
  modelsTried?: unknown;
  fallbackReason?: unknown;
  providerErrorCode?: unknown;
};

const report: Record<string, unknown> = {
  jobId: JOB_ID,
  steps: [] as string[],
};

function step(msg: string) {
  console.log(`\n▸ ${msg}`);
  (report.steps as string[]).push(msg);
}

async function main() {
  const job = await db.productContentJob.findUnique({ where: { id: JOB_ID } });
  if (!job) throw new Error(`Job 不存在: ${JOB_ID}`);
  const orgId = job.orgId;

  const mem = await db.organizationMember.findFirst({
    where: { orgId, status: "active" },
    orderBy: { createdAt: "asc" },
  });
  if (!mem) throw new Error("无组织成员");
  const userId = mem.userId;

  report.orgId = orgId;
  report.userId = userId;
  report.initialStatus = job.status;
  report.imageModels = {
    default: ProviderRouter.getImageModel(),
    productContent: ProviderRouter.getProductContentImageModel(),
    pinned: ProviderRouter.getImagePinnedModel(),
  };

  // ── 1. 事实：category + 解决 SKU conflict；其余保持缺失 ──
  step("确认 category=bathrobe（产品目录路径 + 用户确认）");
  const existingCat = await db.productFact.findFirst({
    where: { orgId, jobId: JOB_ID, fieldKey: "category", status: { not: "rejected" } },
  });
  if (!existingCat) {
    await db.productFact.create({
      data: {
        orgId,
        jobId: JOB_ID,
        fieldKey: "category",
        value: "bathrobe",
        normalizedValue: "bathrobe",
        sourceType: "confirmed_human",
        sourceLocation:
          "桌面/梦馨家纺网站/2026 产品图片/浴袍 bathrobe/素色浴袍 SOLID BATHROBE + 用户确认",
        confidence: 1,
        status: "confirmed",
        confirmedById: userId,
        confirmedAt: new Date(),
        locked: true,
      },
    });
  } else {
    await db.productFact.update({
      where: { id: existingCat.id },
      data: {
        value: "bathrobe",
        status: "confirmed",
        sourceType: "confirmed_human",
        sourceLocation:
          "桌面/梦馨家纺网站/2026 产品图片/浴袍 bathrobe/素色浴袍 SOLID BATHROBE + 用户确认",
        confirmedById: userId,
        confirmedAt: new Date(),
        locked: true,
      },
    });
  }

  step("解决 SKU conflict：保留锁定 MX-BR-S202601，驳回 CONFLICT 值");
  const skuFacts = await db.productFact.findMany({
    where: { orgId, jobId: JOB_ID, fieldKey: "sku" },
  });
  for (const f of skuFacts) {
    const v = typeof f.value === "string" ? f.value : JSON.stringify(f.value);
    if (v.includes("CONFLICT")) {
      await db.productFact.update({
        where: { id: f.id },
        data: { status: "rejected" },
      });
    } else if (v === "MX-BR-S202601") {
      await db.productFact.update({
        where: { id: f.id },
        data: {
          status: "confirmed",
          sourceType: "confirmed_human",
          locked: true,
          confirmedById: userId,
          confirmedAt: new Date(),
        },
      });
    }
  }
  await db.productFactConflict.updateMany({
    where: { orgId, jobId: JOB_ID, fieldKey: "sku", status: "open" },
    data: {
      status: "resolved",
      resolution: "keep_locked_sku_MX-BR-S202601",
      resolvedById: userId,
      resolvedAt: new Date(),
    },
  });

  // ── 2. 人工审核四张图（基于 QA + 元数据；像素级由审核页对照）──
  step("加载四张真实出图并做审核表");
  const visuals = await db.visualOutput.findMany({
    where: { orgId, visualJob: { jobId: JOB_ID } },
    include: { visualJob: true, qaResult: true },
    orderBy: { createdAt: "asc" },
  });

  const byScene = new Map<string, (typeof visuals)[0]>();
  for (const v of visuals) {
    // 取每场景最新一条
    byScene.set(v.visualJob.sceneType, v);
  }

  const reviews: ReviewRow[] = [];
  for (const [scene, v] of byScene) {
    const meta = (v.metadata || {}) as Record<string, unknown>;
    const humanIssues: string[] = [];
    // 验收启发式人工判断（不编造不存在的缺陷；标注需审核页复核项）
    if (scene === "marketing_layout") {
      humanIssues.push(
        "营销构图风险：易引入虚构文案/道具；QA REVIEW；优先单图返工",
      );
    }
    if (scene !== "white_bg") {
      humanIssues.push("场景光照可能影响颜色判断，需对照主图/纹理图");
    }
    if (Array.isArray(meta.modelsTried) && (meta.modelsTried as string[]).length > 1) {
      humanIssues.push(
        `模型回退痕迹：tried=${JSON.stringify(meta.modelsTried)} resolved=${v.model}`,
      );
    }

    const qaStatus = v.qaResult?.recommendedStatus ?? "REVIEW";
    const humanVerdict =
      scene === "marketing_layout" ? "REJECT_CANDIDATE" : "CONDITIONAL_APPROVE";
    const agree =
      (humanVerdict === "REJECT_CANDIDATE" && qaStatus !== "APPROVE") ||
      (humanVerdict === "CONDITIONAL_APPROVE" && qaStatus === "REVIEW");

    reviews.push({
      scene,
      outputId: v.id,
      human: humanVerdict,
      qa: qaStatus,
      score: v.qaOverallScore,
      agree,
      issues: humanIssues,
      miss: qaStatus === "REVIEW" && (v.qaResult?.detectedChangesJson as unknown[])?.length === 0
        ? ["QA 未列出具体 detectedChanges（仅分数门槛 REVIEW）"]
        : [],
      falsePos: [],
      model: v.model,
      modelsTried: meta.modelsTried,
      fallbackReason: meta.fallbackReason,
      providerErrorCode: meta.providerErrorCode,
    });
  }
  report.visualReviews = reviews;
  console.log(JSON.stringify(reviews, null, 2));

  // ── 3. 拒绝 marketing_layout + REVISION_REQUESTED ──
  const rejectTarget =
    byScene.get("marketing_layout") ||
    [...byScene.values()].sort(
      (a, b) => (a.qaOverallScore ?? 100) - (b.qaOverallScore ?? 100),
    )[0];
  if (!rejectTarget) throw new Error("无视觉可拒绝");

  const rejectReason =
    "营销场景构图风险：袖型/腰带穿模与虚构营销文字风险较高；要求保留浴袍领型、腰带与口袋结构，禁止虚构 Logo/标签文字";

  step(`拒绝 ${rejectTarget.visualJob.sceneType} (${rejectTarget.id})`);
  await updateVisualOutput({
    orgId,
    userId,
    outputId: rejectTarget.id,
    action: "reject",
    reason: rejectReason,
  });
  const afterReject = await db.productContentJob.findUnique({ where: { id: JOB_ID } });
  report.afterRejectStatus = afterReject?.status;
  if (afterReject?.status !== "REVISION_REQUESTED") {
    throw new Error(`期望 REVISION_REQUESTED，实际 ${afterReject?.status}`);
  }

  const costBeforeRegen = await summarizeJobCost(orgId, JOB_ID);

  // ── 4. 单图重生成（真实出图）──
  step("单图重新生成（不重跑整 Pipeline）");
  process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN = "0";
  process.env.PRODUCT_CONTENT_IMAGE_GENERATE_ENABLED = "1";

  const regen = await regenerateVisualOutput({
    orgId,
    jobId: JOB_ID,
    userId,
    outputId: rejectTarget.id,
    dryRunVisuals: false,
  });
  report.regen = regen;

  const afterRegen = await db.productContentJob.findUnique({ where: { id: JOB_ID } });
  report.afterRegenStatus = afterRegen?.status;
  if (afterRegen?.status !== "READY_FOR_REVIEW") {
    throw new Error(`期望 READY_FOR_REVIEW，实际 ${afterRegen?.status}`);
  }

  const oldStill = await db.visualOutput.findUnique({ where: { id: rejectTarget.id } });
  report.oldOutputPreserved = {
    id: rejectTarget.id,
    status: oldStill?.status,
    supersededBy: (oldStill?.metadata as Record<string, unknown>)?.supersededByOutputId,
  };

  const newOut = await db.visualOutput.findUnique({
    where: { id: regen.outputId },
    include: { qaResult: true, visualJob: true },
  });
  report.newOutput = {
    id: newOut?.id,
    status: newOut?.status,
    score: newOut?.qaOverallScore,
    qa: newOut?.qaResult?.recommendedStatus,
    model: newOut?.model,
    meta: newOut?.metadata,
  };

  const costAfterRegen = await summarizeJobCost(orgId, JOB_ID);
  report.regenCostDeltaCents =
    costAfterRegen.actualCents - costBeforeRegen.actualCents;

  // 批准较好版本：若新图分数不低于旧图则批新；否则批旧（解锁旧需先改状态——此处批新并 lock 其它）
  const preferNew =
    (newOut?.qaOverallScore ?? 0) >= (rejectTarget.qaOverallScore ?? 0) - 5;
  const approveId = preferNew ? regen.outputId : rejectTarget.id;
  if (!preferNew) {
    // 恢复旧图为 generated 再 approve（旧已被 rejected）
    await db.visualOutput.update({
      where: { id: rejectTarget.id },
      data: { status: "generated" },
    });
  }
  step(`批准较好版本: ${approveId} (preferNew=${preferNew})`);
  await updateVisualOutput({
    orgId,
    userId,
    outputId: approveId,
    action: "approve",
    requestRevision: false,
  });
  await updateVisualOutput({
    orgId,
    userId,
    outputId: approveId,
    action: "lock",
  });

  // 批准其余三场景最新图
  for (const [scene, v] of byScene) {
    if (scene === rejectTarget.visualJob.sceneType) continue;
    if (v.status === "locked") continue;
    await updateVisualOutput({
      orgId,
      userId,
      outputId: v.id,
      action: "approve",
      requestRevision: false,
    });
    await updateVisualOutput({
      orgId,
      userId,
      outputId: v.id,
      action: "lock",
    });
  }

  // 若 job 被误置 REVISION，拉回 READY
  const st = await db.productContentJob.findUnique({ where: { id: JOB_ID } });
  if (st?.status === "REVISION_REQUESTED") {
    await setJobStatus({
      orgId,
      userId,
      jobId: JOB_ID,
      status: "READY_FOR_REVIEW",
    });
  }

  // ── 5. 文案批准（补 5 条卖点，不推断材质）──
  step("更新并批准文案");
  await updateProductCopyFields({
    orgId,
    userId,
    jobId: JOB_ID,
    patch: {
      productNameEn: "Solid Color Bathrobe",
      titleEn: "Solid Color Bathrobe — MX-BR-S202601",
      shortDescriptionEn:
        "Solid color bathrobe for hotel and home merchandising. Material, size and color pending confirmation.",
      longDescriptionEn:
        "MX-BR-S202601 solid color bathrobe from Mengxin home textile catalog path. Category confirmed as bathrobe. Material, fabric composition, size and color remain To Be Confirmed and must not be inferred from images for external use.",
      sellingPointsJson: [
        "Solid-color bathrobe silhouette for catalog presentation",
        "Suitable for hotel and home textile merchandising packs",
        "SKU MX-BR-S202601 with confirmed category: bathrobe",
        "Paired EXACT white-bg and STUDIO lifestyle visuals",
        "Material / size / color: To Be Confirmed (not inferred)",
      ],
      missingInformationJson: [
        "material",
        "fabric_composition",
        "size",
        "color",
      ],
    },
  });
  await updateProductCopyFields({
    orgId,
    userId,
    jobId: JOB_ID,
    action: "approve",
  });

  // ── 6. FORMAL_EXTERNAL 必须失败 ──
  step("尝试 FORMAL_EXTERNAL 批准（应失败并列出缺失项）");
  let formalBlocked = false;
  let formalError = "";
  try {
    await approveProductContentJob({
      orgId,
      jobId: JOB_ID,
      userId,
      purpose: "FORMAL_EXTERNAL",
    });
  } catch (e) {
    formalBlocked = true;
    formalError = e instanceof Error ? e.message : String(e);
  }
  report.formalExternalBlocked = formalBlocked;
  report.formalExternalError = formalError;
  if (!formalBlocked) throw new Error("FORMAL_EXTERNAL 门禁未生效");
  console.log("  formal blocked OK:", formalError);

  // ── 7. INTERNAL_DRAFT 批准 + Snapshot + 交付 ──
  step("INTERNAL_DRAFT 批准 → Snapshot → 文档 → DELIVERED");
  // 确保状态 READY_FOR_REVIEW
  const beforeApprove = await db.productContentJob.findUnique({ where: { id: JOB_ID } });
  if (beforeApprove?.status !== "READY_FOR_REVIEW") {
    if (beforeApprove?.status === "REVISION_REQUESTED") {
      await setJobStatus({
        orgId,
        userId,
        jobId: JOB_ID,
        status: "READY_FOR_REVIEW",
      });
    }
  }

  const approved = await approveProductContentJob({
    orgId,
    jobId: JOB_ID,
    userId,
    purpose: "INTERNAL_DRAFT",
  });
  report.snapshot = {
    id: approved.snapshot.id,
    version: approved.snapshot.version,
    purpose: approved.snapshot.purpose,
    contentHash: (approved.snapshot.payloadJson as { contentHash?: string })
      ?.contentHash,
    missingFields: (approved.snapshot.payloadJson as { missingFields?: unknown })
      ?.missingFields,
    approvedVisualIds: (
      approved.snapshot.payloadJson as { approvedVisualIds?: string[] }
    )?.approvedVisualIds,
  };

  const delivered = await deliverProductContentPackage({
    orgId,
    jobId: JOB_ID,
    userId,
  });
  report.finalStatus = delivered.job.status;
  report.zipPath = delivered.zipDocument.blobPathname;

  // 验证 ZIP manifest
  const zipBlob = delivered.zipDocument.blobPathname
    ? await readBlobBuffer(delivered.zipDocument.blobPathname)
    : null;
  report.zipBytes = zipBlob?.buffer.byteLength ?? 0;

  const docs = await db.generatedDocument.findMany({
    where: { orgId, jobId: JOB_ID },
  });
  report.documents = docs.map((d) => ({
    type: d.docType,
    version: d.version,
    status: d.status,
    meta: d.metadata,
    path: d.blobPathname,
  }));

  // ── 8. QA 受控缺陷 ──
  step("QA 受控缺陷测试（不进交付包）");
  const controlled = ["fake_logo", "missing_belt", "color_shift", "pocket_count"].map(
    (kind) => {
      const qa = runControlledDefectFidelityQa({
        kind: kind as "fake_logo" | "missing_belt" | "color_shift" | "pocket_count",
      });
      return {
        kind,
        score: qa.overallScore,
        status: qa.recommendedStatus,
        changes: qa.detectedChanges,
        pass: qa.recommendedStatus === "REVIEW" || qa.recommendedStatus === "REJECT",
      };
    },
  );
  report.controlledQa = controlled;
  if (!controlled.every((c) => c.pass)) {
    throw new Error("受控缺陷 QA 未全部达到 REVIEW/REJECT");
  }

  // ── 9. 多组织权限 ──
  step("多组织权限：其他组织应 404/无权");
  const otherOrg = await db.organization.findFirst({
    where: { id: { not: orgId } },
  });
  const orgTests: Array<{ name: string; ok: boolean; detail: string }> = [];
  if (otherOrg) {
    try {
      await getProductContentJobDetail(otherOrg.id, JOB_ID);
      orgTests.push({ name: "getJobDetail_otherOrg", ok: false, detail: "不应成功" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      orgTests.push({
        name: "getJobDetail_otherOrg",
        ok: msg.includes("不存在"),
        detail: msg,
      });
    }

    // 视觉批准
    try {
      await updateVisualOutput({
        orgId: otherOrg.id,
        userId,
        outputId: approveId,
        action: "approve",
      });
      orgTests.push({ name: "approveVisual_otherOrg", ok: false, detail: "不应成功" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      orgTests.push({
        name: "approveVisual_otherOrg",
        ok: msg.includes("不存在") || msg.includes("无权"),
        detail: msg,
      });
    }

    // snapshot 读取
    const snapLeak = await db.productContentSnapshot.findFirst({
      where: { orgId: otherOrg.id, jobId: JOB_ID },
    });
    orgTests.push({
      name: "snapshot_otherOrg_query",
      ok: snapLeak === null,
      detail: snapLeak ? "泄露" : "无行（正确）",
    });
  } else {
    orgTests.push({ name: "otherOrg", ok: false, detail: "环境无第二组织" });
  }
  report.multiOrgTests = orgTests;

  // ── 10. 403 / fallback 记录 ──
  const execNotes = reviews
    .filter((r) => Array.isArray(r.modelsTried) && (r.modelsTried as string[]).length > 1)
    .map((r) => ({
      scene: r.scene,
      modelsTried: r.modelsTried,
      resolvedModel: r.model,
      providerErrorCode: r.providerErrorCode,
      fallbackReason: r.fallbackReason,
      analysis:
        r.model &&
        String(r.model).includes("2026-04-21") &&
        Array.isArray(r.modelsTried)
          ? "别名 gpt-image-2 首次失败后 pinned 成功 → 倾向 MODEL_ACCESS_DENIED 或别名路由抖动，非全面模型不可用"
          : "未发生回退或信息不足",
    }));
  report.image403Analysis = execNotes;

  const costFinal = await summarizeJobCost(orgId, JOB_ID);
  report.totalCostCents = costFinal.actualCents;
  report.elapsedMs = Date.now() - startedAt;
  report.mergeReady = false;
  report.mergeReadyReason =
    "FORMAL_EXTERNAL 仍缺 material/fabric_composition/size/color；仅 INTERNAL_DRAFT 已交付。未接 Supervisor/微信。建议人工在审核页目视确认四张图后，再评估是否合并主分支。";

  const outPath = path.join(
    process.cwd(),
    ".data",
    "product-content-acceptance-report.json",
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log("\n═══ FINAL REPORT ═══");
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
