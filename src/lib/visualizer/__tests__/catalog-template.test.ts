/**
 * 运行：npx tsx src/lib/visualizer/__tests__/catalog-template.test.ts
 */

import {
  buildCatalogTemplatePrompt,
  isCatalogTemplateType,
  resolveTemplateRoomUrl,
  CATALOG_TEMPLATE_PROMPT_VERSION,
} from "../catalog-template";
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

ok(
  isCatalogTemplateType("standard_floor_to_ceiling_day"),
  "识别标准落地窗模板",
);
ok(isCatalogTemplateType("modern_living_room_day"), "识别现代客厅模板");
ok(!isCatalogTemplateType("bedroom_blackout"), "卧室模板本阶段未启用");
ok(CATALOG_TEMPLATE_PROMPT_VERSION === "catalog-template-v1", "prompt 版本");

{
  const prev = process.env.VISUALIZER_TEMPLATE_STANDARD_ROOM_URL;
  delete process.env.VISUALIZER_TEMPLATE_STANDARD_ROOM_URL;
  ok(
    resolveTemplateRoomUrl("standard_floor_to_ceiling_day") === null,
    "未配置底图 → null（不可静默失败）",
  );
  process.env.VISUALIZER_TEMPLATE_STANDARD_ROOM_URL =
    "https://evil.example.com/room.jpg";
  ok(
    resolveTemplateRoomUrl("standard_floor_to_ceiling_day") === null,
    "拒绝任意第三方 URL",
  );
  process.env.VISUALIZER_TEMPLATE_STANDARD_ROOM_URL =
    "/api/files/visualizer/templates/standard-room.jpg";
  ok(
    resolveTemplateRoomUrl("standard_floor_to_ceiling_day")?.startsWith(
      "/api/files/",
    ) === true,
    "接受本系统 files 代理路径",
  );
  if (prev === undefined) {
    delete process.env.VISUALIZER_TEMPLATE_STANDARD_ROOM_URL;
  } else {
    process.env.VISUALIZER_TEMPLATE_STANDARD_ROOM_URL = prev;
  }
}

{
  const prompt = buildCatalogTemplatePrompt({
    category: "zebra",
    name: "Test Zebra",
    referenceCount: 2,
  });
  ok(prompt.includes("Input image 1 is the neutral room scene"), "底图为唯一场景");
  ok(prompt.includes("Input image 2"), "参考图序号正确");
  ok(prompt.includes("Zebra"), "类别补充 zebra 提示");
  ok(
    prompt.includes("not a real completed project photograph"),
    "声明非真实项目照片",
  );
}

{
  const drapery = buildCatalogTemplatePrompt({
    category: "drapery",
    name: "Drape",
    referenceCount: 1,
  });
  ok(drapery.includes("Drapery"), "布艺类别提示");
}

{
  // AI 图不可保存为 installed+real
  const sanitized = sanitizeCatalogAssets(
    [
      {
        role: "installed",
        sourceType: "ai_generated",
        fileUrl: "/api/files/visualizer/catalog/org/x.png",
        fileName: "x.png",
        mimeType: "image/png",
      },
    ],
    { orgId: "org" },
  );
  ok(sanitized[0]?.role === "style_reference", "AI 图强制降级为 style_reference");
  ok(sanitized[0]?.sourceType === "ai_generated", "保留 ai_generated");
  ok(
    sanitized[0]?.verificationStatus === "ai_reference",
    "AI 模板资产 verificationStatus=ai_reference",
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
