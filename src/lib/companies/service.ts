import { db } from "@/lib/db";

// ============================================================
// 公司（联合品牌）服务层
// 同一公司旗下用户左上角显示「青砚 × 公司logo」
// ============================================================

export interface CompanyBrand {
  id: string;
  name: string;
  slug: string;
  logoUrl: string;
}

/** 解析 companyIdsJson（JSON 数组），容错返回空数组 */
export function parseCompanyIds(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

/** 按 ids 顺序返回启用中的公司（第一个为主公司） */
export async function getCompaniesByIds(ids: string[]): Promise<CompanyBrand[]> {
  if (ids.length === 0) return [];
  const rows = await db.company.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, name: true, slug: true, logoUrl: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((c): c is CompanyBrand => Boolean(c));
}

/** 列出全部启用中的公司（邀请码/用户管理下拉用） */
export async function listActiveCompanies(): Promise<CompanyBrand[]> {
  return db.company.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, logoUrl: true },
    orderBy: { createdAt: "asc" },
  });
}
