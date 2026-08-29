/**
 * HD 渲染异步任务 — 状态与档位的纯函数层
 *
 * 渲染耗时 1–2 分钟，改为「请求即返回 + after() 后置执行 + 客户端轮询」：
 * - 弱网/切页/锁屏不再导致整次渲染作废（此前是一根同步长连接）
 * - 状态落在 VisualizerVariant.renderJob* 列，刷新页面可续看
 * - 陈旧检测兜底 after() 被部署/超时打断的情况（无 checkpoint，直接可重试）
 */

export type RenderJobStatus = "rendering" | "done" | "failed";

/** 渲染档位：fast=快速预览（medium 质量），fine=精修（high 质量，发客户前用） */
export type RenderTier = "fast" | "fine";

/** 超过该时长仍是 rendering 视为已中断（Vercel maxDuration 300s + 余量） */
export const RENDER_JOB_STALE_MS = 6 * 60 * 1000;

export function normalizeRenderTier(raw: unknown): RenderTier {
  return raw === "fine" ? "fine" : "fast";
}

/** 档位 → OpenAI images/edits quality 参数 */
export function renderTierToImageQuality(tier: RenderTier): "medium" | "high" {
  return tier === "fine" ? "high" : "medium";
}

/**
 * 任务是否仍在活跃执行（用于防重入与前端轮询判断）。
 * rendering 且未过陈旧阈值 = 活跃；其余（null/done/failed/陈旧 rendering）都允许发起新渲染。
 */
export function isRenderJobActive(
  status: string | null | undefined,
  startedAt: Date | string | null | undefined,
  nowMs: number,
): boolean {
  if (status !== "rendering") return false;
  if (!startedAt) return false;
  const started = typeof startedAt === "string" ? Date.parse(startedAt) : startedAt.getTime();
  if (!Number.isFinite(started)) return false;
  return nowMs - started < RENDER_JOB_STALE_MS;
}

/** 轮询端看到的任务快照（含陈旧归一化：陈旧 rendering 对外报 failed） */
export function summarizeRenderJob(
  row: {
    renderJobStatus: string | null;
    renderJobQuality: string | null;
    renderJobError: string | null;
    renderJobStartedAt: Date | null;
  },
  nowMs: number,
): {
  status: RenderJobStatus | null;
  tier: RenderTier | null;
  error: string | null;
  startedAt: string | null;
  stale: boolean;
} {
  const startedAt = row.renderJobStartedAt?.toISOString() ?? null;
  const tier =
    row.renderJobQuality === "fast" || row.renderJobQuality === "fine"
      ? (row.renderJobQuality as RenderTier)
      : null;
  if (row.renderJobStatus === "rendering") {
    const active = isRenderJobActive(row.renderJobStatus, row.renderJobStartedAt, nowMs);
    if (!active) {
      return {
        status: "failed",
        tier,
        error: "渲染超时中断（可能因部署或网络），请重试。",
        startedAt,
        stale: true,
      };
    }
    return { status: "rendering", tier, error: null, startedAt, stale: false };
  }
  if (row.renderJobStatus === "done" || row.renderJobStatus === "failed") {
    return {
      status: row.renderJobStatus,
      tier,
      error: row.renderJobError,
      startedAt,
      stale: false,
    };
  }
  return { status: null, tier: null, error: null, startedAt: null, stale: false };
}
