import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/google-calendar";

export async function GET() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "Google OAuth 未配置。请在 .env 中设置 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET" },
      { status: 500 }
    );
  }

  const url = getAuthUrl();
  return NextResponse.redirect(url);
}
