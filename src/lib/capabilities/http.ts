/**
 * Capabilities API 共用：TenantContext + membership
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireTenantContext } from "@/lib/tenancy";
import {
  buildCapabilitiesAccess,
  CapabilitiesAccessError,
} from "./access";
import type { CapabilitiesAccessContext } from "./types";

export async function requireCapabilitiesAccess(
  request: NextRequest,
): Promise<CapabilitiesAccessContext | NextResponse> {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;

  try {
    return await buildCapabilitiesAccess(tenant);
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}

export function capabilitiesErrorResponse(err: unknown): NextResponse {
  if (err instanceof CapabilitiesAccessError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.httpStatus },
    );
  }
  console.error("[capabilities]", err);
  return NextResponse.json({ error: "内部错误" }, { status: 500 });
}

export function parseDateParam(
  raw: string | null,
  fallback: Date,
): Date {
  if (!raw) return fallback;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return fallback;
  return d;
}
