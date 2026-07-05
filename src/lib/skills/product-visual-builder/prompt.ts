/**
 * product-visual-builder — prompt 组装纯函数（Phase 1A）
 *
 * 纯函数：不调用数据库 / AI / blob，不读取历史记忆。
 * 仅根据输入按固定顺序拼装 finalPrompt + 固定 warnings + 实际使用的事实。
 */

import type {
  VisualBuilderInput,
  VisualConstraints,
  VisualProductFacts,
} from "./types";

const NOT_PROVIDED = "not provided（未提供）";

/** 固定免责声明，任何生成都必须附带。 */
export const FIXED_WARNINGS: readonly string[] = [
  "生成图为展示性素材，可能与真实产品存在差异，请以实物/原图为准。",
  "认证信息仅按用户提供的内容原样展示，最终以官方证书为准。",
  "本生成图不得直接作为最终规格/合规证明文件。",
  "需人工确认后方可用于官网或对客户发布。",
];

const STYLE_LABELS: Record<string, string> = {
  warm_home: "温馨家居氛围（warm home lifestyle）",
  hotel: "酒店质感（hotel premium）",
  white_background: "纯白背景棚拍（clean white background studio）",
  spec_sheet: "规格说明图（spec-sheet, 信息清晰）",
  ecommerce: "电商主图（ecommerce listing）",
};

const USE_CASE_LABELS: Record<string, string> = {
  website: "官网展示（构图大气，预留文案空间）",
  catalog: "产品目录（规整统一）",
  quote_attachment: "报价附图（清晰直观）",
  whatsapp_sales: "WhatsApp 销售素材（手机端友好）",
  internal_review: "内部评审（仅供内部确认）",
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  zh: "中文",
  bilingual: "中英双语 / bilingual",
};

const GLOBAL_GUARDRAILS = [
  "全局铁律（不可违反）：",
  "1. 真实产品照片是唯一事实来源。",
  "2. 不得改变产品本体：结构、材质、版型、颜色、纹理、logo/标签位置、尺寸比例。",
  "3. 严禁编造认证、材质、尺寸、克重(GSM)、MOQ、护理说明、产地。",
  "4. 未提供的信息必须标注为 not provided（未提供），不得脑补。",
  "5. 认证只能按用户提供内容原样展示，最终以官方证书为准。",
  "6. 输出默认 humanReviewRequired=true。",
  "7. 第一版只生成建议和素材，不自动发布官网或客户资料。",
].join("\n");

function normalizeFactValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    const cleaned = value.map((v) => (v ?? "").trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned.join("、") : null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const FACT_FIELDS: { key: keyof VisualProductFacts; label: string }[] = [
  { key: "material", label: "材质 material" },
  { key: "sizes", label: "尺寸 sizes" },
  { key: "colors", label: "颜色 colors" },
  { key: "structure", label: "结构 structure" },
  { key: "texture", label: "纹理 texture" },
  { key: "packaging", label: "包装 packaging" },
  { key: "labelLogoOptions", label: "标签/Logo labelLogoOptions" },
  { key: "careInstructions", label: "护理说明 careInstructions" },
];

function buildProductFactsSection(
  facts: VisualProductFacts | undefined,
): { lines: string[]; used: Record<string, unknown> } {
  const lines: string[] = ["【产品事实 Product Facts】"];
  const used: Record<string, unknown> = {};
  for (const { key, label } of FACT_FIELDS) {
    const norm = normalizeFactValue(facts?.[key]);
    if (norm === null) {
      lines.push(`- ${label}: ${NOT_PROVIDED}`);
    } else {
      lines.push(`- ${label}: ${norm}`);
      used[key] = facts?.[key];
    }
  }
  return { lines, used };
}

function buildConstraintsSection(constraints: VisualConstraints | undefined): string[] {
  const lines: string[] = ["【硬约束 Hard Constraints】"];
  const mustKeep = constraints?.mustKeep?.filter(Boolean) ?? [];
  const mustNotAdd = constraints?.mustNotAdd?.filter(Boolean) ?? [];
  const forbiddenClaims = constraints?.forbiddenClaims?.filter(Boolean) ?? [];
  const certRules = constraints?.certificationRules?.trim();

  lines.push(`- 必须保留 mustKeep: ${mustKeep.length ? mustKeep.join("、") : NOT_PROVIDED}`);
  lines.push(`- 不得添加 mustNotAdd: ${mustNotAdd.length ? mustNotAdd.join("、") : NOT_PROVIDED}`);
  lines.push(
    `- 禁止声明 forbiddenClaims: ${forbiddenClaims.length ? forbiddenClaims.join("、") : NOT_PROVIDED}`,
  );
  lines.push(`- 认证展示规则 certificationRules: ${certRules || NOT_PROVIDED}`);
  return lines;
}

function buildSourceImageRolesSection(input: VisualBuilderInput): string[] {
  const lines: string[] = ["【源图角色 Source Image Roles】"];
  const urls = input.sourceImageUrls ?? [];
  const roles = input.sourceImageRoles ?? [];
  if (urls.length === 0) {
    lines.push(`- ${NOT_PROVIDED}`);
    return lines;
  }
  urls.forEach((_, i) => {
    const role = roles[i] ?? "other";
    lines.push(`- 第 ${i + 1} 张: 角色=${role}`);
  });
  return lines;
}

function buildCertificationsSection(input: VisualBuilderInput): string[] {
  const lines: string[] = ["【认证 Certifications（仅按原文展示）】"];
  const certs = input.certifications ?? [];
  if (certs.length === 0) {
    lines.push(`- ${NOT_PROVIDED}`);
    return lines;
  }
  certs.forEach((c, i) => {
    const parts = [
      `name=${c.name}`,
      `issuer=${c.issuer ?? NOT_PROVIDED}`,
      `number=${c.number ?? NOT_PROVIDED}`,
      `note=${c.note ?? NOT_PROVIDED}`,
    ];
    lines.push(`- 第 ${i + 1} 项: ${parts.join("，")}`);
  });
  return lines;
}

export function buildProductVisualPrompt(input: VisualBuilderInput): {
  finalPrompt: string;
  warnings: string[];
  productFactsUsed: Record<string, unknown>;
} {
  const facts = buildProductFactsSection(input.productFacts);

  const sections: string[] = [];

  // 1. global guardrails
  sections.push(GLOBAL_GUARDRAILS);

  // 基本信息
  sections.push(
    [
      "【基础信息 Basics】",
      `- 产品类型 productType: ${input.productType}`,
      `- 产品名称 productName: ${input.productName || NOT_PROVIDED}`,
      `- 输出语言 language: ${LANGUAGE_LABELS[input.language] ?? input.language}`,
    ].join("\n"),
  );

  // 2. product facts
  sections.push(facts.lines.join("\n"));
  sections.push(buildCertificationsSection(input).join("\n"));

  // 3. style preference
  sections.push(
    ["【风格偏好 Style】", `- ${STYLE_LABELS[input.style] ?? input.style}`].join("\n"),
  );

  // 4. use case
  sections.push(
    ["【用途 Use Case】", `- ${USE_CASE_LABELS[input.useCase] ?? input.useCase}`].join("\n"),
  );

  // 5. source image roles
  sections.push(buildSourceImageRolesSection(input).join("\n"));

  // 6. hard constraints
  sections.push(buildConstraintsSection(input.constraints).join("\n"));

  // 7. output requirements
  sections.push(
    [
      "【输出要求 Output Requirements】",
      "- 仅基于以上事实生成展示性素材建议与图像生成提示词，不得编造。",
      "- 明确列出实际使用了哪些产品事实（productFactsUsed）。",
      "- 附带风险提示（warnings），并标注 humanReviewRequired=true。",
      "- 不自动发布；所有结果默认需人工确认后才能用于官网或客户资料。",
    ].join("\n"),
  );

  return {
    finalPrompt: sections.join("\n\n"),
    warnings: [...FIXED_WARNINGS],
    productFactsUsed: facts.used,
  };
}
