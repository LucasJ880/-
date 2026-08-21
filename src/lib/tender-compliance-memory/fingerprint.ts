/**
 * 合规记忆 · 要求文本指纹与相似度（纯函数）。
 * 指纹 = 归一化文本（小写、去标点/空白、全角→半角）的 sha256 前 24 位；
 * 相似度 = 词元集合 Jaccard（英文按词、中文按字，数字与代号保留）。
 */

import { createHash } from "node:crypto";

export function normalizeRequirementText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function requirementFingerprint(text: string): string {
  const n = normalizeRequirementText(text);
  return createHash("sha256").update(n).digest("hex").slice(0, 24);
}

export function requirementTokens(text: string): Set<string> {
  const n = normalizeRequirementText(text);
  const out = new Set<string>();
  for (const w of n.split(" ")) {
    if (!w) continue;
    if (/^[\p{Script=Han}]+$/u.test(w)) {
      for (const ch of w) out.add(ch);
    } else if (w.length >= 2 || /\d/.test(w)) {
      out.add(w);
    }
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export const COMPLIANCE_MEMORY_SUBJECT_PREFIX = "req:";
export const COMPLIANCE_MEMORY_FUZZY_THRESHOLD = 0.75;
