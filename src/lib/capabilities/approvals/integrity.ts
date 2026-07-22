/**
 * 审批内容防篡改：payloadHash / version
 */

import { createHash } from "node:crypto";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function computePayloadHash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function verifyPayloadIntegrity(opts: {
  payload: unknown;
  expectedHash?: string | null;
  expectedVersion?: number | null;
  currentVersion?: number | null;
}): { ok: true } | { ok: false; reason: string } {
  if (opts.expectedHash) {
    const actual = computePayloadHash(opts.payload);
    if (actual !== opts.expectedHash) {
      return { ok: false, reason: "payload_hash_mismatch" };
    }
  }
  if (
    opts.expectedVersion != null &&
    opts.currentVersion != null &&
    opts.expectedVersion !== opts.currentVersion
  ) {
    return { ok: false, reason: "payload_version_mismatch" };
  }
  return { ok: true };
}

/** 摘要：去掉敏感键，截断长文本 */
export function summarizePayload(payload: unknown): unknown {
  if (payload == null) return null;
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return typeof payload === "string"
      ? payload.slice(0, 200)
      : payload;
  }
  const src = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    const key = k.toLowerCase();
    if (
      key.includes("password") ||
      key.includes("secret") ||
      key.includes("apikey") ||
      key.includes("api_key") ||
      key.includes("token") ||
      key.includes("unlock") ||
      key.includes("prompt")
    ) {
      continue;
    }
    if (typeof v === "string") {
      out[k] = v.length > 160 ? `${v.slice(0, 160)}…` : v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = { _summary: "object" };
    }
  }
  return out;
}
