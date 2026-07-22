/**
 * 账本 metadata 脱敏：禁止密钥、解锁码、完整敏感 Prompt
 */

const BLOCKED_KEY_PARTS = [
  "apikey",
  "api_key",
  "authorization",
  "oauth",
  "access_token",
  "refresh_token",
  "secret",
  "password",
  "unlock",
  "unlockcode",
  "system_prompt",
  "systemprompt",
  "full_prompt",
  "fullprompt",
  "raw_prompt",
  "credential",
];

const MAX_STRING = 240;

export function sanitizeUsageMetadata(
  meta: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!meta) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    const key = k.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (BLOCKED_KEY_PARTS.some((p) => key.includes(p))) continue;
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) continue;
      // 疑似密钥形态
      if (/^sk-[a-zA-Z0-9]{20,}/.test(t)) continue;
      out[k] = t.length > MAX_STRING ? `${t.slice(0, MAX_STRING)}…` : t;
      continue;
    }
    if (v == null || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
      continue;
    }
    // 嵌套对象仅保留浅层非敏感标量
    if (typeof v === "object" && !Array.isArray(v)) {
      const nested = sanitizeUsageMetadata(v as Record<string, unknown>);
      if (nested && Object.keys(nested).length > 0) out[k] = nested;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
