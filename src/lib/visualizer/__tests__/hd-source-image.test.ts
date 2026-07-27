/**
 * HD 主输入房间图选择
 * 运行：npx tsx src/lib/visualizer/__tests__/hd-source-image.test.ts
 */
import {
  isAiCleanedSourceImage,
  resolveHdRoomSourceImage,
} from "../hd-source-image";

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

const baseImages = [
  {
    id: "orig",
    fileUrl: "/api/files/orig.png",
    mimeType: "image/png",
    width: 100,
    height: 80,
    note: null as string | null,
    fileName: "room.png",
    createdAt: new Date("2026-01-01"),
  },
  {
    id: "clean",
    fileUrl: "/api/files/clean.png",
    mimeType: "image/png",
    width: 100,
    height: 80,
    note: "AI cleaned from source image orig",
    fileName: "room_ai_cleaned.png",
    createdAt: new Date("2026-01-02"),
  },
];

ok(isAiCleanedSourceImage(baseImages[1]!), "识别 cleaned 图");
ok(!isAiCleanedSourceImage(baseImages[0]!), "原图不是 cleaned");

{
  const r = resolveHdRoomSourceImage({
    productOptionRegionIds: ["r1"],
    regions: [{ id: "r1", sourceImageId: "orig" }],
    sourceImages: baseImages,
    composedDataUrl: "data:image/png;base64,AAAA",
  });
  ok(r.ok && r.kind === "cleaned" && r.sourceImageId === "clean", "cleaned 存在时优先使用 cleaned");
  ok(r.ok && r.fileUrl.includes("clean"), "主输入 URL 为 cleaned，非 composed");
}

{
  const r = resolveHdRoomSourceImage({
    productOptionRegionIds: ["r1"],
    regions: [{ id: "r1", sourceImageId: "orig" }],
    sourceImages: [baseImages[0]!],
  });
  ok(r.ok && r.kind === "original" && r.sourceImageId === "orig", "无 cleaned 时用 original");
}

{
  const r = resolveHdRoomSourceImage({
    productOptionRegionIds: ["r1"],
    regions: [{ id: "r1", sourceImageId: "clean" }],
    sourceImages: baseImages,
  });
  ok(r.ok && r.sourceImageId === "clean", "产品挂在 cleaned 上时用 cleaned");
}

{
  const r = resolveHdRoomSourceImage({
    productOptionRegionIds: ["r1"],
    regions: [{ id: "r1", sourceImageId: "missing" }],
    sourceImages: baseImages,
  });
  ok(!r.ok && r.code === "SOURCE_ROOM_IMAGE_MISSING", "原始图缺失时明确失败");
}

{
  const r = resolveHdRoomSourceImage({
    productOptionRegionIds: [],
    regions: [],
    sourceImages: baseImages,
  });
  ok(!r.ok && r.code === "SCENE_REGION_NOT_CONFIRMED", "无区域时失败");
}

{
  const r = resolveHdRoomSourceImage({
    productOptionRegionIds: ["r1"],
    regions: [{ id: "r1", sourceImageId: "orig" }],
    sourceImages: [
      { ...baseImages[0]!, width: null, height: null },
    ],
  });
  ok(!r.ok && r.code === "SOURCE_ROOM_IMAGE_MISSING", "无尺寸时失败");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
