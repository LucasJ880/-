/**
 * 客户效果图 / HD 渲染参考素材质量排序
 *
 * 真实安装图 > 面料纹理与结构图 > AI 标准安装模板
 */

export type CatalogReferenceQuality = "real_install" | "mixed" | "ai_only" | "none";

export type RankableAsset = {
  role: string;
  sourceType: string;
  isPrimary: boolean;
  sortOrder: number;
  verificationStatus?: string | null;
  id?: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
};

/** 分数越小优先级越高 */
export function catalogAssetQualityRank(asset: RankableAsset): number {
  const verified =
    asset.role === "installed" &&
    asset.sourceType === "real" &&
    asset.verificationStatus === "real_verified";
  if (verified) return 0;
  if (asset.role === "installed" && asset.sourceType === "real") return 1;
  if (asset.role === "texture" && asset.sourceType === "real") return 2;
  if (asset.role === "detail" && asset.sourceType === "real") return 3;
  if (asset.role === "swatch" && asset.sourceType === "real") return 4;
  if (asset.role === "style_reference" && asset.sourceType === "ai_generated") {
    return 5;
  }
  // 其它（含 AI installed 误标等）靠后
  return 90;
}

export function sortCatalogAssetsForRender<T extends RankableAsset>(
  assets: T[],
): T[] {
  return [...assets].sort((a, b) => {
    const q = catalogAssetQualityRank(a) - catalogAssetQualityRank(b);
    if (q !== 0) return q;
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
}

/**
 * 每产品取高质量参考：同 role 只留最优一张，全局最多 maxCount
 */
export function pickCatalogReferencesForRender<T extends RankableAsset>(
  assets: T[],
  maxCount = 8,
): T[] {
  const sorted = sortCatalogAssetsForRender(assets);
  const seenRoles = new Set<string>();
  const out: T[] = [];
  for (const asset of sorted) {
    if (seenRoles.has(asset.role)) continue;
    seenRoles.add(asset.role);
    out.push(asset);
    if (out.length >= maxCount) break;
  }
  return out;
}

export function evaluateReferenceQuality(
  assets: RankableAsset[],
): {
  referenceQuality: CatalogReferenceQuality;
  warning: string | null;
} {
  if (assets.length === 0) {
    return { referenceQuality: "none", warning: null };
  }
  const hasReal = assets.some(
    (a) => a.role === "installed" && a.sourceType === "real",
  );
  const hasAi = assets.some(
    (a) => a.role === "style_reference" && a.sourceType === "ai_generated",
  );
  if (hasReal) {
    return {
      referenceQuality: hasAi ? "mixed" : "real_install",
      warning: null,
    };
  }
  if (hasAi) {
    return {
      referenceQuality: "ai_only",
      warning: "本次生成未使用真实安装案例，实际效果可能存在差异。",
    };
  }
  return { referenceQuality: "mixed", warning: null };
}
