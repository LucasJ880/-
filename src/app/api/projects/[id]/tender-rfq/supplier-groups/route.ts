/**
 * PUT /api/projects/[id]/tender-rfq/supplier-groups（RFQ-AUTO-5）
 *
 * 整份保存本人的供应商分组。用项目做权限与组织的判定（要求项目写权限），
 * 写的是「登录的这个人在这个组织」的分组——只能改自己的，请求体里没有用户号、没有组织号。
 * 请求体：{ baseVersion: 读到的那一版（从没保存过为 null）, groups: [{ name, supplierIds, keywords }] }。
 * 库里最新的不是 baseVersion → 409 并带回最新的分组，不覆盖。功能未对该组织开放 → 404。
 * 本路由不发信、不建审批卡。
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { buildSupplierGroupsEntryFor, saveSupplierGroups } from "@/lib/tender-rfq/supplier-groups-service";

type Params = { params: Promise<{ id: string }> };

// 只管外形；各项上限与内容规则由 validateSupplierGroups 逐条给出中文原因
const bodySchema = z
  .object({
    baseVersion: z.string().min(1).max(64).nullable(),
    groups: z.array(z.unknown()).max(50),
  })
  .strict();

const STATUS_OF = { DISABLED: 404, INVALID: 400, FOREIGN_SUPPLIER: 400, VERSION_CONFLICT: 409 } as const;

export async function PUT(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const orgId = access.project.orgId;
  if (!orgId) return NextResponse.json({ ok: false, error: "这个项目不属于任何组织。" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errorCode: "INVALID", error: "请求体需要是 { baseVersion, groups }。" }, { status: 400 });
  }

  const result = await saveSupplierGroups({ orgId, projectId, userId: access.user.id, baseVersion: parsed.data.baseVersion, groups: parsed.data.groups });
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: result.errorCode,
        error: result.message,
        ...(result.errorCode === "VERSION_CONFLICT" ? { supplierGroups: await buildSupplierGroupsEntryFor({ orgId, projectId, stored: result.current }) } : {}),
      },
      { status: STATUS_OF[result.errorCode] },
    );
  }
  return NextResponse.json({
    ok: true,
    changed: result.changed,
    supplierGroups: await buildSupplierGroupsEntryFor({ orgId, projectId, stored: { doc: result.doc, version: result.version } }),
  });
}
