/**
 * R1（S2 Trust-Boundary Closure）：发现信号的**有效项目归属**与项目级授权贯穿。
 *
 * 缺口（上轮报告第 10 节记录、本轮修复）：signals 的 5 个 HTTP 入口只做了 org 级鉴权，
 * 于是同 org 内对项目 A 无任何权限的成员，能读取、改写、resolve 挂在项目 A 下的信号，
 * 列表也照单全收——而 Run 面（S2 B3）早已按 canonical 项目权限收口。信号携带的正是
 * Run 的产物（供应商线索、账号、resolutionJson 预填），可见性必须与 Run 同级。
 *
 * ── 有效归属规则（服务端解析，客户端不可断言）──────────────
 * 一条信号的**治理项目集合** = 以下非空指针的并集：
 *   signal.projectId、signal.tenderId、run.projectId、run.tenderId（run = signal.searchRunId）
 * 依据（既有语义，非新造）：
 *   - tenderId 与 projectId 在本域是同一张 Project 表的指针：createSubmittedSignal /
 *     createSearchRun 都用 assertProjectPointerInOrg(orgId, tenderId, "招标项目") 校验；
 *     createSearchRun 更是对 projectId 与 tenderId **各自**断言项目写权限。
 *   - signal.projectId 为 null 但挂在项目绑定 Run 上的信号，**不是**组织公共线索：
 *     createDiscoveredSignal 本身就用 `projectId ?? run.projectId` 继承 Run 归属。
 *
 * 判定纪律：
 *   - 集合内**每一个**项目都必须通过相应级别授权（不取最宽松的那一个，不自动重新归类）；
 *   - searchRunId 指向本 org 内不存在的 Run → 不可解析 → fail-closed（NOT_FOUND）；
 *   - 创建时客户端指针互相冲突（如 projectId=B 而 searchRunId 属于 A）→ 明确拒绝；
 *   - 集合为空 = 真正的组织级线索 → 沿用既有组织级授权（requireSupplierIntelAccess 已建立），
 *     不强行绑定项目。
 *
 * 授权级别（按操作，不按页面按钮）：
 *   read  = 查看单条（含 capability 附带信息）、列表/筛选/计数
 *   write = 创建、review、reject、link、resolve（resolve 会 append resolutionJson，是写）
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SupplierIntelActor } from "./actor";
import { assertProjectAccessForActor, listAccessibleProjectIdsForActor, type ProjectAccessLevel } from "./access";
import { SupplierIntelError } from "./errors";

/** 解析归属所需的最小信号元数据（**不含**任何受保护正文/备注/证据字段） */
export interface SignalScopePointers {
  projectId: string | null;
  tenderId: string | null;
  searchRunId: string | null;
}

/** Run 侧最小归属元数据 */
export interface RunScopePointers {
  id: string;
  projectId: string | null;
  tenderId: string | null;
}

export interface SignalProjectScope {
  /** 治理该信号的全部项目 id（去重、升序）；空 = 组织级线索 */
  projectIds: string[];
  /** 归属来源明细（审计用，不含受保护内容） */
  sources: Array<{ from: SignalScopeOrigin; projectId: string }>;
  orgLevel: boolean;
}

export type SignalScopeOrigin =
  | "signal.projectId"
  | "signal.tenderId"
  | "run.projectId"
  | "run.tenderId";

/**
 * 纯函数：由信号 + 其 Run 的指针合并出治理项目集合。
 * run=null 且 signal.searchRunId 非空的情形由调用方 fail-closed（本函数不猜）。
 */
export function mergeSignalProjectScope(
  signal: SignalScopePointers,
  run: RunScopePointers | null,
): SignalProjectScope {
  const sources: Array<{ from: SignalScopeOrigin; projectId: string }> = [];
  const push = (from: SignalScopeOrigin, id: string | null) => {
    const v = id?.trim();
    if (v) sources.push({ from, projectId: v });
  };
  push("signal.projectId", signal.projectId);
  push("signal.tenderId", signal.tenderId);
  push("run.projectId", run?.projectId ?? null);
  push("run.tenderId", run?.tenderId ?? null);

  const projectIds = [...new Set(sources.map((s) => s.projectId))].sort();
  return { projectIds, sources, orgLevel: projectIds.length === 0 };
}

