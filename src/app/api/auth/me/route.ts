import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";

export const GET = withAuth(async (_request, _ctx, user) => {
  return NextResponse.json({ user });
});
