/**
 * PUT /api/projects/[id]/tender-rfq/auto-follow-up（RFQ-AUTO-3）
 *
 * 开启 / 关闭本人的开关「自动起草的轮次带跟进授权」。用项目做权限与组织的判定（要求项目写权限），
 * 写的是「登录的这个人在这个组织」的开关——只能改自己的，请求体里没有用户号。
 * 开启要求两个功能开关（跟进授权、自动起草）对该组织都打开，否则 404；关闭任何时候都可以。
 * 状态变了才追加一条记录（记录即状态）。
 * 本路由不发信、不建审批卡。
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { setAutoDraftFollowUpOptIn } from "@/lib/tender-rfq/auto-followup-optin-service";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ enabled: z.boolean() }).strict();

const STATUS_OF = { DISABLED: 404 } as const;

export async function PUT(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const orgId = access.project.orgId;
  if (!orgId) return NextResponse.json({ ok: false, error: "这个项目不属于任何组织。" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "请求体需要是 { enabled: true 或 false }。" }, { status: 400 });

  const result = await setAutoDraftFollowUpOptIn({ orgId, projectId, userId: access.user.id, enabled: parsed.data.enabled });
  if (!result.ok) return NextResponse.json({ ok: false, errorCode: result.errorCode, error: result.message }, { status: STATUS_OF[result.errorCode] });
  return NextResponse.json({ ok: true, state: result.state, changed: result.changed });
}
