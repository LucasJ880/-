import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { parseCompanyIds, getCompaniesByIds } from "@/lib/companies/service";

export const GET = withAuth(async (_request, _ctx, user) => {
  // 公司归属（联合品牌）：左上角显示「青砚 × 公司logo」
  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { companyIdsJson: true },
  });
  const companies = await getCompaniesByIds(parseCompanyIds(row?.companyIdsJson));

  return NextResponse.json({ user: { ...user, companies } });
});
