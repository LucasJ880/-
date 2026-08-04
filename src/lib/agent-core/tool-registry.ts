/**
 * 统一工具注册表
 *
 * Phase 2A：execute 层以 TenantContext.orgRole + membership 授权（canInvokeTool）。
 * QM Phase1：执行前 allowlist + ScopeGuard；requiresApproval 不直执。
 */

import type {
  ToolDefinition,
  ToolDomain,
  OpenAIToolSpec,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolAllowRoles,
} from "./types";
import type { PlatformRole } from "@/lib/rbac/roles";
import { canInvokeTool } from "@/lib/tenancy/tool-auth";
import { runPreExecuteGuards } from "./pre-execute-guard";
import { handleRequiresApproval } from "./approval-gate";

/** 未声明 allowRoles 的工具视为 admin-only（安全默认） */
const DEFAULT_ALLOW_ROLES: ToolAllowRoles = ["admin"];

function resolveAllowRoles(tool: ToolDefinition): ToolAllowRoles {
  return tool.allowRoles ?? DEFAULT_ALLOW_ROLES;
}

function normalizeRole(role: string | null | undefined): PlatformRole {
  if (role === "super_admin") return "admin";
  if (
    role === "admin" ||
    role === "manager" ||
    role === "sales" ||
    role === "trade" ||
    role === "user"
  ) {
    return role;
  }
  return "user";
}

function roleCanCall(tool: ToolDefinition, role: PlatformRole): boolean {
  const allow = resolveAllowRoles(tool);
  if (allow === "*") return true;
  return allow.includes(role);
}

export interface RegistryFilters {
  domains?: ToolDomain[];
  /**
   * 工具名过滤：
   * - undefined：不按名称过滤
   * - []：零工具
   * - 非空：仅列出名称
   */
  names?: string[];
  /** 遗留：按平台角色过滤（list 可见性） */
  role?: PlatformRole | string;
  /** Phase 2A：按组织角色收紧 list（viewer 仅 l0） */
  orgRole?: string;
  maxRisk?: "l0_read" | "l1_internal_write" | "l2_soft" | "l3_strong";
  /** 企业禁用工具 */
  disabledTools?: string[];
}

const RISK_ORDER: Record<NonNullable<RegistryFilters["maxRisk"]>, number> = {
  l0_read: 0,
  l1_internal_write: 1,
  l2_soft: 2,
  l3_strong: 3,
};

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] Overwriting tool: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(filters?: RegistryFilters): ToolDefinition[] {
    let result = Array.from(this.tools.values());
    if (filters?.domains?.length) {
      result = result.filter((t) => filters.domains!.includes(t.domain));
    }
    // 关键：names === undefined 不过滤；names === [] → 零工具
    if (filters?.names !== undefined) {
      const nameSet = new Set(filters.names);
      result = result.filter((t) => nameSet.has(t.name));
    }
    if (filters?.disabledTools?.length) {
      const banned = new Set(filters.disabledTools);
      result = result.filter((t) => !banned.has(t.name));
    }
    if (filters?.role) {
      const role = normalizeRole(filters.role);
      result = result.filter((t) => roleCanCall(t, role));
    }
    if (filters?.orgRole === "org_viewer") {
      result = result.filter((t) => (t.risk ?? "l0_read") === "l0_read");
    }
    if (filters?.maxRisk) {
      const cap = RISK_ORDER[filters.maxRisk];
      result = result.filter((t) => {
        const r = t.risk ?? "l0_read";
        return RISK_ORDER[r] <= cap;
      });
    }
    return result;
  }

  toOpenAITools(filters?: RegistryFilters): OpenAIToolSpec[] {
    return this.list(filters).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * 执行工具：pre-guard → canInvokeTool → requiresApproval 闸 → execute
   */
  async execute(
    name: string,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, data: null, error: `未知工具: ${name}` };
    }

    const pre = runPreExecuteGuards({ toolName: name, ctx });
    if (!pre.ok) {
      console.warn(
        `[ToolRegistry] Pre-execute deny: ${pre.code} tool=${name} org=${ctx.orgId}`,
      );
      return {
        success: false,
        data: { code: pre.code },
        error: pre.error,
      };
    }

    const decision = canInvokeTool({
      tenant: {
        userId: ctx.userId,
        orgId: ctx.orgId,
        orgRole: ctx.orgRole ?? "org_viewer",
        isPlatformAdmin: ctx.role === "admin" || ctx.role === "super_admin",
        workspaceIds: ctx.workspaceIds,
      },
      hasMembership: ctx.hasMembership === true,
      tool,
      workspaceId: ctx.workspaceId,
      workspaceRole: ctx.workspaceRole,
      maxRisk: ctx.maxRisk,
      modulesJson: ctx.modulesJson,
      toolPolicy: ctx.toolPolicy,
      workspaceToolPolicy: ctx.workspaceToolPolicy,
    });

    if (!decision.ok) {
      console.warn(
        `[ToolRegistry] Tenant/orgRole reject: ${decision.code} tool=${name} org=${ctx.orgId} orgRole=${ctx.orgRole}`,
      );
      return { success: false, data: null, error: decision.error };
    }

    // 关键：需要审批时绝不调用原工具 executor
    if (decision.requiresApproval || decision.needsApproval) {
      return handleRequiresApproval({ tool, ctx });
    }

    // Phase 3A-4：高风险 Tool 配额（l2+）
    const risk = tool.risk ?? "l0_read";
    const highRisk = risk === "l2_soft" || risk === "l3_strong";
    let reservationId: string | null = null;
    if (highRisk && ctx.orgId && ctx.hasMembership) {
      try {
        const { reserveQuota, commitReservation, releaseReservation } =
          await import("@/lib/capabilities/governance/reserve");
        const reserved = await reserveQuota({
          orgId: ctx.orgId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
          metric: "DAILY_HIGH_RISK_TOOL_CALLS",
          amount: 1,
          idempotencyKey: `tool:${ctx.orgId}:${name}:${ctx.agentRunId ?? ctx.sessionId ?? "nosession"}:${Date.now()}`,
        });
        if (!reserved.ok) {
          return {
            success: false,
            data: null,
            error: reserved.error ?? "高风险 Tool 配额已达 hard limit",
          };
        }
        reservationId = reserved.reservationId;
        const result = await tool.execute({
          ...ctx,
          role: normalizeRole(ctx.role),
        });
        if (result.success) {
          await commitReservation({
            reservationId,
            orgId: ctx.orgId,
            userId: ctx.userId,
          });
        } else {
          await releaseReservation({
            reservationId,
            orgId: ctx.orgId,
            userId: ctx.userId,
          });
        }
        return result;
      } catch (e) {
        if (reservationId) {
          const { releaseReservation } = await import(
            "@/lib/capabilities/governance/reserve"
          );
          await releaseReservation({
            reservationId,
            orgId: ctx.orgId,
            userId: ctx.userId,
          });
        }
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[ToolRegistry] Tool ${name} failed:`, msg);
        return { success: false, data: null, error: msg };
      }
    }

    const role = normalizeRole(ctx.role);

    try {
      return await tool.execute({ ...ctx, role });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ToolRegistry] Tool ${name} failed:`, msg);
      return { success: false, data: null, error: msg };
    }
  }

  get size(): number {
    return this.tools.size;
  }
}

export const registry = new ToolRegistry();
