/**
 * 截标 / 询价截止日解析
 * enquiryDeadline = closing − 5 calendar days（日期即可）
 */

import type { ClosingParse } from "./types";

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const CLOSING_PATTERNS: RegExp[] = [
  // RFSO cover: Solicitation Closes … At /à : 14 :00 MDT … On / le : August 18, 2026
  /Solicitation\s+Closes[\s\S]{0,220}?At\s*\/?\s*à\s*:\s*(\d{1,2})\s*:\s*(\d{2})\s*(MDT|MST|EDT|EST|PDT|PST|CDT|CST|UTC|GMT)[\s\S]{0,80}?On\s*\/?\s*le\s*:\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i,
  /(?:closing|bid\s*closing|solicitation\s*closes?)[:\s]+([0-9]{4}-[0-9]{2}-[0-9]{2}(?:\s+[0-9]{1,2}:[0-9]{2})?(?:\s*[A-Z]{2,5})?)/i,
  /(?:closing\s*date)[:\s]+([0-9]{4}-[0-9]{2}-[0-9]{2}(?:\s+[0-9]{1,2}:[0-9]{2})?(?:\s*[A-Z]{2,5})?)/i,
  /\b([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{1,2}:[0-9]{2}\s*(?:MDT|MST|EDT|EST|PDT|PST|CDT|CST|UTC|GMT))\b/i,
  /\b([A-Za-z]+\s+\d{1,2},\s*\d{4})\s+at\s+(\d{1,2}\s*:\s*\d{2})\s*(MDT|MST|EDT|EST|PDT|PST|CDT|CST|UTC|GMT)\b/i,
];

function parseYmd(rawDate: string): Date | null {
  const iso = rawDate
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (iso) {
    return new Date(
      Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0),
    );
  }
  const named = rawDate
    .trim()
    .match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!named) return null;
  const mo = MONTHS[named[1]!.toLowerCase()];
  if (!mo) return null;
  return new Date(Date.UTC(Number(named[3]), mo - 1, Number(named[2]), 12, 0, 0));
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
  // Prefer cover-page bilingual pattern (captures time/tz/date separately)
  const cover = text.match(CLOSING_PATTERNS[0]!);
  if (cover) {
    const hour = cover[1]!.padStart(2, "0");
    const minute = cover[2]!;
    const tz = cover[3]!.toUpperCase();
    const monthName = cover[4]!;
    const day = cover[5]!;
    const year = cover[6]!;
    const closingRaw = `${monthName} ${day}, ${year} ${hour}:${minute} ${tz}`;
    const closingDate = parseYmd(`${monthName} ${day}, ${year}`);
    return {
      closingRaw,
      closingDate,
      timezoneLabel: tz,
      enquiryDeadline: closingDate ? computeEnquiryDeadline(closingDate) : null,
      sourceSnippet: cover[0]!.replace(/\s+/g, " ").trim().slice(0, 400),
    };
  }

  for (let i = 1; i < CLOSING_PATTERNS.length; i++) {
    const re = CLOSING_PATTERNS[i]!;
    const m = text.match(re);
    if (!m) continue;

    // Pattern: Month D, YYYY at HH:MM TZ
    if (m[2] && m[3] && /[A-Za-z]/.test(m[1] ?? "")) {
      const time = m[2]!.replace(/\s+/g, "");
      const tz = m[3]!.toUpperCase();
      const closingRaw = `${m[1]!.trim()} ${time} ${tz}`;
      const closingDate = parseYmd(m[1]!.trim());
      return {
        closingRaw,
        closingDate,
        timezoneLabel: tz,
        enquiryDeadline: closingDate ? computeEnquiryDeadline(closingDate) : null,
        sourceSnippet: m[0]!.replace(/\s+/g, " ").trim().slice(0, 400),
      };
    }

    if (!m[1]) continue;
    const closingRaw = m[1].trim();
    const closingDate = parseYmd(closingRaw);
    const timezoneLabel =
      extractTimezoneLabel(closingRaw) ?? extractTimezoneLabel(m[0] ?? "");
    return {
      closingRaw,
      closingDate,
      timezoneLabel,
      enquiryDeadline: closingDate ? computeEnquiryDeadline(closingDate) : null,
      sourceSnippet: (m[0] ?? closingRaw).replace(/\s+/g, " ").trim().slice(0, 400),
    };
  }
  return null;
}

export function formatDateYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}
