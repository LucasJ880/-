/**
 * 结构化日志
 *
 * - 开发环境：彩色/可读格式（console.log 原样）
 * - 生产环境：单行 JSON，方便 Vercel Logs / Sentry 断点关联
 * - 自动附带当前 requestId / userId（来自 AsyncLocalStorage）
 *
 * 使用：
 *   import { logger } from "@/lib/common/logger";
 *   logger.info("ai.chat.start", { threadId, model });
 *   logger.warn("ai.parse.failure", { reason });
 *   logger.error("db.tx.rollback", { err });
 */
import { getRequestContext } from "./request-context";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentMinLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return LEVEL_WEIGHT[raw as Level] ?? LEVEL_WEIGHT.info;
}

const IS_PROD =
  process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";

function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err as unknown as Record<string, unknown>),
    };
  }
  return { raw: err };
}

function write(level: Level, event: string, fields?: Record<string, unknown>) {
  if (LEVEL_WEIGHT[level] < currentMinLevel()) return;

  const ctx = getRequestContext();
  const payload: Record<string, unknown> = {
    level,
    event,
    time: new Date().toISOString(),
    ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx?.userId ? { userId: ctx.userId } : {}),
    ...(ctx?.orgId ? { orgId: ctx.orgId } : {}),
    ...(ctx?.route ? { route: ctx.route } : {}),
    ...(ctx?.method ? { method: ctx.method } : {}),
    ...(fields ? flattenError(fields) : {}),
  };

  const target = level === "error" ? console.error : level === "warn" ? console.warn : console.log;

  if (IS_PROD) {
    target(JSON.stringify(payload));
  } else {
    const { level: _l, event: _e, time: _t, ...rest } = payload;
    target(`[${level.toUpperCase()}] ${event}`, rest);
  }
}

function flattenError(fields: Record<string, unknown>): Record<string, unknown> {
  if (!("err" in fields) && !("error" in fields)) return fields;
  const copy = { ...fields };
  if ("err" in copy) copy.err = serializeError(copy.err);
  if ("error" in copy && copy.error instanceof Error) copy.error = serializeError(copy.error);
  return copy;
}

export const logger = {
  debug(event: string, fields?: Record<string, unknown>) {
    write("debug", event, fields);
  },
  info(event: string, fields?: Record<string, unknown>) {
    write("info", event, fields);
  },
  warn(event: string, fields?: Record<string, unknown>) {
    write("warn", event, fields);
  },
  error(event: string, fields?: Record<string, unknown>) {
    write("error", event, fields);
  },
};
