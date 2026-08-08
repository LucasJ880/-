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

/**
 * Phase 1.1.1 package fingerprint：
 * SHA256(sorted(documentId:contentHash).join via ordered hashes of those pairs)
 */
export function computePackageFingerprintFromPairs(
  docs: ReadonlyArray<{ documentId: string; contentHash: string }>,
): string {
  const parts = docs
    .map((d) => `${d.documentId.trim()}:${d.contentHash.trim().toLowerCase()}`)
    .filter((p) => p.includes(":") && !p.startsWith(":") && !p.endsWith(":"))
    .sort();
  return fingerprintOrderedHashes(parts.length > 0 ? parts : ["empty-package"]);
}

/** 无 code 时 requirement 正文指纹（短 hex） */
export function normalizeRequirementFingerprint(text: string): string {
  const normalized = (text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .slice(0, 240);
  return sha256Content(normalized).slice(0, 32);
}
