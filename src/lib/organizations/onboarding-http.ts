/**
 * 入驻向导 API 共用：请求体解析与错误映射（仅供 /api/admin/onboarding/* 路由）
 */

import { NextRequest, NextResponse } from "next/server";
import { OnboardingError } from "./onboarding";

export async function readJsonBody(request: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    const text = await request.text();
    return { ok: true, body: text.trim() ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "请求体格式错误" }, { status: 400 }) };
  }
}

export function validationErrorResponse(errors: string[]): NextResponse {
  return NextResponse.json({ error: errors.join("；"), errors }, { status: 400 });
}

export function onboardingErrorResponse(err: unknown, logTag: string): NextResponse {
  if (err instanceof OnboardingError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error(`[onboarding] ${logTag} failed:`, err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "操作失败，请稍后重试" }, { status: 500 });
}
