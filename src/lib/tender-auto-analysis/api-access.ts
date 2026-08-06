/**
 * Tender analysis API 共用鉴权辅助
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
  type ProjectAccessContext,
} from "@/lib/projects/access";

export function isAccessError(
  v: ProjectAccessContext | NextResponse,
): v is NextResponse {
  return v instanceof NextResponse;
}

/** 读：项目可见；跨 org 由 requireProjectReadAccess 返回 404/403 */
export async function requireTenderAnalysisRead(
  request: NextRequest,
  projectId: string,
): Promise<ProjectAccessContext | NextResponse> {
  return requireProjectReadAccess(request, projectId);
}

/** 写/批准：与 bid-intelligence go-decision 相同 — requireProjectWriteAccess */
export async function requireTenderAnalysisWrite(
  request: NextRequest,
  projectId: string,
): Promise<ProjectAccessContext | NextResponse> {
  return requireProjectWriteAccess(request, projectId);
}

export function missingOrgResponse(): NextResponse {
  return NextResponse.json({ error: "项目缺少组织" }, { status: 422 });
}

export function orgIdOf(access: ProjectAccessContext): string | null {
  return access.project.orgId?.trim() || null;
}
