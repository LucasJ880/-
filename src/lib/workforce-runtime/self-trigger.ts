/**
 * 观察期包1 · 延迟压缩 —— 让出后链式自触发（route 层专用）
 *
 * 目的：t3 等长任务让出后不再等下一班每 2 分钟节拍的 cron
 * （实测单次空转 2:18），由本次 invocation 在响应后 fire-and-forget
 * 调自身 cron endpoint。
 *
 * 层次纪律（load-bearing，勿动）：本模块只允许被
 * `src/app/api/cron/agent-runs/route.ts` 使用。绝不能从
 * processor / processQueuedWorkforceJobs 触发——§38/§39 回归 harness
 * 直接调 processor，若 lib 层自触发会在回归期间对隔离库发起并发 tick
 * （违反同库并发禁忌：任何 tick 与 harness 不得同打一个隔离库）。
 *
 * 开关 = 单个 env：`WORKFORCE_CONTINUATION_SELF_TRIGGER_URL`
 * （显式完整基址，生产填 https://qingyan.ca；未配置 = OFF，
 * 回滚 = 删 env + redeploy）。不复用 resolveAppOrigin：其 fallback
 * （qingyan.ai / VERCEL_URL）对生产 cron 自调用分别是错域与 SSO 302 陷阱。
 *
 * 防风暴（与 route 层合计五层）：
 * 1. 仅本批 yieldedContinuations > 0 才触发（让出必然发生在真实工作
 *    + checkpoint 之后，链式节拍被真实进度限速）；
 * 2. 每 invocation 至多触发一次（route 层单点调用）；
 * 3. depth 硬上限 WORKFORCE_CONTINUATION_MAX_DEPTH（超限退回 cron 节拍）；
 * 4. env 未配置默认 OFF；
 * 5. child 走完整 requireCronSecret + 非生产隔离防线（fail-closed）。
 * 与常规 cron tick 重叠由既有 CAS + lease 兜底（多余 tick 空转无害）。
 */

import { WORKFORCE_CONTINUATION_MAX_DEPTH } from "./constants";

export type SelfTriggerEnv = Record<string, string | undefined>;

/**
 * fire-and-forget 的「只等发出」窗口：请求发出后最多等这么久就放弃等待
 * （child 处理最长 300s，父若等完整响应会撞自己的 maxDuration）。
 */
export const CONTINUATION_TRIGGER_SEND_TIMEOUT_MS = 5_000;

/** 解析自触发基址；未配置 / 非 http(s) → null（= OFF，fail-closed） */
export function resolveSelfTriggerBaseUrl(
  env: SelfTriggerEnv = process.env,
): string | null {
  const raw = env.WORKFORCE_CONTINUATION_SELF_TRIGGER_URL?.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.replace(/\/+$/, "");
}

/** 是否应链式自触发下一 tick（纯判定，零副作用） */
export function shouldFireContinuationTrigger(input: {
  yieldedContinuations: number;
  depth: number;
  env?: SelfTriggerEnv;
}): boolean {
  if (!Number.isInteger(input.yieldedContinuations)) return false;
  if (input.yieldedContinuations <= 0) return false;
  if (!Number.isInteger(input.depth) || input.depth < 0) return false;
  if (input.depth >= WORKFORCE_CONTINUATION_MAX_DEPTH) return false;
  const env = input.env ?? process.env;
  if (!resolveSelfTriggerBaseUrl(env)) return false;
  if (!env.CRON_SECRET?.trim()) return false;
  return true;
}

/**
 * 自触发的可观测结果（DURABLE_FOLLOWUP_M1 修正观测语义）。
 *
 * 五种事实必须分开，任何一种都**不等于**"下一轮已认领 / 已执行"：
 *   not_configured         未配置 → 未尝试
 *   accepted               收到 2xx：child 已接收请求（下一轮是否认领 Job
 *                          以 child 自己的 AutomationRun / job.claimed 事件为准）
 *   http_rejected          收到非 2xx（401/403/5xx/3xx 重定向等）：child 未处理
 *   unknown_after_timeout  发出后在等待窗口内放弃：请求可能已到达也可能没有，
 *                          接收状态未知（预期常态：child 处理时间远超等待窗口）
 *   send_failed            网络等发送失败
 * 后续 tick 的安全性一律依赖 claim CAS + 租约 + 幂等，而不是这里的结果。
 */
