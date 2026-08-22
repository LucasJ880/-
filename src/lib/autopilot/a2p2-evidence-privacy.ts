/**
 * Autopilot A2-P2.1 — deterministic privacy / secret / raw-content gate.
 */

import {
  EVALUATION_PRIVACY_CLASSES,
  FORBIDDEN_CONTRACT_FIELD_NAMES,
  findForbiddenContractField,
  isJudgeEligiblePrivacyClass,
  type EvaluationPrivacyClass,
} from "./a2p2-contract";
import {
  MAX_LOCATOR_STRING,
  MAX_SAFE_SCALAR_ARRAY,
  MAX_SOURCE_ID_LENGTH,
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
  "contentText",
  "sourceSnippet",
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
const HTML_RE = /<\/?[a-z][a-z0-9]*\b[^>]*>/i;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VERSION_TOKEN_RE =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9._:-]{0,63}){0,3}$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_VERSION_TOKEN_LENGTH = 80;
const MAX_ISO_TIMESTAMP_LENGTH = 30;

export type PrivacyScanResult = {
  secret: boolean;
  forbiddenField: string | null;
  privacyClass: EvaluationPrivacyClass;
  redacted: boolean;
  html: boolean;
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

export function containsUnsafeMarkup(value: unknown): boolean {
  return collectStrings(value).some((text) => HTML_RE.test(text));
}

export function containsPiiText(value: string): boolean {
  EMAIL_RE.lastIndex = 0;
  PHONE_RE.lastIndex = 0;
  return EMAIL_RE.test(value) || PHONE_RE.test(value);
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

export function isOpaqueSourceId(value: string): boolean {
  if (value.length < 1 || value.length > MAX_SOURCE_ID_LENGTH) return false;
  if (!OPAQUE_ID_RE.test(value)) return false;
  if (containsPiiText(value)) return false;
  if (containsSecretMaterial(value)) return false;
  if (containsUnsafeMarkup(value)) return false;
  return true;
}

export function isOpaqueToken(value: string): boolean {
  return isOpaqueSourceId(value);
}

export function isVersionToken(value: string): boolean {
  if (value.length < 1 || value.length > MAX_VERSION_TOKEN_LENGTH) return false;
  if (/\s/.test(value)) return false;
  if (!VERSION_TOKEN_RE.test(value)) return false;
  if (containsPiiText(value)) return false;
  if (containsSecretMaterial(value)) return false;
  if (containsUnsafeMarkup(value)) return false;
  return true;
}

export function isBoundedIsoTimestamp(value: string): boolean {
  if (value.length < 20 || value.length > MAX_ISO_TIMESTAMP_LENGTH) return false;
  if (!ISO_TIMESTAMP_RE.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

export function safeRejectedIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!isOpaqueToken(value)) return undefined;
  return value;
}

export function safeExtractorVersion(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  return isVersionToken(value) ? value : undefined;
}

export function safeSourceObservedAt(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  return isBoundedIsoTimestamp(value) ? value : undefined;
}

export function sanitizeLocator(
  locator: EvidenceLocator | undefined,
): { locator?: EvidenceLocator; redacted: boolean } {
  if (!locator) return { redacted: false };
  const page =
    typeof locator.page === "number" && Number.isInteger(locator.page) && locator.page > 0
      ? locator.page
      : undefined;
  const section = redactLocatorField(locator.section);
  const field = redactLocatorField(locator.field);
  const recordKey = redactLocatorField(locator.recordKey);
  const toolName = redactLocatorField(locator.toolName);
  const redacted =
    section.redacted || field.redacted || recordKey.redacted || toolName.redacted;
  if (!page && !section.text && !field.text && !recordKey.text && !toolName.text) {
    return { redacted };
  }
  return {
    redacted,
    locator: {
      page,
      section: section.text,
      field: field.text,
      recordKey: recordKey.text,
      toolName: toolName.text,
    },
  };
}

function redactLocatorField(value: string | undefined): {
  text: string | undefined;
  redacted: boolean;
} {
  if (typeof value !== "string") return { text: undefined, redacted: false };
  const pii = redactPiiText(boundFactString(value).slice(0, MAX_LOCATOR_STRING));
  return { text: pii.text || undefined, redacted: pii.redacted };
}

export function sanitizeNormalizedValue(value: unknown): {
  value: SafeNormalizedValue;
  redacted: boolean;
} | undefined {
  if (value === null || typeof value === "boolean") {
    return { value, redacted: false };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { value, redacted: false } : undefined;
  }
  if (typeof value === "string") {
    const pii = redactPiiText(boundFactString(value));
    return { value: pii.text, redacted: pii.redacted };
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_SAFE_SCALAR_ARRAY) return undefined;
    const items: SafeScalar[] = [];
    let redacted = false;
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
        const pii = redactPiiText(boundFactString(item));
        items.push(pii.text);
        redacted = redacted || pii.redacted;
        continue;
      }
      return undefined;
    }
    return { value: items, redacted };
  }
  return undefined;
}

export function isKnownPrivacyClass(value: unknown): value is EvaluationPrivacyClass {
  return (
    typeof value === "string" &&
    (EVALUATION_PRIVACY_CLASSES as readonly string[]).includes(value)
  );
}

export function scanEvidenceValue(value: unknown): PrivacyScanResult {
  const forbiddenField = scanForbiddenEvidenceFields(value);
  const secret = containsSecretMaterial(value);
  const html = containsUnsafeMarkup(value);
  const texts = collectStrings(value).join(" ");
  const pii = redactPiiText(texts).redacted;
  let privacyClass: EvaluationPrivacyClass = "INTERNAL";
  if (secret || forbiddenField) privacyClass = "PROHIBITED";
  else if (pii) privacyClass = "SENSITIVE";
  return {
    secret,
    forbiddenField,
    privacyClass,
    redacted: pii,
    html,
  };
}

export function isPacketEligiblePrivacyClass(
  privacyClass: EvaluationPrivacyClass,
): boolean {
  return isJudgeEligiblePrivacyClass(privacyClass) && privacyClass !== "PROHIBITED";
}
