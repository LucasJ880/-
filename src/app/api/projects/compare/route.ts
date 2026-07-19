import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { compareProjects } from "@/lib/projects/compare";

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const projectIds = Array.isArray(body.projectIds)
    ? body.projectIds.filter((x: unknown) => typeof x === "string")
    : [];
  try {
    const rows = await compareProjects({
      userId: user.id,
      role: user.role ?? "user",
      projectIds,
    });
    return NextResponse.json({ projects: rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "对比失败" },
      { status: 400 },
    );
  }
});
