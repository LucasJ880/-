/**
 * P1-alpha：页面文本归一化 + SHA-256 指纹（与 research bundle 无关）
 */

import { createHash } from "crypto";

export function normalizePageText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hashPageText(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
