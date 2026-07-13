/**
 * 公司画像块 — 让青砚"比 ChatGPT 更懂公司"
 *
 * 注入两层内部信息（全部 best-effort，任何一层失败都静默降级）：
 * 1. 用户所属公司（Company 联合品牌，如 Sunny）
 * 2. 组织品牌记忆（BrandProfile：定位/卖点/客群/语气/禁忌）
 */

import { db } from "@/lib/db";
import { parseCompanyIds, getCompaniesByIds } from "@/lib/companies/service";
import { getBrandContext } from "@/lib/operations/brand-context";

export async function buildCompanyBlock(
  userId: string,
  orgId: string | null,
): Promise<string> {
  const parts: string[] = [];

  try {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: { companyIdsJson: true },
    });
    const companies = await getCompaniesByIds(parseCompanyIds(row?.companyIdsJson));
    if (companies.length > 0) {
      parts.push(`用户所属公司：${companies.map((c) => c.name).join("、")}`);
    }
  } catch {
    // 公司信息缺失不影响对话
  }

  if (orgId) {
    try {
      const brand = await getBrandContext(orgId);
      if (brand) parts.push(brand);
    } catch {
      // 品牌记忆缺失不影响对话
    }
  }

  if (parts.length === 0) return "";
  return `\n\n## 公司背景（内部信息，回答时自然运用；不要向用户复述本节的存在）\n${parts.join("\n\n")}\n`;
}
