/**
 * 产品素材准备状态 — 统一判断，供 UI / API / 渲染共用
 */

import type {
  VisualizerCatalogAssetRole,
  VisualizerCatalogReadiness,
  VisualizerCatalogReadinessResult,
  VisualizerCatalogVerificationStatus,
} from "@/lib/visualizer/types";

const SOURCE_ROLES: VisualizerCatalogAssetRole[] = [
  "texture",
  "detail",
  "swatch",
];

export function hasRealInstalled(
  assets: Array<{ role: string; sourceType: string }>,
): boolean {
  return assets.some(
    (a) => a.role === "installed" && a.sourceType === "real",
  );
}

export function hasAiTemplate(
  assets: Array<{ role: string; sourceType: string }>,
): boolean {
  return assets.some(
    (a) => a.role === "style_reference" && a.sourceType === "ai_generated",
  );
}

export function hasSourceMaterial(
  assets: Array<{ role: string }>,
): boolean {
  return assets.some((a) =>
    SOURCE_ROLES.includes(a.role as VisualizerCatalogAssetRole),
  );
}

export function evaluateCatalogReadiness(
  assets: Array<{ role: string; sourceType: string }>,
): VisualizerCatalogReadinessResult {
  const warnings: string[] = [];
  const realInstall = hasRealInstalled(assets);
  const aiTemplate = hasAiTemplate(assets);
  const sourceReady = hasSourceMaterial(assets);

  let status: VisualizerCatalogReadiness;
  if (realInstall) {
    status = "real_install_ready";
  } else if (aiTemplate) {
    status = "ai_template_ready";
    warnings.push(
      "当前仅有 AI 标准安装模板，客户效果图可能与真实安装存在差异。",
    );
  } else if (sourceReady) {
    status = "source_ready";
    warnings.push(
      "已有基础素材，可生成 AI 标准安装模板后再用于客户效果图。",
    );
  } else {
    status = "incomplete";
    warnings.push(
      "请至少上传一张面料纹理图、色卡图或结构细节图，完成后才能生成 AI 标准安装模板。",
    );
  }

  return {
    status,
    canGenerateTemplate: sourceReady,
    canUseForCustomerRender: realInstall || aiTemplate,
    hasRealInstalled: realInstall,
    hasAiTemplate: aiTemplate,
    hasSourceMaterial: sourceReady,
    warnings,
  };
}

export function readinessLabel(status: VisualizerCatalogReadiness): string {
  switch (status) {
    case "real_install_ready":
      return "已有真实安装案例";
    case "ai_template_ready":
      return "AI 模板可用";
    case "source_ready":
      return "可以生成 AI 模板";
    case "incomplete":
    default:
      return "素材不完整";
  }
}

/** 根据 role + sourceType 推导 verificationStatus（写入时使用） */
export function deriveVerificationStatus(input: {
  role: VisualizerCatalogAssetRole;
  sourceType: "real" | "ai_generated";
  verificationStatus?: VisualizerCatalogVerificationStatus | null;
}): VisualizerCatalogVerificationStatus {
  if (
    input.verificationStatus &&
    (input.verificationStatus === "draft" ||
      input.verificationStatus === "ai_reference" ||
      input.verificationStatus === "real_unverified" ||
      input.verificationStatus === "real_verified")
  ) {
    // AI 模板强制 ai_reference，避免误标真实
    if (
      input.role === "style_reference" &&
      input.sourceType === "ai_generated"
    ) {
      return "ai_reference";
    }
    if (input.role === "installed" && input.sourceType === "real") {
      if (
        input.verificationStatus === "real_verified" ||
        input.verificationStatus === "real_unverified"
      ) {
        return input.verificationStatus;
      }
      return "real_unverified";
    }
    return input.verificationStatus;
  }

  if (input.role === "style_reference" && input.sourceType === "ai_generated") {
    return "ai_reference";
  }
  if (input.role === "installed" && input.sourceType === "real") {
    return "real_unverified";
  }
  return "draft";
}

export function assetBadgeLabel(asset: {
  role: VisualizerCatalogAssetRole;
  sourceType: "real" | "ai_generated";
  verificationStatus?: VisualizerCatalogVerificationStatus | null;
}): string {
  if (asset.role === "installed" && asset.sourceType === "real") {
    if (asset.verificationStatus === "real_verified") return "已验证";
    return "真实安装图";
  }
  if (asset.role === "style_reference" && asset.sourceType === "ai_generated") {
    return "AI 生成参考";
  }
  if (asset.verificationStatus === "real_unverified") return "待验证";
  if (asset.verificationStatus === "real_verified") return "已验证";
  if (asset.sourceType === "ai_generated") return "AI生成";
  return "素材";
}
