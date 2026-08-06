/**
 * 内容哈希与有序指纹（用于幂等与 Addendum 检测）
 */

import { createHash } from "node:crypto";

/** sha256 hex of raw bytes or utf8 string */
export function sha256Content(input: Buffer | string): string {
  const hash = createHash("sha256");
  if (typeof input === "string") {
    hash.update(input, "utf8");
  } else {
    hash.update(input);
  }
  return hash.digest("hex");
}

/**
 * 对有序 contentHash 列表生成稳定指纹。
 * 调用方必须保证 hashes 已按约定排序（如 documentId / 上传顺序）。
 */
export function fingerprintOrderedHashes(
  orderedHashes: readonly string[],
): string {
  const normalized = orderedHashes.map((h) => h.trim().toLowerCase()).filter(Boolean);
  const payload = normalized.join("\n");
  return sha256Content(payload);
}

/** 便捷：排序后指纹（按字典序；需要稳定业务序时请用 fingerprintOrderedHashes） */
export function fingerprintSortedHashes(hashes: readonly string[]): string {
  const sorted = [...hashes]
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .sort();
  return fingerprintOrderedHashes(sorted);
}