export type ContinuationTriggerOutcome =
  | "not_configured"
  | "accepted"
  | "http_rejected"
  | "unknown_after_timeout"
  | "send_failed";

export type ContinuationTriggerResult = {
  /** 是否实际尝试发出请求 */
  attempted: boolean;
  outcome: ContinuationTriggerOutcome;
  /** accepted / http_rejected 时的 child HTTP 状态码 */
  httpStatus?: number;
  /**
   * 兼容旧字段：**仅** accepted（child 明确 2xx 接收）为 true。
   * 此前 HTTP 失败响应与超时中止也被报成 fired=true——那是错误的成功语义。
   */
  fired: boolean;
  reason?: "not_configured" | "send_timeout_abort" | "fetch_failed" | "http_status";
};

/**
 * fire-and-forget 调自身 cron endpoint（child depth = 父 depth + 1）。
 *
 * 只等发出：超时即 abort 放弃等待，绝不等 child 的完整响应。
 * 任何失败（网络/超时/配置缺失/非 2xx）都不抛出、不影响父 invocation 的结果
 * ——自触发只是加速器，cron 节拍永远是兜底。不跟随重定向（SSO 302 = 未接收）。
 * 返回值不含任何 secret。
 */
export async function fireContinuationTrigger(input: {
  depth: number;
  env?: SelfTriggerEnv;
  fetchImpl?: typeof fetch;
  sendTimeoutMs?: number;
}): Promise<ContinuationTriggerResult> {
  const env = input.env ?? process.env;
  const base = resolveSelfTriggerBaseUrl(env);
  const secret = env.CRON_SECRET?.trim();
  if (!base || !secret) {
    return {
      attempted: false,
      outcome: "not_configured",
      fired: false,
      reason: "not_configured",
    };
  }

  const url = `${base}/api/cron/agent-runs?trigger=continuation&depth=${input.depth + 1}`;
  const doFetch = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    input.sendTimeoutMs ?? CONTINUATION_TRIGGER_SEND_TIMEOUT_MS,
  );
  try {
    const res = await doFetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
      signal: controller.signal,
      cache: "no-store",
      redirect: "manual",
    });
    const status = typeof res?.status === "number" ? res.status : 0;
    if (status >= 200 && status < 300) {
      return { attempted: true, outcome: "accepted", httpStatus: status, fired: true };
    }
    return {
      attempted: true,
      outcome: "http_rejected",
      httpStatus: status,
      fired: false,
      reason: "http_status",
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    // abort = 发出后放弃等待：不能证明请求未发送，也不能证明 child 已接收
    return aborted
      ? {
          attempted: true,
          outcome: "unknown_after_timeout",
          fired: false,
          reason: "send_timeout_abort",
        }
      : {
          attempted: true,
          outcome: "send_failed",
          fired: false,
          reason: "fetch_failed",
        };
  } finally {
    clearTimeout(timer);
  }
}

/** 结构化记录自触发结果（route 层 after() 内调用；不含 secret / URL） */
export function logContinuationTriggerResult(
  depth: number,
  result: ContinuationTriggerResult,
): void {
  const payload = {
    depth,
    childDepth: depth + 1,
    attempted: result.attempted,
    outcome: result.outcome,
    httpStatus: result.httpStatus ?? null,
  };
  if (result.outcome === "accepted" || result.outcome === "unknown_after_timeout") {
    console.info("[cron.agent-runs] continuation trigger", payload);
  } else {
    console.warn("[cron.agent-runs] continuation trigger not accepted", payload);
  }
}
