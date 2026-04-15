import type { ToolExecutionResult } from "../types";

export function ok(data: unknown): ToolExecutionResult {
  return { success: true, data };
}
