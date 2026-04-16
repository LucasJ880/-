/**
 * 敏感字段对称加密 — AES-256-GCM
 *
 * 环境变量 ENCRYPTION_KEY：64 个 hex 字符（32 字节）。
 * 未设置时退化为明文存储（开发环境兼容），但会打印一次警告。
 *
 * 密文格式：enc:v1:<iv_hex>:<ciphertext_hex>:<authTag_hex>
 * 解密时如果值不带 enc:v1: 前缀，视为明文直接返回（兼容旧数据迁移期）。
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:";

let _warned = false;

function getKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (!_warned) {
      _warned = true;
      console.warn(
        "[crypto] ENCRYPTION_KEY 未设置，敏感字段将以明文存储。" +
          "生产环境请设置 64 位 hex 密钥（openssl rand -hex 32）",
      );
    }
    return null;
  }
  if (raw.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY 必须为 64 个 hex 字符（32 字节）。当前长度: " + raw.length,
    );
  }
  return Buffer.from(raw, "hex");
}

export function encryptField(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

export function decryptField(ciphertext: string): string {
  if (!ciphertext) return ciphertext;
  if (!ciphertext.startsWith(PREFIX)) return ciphertext;

  const key = getKey();
  if (!key) {
    console.error("[crypto] 数据已加密但 ENCRYPTION_KEY 未设置，无法解密");
    return "";
  }

  const parts = ciphertext.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    console.error("[crypto] 密文格式错误");
    return "";
  }

  const [ivHex, dataHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(dataHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}
