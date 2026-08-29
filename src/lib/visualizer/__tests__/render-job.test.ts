/**
 * HD 渲染异步任务状态纯函数测试
 * 运行：npx tsx src/lib/visualizer/__tests__/render-job.test.ts
 */

import assert from "node:assert/strict";
import {
  RENDER_JOB_STALE_MS,
  isRenderJobActive,
  normalizeRenderTier,
  renderTierToImageQuality,
  summarizeRenderJob,
} from "../render-job";

const now = Date.parse("2026-08-29T12:00:00Z");

// ── 档位归一化与质量映射 ──
assert.equal(normalizeRenderTier("fine"), "fine");
assert.equal(normalizeRenderTier("fast"), "fast");
assert.equal(normalizeRenderTier(undefined), "fast", "缺省走快速档");
assert.equal(normalizeRenderTier("high"), "fast", "非法值收敛到快速档");
assert.equal(renderTierToImageQuality("fast"), "medium");
assert.equal(renderTierToImageQuality("fine"), "high");

// ── 活跃判定 ──
const fresh = new Date(now - 60_000);
const stale = new Date(now - RENDER_JOB_STALE_MS - 1);
assert.equal(isRenderJobActive("rendering", fresh, now), true, "1 分钟内 rendering 活跃");
assert.equal(isRenderJobActive("rendering", stale, now), false, "陈旧 rendering 不活跃（可重试）");
assert.equal(isRenderJobActive("rendering", null, now), false, "无 startedAt 不算活跃");
assert.equal(isRenderJobActive("done", fresh, now), false);
assert.equal(isRenderJobActive("failed", fresh, now), false);
assert.equal(isRenderJobActive(null, fresh, now), false);

// ── 轮询快照：陈旧 rendering 对外归一为 failed ──
const staleSummary = summarizeRenderJob(
  {
    renderJobStatus: "rendering",
    renderJobQuality: "fast",
    renderJobError: null,
    renderJobStartedAt: stale,
  },
  now,
);
assert.equal(staleSummary.status, "failed");
assert.equal(staleSummary.stale, true);
assert.ok(staleSummary.error && staleSummary.error.includes("重试"));

const activeSummary = summarizeRenderJob(
  {
    renderJobStatus: "rendering",
    renderJobQuality: "fine",
    renderJobError: null,
    renderJobStartedAt: fresh,
  },
  now,
);
assert.equal(activeSummary.status, "rendering");
assert.equal(activeSummary.tier, "fine");
assert.equal(activeSummary.stale, false);

const doneSummary = summarizeRenderJob(
  {
    renderJobStatus: "done",
    renderJobQuality: "fast",
    renderJobError: null,
    renderJobStartedAt: fresh,
  },
  now,
);
assert.equal(doneSummary.status, "done");

const idleSummary = summarizeRenderJob(
  {
    renderJobStatus: null,
    renderJobQuality: null,
    renderJobError: null,
    renderJobStartedAt: null,
  },
  now,
);
assert.equal(idleSummary.status, null);

console.log("Visualizer render job state tests passed");
