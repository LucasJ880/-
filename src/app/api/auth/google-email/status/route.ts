import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEmailProvider } from "@/lib/google-email";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ connected: false });
  }

  const provider = await getEmailProvider(user.id);
  if (!provider || !provider.accessToken) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    email: provider.accountEmail,
    grantedScopes: provider.grantedScopes,
  });
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  const { db } = await import("@/lib/db");
  await db.emailProvider.deleteMany({
    where: { userId: user.id, type: "gmail" },
  });

  return NextResponse.json({ success: true });
}
