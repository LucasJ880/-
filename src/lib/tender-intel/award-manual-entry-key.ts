/**
 * CHAIN-1b 人工录入 APC 授标的来源键（服务端：用 node:crypto）
 */
import { createHash } from "node:crypto";
import { MANUAL_APC_SOURCE_PREFIX } from "./award-manual-entry";

/** 来源键：manual:apc: + sha256(规整链接 + 换行 + 中标方规整名) 的前 32 位（同一条公告的同一个中标方只算一次） */
export function manualApcSourceKey(normalizedUrl: string, winnerNameNormalized: string): string {
  return MANUAL_APC_SOURCE_PREFIX + createHash("sha256").update(`${normalizedUrl}\n${winnerNameNormalized}`).digest("hex").slice(0, 32);
}
