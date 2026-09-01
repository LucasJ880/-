import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess, requireProjectWriteAccess } from "@/lib/projects/access";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import {
  createProjectSearchRun,
  listProjectSearchRuns,
} from "@/lib/supplier-intel/project-run-service";

/**
 * B1+B3（S2 Final Review）：
 * - 客户端只提交 project 指针 + 检索提示；requirements 字段被完全忽略——canonical
 *   需求快照一律服务端读取（loadCanonicalSupplierRequirementSnapshot）。
 * - 顺序不变量：flag 404-dark → 租户 → canonical 项目门（requireProjectWrite/ReadAccess）
 *   → org 交叉校验 → 服务层（内部再断言一次，defense-in-depth）。
 * - 列表必须带 projectId（M1 project-scoped list，杜绝 org 全量需求快照泄露）。
 */

function strArray(v: unknown, cap = 20): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, cap);
}

export async function GET(request: NextRequest) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "必须提供 projectId（M1 列表为项目范围）" }, { status: 400 });
  }
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  if (access.project.orgId !== tenant.orgId) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  try {
    const runs = await listProjectSearchRuns(
      { orgId: tenant.orgId, userId: tenant.userId },
      projectId,
      { status: url.searchParams.get("status") ?? undefined },
    );
    return NextResponse.json({ runs });
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
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return NextResponse.json({ error: "projectId 必填（供应商搜索必须项目绑定）" }, { status: 400 });
  }

  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  if (access.project.orgId !== tenant.orgId) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const delivery = (body.delivery ?? {}) as Record<string, unknown>;
  try {
    const run = await createProjectSearchRun(
      { orgId: tenant.orgId, userId: tenant.userId },
      {
        projectId,
        allowLlm: body.useLlm !== false,
        hints: {
          productCategory: typeof body.productCategory === "string" ? body.productCategory : null,
          quantity: typeof body.quantity === "number" ? body.quantity : null,
          productKeywordsZh: strArray(body.productKeywordsZh),
          productKeywordsEn: strArray(body.productKeywordsEn),
          capabilityHintsZh: strArray(body.capabilityHintsZh),
          exclusions: strArray(body.exclusions),
          delivery: {
            country: typeof delivery.country === "string" ? delivery.country : null,
            province: typeof delivery.province === "string" ? delivery.province : null,
            city: typeof delivery.city === "string" ? delivery.city : null,
            requiredDate: typeof delivery.requiredDate === "string" ? delivery.requiredDate : null,
          },
        },
      },
    );
    return NextResponse.json({ run }, { status: 201 });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
