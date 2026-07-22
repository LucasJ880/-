import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import { decideCapabilityApproval } from "@/lib/capabilities/approvals/decision";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ approvalId: string }> },
) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    const { approvalId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as {
      note?: string;
      idempotencyKey?: string;
      expectedPayloadHash?: string;
    };
    const result = await decideCapabilityApproval(access, {
      approvalId: decodeURIComponent(approvalId),
      action: "approve",
      note: body.note,
      idempotencyKey: body.idempotencyKey,
      expectedPayloadHash: body.expectedPayloadHash,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}
