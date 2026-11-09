/** GET /api/projects/{id}/procurement-records（项目读权限）：Tender 详情「历史采购与资料申请」卡片——关联合同与该项目的资料申请 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { isProcurementSchemaReady, SCHEMA_NOT_READY } from "@/lib/procurement-records/flags";
import { getTenderProcurementSummary } from "@/lib/procurement-records/views";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  if (!isProcurementSchemaReady()) return NextResponse.json({ available: false, reason: SCHEMA_NOT_READY });
  if (!access.project.orgId) return NextResponse.json({ available: true, orgId: null, instruments: [], requests: [] });
  const summary = await getTenderProcurementSummary(access.project.orgId, id);
  return NextResponse.json({ available: true, orgId: access.project.orgId, ...summary });
}
