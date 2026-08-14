/**
 * Autopilot Trace sanitizer。
 * 禁止把 credential / 完整 Prompt / 业务正文无脑写入观察存储。
 */

import { createHash } from "crypto";
import type { AutopilotContentRef } from "./types";

const BLOCKED_KEY_PARTS = [
  "authorization",
  "cookie",
  "setcookie",
  "set_cookie",
  "apikey",
  "api_key",
  "xapikey",
  "x_api_key",
  "oauth",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "idtoken",
  "id_token",
  "password",
  "passwd",
  "secret",
  "credential",
  "bearer",
  "privatekey",
  "private_key",
  "clientsecret",
  "client_secret",
  "sessiontoken",
  "session_token",
  "sessionsecret",
  "jwt",
  "system_prompt",
  "systemprompt",
  "full_prompt",
  "fullprompt",
  "raw_prompt",
  "rawprompt",
];

const REDACTED = "[REDACTED]";
const MAX_STRING = 240;
const MAX_SUMMARY = 80;
const MAX_DEPTH = 6;
const MAX_ARRAY = 30;
const MAX_KEYS = 40;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function looksLikeSecretValue(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  if (/^bearer\s+/i.test(t)) return true;
  if (/^basic\s+[a-z0-9+/=_-]{12,}/i.test(t)) return true;
  if (/^sk-[a-zA-Z0-9]{16,}/.test(t)) return true;
  if (/^eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\./.test(t)) return true;
  if (/^(ya29\.|xox[baprs]-|ghp_|github_pat_)/i.test(t)) return true;
  return false;
}

function isBlockedKey(key: string): boolean {
  const n = normalizeKey(key);
  return BLOCKED_KEY_PARTS.some((p) => n.includes(p.replace(/[^a-z0-9_]/g, "")));
}

export function hashAutopilotContent(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function toContentRef(
  value: unknown,
  id?: string,
): AutopilotContentRef | null {
  if (value == null) return null;
  const text =
    typeof value === "string" ? value : safeJsonStringify(value);
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return {
    kind: "reference",
    id,
    hash: hashAutopilotContent(trimmed),
    summary: trimmed.slice(0, MAX_SUMMARY),
    bytes: Buffer.byteLength(trimmed, "utf8"),
  };
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

export function sanitizeAgentTrace(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (looksLikeSecretValue(value)) return REDACTED;
    const t = value.trim();
    if (t.length > MAX_STRING) return `${t.slice(0, MAX_STRING)}…`;
    return value;
  }
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitizeAgentTrace(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_KEYS) break;
      if (isBlockedKey(k)) {
        out[k] = REDACTED;
        count += 1;
        continue;
      }
      out[k] = sanitizeAgentTrace(v, depth + 1);
      count += 1;
    }
    return out;
  }
  return String(value);
}

export function sanitizeAutopilotPayload(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!payload) return null;
  const sanitized = sanitizeAgentTrace(payload);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return null;
  }
  return sanitized as Record<string, unknown>;
}

export function containsRedactedMarker(value: unknown): boolean {
  if (value === REDACTED) return true;
  if (Array.isArray(value)) return value.some(containsRedactedMarker);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(
      containsRedactedMarker,
    );
  }
  return false;
}
