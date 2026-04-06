import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json(
      { error: "未登录" },
      { status: 401, headers: { "x-auth-reason": "session" } }
    );
  }
  return NextResponse.json({ user });
}
