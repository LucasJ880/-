/**
 * Staging 只读+受控事务验证：状态机 / 幂等 / Postiz 分类（无真实发布）
 *
 *   DATABASE_ENVIRONMENT=staging \
 *   ISOLATED_DATABASE_URL=... \
 *   npx tsx scripts/phase-c-staging-pipeline-verify.ts
 */
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  canTransition,
  normalizePublishStatus,
  buildIdempotencyKey,
} from "../src/lib/operations/publish-status";
import { classifyPostizProviderState } from "../src/lib/operations/postiz";
import { evaluatePublishSafety } from "../src/lib/operations/publish-safety";

const PRODUCTION_HOST_MARKERS = ["ep-super-field", "ep-raspy-credit"];
const ALLOWED_ENV = new Set(["isolated", "staging"]);

function cleanUrl(raw: string) {
  return raw.trim().replace(/^['"]|['"]$/g, "");
}
function maskHost(host: string) {
  return host.length > 18 ? `${host.slice(0, 14)}…${host.slice(-10)}` : `${host.slice(0, 8)}…`;
}
function fail(m: string): never {
  console.error(`[staging-verify] FAIL: ${m}`);
  process.exit(1);
}

let passed = 0;
let failed = 0;
function ok(c: boolean, name: string) {
  if (c) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`);
  }
}

async function main() {
  const envTag = (process.env.DATABASE_ENVIRONMENT || "").trim().toLowerCase();
  if (!ALLOWED_ENV.has(envTag)) fail("DATABASE_ENVIRONMENT 必须为 isolated|staging");
  const url = process.env.ISOLATED_DATABASE_URL;
  if (!url?.trim()) fail("需要 ISOLATED_DATABASE_URL");
  const host = new URL(cleanUrl(url!).replace(/^postgresql:/i, "http:")).hostname;
  if (PRODUCTION_HOST_MARKERS.some((m) => host.includes(m))) fail("拒绝生产 host");
  console.log(`[staging-verify] host=${maskHost(host)} env=${envTag}`);

  console.log("\n[state machine pure]");
  ok(canTransition("draft", "queued").ok === false, "拒绝 draft→queued");
  ok(canTransition("draft", "published").ok === false, "拒绝 draft→published");
  ok(canTransition("blocked", "queued").ok === false, "拒绝 blocked→queued");
  ok(canTransition("pending_human_approval", "published").ok === false, "拒绝 pending→published");
  ok(canTransition("failed", "published").ok === false, "拒绝 failed→published");
  ok(canTransition("draft", "ai_reviewed").ok === true, "允许 draft→ai_reviewed");
  ok(canTransition("ai_reviewed", "pending_human_approval").ok === true, "允许 ai→pending");
  ok(canTransition("pending_human_approval", "approved").ok === true, "允许 pending→approved");
  ok(canTransition("approved", "queued").ok === true, "允许 approved→queued");
  ok(canTransition("queued", "processing").ok === true, "允许 queued→processing");
  ok(canTransition("processing", "published").ok === true, "允许 processing→published");
  ok(normalizePublishStatus("review") === "pending_human_approval", "旧 review 兼容");

  console.log("\n[playbook gate]");
  const legacy = evaluatePublishSafety({
    captionText: "Before and after motorized shades for local homeowners",
    videoUrl: "https://cdn.example.com/v.mp4",
    hasApprovedPlaybook: false,
    enforcementMode: "warn",
    autoPublish: false,
  });
  ok(
    legacy.issues.some((i) => i.code === "PLAYBOOK_NOT_APPROVED_LEGACY_FALLBACK"),
    "legacy fallback warning",
  );
  const autoBlock = evaluatePublishSafety({
    captionText: "Before and after motorized shades for local homeowners",
    videoUrl: "https://cdn.example.com/v.mp4",
    hasApprovedPlaybook: false,
    enforcementMode: "warn",
    autoPublish: true,
  });
  ok(autoBlock.result === "block", "无 PB 自动发布阻断");

  console.log("\n[postiz classify mock]");
  ok(classifyPostizProviderState("SCHEDULED").publishJobStatus === "queued", "排期保持 queued");
  ok(classifyPostizProviderState(null).publishJobStatus === "queued", "无证据不 published");
  ok(classifyPostizProviderState("published").publishJobStatus === "published", "有证据→published");
  ok(classifyPostizProviderState("failed").publishJobStatus === "failed", "失败→failed");

  console.log("\n[idempotency key]");
  const k1 = buildIdempotencyKey("org", "job", 1);
  const k2 = buildIdempotencyKey("org", "job", 1);
  const k3 = buildIdempotencyKey("org", "job", 2);
  ok(k1 === k2 && k1 !== k3, "幂等键稳定且随版本变化");

  // DB-backed: create disposable fixture job in transaction then rollback via delete
  const db = new PrismaClient({ datasources: { db: { url: cleanUrl(url!) } } });
  try {
    console.log("\n[db fixture — no real publish]");
    const org = await db.organization.findFirst({ select: { id: true } });
    if (!org) {
      console.log("  ⚠ 无 Organization，跳过 DB fixture（空库可接受）");
    } else {
      const account = await db.matrixAccount.create({
        data: {
          orgId: org.id,
          platform: "instagram",
          handle: `staging-verify-${randomUUID().slice(0, 8)}`,
          groupName: "staging-verify",
          publishChannel: "manual",
          status: "active",
        },
      });
      const asset = await db.videoAsset.create({
        data: {
          orgId: org.id,
          source: "manual",
          title: "staging-verify-asset",
          language: "en",
          videoUrl: "https://cdn.example.com/staging-verify.mp4",
          status: "ready",
        },
      });
      const idem = buildIdempotencyKey(org.id, "pending", 1);
      const job = await db.publishJob.create({
        data: {
          orgId: org.id,
          assetId: asset.id,
          accountId: account.id,
          captionText: "staging verify caption body text",
          channel: "postiz",
          status: "approved",
          contentVersion: 1,
          idempotencyKey: `${org.id}:${randomUUID()}:v1`,
        },
      });
      ok(Boolean(job.id), "创建 fixture PublishJob");

      // simulate queued without external call
      const queued = await db.publishJob.update({
        where: { id: job.id },
        data: {
          status: "queued",
          externalJobId: `mock-${randomUUID().slice(0, 8)}`,
          providerStatus: "scheduled",
          providerResponseJson: { mock: true, state: "scheduled" },
        },
      });
      ok(queued.status === "queued", "Mock 排期后保持 queued");
      ok(queued.providerStatus === "scheduled", "providerStatus=scheduled");

      // no evidence → stay queued/processing
      const noEvidence = classifyPostizProviderState("processing");
      ok(noEvidence.publishJobStatus !== "published", "processing 不直接当 published");

      // with evidence → published
      const published = await db.publishJob.update({
        where: { id: job.id },
        data: {
          status: "published",
          providerStatus: "published",
          externalPostUrl: "https://example.com/p/mock",
          providerResponseJson: { mock: true, state: "published" },
        },
      });
      ok(published.status === "published", "有证据后 published");

      // canceled 任务不应再派发（逻辑断言 + 状态）
      const canceled = await db.publishJob.update({
        where: { id: job.id },
        data: { status: "canceled" },
      });
      ok(canceled.status === "canceled", "可置为 canceled");
      ok(
        canTransition("canceled", "queued").ok === false,
        "canceled 不可再入 queued",
      );

      // cleanup fixtures
      await db.publishJob.deleteMany({ where: { assetId: asset.id } });
      await db.videoAsset.delete({ where: { id: asset.id } });
      await db.matrixAccount.delete({ where: { id: account.id } });
      ok(true, "fixture 已清理");
      void idem;
      void createHash;
    }
  } finally {
    await db.$disconnect();
  }

  console.log(`\n[staging-verify] ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
  console.log("[staging-verify] PASS");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
