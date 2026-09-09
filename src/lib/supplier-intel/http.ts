/**
 * 路由层域错误映射（统一实现，禁止各路由再复制）：
 * SupplierIntelError → {error, code} + httpStatus；其它异常上抛走 Next 500。
 */

import { NextResponse } from "next/server";
import { SupplierIntelError } from "./errors";

export function mapSupplierIntelError(err: unknown): NextResponse | null {
  if (err instanceof SupplierIntelError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.httpStatus });
  }
  return null;
}
