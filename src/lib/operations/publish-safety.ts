/**
 * evaluatePublishSafety — Phase C 基础发布检查
 */

import { checkContentRules } from "./content-rules";
import type { PlaybookEnforcementMode } from "./playbook/enforcement";
import type { SimilarityResult } from "./similarity";

export type SafetySeverity = "info" | "warn" | "block";
export type SafetyResult = "pass" | "warn" | "block";

export type SafetyIssue = {
  code: string;
  severity: SafetySeverity;
  message: string;
  field?: string;
  suggestedFix?: string;
};

export type PublishSafetyInput = {
  captionText: string;
  hashtags?: string | null;
  ctaText?: string | null;
  hookText?: string | null;
  videoUrl?: string | null;
  platform?: string;
  accountStatus?: string;
  dailyQuota?: number;
  publishedTodayCount?: number;
  hasApprovedPlaybook: boolean;
  playbookCompletenessScore?: number | null;
  playbookValidationResult?: string | null;
  completenessThreshold?: number;
  enforcementMode: PlaybookEnforcementMode;
  /** 是否走自动发布（非人工） */
  autoPublish: boolean;
  brandForbiddenClaims?: string | null;
  similarity?: SimilarityResult | null;
  recentSameAccountTexts?: string[];
};

export type PublishSafetyOutput = {
  result: SafetyResult;
  score: number;
  issues: SafetyIssue[];
};

const SECRET_RE =
  /\b(api[_-]?key|secret|password|token|Bearer\s+[A-Za-z0-9._\-]+|sk-[A-Za-z0-9]{10,})\b/i;
const URL_RE = /https?:\/\/[^\s]+/gi;

