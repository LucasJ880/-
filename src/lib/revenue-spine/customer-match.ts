/**
 * Revenue Spine — 客户四级去重（PART 2 / 六；PRD F2.3 调整顺序）
 *   1. email exact  2. phone（E.164 比对，国家提示取询盘 / 客户档案的国家，见 phone.ts）
 *   3. company domain（免费邮箱域名不算）  4. normalized company name（自动合并，行为不变）
 * 电话提前到第二级：WhatsApp 来信只有号码，同一买家随后在网站留邮箱 + 电话时据此合并到同一客户 / 商机。
 * 电话只在两边都能归一成可信 E.164 时参与（没有国家提示的本地号、0000000000 / 1234567890 这类占位号不参与）；
 * 两边都有企业邮箱域名且不同 → 不按电话合并（总机 / 共用号码不能压过域名），交给第 3 级域名判断。
 * 联系人与公司仍可区分：同域不同联系人 → 复用账户，contactName 记在互动与 RFQ 证据里（Account/Contact 拆分 = P1）。
 * 电话没有索引列（本轮不做迁移）：按国内号码数字在本组织客户里预筛（regexp_replace 去掉非数字后包含），再逐个精确比对。
 */

import { db } from "@/lib/db";
import { isFreeMailDomain, matchableEmailDomain, normalizeCompanyName, normalizeEmail, normalizePhone, websiteHost } from "./normalize";
import { matchablePhoneE164, phonesMatch, splitCallingCode } from "./phone";

/** 企业邮箱域名（去重用）：免费邮箱不算 */
function corporateDomain(domain: string | null | undefined): string | null {
  return domain && !isFreeMailDomain(domain) ? domain.toLowerCase() : null;
}

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
  /** 可参与去重的 E.164；无法确定（本地格式且没有国家提示）或是占位号时为 null */
  phoneE164: string | null;
} {
  const email = normalizeEmail(input.email);
  return {
    email,
    domain: matchableEmailDomain(email) ?? corporateDomain(websiteHost(input.website)),
    normalizedName: normalizeCompanyName(input.company),
    phone: normalizePhone(input.phone),
    phoneE164: matchablePhoneE164(input.phone, input.country),
  };
}

/**
 * 电话候选预筛（无索引列、无迁移）：客户电话去掉非数字后包含该号码的国内部分。任何 phonesMatch 能匹配上的
 * 写法（+44 (0)20…、0 开头的本地号、带分机、wa_id 的 521 / 549 前缀）数字串里都含国内号码，所以预筛只会多、不会漏。
 */
async function phoneCandidateIds(orgId: string, e164: string): Promise<string[]> {
  // 最多 50 个候选（之后逐个精确比对；同号多个客户本身就少见），最早建立的在前
  const digits = e164.slice(1);
  const national = splitCallingCode(digits)?.national ?? digits;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "SalesCustomer"
    WHERE "orgId" = ${orgId}
      AND "archivedAt" IS NULL
      AND "phone" IS NOT NULL
      AND regexp_replace("phone", '[^0-9]', '', 'g') LIKE ${`%${national}%`}
    ORDER BY "createdAt" ASC
    LIMIT 50`;
  return rows.map((r) => r.id);
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
  if (keys.phoneE164) {
    const ids = await phoneCandidateIds(orgId, keys.phoneE164);
    const rows = ids.length
      ? await db.salesCustomer.findMany({
          where: { ...base, id: { in: ids } },
          select: { ...SELECT, country: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
    // 同号多个客户：与其它各级一致取最早建立的
    const byPhone = rows.find((r) => {
      if (!phonesMatch({ phone: input.phone, country: input.country }, { phone: r.phone, country: r.country })) return false;
      // 同号但两边是不同的企业邮箱域名（总机 / 代理共用号码）→ 不按电话合并
      const existingDomain = corporateDomain(r.emailDomain);
      if (keys.domain && existingDomain && existingDomain !== keys.domain) {
        candidates.push({ id: r.id, name: r.name, level: "phone" });
        return false;
      }
      return true;
    });
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
