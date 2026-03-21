import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { syncNotifications, listNotifications } from "@/lib/notifications/service";
import { queryString, queryPagination } from "@/lib/common/api-helpers";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  await syncNotifications(auth.user.id);

  const { page, pageSize } = queryPagination(request);
  const status = queryString(request, "status");
  const category = queryString(request, "category");
  const type = queryString(request, "type");
  const priority = queryString(request, "priority");
  const projectId = queryString(request, "projectId");

  const result = await listNotifications(auth.user.id, {
    page,
    pageSize,
    status,
    category,
    type,
    priority,
    projectId,
  });

  return NextResponse.json(result);
}
