import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { listActiveCompanies } from "@/lib/companies/service";

/**
 * GET /api/admin/companies
 * 列出启用中的公司（邀请码创建 / 用户公司分配下拉用）
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const companies = await listActiveCompanies();
  return NextResponse.json({ companies });
}

/**
 * POST /api/admin/companies
 * 新建公司（联合品牌）
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const { name, slug, logoUrl } = body as {
    name?: string;
    slug?: string;
    logoUrl?: string;
  };

  if (!name?.trim() || !slug?.trim() || !logoUrl?.trim()) {
    return NextResponse.json(
      { error: "公司名称、slug、logo 地址均为必填项" },
      { status: 400 },
    );
  }

  const normalizedSlug = slug.trim().toLowerCase();
  const existing = await db.company.findUnique({ where: { slug: normalizedSlug } });
  if (existing) {
    return NextResponse.json({ error: "该公司 slug 已存在" }, { status: 409 });
  }

  const company = await db.company.create({
    data: {
      name: name.trim(),
      slug: normalizedSlug,
      logoUrl: logoUrl.trim(),
    },
  });

  return NextResponse.json({ company }, { status: 201 });
}
