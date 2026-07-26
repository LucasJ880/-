/**
 * Final Validation Gate 补充：权限错误码映射、Job 策略、底图读取约定
 * 运行：npx tsx src/lib/visualizer/__tests__/catalog-template-gate.test.ts
 *
 * 不连真实 DB / 不调用图片模型。
 */

import {
  CatalogTemplateError,
  MAX_AI_TEMPLATES_PER_TYPE,
  CATALOG_TEMPLATE_TYPES,
  resolveTemplateRoomUrl,
  isCatalogTemplateType,
} from "../catalog-template";
import { evaluateCatalogReadiness } from "../catalog-readiness";
import { evaluateReferenceQuality } from "../catalog-reference";
import { sanitizeCatalogAssets } from "../catalog";

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

// 错误码与 HTTP 语义（门禁约定）
{
  const e = new CatalogTemplateError(
    "TEMPLATE_ROOM_NOT_CONFIGURED",
    "AI 标准场景底图尚未配置，请联系管理员。",
    503,
  );
  ok(e.status === 503 && !/stack|Error:/.test(e.message), "未配置底图为可读 503");
  ok(
    new CatalogTemplateError("PLATFORM_IMMUTABLE", "平台预置产品不可修改", 403)
      .status === 403,
    "平台预置不可改 → 403",
  );
  ok(
    new CatalogTemplateError("FORBIDDEN", "该产品不属于当前组织", 403).status ===
      403,
    "跨组织 → 403",
  );
  ok(
    new CatalogTemplateError("ARCHIVED", "已归档产品不可生成模板", 400).status ===
      400,
    "归档产品 → 400",
  );
  ok(
    new CatalogTemplateError("JOB_IN_PROGRESS", "该模板正在生成中，请稍候", 409)
      .status === 409,
    "重复点击 → 409 JOB_IN_PROGRESS",
  );
}

// 重复生成数量上限策略
ok(MAX_AI_TEMPLATES_PER_TYPE === 2, "每种模板上限 2");
ok(
  MAX_AI_TEMPLATES_PER_TYPE * CATALOG_TEMPLATE_TYPES.length === 4,
  "同产品 AI style_reference 总量上限 4",
);

// pathname / proxy 支持
{
  const prevS = process.env.VISUALIZER_TEMPLATE_STANDARD_ROOM_URL;
  const prevL = process.env.VISUALIZER_TEMPLATE_LIVING_ROOM_URL;
  process.env.VISUALIZER_TEMPLATE_STANDARD_ROOM_URL =
    "visualizer/templates/standard-room.jpg";
  ok(
    resolveTemplateRoomUrl("standard_floor_to_ceiling_day") ===
      "visualizer/templates/standard-room.jpg",
    "支持私有 Blob pathname",
  );
  process.env.VISUALIZER_TEMPLATE_LIVING_ROOM_URL =
    "/api/files/visualizer/templates/living.jpg";
  ok(
    resolveTemplateRoomUrl("modern_living_room_day")?.startsWith("/api/files/") ===
      true,
    "支持 /api/files 代理 URL",
  );
  process.env.VISUALIZER_TEMPLATE_STANDARD_ROOM_URL =
    "https://public.cdn.example/room.jpg";
  ok(
    resolveTemplateRoomUrl("standard_floor_to_ceiling_day") === null,
    "拒绝公开第三方 URL",
  );
  if (prevS === undefined) delete process.env.VISUALIZER_TEMPLATE_STANDARD_ROOM_URL;
  else process.env.VISUALIZER_TEMPLATE_STANDARD_ROOM_URL = prevS;
  if (prevL === undefined) delete process.env.VISUALIZER_TEMPLATE_LIVING_ROOM_URL;
  else process.env.VISUALIZER_TEMPLATE_LIVING_ROOM_URL = prevL;
}

// AI-only 客户渲染警告
{
  const q = evaluateReferenceQuality([
    {
      role: "style_reference",
      sourceType: "ai_generated",
      isPrimary: false,
      sortOrder: 0,
      verificationStatus: "ai_reference",
    },
  ]);
  ok(q.referenceQuality === "ai_only", "AI-only → referenceQuality=ai_only");
  ok(
    (q.warning ?? "").includes("未使用真实安装案例"),
    "AI-only 必须带 warning",
  );
}

// 无素材不可生成
ok(
  evaluateCatalogReadiness([]).canGenerateTemplate === false,
  "incomplete 不可生成模板",
);
ok(
  evaluateCatalogReadiness([{ role: "texture", sourceType: "real" }])
    .canGenerateTemplate === true,
  "source_ready 可生成模板",
);

// AI 不可伪装真实安装
{
  const assets = sanitizeCatalogAssets(
    [
      {
        role: "installed",
        sourceType: "ai_generated",
        fileUrl: "/api/files/visualizer/catalog/org/a.png",
        fileName: "a.png",
        mimeType: "image/png",
      },
    ],
    { orgId: "org" },
  );
  ok(assets[0]?.role !== "installed", "AI 不得序列化为 installed");
  ok(
    assets[0]?.role === "style_reference" &&
      assets[0]?.verificationStatus === "ai_reference",
    "AI 降级为 style_reference + ai_reference",
  );
  ok(
    evaluateCatalogReadiness(assets).hasRealInstalled === false,
    "降级后不算真实安装就绪",
  );
}

ok(isCatalogTemplateType("standard_floor_to_ceiling_day"), "模板类型有效");
ok(!isCatalogTemplateType("bedroom_blackout"), "bedroom 未启用");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
