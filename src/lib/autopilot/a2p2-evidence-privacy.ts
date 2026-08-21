/**
 * Autopilot A2-P2.1 — deterministic privacy / secret / raw-content gate.
 */

import {
  FORBIDDEN_CONTRACT_FIELD_NAMES,
  findForbiddenContractField,
  isJudgeEligiblePrivacyClass,
  type EvaluationPrivacyClass,
} from "./a2p2-contract";
import {
  MAX_LOCATOR_STRING,
  MAX_SAFE_SCALAR_ARRAY,
  SAFE_FACT_STRING_MAX,
  type EvidenceLocator,
  type SafeNormalizedValue,
  type SafeScalar,
} from "./a2p2-evidence-types";

export const FORBIDDEN_EVIDENCE_FIELD_NAMES = [
  ...FORBIDDEN_CONTRACT_FIELD_NAMES,
  "rawPrompt",
  "rawOutput",
  "rawEmail",
  "rawTender",
  "rawContract",
  "rawToolPayload",
  "rawToolResponse",
  "documentText",
  "pageText",
  "fullBody",
  "fullContent",
] as const;

const SECRET_NEEDLES = [
  "bearer ",
  "authorization:",
  "api_key",
  "apikey",
  "x-api-key",
  "password=",
  "password:",
  "cookie:",
  "set-cookie",
  "oauth",
  "sk-live-",
  "sk-proj-",
  "begin private key",
  "-----begin ",
] as const;

const CREDENTIAL_URL = /\b(?:postgres|mysql|mongodb|redis|amqp):\/\/[^\s]+:[^\s]+@/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/g;

export type PrivacyScanResult = {
  secret: boolean;
  forbiddenField: string | null;
  privacyClass: EvaluationPrivacyClass;
  redacted: boolean;
};

export function scanForbiddenEvidenceFields(value: unknown): string | null {
  const nested = findForbiddenContractField(value);
  if (nested) return nested;
  if (!value || typeof value !== "object") return null;
  return findExtendedForbidden(value, "$");
}

function findExtendedForbidden(value: unknown, path: string): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const nested = findExtendedForbidden(value[i], `${path}[${i}]`);
      if (nested) return nested;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_EVIDENCE_FIELD_NAMES as readonly string[]).includes(key)) {
      return `${path}.${key}`;
    }
    const nested = findExtendedForbidden(child, `${path}.${key}`);
    if (nested) return nested;
  }
  return null;
}

export function containsSecretMaterial(value: unknown): boolean {
  const texts = collectStrings(value);
  for (const text of texts) {
    const lower = text.toLowerCase();
    if (SECRET_NEEDLES.some((needle) => lower.includes(needle))) return true;
    if (CREDENTIAL_URL.test(text)) return true;
  }
  return false;
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectStrings(child, out);
    }
  }
  return out;
}

export function redactPiiText(value: string): { text: string; redacted: boolean } {
  const next = value
    .replace(EMAIL_RE, "[EMAIL]")
    .replace(PHONE_RE, "[PHONE]");
  return { text: next, redacted: next !== value };
}

export function boundFactString(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, SAFE_FACT_STRING_MAX);
}

export function sanitizeLocator(
  locator: EvidenceLocator | undefined,
): EvidenceLocator | undefined {
  if (!locator) return undefined;
  const page =
    typeof locator.page === "number" && Number.isInteger(locator.page) && locator.page > 0
      ? locator.page
      : undefined;
  const section = boundLocator(locator.section);
  const field = boundLocator(locator.field);
  const recordKey = boundLocator(locator.recordKey);
  const toolName = boundLocator(locator.toolName);
  if (!page && !section && !field && !recordKey && !toolName) return undefined;
  return { page, section, field, recordKey, toolName };
}

function boundLocator(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = boundFactString(value).slice(0, MAX_LOCATOR_STRING);
  return trimmed || undefined;
}

export function sanitizeNormalizedValue(
  value: unknown,
): SafeNormalizedValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    return redactPiiText(boundFactString(value)).text;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_SAFE_SCALAR_ARRAY) return undefined;
    const items: SafeScalar[] = [];
    for (const item of value) {
      if (item === null || typeof item === "boolean") {
        items.push(item);
        continue;
      }
      if (typeof item === "number" && Number.isFinite(item)) {
        items.push(item);
        continue;
      }
      if (typeof item === "string") {
        items.push(redactPiiText(boundFactString(item)).text);
        continue;
      }
      return undefined;
    }
    return items;
  }
  return undefined;
}

export function scanEvidenceValue(value: unknown): PrivacyScanResult {
  const forbiddenField = scanForbiddenEvidenceFields(value);
  const secret = containsSecretMaterial(value);
  const texts = collectStrings(value).join(" ");
  const pii = redactPiiText(texts).redacted;
  let privacyClass: EvaluationPrivacyClass = "INTERNAL";
  if (secret || forbiddenField) privacyClass = "PROHIBITED";
  else if (pii) privacyClass = "SENSITIVE";
  return {
    secret: secret || forbiddenField != null,
    forbiddenField,
    privacyClass,
    redacted: pii,
  };
}

export function isPacketEligiblePrivacyClass(
  privacyClass: EvaluationPrivacyClass,
): boolean {
  return isJudgeEligiblePrivacyClass(privacyClass) && privacyClass !== "PROHIBITED";
}
