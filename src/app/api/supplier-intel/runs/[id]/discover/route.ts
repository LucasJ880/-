import { NextResponse, type NextRequest } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { executeSupplierSearchRun } from "@/lib/supplier-intel/discovery-service";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { getProjectSearchRun } from "@/lib/supplier-intel/project-run-service";
import {
  claimRunExecution,
  releaseRunExecution,
  startSearchRun,
} from "@/lib/supplier-intel/run-service";

type Ctx = { params: Promise<{ id: string }> };

/**
 * FR1-E 输入白名单：这个入口只表达一件事——「执行这个 Run」。
 *
 * 执行策略（是否收口、是否带内部池、内部池上限）由服务端固定，**不接受请求体控制**。
 * 采购工作台不需要这些开关；把它们留在公开 HTTP body 上，等于让任何能发请求的人
 * 把一次搜索退化成「不收口、跳过内部源、拉满上限」的形态。S4 的组合编排如果需要
 * 别的策略，走内部 service 调用（executeSupplierSearchRun 直接传 opts），不再走这里。
 */
const S3A_EXECUTION_POLICY = {
  includeInternalPool: true,
  finalize: true,
  /** undefined = 由 adapter 自己的默认上限决定（服务端策略，不由客户端指定） */
  internalPoolLimit: undefined as number | undefined,
} as const;

/**
 * B3 外呼顺序不变量：flag → 租户 → canonical 项目写权限（外呼前）→ 执行
 * （executeSupplierSearchRun 内部在任何计划/provider 调用前再断言一次，defense-in-depth；
 *   无权限路径 provider 调用数恒 0）。
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const actor = { orgId: tenant.orgId, userId: tenant.userId };

  try {
    const run = await getProjectSearchRun(actor, id);
    const access = await requireProjectWriteAccess(request, run.projectId!);
    if (access instanceof NextResponse) return access;
    if (access.project.orgId !== tenant.orgId) {
      return NextResponse.json({ error: "搜索运行不存在" }, { status: 404 });
    }
    // S3-A：服务端重复执行保护——先认领（短锁 CAS），认领失败即 409，
    // 不依赖前端 disabled；刷新/重复点击/客户端重试都撞在这里。
    // FR1-B：认领句柄带唯一 claimId，释放时凭它证明自己仍是当前 executor。
    const lease = await claimRunExecution(actor, id);
    try {
      if (run.status === "PLANNED") {
        await startSearchRun(actor, id); // PLANNED → RUNNING（审计 run.started）
      }
      const result = await executeSupplierSearchRun(actor, id, S3A_EXECUTION_POLICY);
      return NextResponse.json({ result });
    } finally {
      await releaseRunExecution(actor, id, lease.claimId);
    }
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
