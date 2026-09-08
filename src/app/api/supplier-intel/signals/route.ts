import { NextResponse, type NextRequest } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { resolveSubmitSignalScope } from "@/lib/supplier-intel/signal-scope";
import { createSubmittedSignal, listSignals } from "@/lib/supplier-intel/signal-service";

/**
 * R1（Trust-Boundary Closure）顺序不变量：
 *   flag 404-dark → 租户 → 有效项目归属解析（只读最小元数据）→ canonical 项目门
 *   （requireProjectWriteAccess）→ org 交叉校验 → 服务层（内部再断言一次，defense-in-depth）。
 * 列表不做逐条鉴权：listSignals 用「可访问项目集合 + 关系过滤」在单条查询里收口，
 * 无权项目的信号不会出现在列表/筛选/计数中。
 */

export async function GET(request: NextRequest) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const url = new URL(request.url);
  try {
    const signals = await listSignals(
      { orgId: tenant.orgId, userId: tenant.userId },
      {
        status: url.searchParams.get("status") ?? undefined,
        platform: url.searchParams.get("platform") ?? undefined,
      },
    );
    return NextResponse.json({ signals });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}

export async function POST(request: NextRequest) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });

  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  const pointers = {
    projectId: typeof body.projectId === "string" ? body.projectId : null,
    tenderId: typeof body.tenderId === "string" ? body.tenderId : null,
    searchRunId: typeof body.searchRunId === "string" ? body.searchRunId : null,
  };

  try {
    // 有效项目归属由服务端解析（含 Run 继承与混合指针冲突拒绝），再逐个过 canonical 写门
    const scope = await resolveSubmitSignalScope(actor, pointers);
    for (const projectId of scope.projectIds) {
      const access = await requireProjectWriteAccess(request, projectId);
      if (access instanceof NextResponse) return access;
      if (access.project.orgId !== tenant.orgId) {
        return NextResponse.json({ error: "项目不存在" }, { status: 404 });
      }
    }

    // trusted principal：orgId/userId 一律取自 tenant 上下文，body 里的同名字段不生效
    const signal = await createSubmittedSignal(actor, {
      url: typeof body.url === "string" ? body.url : null,
      rawText: typeof body.rawText === "string" ? body.rawText : null,
      manualEntry: body.manualEntry === true,
      projectId: pointers.projectId,
      tenderId: pointers.tenderId,
      searchRunId: pointers.searchRunId,
      rawMetadata: body.rawMetadata,
    });
    return NextResponse.json({ signal }, { status: 201 });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
