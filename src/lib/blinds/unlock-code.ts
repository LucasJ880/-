/**
 * 企业解锁码（行折扣 / 定金）— 仅存 bcrypt 哈希，永不落明文。
 */

import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

/** 是否像 bcrypt hash（用于拒绝把明文误写入 hash 字段） */
export function looksLikeBcryptHash(value: string): boolean {
  return /^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value);
}

export async function hashUnlockCode(plain: string): Promise<string> {
  const trimmed = plain.trim();
  if (trimmed.length < 3 || trimmed.length > 64) {
    throw new Error("解锁码长度需为 3~64 个字符");
  }
  return bcrypt.hash(trimmed, BCRYPT_ROUNDS);
}

export async function verifyUnlockCode(
  plain: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash || !plain.trim()) return false;
  if (!looksLikeBcryptHash(hash)) {
    // 拒绝明文比对：旧数据若误存明文，视为未配置
    return false;
  }
  try {
    return await bcrypt.compare(plain.trim(), hash);
  } catch {
    return false;
  }
}

/** 日志 / 审计 / API 错误：永远不回传输入码或哈希 */
export function unlockCodeAuditSafe(meta?: {
  configured?: boolean;
  matched?: boolean;
  orgId?: string;
}): Record<string, unknown> {
  return {
    configured: meta?.configured === true,
    matched: meta?.matched === true,
    ...(meta?.orgId ? { orgId: meta.orgId } : {}),
  };
}

export function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
}
