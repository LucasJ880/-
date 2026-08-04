/**
 * Bid Workflow schema drift — 仅识别 Prisma P2021/P2022，不吞未知错误。
 */
import { isSchemaDriftPrismaError } from "@/lib/common/api-helpers";
import type { Prisma } from "@prisma/client";

export function isPrismaSchemaDriftError(
  err: unknown,
): err is Prisma.PrismaClientKnownRequestError {
  return isSchemaDriftPrismaError(err);
}

export type SchemaFallbackResult<T> = {
  value: T;
  usedFallback: boolean;
  driftCode?: "P2021" | "P2022";
};

/**
 * 优先 primary；仅 P2021/P2022 时执行 fallback。
 * 其他错误（权限已在外层处理、连接失败、未知 Prisma）一律上抛。
 */
export async function withBidWorkflowSchemaFallback<T>(opts: {
  primary: () => Promise<T>;
  fallback: () => Promise<T>;
  logLabel: string;
}): Promise<SchemaFallbackResult<T>> {
  try {
    return { value: await opts.primary(), usedFallback: false };
  } catch (err) {
    if (!isPrismaSchemaDriftError(err)) throw err;
    const code = err.code as "P2021" | "P2022";
    // 可观测但不泄漏连接串 / 表名细节
    console.warn(
      `[bid-workflow-schema-drift] label=${opts.logLabel} code=${code} fallback=1`,
    );
    const value = await opts.fallback();
    return { value, usedFallback: true, driftCode: code };
  }
}

/** 列表/详情在 drift 时的统一 intelligence 字段 */
export function bidWorkflowUnavailableFields() {
  return {
    bidPhaseStatus: null as string | null,
    intelligenceRoom: null,
    intelligenceAvailable: false as const,
  };
}
