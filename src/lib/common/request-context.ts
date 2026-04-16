/**
 * 请求级上下文（基于 AsyncLocalStorage）
 *
 * 用途：
 * - 在 withAuth/withOrgAccess 等入口处注入 requestId + userId
 * - 下游任意代码可通过 getRequestContext() 读取，无需透传
 * - logger 自动附带这些字段，便于在 Sentry / Vercel Logs 里串联整条链路
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
  userId?: string;
  orgId?: string | null;
  route?: string;
  method?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** 简易随机 ID（12 字节 base36），避免引入 uuid 依赖 */
export function generateRequestId(): string {
  const rand = () =>
    Math.random().toString(36).slice(2, 10).padStart(8, "0");
  return `${Date.now().toString(36)}-${rand()}${rand()}`;
}
