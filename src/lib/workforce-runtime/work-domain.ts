/**
 * T5 Segment 2.5 — 有效业务域解析（server 权威，fail-closed）
 *
 * 修正的语义错误：`toolDomainForWorkDomain` 此前把 **缺失/未知** workDomain
 * 映射成 `system`。那不是"最小权限"，而是把"不知道"当成了一个确定答案——
 * 后果是历史销售 Workforce Job（建 run 时还没有 workDomain 这个概念）
 * 在执行第一个工具时就 `org_role_denied`，而 platform admin 反而能跑通
 * （system 域允许 admin），等于"未知域"给了管理员一条静默旁路。
 *
 * 新规则：
 *   system 只能来自**显式** general。
 *   缺失/未知 → 不返回任何域，由本模块按下列优先级解析，解析不出即拒绝执行。
 *
 *   A. metadata.workDomain 显式    → EXPLICIT           （永远优先，不可被降级）
 *   B. metadata.projectId → Project.workDomain（canonical）→ PROJECT_CANONICAL
 *   C. 旧 run 的**持久化工具证据**全部属于销售执行集合 → LEGACY_SALES_COMPAT
 *   D. 其余                        → fail closed（work_domain_missing / _ambiguous）
 *
 * C 的证据必须是 durable server facts（AgentRunStep.preferredTool / planJson —
 * 两者都由 server 校验后写入），**不得**使用客户端字段、goal 自然语言、
 * 用户角色或时间戳猜测。工具的域归属从既有 registry 派生
 * （RUNTIME_V2_TOOL_CATALOG = 销售线；tender descriptor = 项目域），
 * 不新建第二份工具名单。
 */

import { db } from "@/lib/db";
import { getRuntimeV2Tool } from "@/lib/agent-runtime-v2/tool-catalog";
import { TENDER_WORKFORCE_TOOL_DESCRIPTORS } from "@/lib/tender-workforce/tools";

export const WORK_DOMAINS = ["tender", "delivery", "sales", "general"] as const;
export type WorkDomain = (typeof WORK_DOMAINS)[number];

export type WorkDomainResolutionSource =
  | "EXPLICIT"
  | "PROJECT_CANONICAL"
  | "LEGACY_SALES_COMPAT";

export type WorkDomainFailureCode =
  | "work_domain_missing"
  | "work_domain_ambiguous";

export type ResolveWorkDomainResult =
  | { ok: true; workDomain: WorkDomain; source: WorkDomainResolutionSource }
  | { ok: false; code: WorkDomainFailureCode; error: string };

/** 纯规范化：只接受已知域字面量，其它一律 null（不猜、不兜底） */
export function normalizeWorkDomain(value: unknown): WorkDomain | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (WORK_DOMAINS as readonly string[]).includes(v)
    ? (v as WorkDomain)
    : null;
}

/* ─────────────── 工具 → 域归属（从既有 registry 派生） ─────────────── */

const TENDER_TOOL_NAMES = new Set(
  TENDER_WORKFORCE_TOOL_DESCRIPTORS.map((d) => d.name),
);

export type ToolDomainClass = "sales" | "project" | "unknown";

/**
 * 工具的业务域归属。**不维护第二份名单**：
 *   RUNTIME_V2_TOOL_CATALOG（全局销售线工具目录）→ sales
 *   TENDER_WORKFORCE_TOOL_DESCRIPTORS（投标域执行 descriptor）→ project
 * 两边都不认识 → unknown（调用方 fail-closed）。
 */
export function toolDomainClass(toolName: string | null | undefined): ToolDomainClass {
  const name = (toolName ?? "").trim();
  if (!name) return "unknown";
  if (TENDER_TOOL_NAMES.has(name)) return "project";
  return getRuntimeV2Tool(name) ? "sales" : "unknown";
}

/**
 * 由一组持久化工具证据判定旧 run 的域。
 * 纯函数（便于穷举测试）：全部 sales → sales；出现 project 或 unknown → 歧义。
 * 空证据 → null（调用方按 missing 处理，绝不当成 sales）。
 */