/**
 * 纯函数：创建时的客户端指针一致性。
 * 客户端给了 projectId/tenderId 又给 searchRunId 时，指针必须与 Run 的归属一致——
 * 否则就是「用有权项目的 projectId + 无权项目的 searchRunId」混合绕过（R1-T5）。
 * 返回冲突明细（空数组 = 一致）。
 */
export function detectSubmitPointerConflicts(
  input: SignalScopePointers,
  run: RunScopePointers | null,
): string[] {
  if (!run) return [];
  const conflicts: string[] = [];
  const p = input.projectId?.trim() || null;
  const t = input.tenderId?.trim() || null;
  if (p && run.projectId && p !== run.projectId) {
    conflicts.push(`projectId=${p} 与 Run 的 projectId=${run.projectId} 不一致`);
  }
  if (p && !run.projectId && run.tenderId && p !== run.tenderId) {
    conflicts.push(`projectId=${p} 与 Run 的 tenderId=${run.tenderId} 不一致`);
  }
  if (t && run.tenderId && t !== run.tenderId) {
    conflicts.push(`tenderId=${t} 与 Run 的 tenderId=${run.tenderId} 不一致`);
  }
  // 对称补齐（R1 Edge Closure）：Run 只挂 projectId 时，客户端的 tenderId 同样要与之对质——
  // 否则 Run(projectId=A, tenderId=null) + Input(tenderId=B) 会静默通过，
  // 变成「用 B 的 tenderId 借 A 的 Run 建信号」的混合指针。
  if (t && !run.tenderId && run.projectId && t !== run.projectId) {
    conflicts.push(`tenderId=${t} 与 Run 的 projectId=${run.projectId} 不一致`);
  }
  return conflicts;
}

/**
 * 纯函数：信号列表的项目可见性 where 片段（一次查询完成，零 N+1）。
 *
 * 语义 = 「治理该信号的每一个项目都在允许集合内」，与单条断言同口径：
 *   projectId/tenderId 为 null 视为不施加约束；searchRunId 非空则通过 searchRun 关系
 *   把 Run 的两个指针一并纳入（关系过滤 = SQL join，不是逐条鉴权）。
 *
 * 第一段「归属可解析性」对**所有**角色成立（含 super_admin / org_admin）：挂着本 org
 * 解析不到的 Run 的信号，单条读取会 fail-closed，列表也必须一致地排除——否则同一行
 * 会出现「单条拒绝、列表可见」的裂缝。
 */
export function buildSignalProjectVisibilityFilter(
  scope: { unrestricted: true } | { unrestricted: false; projectIds: string[] },
  orgId: string,
): Prisma.SupplierDiscoverySignalWhereInput[] {
  const clauses: Prisma.SupplierDiscoverySignalWhereInput[] = [
    { OR: [{ searchRunId: null }, { searchRun: { is: { orgId } } }] },
  ];
  if (scope.unrestricted) return clauses;

  const allowed = scope.projectIds;
  const pointerOk = (field: "projectId" | "tenderId") =>
    ({ OR: [{ [field]: null }, { [field]: { in: allowed } }] }) as Prisma.SupplierDiscoverySignalWhereInput;

  clauses.push(
    pointerOk("projectId"),
    pointerOk("tenderId"),
    {
      OR: [
        { searchRunId: null },
        {
          searchRun: {
            is: {
              orgId,
              AND: [
                { OR: [{ projectId: null }, { projectId: { in: allowed } }] },
                { OR: [{ tenderId: null }, { tenderId: { in: allowed } }] },
              ],
            },
          },
        },
      ],
    },
  );
  return clauses;
}

/** 读取信号的最小归属元数据；不存在（或跨 org）→ null，不泄露存在性 */
export async function readSignalScopePointers(
  actor: SupplierIntelActor,
  signalId: string,
): Promise<(SignalScopePointers & { id: string }) | null> {
  return db.supplierDiscoverySignal.findFirst({
    where: { id: signalId, orgId: actor.orgId },
    // 归属元数据 only：授权前不读取 title/rawText/description/resolutionJson 等受保护内容
    select: { id: true, projectId: true, tenderId: true, searchRunId: true },
  });
}