export function evaluatePublishSafety(
  input: PublishSafetyInput,
): PublishSafetyOutput {
  const issues: SafetyIssue[] = [];
  const full = [input.hookText, input.captionText, input.ctaText, input.hashtags]
    .filter(Boolean)
    .join("\n");
  const completenessThreshold = input.completenessThreshold ?? 60;

  if (input.accountStatus && input.accountStatus !== "active") {
    issues.push({
      code: "ACCOUNT_INACTIVE",
      severity: "block",
      message: `账号状态为 ${input.accountStatus}，不可发布`,
    });
  }

  // Playbook 门禁
  if (!input.hasApprovedPlaybook) {
    if (input.enforcementMode === "enforce") {
      issues.push({
        code: "PLAYBOOK_REQUIRED",
        severity: "block",
        message: "enforce 模式要求有效批准 Playbook 才能进入发布审批",
        suggestedFix: "先批准账号或账号组 Playbook",
      });
    } else if (input.enforcementMode === "warn") {
      issues.push({
        code: "PLAYBOOK_NOT_APPROVED_LEGACY_FALLBACK",
        severity: input.autoPublish ? "block" : "warn",
        message:
          "当前账号没有有效批准的运营方案，本内容使用 BrandProfile / personaNotes 兼容上下文生成，不符合自动发布条件。",
        suggestedFix: "批准 Playbook 后可解除自动发布限制",
      });
    } else if (input.autoPublish) {
      issues.push({
        code: "PLAYBOOK_AUTO_BLOCKED",
        severity: "block",
        message: "无批准 Playbook，禁止自动发布",
      });
    }
  } else {
    if (
      typeof input.playbookCompletenessScore === "number" &&
      input.playbookCompletenessScore < completenessThreshold
    ) {
      issues.push({
        code: "PLAYBOOK_INCOMPLETE",
        severity: input.autoPublish ? "block" : "warn",
        message: `Playbook 完整度 ${input.playbookCompletenessScore} < ${completenessThreshold}`,
      });
    }
    if (input.playbookValidationResult === "fail") {
      issues.push({
        code: "PLAYBOOK_VALIDATION_FAIL",
        severity: "block",
        message: "Playbook 存在 block 级校验问题",
      });
    }
  }

  const rules = checkContentRules(full);
  for (const r of rules.reasons) {
    issues.push({
      code: rules.verdict === "block" ? "CONTENT_RULE_BLOCK" : "CONTENT_RULE_REVIEW",
      severity: rules.verdict === "block" ? "block" : "warn",
      message: r,
      field: "captionText",
    });
  }

  if (input.brandForbiddenClaims?.trim()) {
    const parts = input.brandForbiddenClaims
      .split(/[,，;；\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    for (const p of parts) {
      if (full.toLowerCase().includes(p.toLowerCase())) {
        issues.push({
          code: "BRAND_FORBIDDEN_CLAIM",
          severity: "block",
          message: `命中品牌禁止主张：${p}`,
          field: "captionText",
        });
      }
    }
  }

  if (SECRET_RE.test(full)) {
    issues.push({
      code: "SECRET_LEAK",
      severity: "block",
      message: "疑似包含密钥/Token/密码等敏感信息",
      field: "captionText",
    });
  }

  const urls = full.match(URL_RE) ?? [];
  for (const u of urls) {
    try {
      // eslint-disable-next-line no-new
      new URL(u.replace(/[),.]+$/, ""));
    } catch {
      issues.push({
        code: "BAD_URL",
        severity: "warn",
        message: `链接格式异常：${u.slice(0, 80)}`,
        field: "captionText",
      });
    }
  }

  if (!input.captionText?.trim() || input.captionText.trim().length < 8) {
    issues.push({
      code: "CAPTION_TOO_SHORT",
      severity: "block",
      message: "正文过短或缺失",
      field: "captionText",
    });
  }
  if (input.captionText && input.captionText.length > 2200) {
    issues.push({
      code: "CAPTION_TOO_LONG",
      severity: "warn",
      message: "正文过长，可能超出平台限制",
      field: "captionText",
    });
  }

  const tags = (input.hashtags ?? "")
    .split(/[\s,，]+/)
    .filter((t) => t.startsWith("#") || t.length > 0);
  const tagCount = (input.hashtags?.match(/#\w+/g) ?? []).length;
  if (tagCount > 30) {
    issues.push({
      code: "HASHTAG_TOO_MANY",
      severity: "warn",
      message: `Hashtag 数量 ${tagCount} 过多`,
      field: "hashtags",
    });
  }

  const letters = input.captionText.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 20) {
    const upper = letters.replace(/[^A-Z]/g, "").length;
    if (upper / letters.length > 0.7) {
      issues.push({
        code: "ALL_CAPS",
        severity: "warn",
        message: "英文大写占比过高",
        field: "captionText",
      });
    }
  }

  if (!input.ctaText?.trim() && !/dm|comment|link|询|私信|预约|quote/i.test(full)) {
    issues.push({
      code: "CTA_MISSING",
      severity: "warn",
      message: "未检测到明确 CTA",
      field: "ctaText",
      suggestedFix: "补充行动号召",
    });
  }

  if (!input.videoUrl?.trim()) {
    issues.push({
      code: "MEDIA_MISSING",
      severity: "block",
      message: "素材 URL 缺失",
      field: "videoUrl",
    });
  }

  if (
    typeof input.dailyQuota === "number" &&
    typeof input.publishedTodayCount === "number" &&
    input.publishedTodayCount >= input.dailyQuota
  ) {
    issues.push({
      code: "DAILY_QUOTA",
      severity: "block",
      message: `已达每日配额 ${input.dailyQuota}`,
    });
  }

  if (input.similarity?.duplicateRisk === "high") {
    issues.push({
      code: "CROSS_ACCOUNT_SIMILARITY",
      severity: "block",
      message: input.similarity.explanation,
      suggestedFix: "重写差异化文案后再提交",
    });
  } else if (input.similarity?.duplicateRisk === "medium") {
    issues.push({
      code: "CROSS_ACCOUNT_SIMILARITY",
      severity: "warn",
      message: input.similarity.explanation,
    });
  }

  if (input.recentSameAccountTexts?.length) {
    for (const prev of input.recentSameAccountTexts) {
      const a = input.captionText.trim().toLowerCase();
      const b = prev.trim().toLowerCase();
      if (a && b && (a === b || (a.length > 40 && b.includes(a.slice(0, 40))))) {
        issues.push({
          code: "SAME_ACCOUNT_REPEAT",
          severity: "warn",
          message: "与同账号近期文案高度重复",
        });
        break;
      }
    }
  }

  // 平台基础
  if (input.platform === "xiaohongshu" && full.length > 1000) {
    issues.push({
      code: "PLATFORM_LENGTH",
      severity: "warn",
      message: "小红书文案偏长",
    });
  }

  const hasBlock = issues.some((i) => i.severity === "block");
  const hasWarn = issues.some((i) => i.severity === "warn");
  const result: SafetyResult = hasBlock ? "block" : hasWarn ? "warn" : "pass";
  const penalty = issues.reduce(
    (s, i) => s + (i.severity === "block" ? 25 : i.severity === "warn" ? 8 : 2),
    0,
  );
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return { result, score, issues };
}

export function hasBlockIssues(out: PublishSafetyOutput): boolean {
  return out.result === "block" || out.issues.some((i) => i.severity === "block");
}
