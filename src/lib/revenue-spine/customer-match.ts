/**
 * Revenue Spine — 客户四级去重（PART 2 / 六）
 *   1. email exact  2. company domain  3. normalized company name  4. phone
 * 联系人与公司仍可区分：同域不同联系人 → 复用账户，contactName 记在互动与 RFQ 证据里（Account/Contact 拆分 = P1）。
 */

import { db } from "@/lib/db";
import { matchableEmailDomain, normalizeCompanyName, normalizeEmail, normalizePhone, websiteHost } from "./normalize";

export type MatchLevel = "email" | "domain" | "company" | "phone";

export interface MatchInput {
  email?: string | null;
  company?: string | null;
  phone?: string | null;
  website?: string | null;
}

export interface MatchedCustomer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  emailDomain: string | null;
  normalizedName: string | null;
  createdById: string;
}

export interface MatchResult {
  customer: MatchedCustomer | null;
  level: MatchLevel | null;
  /** 其它可能匹配（供人工合并提示） */
  candidates: Array<{ id: string; name: string; level: MatchLevel }>;
}

const SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  contactName: true,
  emailDomain: true,
  normalizedName: true,
  createdById: true,
} as const;

export function buildDedupeKeys(input: MatchInput): {
  email: string | null;
  domain: string | null;
  normalizedName: string | null;
  phone: string | null;
} {
  const email = normalizeEmail(input.email);
  const domain = matchableEmailDomain(email) ?? (input.website ? websiteHost(input.website) : null);
  return {
    email,
    domain: domain && !/^(gmail|yahoo|hotmail|outlook|icloud|qq|163|126)\./i.test(domain) ? domain : null,
    normalizedName: normalizeCompanyName(input.company),
    phone: normalizePhone(input.phone),
  };
}

export async function matchCustomer(orgId: string, input: MatchInput): Promise<MatchResult> {
  const keys = buildDedupeKeys(input);
  const candidates: MatchResult["candidates"] = [];
  const base = { orgId, archivedAt: null } as const;

  if (keys.email) {
    const byEmail = await db.salesCustomer.findFirst({
      where: { ...base, email: { equals: keys.email, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
      select: SELECT,
    });
    if (byEmail) return { customer: byEmail, level: "email", candidates };
  }
  if (keys.domain) {
    const byDomain = await db.salesCustomer.findFirst({
      where: { ...base, emailDomain: keys.domain },
      orderBy: { createdAt: "asc" },
      select: SELECT,
    });
    if (byDomain) return { customer: byDomain, level: "domain", candidates };
  }
  if (keys.normalizedName) {
    const byName = await db.salesCustomer.findFirst({
      where: { ...base, normalizedName: keys.normalizedName },
      orderBy: { createdAt: "asc" },
      select: SELECT,
    });
    if (byName) return { customer: byName, level: "company", candidates };
  }
  if (keys.phone) {
    const rows = await db.salesCustomer.findMany({
      where: { ...base, phone: { not: null } },
      select: SELECT,
      take: 500,
      orderBy: { updatedAt: "desc" },
    });
    const byPhone = rows.find((r) => normalizePhone(r.phone) === keys.phone);
    if (byPhone) return { customer: byPhone, level: "phone", candidates };
  }
  return { customer: null, level: null, candidates };
}
