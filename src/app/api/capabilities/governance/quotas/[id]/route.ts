/**
 * PATCH /api/capabilities/governance/quotas/{id}
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import {
  assertCanWriteOrgQuota,
  assertCanWriteWorkspaceQuota,
  patchQuotaPolicy,
} from "@/lib/capabilities/governance";
import { db } from "@/lib/db";
import { CapabilitiesAccessError } from "@/lib/capabilities/access";

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    const { id } = await ctx.params;
    const current = await db.capabilityQuotaPolicy.findFirst({
      where: { id, orgId: access.orgId },
    });
    if (!current) {
      throw new CapabilitiesAccessError("策略不存在", "NOT_FOUND", 404);
    }

    if (current.workspaceId) {
      await assertCanWriteWorkspaceQuota(access, current.workspaceId);
    } else {
      assertCanWriteOrgQuota(access);
    }

    const body = (await request.json()) as {
      expectedVersion?: number;
      warningLimit?: number | null;
      softLimit?: number | null;
      hardLimit?: number | null;
      enabled?: boolean;
    };

    if (body.expectedVersion == null) {
      return NextResponse.json(
        { error: "expectedVersion 必填" },
        { status: 400 },
      );
    }

    const row = await patchQuotaPolicy({
      orgId: access.orgId,
      userId: access.userId,
      id,
      expectedVersion: body.expectedVersion,
      warningLimit: body.warningLimit,
      softLimit: body.softLimit,
      hardLimit: body.hardLimit,
      enabled: body.enabled,
    });

    return NextResponse.json({ policy: row });
  } catch (err) {
    const code = (err as Error & { code?: string }).code;
    if (code === "version_conflict") {
      return NextResponse.json(
        { error: "版本冲突，请刷新后重试", code: "VERSION_CONFLICT" },
        { status: 409 },
      );
    }
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("不得高于")) {
      return NextResponse.json(
        { error: msg, code: "POLICY_RELAX_DENIED" },
        { status: 400 },
      );
    }
    return capabilitiesErrorResponse(err);
  }
}
