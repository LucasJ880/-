/**
 * /api/organizations/[orgId]/tender-rfq-settings（org_admin）
 *   GET  → 询价发件设置 + 落地价换算设置（已解析，缺省为 null）
 *   PUT  { fromName?, fromEmail?, landedCost?: { fxRates?, fxAsOf?, fxSource?, freightEstimate?,
 *          exportInlandEstimate?, insurancePct?, clearanceFlatCad?, projects?: { [projectId]: { dutyRatePct?, deliveryDeadline? } | null } } }
 *        → 写 Organization.settingsJson.tenderRfq（零 schema）。传了的键覆盖，没传的保留；传 null 清空。
 *
 * 纪律：汇率必须带日期 + 来源（与 project-finance fxRateSource 同口径），不接受"只有数字"的汇率表。
 * 合并与校验规则在 landed-cost.ts（applyTenderRfqSettingsUpdate，有单测）；本文件只做鉴权、归属校验与落库。
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireOrgRole } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit/logger";
import {
  applyTenderRfqSettingsUpdate,
  readLandedCostSettings,
  tenderRfqSettingsPutSchema,
} from "@/lib/tender-rfq/landed-cost";
import { readTenderRfqSettings } from "@/lib/tender-rfq/round-pure";

type Params = { params: Promise<{ orgId: string }> };

function view(settingsJson: unknown) {
  const rfq = readTenderRfqSettings(settingsJson);
  return { fromName: rfq.fromName, fromEmail: rfq.fromEmail, landedCost: readLandedCostSettings(settingsJson) };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const auth = await requireOrgRole(request, orgId, "org_admin");
  if (auth instanceof NextResponse) return auth;
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  if (!org) return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  return NextResponse.json(view(org.settingsJson));
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const auth = await requireOrgRole(request, orgId, "org_admin");
  if (auth instanceof NextResponse) return auth;

  const parsed = tenderRfqSettingsPutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数不合法", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }

  const projectIds = Object.keys(parsed.data.landedCost?.projects ?? {});
  if (projectIds.length) {
    const owned = await db.project.count({ where: { id: { in: projectIds }, orgId } });
    if (owned !== projectIds.length) {
      return NextResponse.json({ error: "projects 里有不属于本组织的项目" }, { status: 400 });
    }
  }

  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  if (!org) return NextResponse.json({ error: "组织不存在" }, { status: 404 });

  const applied = applyTenderRfqSettingsUpdate(org.settingsJson, parsed.data);
  if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: 400 });

  await db.organization.update({ where: { id: orgId }, data: { settingsJson: applied.next as Prisma.InputJsonValue } });
  await logAudit({
    userId: auth.user.id,
    orgId,
    action: "tender_rfq_settings:update",
    targetType: "organization",
    targetId: orgId,
    beforeData: { tenderRfq: (org.settingsJson as { tenderRfq?: unknown } | null)?.tenderRfq ?? null },
    afterData: { tenderRfq: applied.tenderRfq },
    request,
  });
  return NextResponse.json(view(applied.next));
}
