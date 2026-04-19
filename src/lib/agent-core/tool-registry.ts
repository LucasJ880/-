/**
 * 统一工具注册表
 *
 * 所有 Agent 可调用的工具在此注册。支持：
 * - 按域（trade/sales/project/secretary）过滤
 * - 按角色（admin/sales/trade/user）过滤（PR1 新增）
 * - 自动转换为 OpenAI function calling 格式
 * - 运行时按名称查找执行（含角色防御性校验）
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

/** 未声明 allowRoles 的工具视为 admin-only（安全默认） */
const DEFAULT_ALLOW_ROLES: ToolAllowRoles = ["admin"];

function resolveAllowRoles(tool: ToolDefinition): ToolAllowRoles {
  return tool.allowRoles ?? DEFAULT_ALLOW_ROLES;
}

function normalizeRole(role: string | null | undefined): PlatformRole {
  if (role === "super_admin") return "admin";
  if (role === "admin" || role === "sales" || role === "trade" || role === "user") {
    return role;
  }
  return "user"; // 最低权限回退
}

function roleCanCall(tool: ToolDefinition, role: PlatformRole): boolean {
  const allow = resolveAllowRoles(tool);
  if (allow === "*") return true;
  return allow.includes(role);
}

export interface RegistryFilters {
  domains?: ToolDomain[];
  names?: string[];
  /** PR1：按角色过滤；未提供时不做角色过滤（供内部系统调用） */
  role?: PlatformRole | string;
  /** PR1：最高允许风险等级；用于只读模式（如主入口灰度） */
  maxRisk?: "l0_read" | "l1_internal_write" | "l2_soft" | "l3_strong";
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

  /** 列出所有工具；支持按域 / 名称 / 角色 / 风险过滤 */
  list(filters?: RegistryFilters): ToolDefinition[] {
    let result = Array.from(this.tools.values());
    if (filters?.domains?.length) {
      result = result.filter((t) => filters.domains!.includes(t.domain));
    }
    if (filters?.names?.length) {
      const nameSet = new Set(filters.names);
      result = result.filter((t) => nameSet.has(t.name));
    }
    if (filters?.role) {
      const role = normalizeRole(filters.role);
      result = result.filter((t) => roleCanCall(t, role));
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

  /** 转换为 OpenAI function calling 的 tools 格式 */
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
   * 执行一个工具
   *
   * 防御性角色校验：即使 list() 过滤被绕过（prompt injection / 未来接入其他通道），
   * execute 层会再检查一次。ctx.role 缺失时按 "user"（最低权限）处理。
   */
  async execute(
    name: string,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, data: null, error: `未知工具: ${name}` };
    }

    // —— RBAC 防御性校验 ——
    const role = normalizeRole(ctx.role);
    if (!roleCanCall(tool, role)) {
      console.warn(
        `[ToolRegistry] RBAC reject: role=${role} attempted ${name} (allowRoles=${JSON.stringify(resolveAllowRoles(tool))})`,
      );
      return {
        success: false,
        data: null,
        error: `当前角色（${role}）无权调用工具 ${name}`,
      };
    }

    try {
      // 确保下游工具拿到的 role 已归一化
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
