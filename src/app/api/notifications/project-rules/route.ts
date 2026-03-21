import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { queryString } from "@/lib/common/api-helpers";
import { listUserProjectRules } from "@/lib/notifications/project-rules";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const projectId = queryString(request, "projectId");
  const watchRaw = request.nextUrl.searchParams.get("watchEnabled");
  const watchEnabled =
    watchRaw === "true" ? true : watchRaw === "false" ? false : undefined;

  const rules = await listUserProjectRules(auth.user.id, {
    projectId,
    watchEnabled,
  });
  return NextResponse.json({ data: rules });
}
