/**
 * VIS-1e 预览 cookie 的写与清（spec authorization/position-preview「开启与退出预览」、design D4）。
 * httpOnly、生产 secure、lax、path /，与会话 cookie 同属性；2 小时。
 */

import type { NextResponse } from "next/server";
import { PREVIEW_COOKIE, PREVIEW_TTL_SECONDS } from "./token";

export function setPreviewCookie(response: NextResponse, token: string): void {
  response.cookies.set(PREVIEW_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PREVIEW_TTL_SECONDS,
  });
}

export function clearPreviewCookie(response: NextResponse): void {
  response.cookies.set(PREVIEW_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
