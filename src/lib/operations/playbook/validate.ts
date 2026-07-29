/**
 * Playbook 完整度与校验（不替代发布安全 Lint — Phase C）
 */

import type {
  PlaybookContentFields,
  ValidationIssue,
  ValidationResult,
} from "./types";

const REQUIRED_FOR_APPROVAL: Array<{
  field: keyof PlaybookContentFields;
  label: string;
  minLen?: number;
}> = [
  { field: "accountRole", label: "账号角色", minLen: 2 },
  { field: "businessObjective", label: "商业目标", minLen: 8 },
  { field: "positioning", label: "定位", minLen: 8 },
  { field: "toneOfVoice", label: "语气", minLen: 4 },
  { field: "targetAudienceJson", label: "目标客户" },
  { field: "contentPillarsJson", label: "内容支柱" },
  { field: "ctaStrategyJson", label: "CTA 策略" },
];

function hasJsonValue(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function textOk(v: unknown, minLen: number): boolean {
  return typeof v === "string" && v.trim().length >= minLen;
}

export function validatePlaybookContent(content: PlaybookContentFields): {
  completenessScore: number;
  validationResult: ValidationResult;
  validationIssues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  let filled = 0;
  const total = REQUIRED_FOR_APPROVAL.length + 3; // +persona/kpi/forbidden soft

  for (const req of REQUIRED_FOR_APPROVAL) {
    const val = content[req.field];
    const ok =
      req.minLen != null
        ? textOk(val, req.minLen)
        : hasJsonValue(val);
    if (ok) filled += 1;
    else {
      issues.push({
        code: "MISSING_REQUIRED",
        severity: "error",
        field: String(req.field),
        message: `缺少必填：${req.label}`,
      });
    }
  }

  if (textOk(content.personaBackground, 8) || textOk(content.personality, 4)) {
    filled += 1;
  } else {
    issues.push({
      code: "MISSING_PERSONA",
      severity: "warn",
      field: "personaBackground",
      message: "建议补充人物背景或性格",
    });
  }

  if (hasJsonValue(content.kpiTargetsJson)) filled += 1;
  else {
    issues.push({
      code: "MISSING_KPI",
      severity: "warn",
      field: "kpiTargetsJson",
      message: "建议设置 KPI 目标",
    });
  }

  if (hasJsonValue(content.forbiddenTopicsJson)) filled += 1;
  else {
    issues.push({
      code: "MISSING_FORBIDDEN",
      severity: "warn",
      field: "forbiddenTopicsJson",
      message: "建议列出禁止话题",
    });
  }

  const pillars = content.contentPillarsJson;
  if (Array.isArray(pillars) && (pillars.length < 3 || pillars.length > 5)) {
    issues.push({
      code: "PILLARS_COUNT",
      severity: "warn",
      field: "contentPillarsJson",
      message: "内容支柱建议 3–5 个",
    });
  }

  const completenessScore = Math.min(
    100,
    Math.round((filled / total) * 100),
  );
  const hasError = issues.some((i) => i.severity === "error");
  const hasWarn = issues.some((i) => i.severity === "warn");
  const validationResult: ValidationResult = hasError
    ? "fail"
    : hasWarn
      ? "warn"
      : "pass";

  return { completenessScore, validationResult, validationIssues: issues };
}

export function canSubmitValidation(result: ValidationResult): boolean {
  return result === "pass" || result === "warn";
}
