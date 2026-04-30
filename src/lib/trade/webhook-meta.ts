/**
 * Meta Cloud API webhook — 签名校验（供 trade WhatsApp 路由与 P0 自查脚本复用）
 */

import crypto from "crypto";

export function verifyWhatsAppSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