export function classifyLegacyToolEvidence(
  toolNames: Array<string | null | undefined>,
):
  | { ok: true; workDomain: "sales" }
  | { ok: false; code: WorkDomainFailureCode; detail: string } {
  // native synthesis 等 server 控制的无工具步骤不构成证据，也不算未知
  const named = toolNames
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean);
  if (named.length === 0) {
    return {
      ok: false,
      code: "work_domain_missing",
      detail: "旧 run 没有任何持久化工具证据，无法证明其业务域",
    };
  }
  const classes = new Set(named.map(toolDomainClass));
  if (classes.has("unknown")) {
    const unknowns = named.filter((n) => toolDomainClass(n) === "unknown");
    return {
      ok: false,
      code: "work_domain_ambiguous",
      detail: `存在无法归类的工具：${unknowns.slice(0, 3).join(", ")}`,
    };
  }
  if (classes.has("project") && classes.has("sales")) {
    return {
      ok: false,
      code: "work_domain_ambiguous",
      detail: "同一 run 内混合了销售域与项目域工具",
    };
  }
  if (classes.has("project")) {
    // 项目域工具却没有 workDomain / project 归属 —— 绝不擅自归为 sales
    return {
      ok: false,
      code: "work_domain_ambiguous",
      detail: "工具属于项目域，但该 run 既无显式 workDomain 也无 canonical 项目",
    };
  }
  return { ok: true, workDomain: "sales" };
}

/* ─────────────────────── 有效域解析（含 DB 取证） ─────────────────────── */

export async function resolveEffectiveWorkDomain(input: {
  orgId: string;
  runId: string;
  /** AgentRun.metadata（server 写入） */
  runMetadata: Record<string, unknown> | null | undefined;
}): Promise<ResolveWorkDomainResult> {
  const meta = input.runMetadata ?? {};

  // A. 显式域永远优先，且不可被后续证据降级（§8）
  const explicit = normalizeWorkDomain(meta.workDomain);
  if (explicit) return { ok: true, workDomain: explicit, source: "EXPLICIT" };
  if (typeof meta.workDomain === "string" && meta.workDomain.trim()) {
    // 写了但不是已知域：这是配置错误，不是"旧数据"，不进兼容路径
    return {
      ok: false,
      code: "work_domain_ambiguous",
      error: `未支持的 workDomain：${meta.workDomain.trim().slice(0, 40)}`,
    };
  }

  // B. canonical 项目域优先于任何工具推断（§9）
  const projectId =
    typeof meta.projectId === "string" && meta.projectId.trim()
      ? meta.projectId.trim()
      : null;
  if (projectId) {
    const project = await db.project
      .findFirst({
        where: { id: projectId, orgId: input.orgId },
        select: { workDomain: true },
      })
      .catch(() => null);
    const fromProject = normalizeWorkDomain(project?.workDomain);
    if (fromProject) {
      return {
        ok: true,
        workDomain: fromProject,
        source: "PROJECT_CANONICAL",
      };
    }
    if (project) {
      return {
        ok: false,
        code: "work_domain_ambiguous",
        error: `项目 ${projectId} 的 workDomain 非法：${String(project.workDomain).slice(0, 40)}`,
      };
    }
    // 有 projectId 却查不到项目（跨 org / 已删）→ 绝不退回工具推断
    return {
      ok: false,
      code: "work_domain_ambiguous",
      error: `run 声明的项目 ${projectId} 不存在于本组织，无法确定业务域`,
    };
  }

  // C. 旧记录的窄兼容：只认 durable server facts
  const steps = await db.agentRunStep
    .findMany({
      where: { orgId: input.orgId, runId: input.runId },
      select: { preferredTool: true },
    })
    .catch(() => []);
  let evidence: Array<string | null> = steps.map((s) => s.preferredTool);
  if (evidence.filter(Boolean).length === 0) {
    // 计划已生成但 step 尚未落库的窗口：退回同样由 server 校验后持久化的 planJson
    const run = await db.agentRun
      .findFirst({
        where: { id: input.runId, orgId: input.orgId },
        select: { planJson: true },
      })
      .catch(() => null);
    const plan = run?.planJson as
      | { steps?: Array<{ preferredTool?: unknown }> }
      | null
      | undefined;
    evidence = (plan?.steps ?? []).map((s) =>
      typeof s?.preferredTool === "string" ? s.preferredTool : null,
    );
  }

  const classified = classifyLegacyToolEvidence(evidence);
  if (!classified.ok) {
    return {
      ok: false,
      code: classified.code,
      error: `${classified.detail}（run ${input.runId}）`,
    };
  }
  return {
    ok: true,
    workDomain: classified.workDomain,
    source: "LEGACY_SALES_COMPAT",
  };
}
