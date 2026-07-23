/**
 * 项目级调试面（Prompt / Agent / Tool / Trace / Feedback）访问：
 * 必须同时满足「平台管理员」+「项目可读/可管理」。
 * org_owner 不能仅凭组织角色进入。
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import {
  requireProjectManageAccess,
  requireProjectReadAccess,
  type ProjectAccessContext,
} from "@/lib/projects/access";

export async function requireDiagnosticProjectReadAccess(
  request: NextRequest,
  projectId: string,
): Promise<ProjectAccessContext | NextResponse> {
  const admin = await requirePlatformAdmin(request);
  if (admin instanceof NextResponse) return admin;
  return requireProjectReadAccess(request, projectId);
}

export async function requireDiagnosticProjectManageAccess(
  request: NextRequest,
  projectId: string,
): Promise<ProjectAccessContext | NextResponse> {
  const admin = await requirePlatformAdmin(request);
  if (admin instanceof NextResponse) return admin;
  return requireProjectManageAccess(request, projectId);
}
