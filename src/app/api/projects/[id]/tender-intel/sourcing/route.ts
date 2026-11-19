/**
 * GET /api/projects/[id]/tender-intel/sourcing（CHAIN-2）
 *
 * 情报页签「寻源建议」卡：推荐型号（已完成评估的主选 / 备选前 3）+ 价格对照三栏（可比授标 / 市场价格基准 / 我方落地价）。
 * 只给能读这个项目的人；开关关闭时 404。我方落地价一栏只给对本项目有财务查看权的人（没有权限时响应里没有这个键）。
 * 只读：不写任何数据、不发外部请求、不调模型。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { isAutoSupplierRunEnabledForOrg } from "@/lib/tender-intel/sourcing-flags";
import { loadSourcingSuggestions } from "@/lib/tender-intel/sourcing-suggestions";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access.status === 401 ? access : NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const orgId = access.project.orgId;
  if (!orgId || !isAutoSupplierRunEnabledForOrg(orgId)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const view = await loadSourcingSuggestions({ user: access.user, orgId, projectId });
  return NextResponse.json(view, { headers: { "Cache-Control": "private, no-store" } });
}
