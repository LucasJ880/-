/**
 * Seed 用：为企业初始化行折扣解锁码哈希（幂等，永不覆盖已有哈希）
 */

import { db } from "@/lib/db";
import {
  hashUnlockCode,
  isProductionRuntime,
  looksLikeBcryptHash,
} from "./unlock-code";

export type EnsureLineUnlockResult =
  | { status: "kept_existing" }
  | { status: "created_from_env" }
  | { status: "created_dev_example" }
  | { status: "skipped_no_secret"; reason: string };

/**
 * 仅在 lineDiscountUnlockCodeHash 为空时写入。
 * - 生产：必须提供 envPlain；否则跳过，绝不写入 Sunny2026
 * - 非生产：可用 envPlain，或允许显式传入的 devExamplePlain（如 Sunny2026）
 */
export async function ensureLineDiscountUnlockHash(params: {
  orgId: string;
  userId: string;
  /** 环境变量明文，如 process.env.SUNNY_LINE_DISCOUNT_UNLOCK_CODE */
  envPlain?: string | null;
  /** 仅非生产可用的示例明文；生产环境忽略 */
  devExamplePlain?: string | null;
  orgLabel: string;
}): Promise<EnsureLineUnlockResult> {
  const existing = await db.quoteDiscountSettings.findUnique({
    where: { orgId: params.orgId },
    select: { id: true, lineDiscountUnlockCodeHash: true },
  });

  if (
    existing?.lineDiscountUnlockCodeHash &&
    looksLikeBcryptHash(existing.lineDiscountUnlockCodeHash)
  ) {
    return { status: "kept_existing" };
  }

  const envPlain = params.envPlain?.trim() || "";
  const prod = isProductionRuntime();

  let plain: string | null = null;
  let from: "env" | "dev_example" | null = null;

  if (envPlain) {
    plain = envPlain;
    from = "env";
  } else if (!prod && params.devExamplePlain?.trim()) {
    plain = params.devExamplePlain.trim();
    from = "dev_example";
  }

  if (!plain || !from) {
    return {
      status: "skipped_no_secret",
      reason: prod
        ? `${params.orgLabel}: 生产环境未设置解锁码环境变量，跳过（不写入默认可猜测码）`
        : `${params.orgLabel}: 未提供环境变量且无开发示例，跳过`,
    };
  }

  const hash = await hashUnlockCode(plain);

  if (existing) {
    // 已有行但无有效哈希：只补哈希，不覆盖其它折扣字段
    await db.quoteDiscountSettings.update({
      where: { orgId: params.orgId },
      data: {
        lineDiscountUnlockCodeHash: hash,
        updatedBy: params.userId,
      },
    });
  } else {
    await db.quoteDiscountSettings.create({
      data: {
        orgId: params.orgId,
        version: 1,
        effectiveAt: new Date(),
        lineDiscountUnlockCodeHash: hash,
        updatedBy: params.userId,
      },
    });
  }

  return from === "env"
    ? { status: "created_from_env" }
    : { status: "created_dev_example" };
}