/** 读取 Run 的最小归属元数据；本 org 内不存在 → null（调用方 fail-closed） */
export async function readRunScopePointers(
  actor: SupplierIntelActor,
  runId: string,
): Promise<RunScopePointers | null> {
  return db.supplierSearchRun.findFirst({
    where: { id: runId, orgId: actor.orgId },
    select: { id: true, projectId: true, tenderId: true },
  });
}

/**
 * 解析既有信号的治理项目集合（只读最小元数据）。
 * 信号不存在 → NOT_FOUND；searchRunId 指向不可解析的 Run → NOT_FOUND（fail-closed）。
 */
export async function resolveSignalProjectScope(
  actor: SupplierIntelActor,
  signalId: string,
): Promise<SignalProjectScope> {
  const signal = await readSignalScopePointers(actor, signalId);
  if (!signal) throw new SupplierIntelError("NOT_FOUND", "发现信号不存在");
  return resolveScopeForPointers(actor, signal);
}

async function resolveScopeForPointers(
  actor: SupplierIntelActor,
  pointers: SignalScopePointers,
): Promise<SignalProjectScope> {
  let run: RunScopePointers | null = null;
  if (pointers.searchRunId) {
    run = await readRunScopePointers(actor, pointers.searchRunId);
    if (!run) {
      // 引用不可解析：绝不降级成「组织级线索」（那是最宽松归属）
      throw new SupplierIntelError("NOT_FOUND", "信号关联的搜索运行不存在");
    }
  }
  return mergeSignalProjectScope(pointers, run);
}

/** 对治理集合内**每一个**项目断言给定级别（空集合 = 组织级线索，沿用既有 org 授权） */
export async function assertScopeAccess(
  actor: SupplierIntelActor,
  scope: SignalProjectScope,
  level: ProjectAccessLevel,
): Promise<void> {
  for (const projectId of scope.projectIds) {
    await assertProjectAccessForActor(actor, projectId, level);
  }
}

/** 既有信号：解析归属 + 断言级别，返回归属（服务层 defense-in-depth 入口） */
export async function assertSignalAccess(
  actor: SupplierIntelActor,
  signalId: string,
  level: ProjectAccessLevel,
): Promise<SignalProjectScope> {
  const scope = await resolveSignalProjectScope(actor, signalId);
  await assertScopeAccess(actor, scope, level);
  return scope;
}

/**
 * 创建路径：校验客户端指针（同 org 由调用方的 assertProjectPointerInOrg 负责）、
 * 拒绝混合指针冲突、返回治理集合。
 */
export async function resolveSubmitSignalScope(
  actor: SupplierIntelActor,
  input: SignalScopePointers,
): Promise<SignalProjectScope> {
  let run: RunScopePointers | null = null;
  if (input.searchRunId?.trim()) {
    run = await readRunScopePointers(actor, input.searchRunId.trim());
    if (!run) throw new SupplierIntelError("NOT_FOUND", "搜索运行不存在");
  }
  const conflicts = detectSubmitPointerConflicts(input, run);
  if (conflicts.length > 0) {
    throw new SupplierIntelError(
      "INVALID_INPUT",
      `项目指针冲突，拒绝创建（不取最宽松归属）：${conflicts.join("；")}`,
    );
  }
  return mergeSignalProjectScope(input, run);
}

/** 创建路径：解析归属 + 断言写权限 */
export async function assertSubmitSignalAccess(
  actor: SupplierIntelActor,
  input: SignalScopePointers,
): Promise<SignalProjectScope> {
  const scope = await resolveSubmitSignalScope(actor, input);
  await assertScopeAccess(actor, scope, "write");
  return scope;
}

/** 列表面：算一次可访问项目集合，转成 where 片段（零 N+1） */
export async function buildSignalListScopeFilter(
  actor: SupplierIntelActor,
): Promise<Prisma.SupplierDiscoverySignalWhereInput[]> {
  const scope = await listAccessibleProjectIdsForActor(actor, "read");
  return buildSignalProjectVisibilityFilter(scope, actor.orgId);
}
