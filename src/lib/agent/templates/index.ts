/**
 * 流程模板注册中心
 */

import type { FlowTemplate } from "../types";
import { BID_PREPARATION_TEMPLATE } from "./bid-preparation";
import { PROJECT_INSPECTION_TEMPLATE } from "./project-inspection";
import { PROJECT_ONBOARDING_TEMPLATE } from "./project-onboarding";
import { AI_BID_PACKAGE_TEMPLATE } from "./ai-bid-package";

const PRESET_TEMPLATES: FlowTemplate[] = [
  BID_PREPARATION_TEMPLATE,
  PROJECT_INSPECTION_TEMPLATE,
  PROJECT_ONBOARDING_TEMPLATE,
  AI_BID_PACKAGE_TEMPLATE,
];

/**
 * 按 ID 获取模板
 */
export function getTemplate(id: string): FlowTemplate | undefined {
  return PRESET_TEMPLATES.find((t) => t.id === id);
}

/**
 * 根据意图文本匹配模板（关键词匹配）
 */
export function matchTemplate(intent: string): FlowTemplate | undefined {
  const lower = intent.toLowerCase();
  return PRESET_TEMPLATES.find((t) =>
    t.matchKeywords.some((kw) => lower.includes(kw))
  );
}

/**
 * 列出所有可用模板（供 UI 选择）
 */
export function listTemplates(): Array<{
  id: string;
  name: string;
  description: string;
  stepCount: number;
}> {
  return PRESET_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    stepCount: t.steps.length,
  }));
}
