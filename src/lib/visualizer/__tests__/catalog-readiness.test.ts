/**
 * 运行：npx tsx src/lib/visualizer/__tests__/catalog-readiness.test.ts
 */

import {
  evaluateCatalogReadiness,
  deriveVerificationStatus,
} from "../catalog-readiness";
import {
  evaluateReferenceQuality,
  pickCatalogReferencesForRender,
  sortCatalogAssetsForRender,
} from "../catalog-reference";
import { toCatalogDetail } from "../catalog";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.error(`✗ ${name}`);
  }
}

ok(
  evaluateCatalogReadiness([
    { role: "installed", sourceType: "real" },
  ]).status === "real_install_ready",
  "有真实安装图 → real_install_ready",
);

ok(
  evaluateCatalogReadiness([
    { role: "texture", sourceType: "real" },
  ]).status === "source_ready",
  "只有纹理图 → source_ready",
);

ok(
  evaluateCatalogReadiness([
    { role: "style_reference", sourceType: "ai_generated" },
  ]).status === "ai_template_ready",
  "有 AI 模板无真实安装 → ai_template_ready",
);

ok(
  evaluateCatalogReadiness([]).status === "incomplete",
  "无素材 → incomplete",
);

{
  const r = evaluateCatalogReadiness([
    { role: "swatch", sourceType: "real" },
  ]);
  ok(r.canGenerateTemplate === true, "有色卡可生成模板");
  ok(r.canUseForCustomerRender === false, "仅色卡不能用于客户正式生成");
}

{
  const r = evaluateCatalogReadiness([
    { role: "installed", sourceType: "real" },
    { role: "style_reference", sourceType: "ai_generated" },
  ]);
  ok(r.status === "real_install_ready", "真实图优先于 AI 模板状态");
  ok(r.canUseForCustomerRender === true, "有真实图可用于客户生成");
}

ok(
  deriveVerificationStatus({
    role: "style_reference",
    sourceType: "ai_generated",
  }) === "ai_reference",
  "AI 模板 verificationStatus=ai_reference",
);

ok(
  deriveVerificationStatus({
    role: "installed",
    sourceType: "real",
  }) === "real_unverified",
  "新上传真实安装图 → real_unverified",
);

{
  const sorted = sortCatalogAssetsForRender([
    {
      role: "style_reference",
      sourceType: "ai_generated",
      isPrimary: true,
      sortOrder: 0,
      verificationStatus: "ai_reference",
    },
    {
      role: "installed",
      sourceType: "real",
      isPrimary: false,
      sortOrder: 1,
      verificationStatus: "real_unverified",
    },
    {
      role: "texture",
      sourceType: "real",
      isPrimary: true,
      sortOrder: 0,
      verificationStatus: "draft",
    },
  ]);
  ok(sorted[0]?.role === "installed", "客户渲染优先真实安装图");
  ok(sorted[1]?.role === "texture", "其次纹理");
  ok(sorted[2]?.role === "style_reference", "AI 模板最后");
}

{
  const picked = pickCatalogReferencesForRender([
    {
      role: "installed",
      sourceType: "real",
      isPrimary: true,
      sortOrder: 0,
      verificationStatus: "real_verified",
    },
    {
      role: "installed",
      sourceType: "real",
      isPrimary: false,
      sortOrder: 1,
      verificationStatus: "real_unverified",
    },
    {
      role: "style_reference",
      sourceType: "ai_generated",
      isPrimary: false,
      sortOrder: 0,
      verificationStatus: "ai_reference",
    },
  ]);
  ok(picked.length === 2, "同 role 只留一张");
  ok(
    picked[0]?.verificationStatus === "real_verified",
    "同 role 优先 verified",
  );
}

{
  const q = evaluateReferenceQuality([
    {
      role: "style_reference",
      sourceType: "ai_generated",
      isPrimary: true,
      sortOrder: 0,
    },
  ]);
  ok(q.referenceQuality === "ai_only", "仅 AI 参考 → ai_only");
  ok(!!q.warning, "仅 AI 时返回警告文案");
}

{
  const detail = toCatalogDetail(
    {
      id: "mock_legacy",
      orgId: null,
      name: "Legacy",
      category: "roller",
      categoryLabel: "卷帘",
      previewImageUrl: null,
      textureUrl: null,
      assets: [],
      defaultOpacity: 0.85,
      colorsJson: [{ name: "White", hex: "#ffffff" }],
      mountingsJson: ["inside"],
      pricingProductName: null,
      notes: null,
      archived: false,
      createdById: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    { currentOrgId: "org1" },
  );
  ok(detail.readiness.status === "incomplete", "旧产品无资产仍可序列化");
  ok(Array.isArray(detail.assets), "assets 数组存在");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
