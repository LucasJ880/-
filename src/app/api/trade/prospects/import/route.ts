/**
 * POST /api/trade/prospects/import
 *
 * 批量导入线索（展会名片、Excel 客户表等）
 * Content-Type: multipart/form-data
 * Fields: file (CSV/XLSX), campaignId, orgId?, source
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createProspect } from "@/lib/trade/service";
import { parseExcelBuffer, parseCsvText } from "@/lib/trade/importer";
import { db } from "@/lib/db";
import { loadTradeCampaignForOrg, resolveTradeOrgId } from "@/lib/trade/access";

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const campaignId = formData.get("campaignId") as string;
  const formOrgId = (formData.get("orgId") as string) || null;
  const source = (formData.get("source") as string) ?? "exhibition";

  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: formOrgId });
  if (!orgRes.ok) return orgRes.response;

  if (!file) {
    return NextResponse.json({ error: "请上传文件" }, { status: 400 });
  }
  if (!campaignId) {
    return NextResponse.json({ error: "请选择获客活动" }, { status: 400 });
  }

  const camp = await loadTradeCampaignForOrg(campaignId, orgRes.orgId);
  if (camp instanceof NextResponse) return camp;
  const { campaign } = camp;

  const fileName = file.name.toLowerCase();
  let rows;

  if (fileName.endsWith(".csv") || fileName.endsWith(".txt")) {
    const text = await file.text();
    rows = parseCsvText(text);
  } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    rows = parseExcelBuffer(buffer);
  } else {
    return NextResponse.json(
      { error: "仅支持 CSV、TXT、XLS、XLSX 格式" },
      { status: 400 },
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "未能解析出有效数据，请确认文件包含「公司名称」列" },
      { status: 400 },
    );
  }

  const incomingNames = Array.from(
    new Set(rows.map((r) => r.companyName).filter(Boolean)),
  );
  const existingNames = new Set(
    (
      await db.tradeProspect.findMany({
        where: { campaignId, orgId: campaign.orgId, companyName: { in: incomingNames } },
        select: { companyName: true },
      })
    ).map((p) => p.companyName.toLowerCase()),
  );

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (existingNames.has(row.companyName.toLowerCase())) {
      skipped++;
      continue;
    }

    try {
      await createProspect({
        campaignId,
        orgId: campaign.orgId,
        companyName: row.companyName,
        contactName: row.contactName,
        contactEmail: row.contactEmail,
        contactTitle: row.contactTitle,
        website: row.website,
        country: row.country,
        source,
      });
      existingNames.add(row.companyName.toLowerCase());
      created++;
    } catch (err) {
      errors.push(`${row.companyName}: ${err instanceof Error ? err.message : "未知错误"}`);
    }
  }

  return NextResponse.json({
    total: rows.length,
    created,
    skipped,
    errors: errors.slice(0, 10),
  });
}
