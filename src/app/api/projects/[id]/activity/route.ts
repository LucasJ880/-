import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { listProjectActivity } from "@/lib/activity/query";
import { queryString, queryPagination } from "@/lib/common/api-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const { page, pageSize } = queryPagination(request);
  const startDate = queryString(request, "startDate");
  const endDate = queryString(request, "endDate");
  const targetType = queryString(request, "targetType");
  const action = queryString(request, "action");

  const result = await listProjectActivity(id, {
    page,
    pageSize,
    startDate,
    endDate,
    targetType,
    action,
  });

  return NextResponse.json(result);
}
