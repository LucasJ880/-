/**
 * 配置作用域（Prompt / Skill / Playbook / 知识库 / 审批 / 模块）
 * 本轮仅导出类型与优先级，不实现完整继承覆盖引擎。
 */

export type ConfigScope =
  | "PLATFORM"
  | "ORGANIZATION"
  | "WORKSPACE"
  | "PROJECT";

/** 下层可覆盖上层（安全/租户隔离规则除外） */
export const CONFIG_SCOPE_PRIORITY: ConfigScope[] = [
  "PLATFORM",
  "ORGANIZATION",
  "WORKSPACE",
  "PROJECT",
];
