/**
 * Revenue Spine — 客户四级去重（PART 2 / 六；PRD F2.3 调整顺序）
 *   1. email exact  2. phone（E.164 比对，国家提示取询盘 / 客户档案的国家，见 phone.ts）
 *   3. company domain（免费邮箱域名不算）  4. normalized company name（自动合并，行为不变）
 * 电话提前到第二级：WhatsApp 来信只有号码，同一买家随后在网站留邮箱 + 电话时据此合并到同一客户 / 商机。
 * 联系人与公司仍可区分：同域不同联系人 → 复用账户，contactName 记在互动与 RFQ 证据里（Account/Contact 拆分 = P1）。
 * 电话没有索引列（本轮不做迁移）：只在本组织最近更新的 500 个有电话的客户里比对。
 */

import { db } from "@/lib/db";
import { matchableEmailDomain, normalizeCompanyName, normalizeEmail, normalizePhone, websiteHost } from "./normalize";
import { phonesMatch, toE164 } from "./phone";

export type MatchLevel = "email" | "domain" | "company" | "phone";

export interface MatchInput {
  email?: string | null;
  company?: string | null;
  phone?: string | null;
  website?: string | null;
  /** 电话归一的国家提示（询盘填的国家） */
  country?: string | null;
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
  /** 至少 7 位数字时非空（末 10 位旧格式；只用来判断"有没有电话"，比对用 phonesMatch） */
  phone: string | null;
  /** E.164；无法确定（本地格式且没有国家提示）时为 null */
  phoneE164: string | null;
} {
  const email = normalizeEmail(input.email);
  const domain = matchableEmailDomain(email) ?? (input.website ? websiteHost(input.website) : null);
  return {
    email,
    domain: domain && !/^(gmail|yahoo|hotmail|outlook|icloud|qq|163|126)\./i.test(domain) ? domain : null,
    normalizedName: normalizeCompanyName(input.company),
    phone: normalizePhone(input.phone),
    phoneE164: toE164(input.phone, input.country),
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
  if (keys.phone) {
    const rows = await db.salesCustomer.findMany({
      where: { ...base, phone: { not: null } },
      select: { ...SELECT, country: true, createdAt: true },
      take: 500,
      orderBy: { updatedAt: "desc" },
    });
    // 同号多个客户：与其它各级一致取最早建立的
    const byPhone = rows
      .filter((r) => phonesMatch({ phone: input.phone, country: input.country }, { phone: r.phone, country: r.country }))
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())[0];
    if (byPhone) return { customer: byPhone, level: "phone", candidates };
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
  return { customer: null, level: null, candidates };
}
