import { NextResponse } from "next/server";
import { getEmailAuthUrl } from "@/lib/google-email";

export async function GET() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirect = process.env.GOOGLE_EMAIL_REDIRECT_URI?.trim();
  if (!id || !secret || !redirect) {
    return NextResponse.json(
      {
        error:
          "Gmail 邮件 OAuth 未配置。请在部署环境中设置 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET 与 GOOGLE_EMAIL_REDIRECT_URI",
      },
      { status: 500 }
    );
  }

  const url = getEmailAuthUrl();
  return NextResponse.redirect(url);
}
