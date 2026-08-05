/**
 * 截标 / 询价截止日解析
 * enquiryDeadline = closing − 5 calendar days（日期即可）
 */

import type { ClosingParse } from "./types";

const CLOSING_PATTERNS: RegExp[] = [
  /(?:closing|bid\s*closing|solicitation\s*closes?)[:\s]+([0-9]{4}-[0-9]{2}-[0-9]{2}(?:\s+[0-9]{1,2}:[0-9]{2})?(?:\s*[A-Z]{2,5})?)/i,
  /(?:closing\s*date)[:\s]+([0-9]{4}-[0-9]{2}-[0-9]{2}(?:\s+[0-9]{1,2}:[0-9]{2})?(?:\s*[A-Z]{2,5})?)/i,
  /\b([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{1,2}:[0-9]{2}\s*(?:MDT|MST|EDT|EST|PDT|PST|CDT|CST|UTC|GMT))\b/i,
];

function parseYmd(rawDate: string): Date | null {
  const m = rawDate
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // 用 UTC noon 避免时区偏移导致日期漂移
  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
}

function extractTimezoneLabel(raw: string): string | null {
  const m = raw.match(/\b(MDT|MST|EDT|EST|PDT|PST|CDT|CST|UTC|GMT)\b/i);
  return m ? m[1]!.toUpperCase() : null;
}

/** closing − 5 calendar days（仅日期） */
export function computeEnquiryDeadline(closingDate: Date): Date {
  const y = closingDate.getUTCFullYear();
  const mo = closingDate.getUTCMonth();
  const d = closingDate.getUTCDate();
  return new Date(Date.UTC(y, mo, d - 5, 12, 0, 0));
}

export function parseClosingFromText(text: string): ClosingParse | null {
  for (const re of CLOSING_PATTERNS) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const closingRaw = m[1].trim();
    const closingDate = parseYmd(closingRaw);
    const timezoneLabel = extractTimezoneLabel(closingRaw) ?? extractTimezoneLabel(m[0] ?? "");
    const enquiryDeadline = closingDate
      ? computeEnquiryDeadline(closingDate)
      : null;
    return { closingRaw, closingDate, timezoneLabel, enquiryDeadline };
  }
  return null;
}

export function formatDateYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}
