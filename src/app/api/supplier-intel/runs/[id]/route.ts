import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess, requireProjectWriteAccess } from "@/lib/projects/access";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { getProjectSearchRun } from "@/lib/supplier-intel/project-run-service";
import { classifyRunExecutionState } from "@/lib/supplier-intel/run-execution-state";
import { cancelSearchRun } from "@/lib/supplier-intel/run-service";

type Ctx = { params: Promise<{ id: string }> };

/** FR3-A：内部来源命中的供应商必须能被点开看到，最多列这么多（其余给出计数） */
const INTERNAL_CANDIDATE_LIST_CAP = 50;

/**
 * B3：Run 携带 requirement/brief/queries 快照——读取必须过 canonical 项目读权限。
 *
 * FR3-A：内部来源产出的是 SupplierCandidate（不是 Signal）。以前这里只回计数，
 * 于是「内部源 SUCCESS 2 条」在界面上无法点开——采购同事根本不知道是哪两家。
 * 这里如实回候选清单，语义是**内部候选**：来自本组织已有供应商库/历史合作/企业记忆，
 * 不是推荐、不是合格、不是首选。
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  try {
    const run = await getProjectSearchRun({ orgId: tenant.orgId, userId: tenant.userId }, id);
    const access = await requireProjectReadAccess(request, run.projectId!);
    if (access instanceof NextResponse) return access;
    if (access.project.orgId !== tenant.orgId) {
      return NextResponse.json({ error: "搜索运行不存在" }, { status: 404 });
    }
    const [candidateCount, signalCount, candidateRows] = await Promise.all([
      db.supplierCandidate.count({ where: { orgId: tenant.orgId, searchRunId: run.id } }),
      db.supplierDiscoverySignal.count({ where: { orgId: tenant.orgId, searchRunId: run.id } }),
      db.supplierCandidate.findMany({
        where: { orgId: tenant.orgId, searchRunId: run.id },
        orderBy: { createdAt: "asc" },
        take: INTERNAL_CANDIDATE_LIST_CAP,
        select: {
          id: true,
          supplierId: true,
          originSource: true,
          createdAt: true,
          supplier: {
            select: { id: true, name: true, website: true, region: true, category: true },
          },
        },
      }),
    ]);
    return NextResponse.json({
      run,
      executionState: classifyRunExecutionState(run, new Date()),
      counts: { candidates: candidateCount, signals: signalCount },
      candidates: candidateRows.map((c) => ({
        id: c.id,
        supplierId: c.supplierId,
        originSource: c.originSource,
        name: c.supplier?.name ?? null,
        website: c.supplier?.website ?? null,
        region: c.supplier?.region ?? null,
        category: c.supplier?.category ?? null,
      })),
      candidatesTruncated: candidateCount > candidateRows.length,
    });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}

/**
 * FR1-F：采购人员的恢复出口。唯一支持的动作是 `cancel`——
 * 把一次卡住/结果未知的搜索显式收进终态，之后只能新建 Run 重搜（终态不重入）。
 * 这里刻意**不**提供「重置声明后原地重跑」：那等价于接管，无法证明旧 executor 已经停手。
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (action !== "cancel") {
    return NextResponse.json({ error: "action 只支持 cancel" }, { status: 400 });
  }

  try {
    const actor = { orgId: tenant.orgId, userId: tenant.userId };
    const run = await getProjectSearchRun(actor, id);
    const access = await requireProjectWriteAccess(request, run.projectId!);
    if (access instanceof NextResponse) return access;
    if (access.project.orgId !== tenant.orgId) {
      return NextResponse.json({ error: "搜索运行不存在" }, { status: 404 });
    }
    const cancelled = await cancelSearchRun(actor, id);
    return NextResponse.json({ run: cancelled });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
