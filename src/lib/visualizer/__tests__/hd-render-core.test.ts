/**
 * HD render core：主输入 / mask / 失败契约
 * 运行：npx tsx src/lib/visualizer/__tests__/hd-render-core.test.ts
 */
import {
  isFakeSuccessResponse,
  prepareHdImageEditArgs,
  shouldPreservePreviousExportOnFailure,
} from "../hd-render-core";
import { buildHdRenderPrompt } from "../hd-render-prompt";
import {
  hdViewModeOnRenderFailure,
  hdViewModeOnRenderStart,
  hdViewModeOnRenderSuccess,
  isHdSuccessMessageAllowed,
  shouldShowExportResult,
  shouldShowKonvaEditor,
} from "../hd-view-mode";

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

const roomBuf = Buffer.from("ROOM_ORIGINAL_BYTES");
const refBuf = Buffer.from("REF_TEXTURE");

{
  const prepared = prepareHdImageEditArgs({
    productOptions: [
      {
        regionId: "r1",
        productName: "Linen Drape",
        productCategory: "drapery",
        color: "Ivory",
        colorHex: "#f5f0e6",
        opacity: 0.9,
        mountingType: "outside",
      },
    ],
    regions: [
      {
        id: "r1",
        sourceImageId: "orig",
        shape: "rect",
        pointsJson: [
          [20, 20],
          [80, 120],
        ],
      },
    ],
    sourceImages: [
      {
        id: "orig",
        fileUrl: "/files/orig.png",
        mimeType: "image/png",
        width: 200,
        height: 160,
        note: null,
        fileName: "room.png",
        createdAt: new Date(),
      },
      {
        id: "clean",
        fileUrl: "/files/clean.png",
        mimeType: "image/png",
        width: 200,
        height: 160,
        note: "AI cleaned from source image orig",
        fileName: "room_ai_cleaned.png",
        createdAt: new Date(),
      },
    ],
    composedDataUrl: "data:image/png;base64,COMPOSED_SHOULD_NOT_BE_PRIMARY",
    roomImageBuffer: roomBuf,
    roomImageMime: "image/png",
    referenceImages: [
      {
        buffer: refBuf,
        mime: "image/jpeg",
        fileName: "texture.jpg",
        role: "texture",
        productName: "Linen Drape",
        sourceType: "real",
      },
    ],
  });

  ok(prepared.ok, "prepareHdImageEditArgs 成功");
  if (prepared.ok) {
    ok(
      prepared.edit.imageBuffer.equals(roomBuf),
      "第一张主输入为房间图 buffer（非 composed）",
    );
    ok(!!prepared.edit.maskBuffer?.length, "mask 参数非空");
    ok(prepared.edit.sourceKind === "cleaned", "优先 cleaned 作为主输入 kind");
    ok(prepared.edit.referenceImages.length === 1, "产品参考图作为 references");
    ok(
      prepared.edit.prompt.includes("authoritative scene"),
      "prompt 声明房间图为权威场景",
    );
    ok(
      prepared.edit.prompt.includes("flat colored placement rectangle"),
      "prompt 禁止保留色块",
    );
    ok(
      prepared.edit.prompt.includes("realistic folds"),
      "drapery 类别补充 folds 指令",
    );
  }
}

{
  const prepared = prepareHdImageEditArgs({
    productOptions: [],
    regions: [],
    sourceImages: [],
    roomImageBuffer: roomBuf,
    roomImageMime: "image/png",
    referenceImages: [],
  });
  ok(!prepared.ok, "无区域时 prepare 失败");
}

ok(
  shouldPreservePreviousExportOnFailure("https://old.export/png", {
    exportImageUrlWritten: false,
  }) === "https://old.export/png",
  "模型失败不覆盖旧 exportImageUrl",
);

ok(
  isFakeSuccessResponse({
    httpOk: true,
    exportImageUrl: null,
    usedComposedAsPrimary: false,
  }),
  "无 exportImageUrl 视为伪成功",
);
ok(
  !isFakeSuccessResponse({
    httpOk: true,
    exportImageUrl: "https://new/export.png",
    usedComposedAsPrimary: false,
  }),
  "有 exportImageUrl 且未用 composed → 非伪成功",
);
ok(
  isFakeSuccessResponse({
    httpOk: true,
    exportImageUrl: "https://x",
    usedComposedAsPrimary: true,
  }),
  "用 composed 作主输入视为伪成功",
);

{
  const prompt = buildHdRenderPrompt({
    productOptions: [
      {
        productName: "Zebra",
        productCategory: "zebra",
        color: null,
        colorHex: "#333",
        opacity: 0.8,
        mountingType: "inside",
      },
    ],
    references: [],
  });
  ok(prompt.includes("alternating"), "zebra 条带指令");
}

// 前端显示模式
ok(hdViewModeOnRenderStart() === "rendering", "开始渲染 → rendering");
ok(hdViewModeOnRenderSuccess() === "rendered", "成功 → rendered");
ok(
  hdViewModeOnRenderFailure({ previousExportImageUrl: null }) === "error",
  "失败无旧图 → error",
);
ok(
  hdViewModeOnRenderFailure({
    previousExportImageUrl: "https://old",
  }) === "rendered",
  "失败有旧图 → 保留 rendered",
);
ok(shouldShowKonvaEditor("editing"), "编辑模式显示 Konva");
ok(!shouldShowKonvaEditor("rendered"), "结果模式不显示 Konva 为主视图");
ok(
  shouldShowExportResult("rendered", "https://e"),
  "成功后展示 exportImageUrl",
);
ok(
  !isHdSuccessMessageAllowed({ httpOk: false, exportImageUrl: null }),
  "失败不允许成功文案",
);
ok(
  !isHdSuccessMessageAllowed({ httpOk: true, exportImageUrl: null }),
  "缺 export 不允许成功文案",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
