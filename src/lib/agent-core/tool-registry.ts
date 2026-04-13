/**
 * 统一工具注册表
 *
 * 所有 Agent 可调用的工具在此注册。支持：
 * - 按域（trade/sales/project/secretary）过滤
 * - 自动转换为 OpenAI function calling 格式
 * - 运行时按名称查找执行
 */

import type {
  ToolDefinition,
  ToolDomain,
  OpenAIToolSpec,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

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

  /** 列出所有工具（可按域过滤） */
  list(filters?: { domains?: ToolDomain[]; names?: string[] }): ToolDefinition[] {
    let result = Array.from(this.tools.values());
    if (filters?.domains?.length) {
      result = result.filter((t) => filters.domains!.includes(t.domain));
    }
    if (filters?.names?.length) {
      const nameSet = new Set(filters.names);
      result = result.filter((t) => nameSet.has(t.name));
    }
    return result;
  }

  /** 转换为 OpenAI function calling 的 tools 格式 */
  toOpenAITools(filters?: { domains?: ToolDomain[]; names?: string[] }): OpenAIToolSpec[] {
    return this.list(filters).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /** 执行一个工具 */
  async execute(
    name: string,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, data: null, error: `未知工具: ${name}` };
    }

    try {
      return await tool.execute(ctx);
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
