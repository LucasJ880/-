/**
 * HD 窗户 mask
 * 运行：npx tsx src/lib/visualizer/__tests__/hd-window-mask.test.ts
 */
import { createMultiRegionEditMaskPng, createTransparentEditMaskPng } from "../png-mask";
import { buildHdWindowMask } from "../hd-window-mask";
import { alphaAt, decodeSimpleRgbaPng } from "./png-decode";

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

{
  const mask = createTransparentEditMaskPng({
    width: 20,
    height: 20,
    shape: "rect",
    points: [
      [5, 5],
      [10, 10],
    ],
  });
  const d = decodeSimpleRgbaPng(mask);
  ok(d.width === 20 && d.height === 20, "mask 尺寸等于原图");
  ok(alphaAt(d, 7, 7) === 0, "rect 内透明=可编辑");
  ok(alphaAt(d, 0, 0) === 255, "rect 外不透明=保留");
}

{
  const mask = createMultiRegionEditMaskPng({
    width: 30,
    height: 20,
    regions: [
      {
        shape: "rect",
        points: [
          [2, 2],
          [6, 6],
        ],
      },
      {
        shape: "rect",
        points: [
          [20, 10],
          [25, 15],
        ],
      },
    ],
  });
  const d = decodeSimpleRgbaPng(mask);
  ok(alphaAt(d, 4, 4) === 0, "多 rect 区域1 可编辑");
  ok(alphaAt(d, 22, 12) === 0, "多 rect 区域2 可编辑");
  ok(alphaAt(d, 15, 10) === 255, "多 rect 中间保留");
}

{
  const mask = createMultiRegionEditMaskPng({
    width: 20,
    height: 20,
    regions: [
      {
        shape: "polygon",
        points: [
          [5, 2],
          [15, 2],
          [10, 12],
        ],
      },
    ],
  });
  const d = decodeSimpleRgbaPng(mask);
  ok(alphaAt(d, 10, 4) === 0, "polygon 内部可编辑");
  ok(alphaAt(d, 0, 0) === 255, "polygon 外部保留");
}

{
  const r = buildHdWindowMask({
    width: 100,
    height: 100,
    regions: [],
  });
  ok(!r.ok && r.code === "SCENE_REGION_NOT_CONFIRMED", "无区域时失败");
}

{
  const r = buildHdWindowMask({
    width: 200,
    height: 200,
    regions: [
      {
        shape: "rect",
        points: [
          [40, 40],
          [80, 100],
        ],
        productCategory: "roller",
      },
    ],
  });
  ok(r.ok, "单 rect 生成成功");
  if (r.ok) {
    const d = decodeSimpleRgbaPng(r.maskBuffer);
    ok(d.width === 200 && d.height === 200, "buildHdWindowMask 尺寸匹配");
    ok(alphaAt(d, 60, 70) === 0, "窗区可编辑");
    ok(alphaAt(d, 0, 0) === 255, "房间角落保留");
    const editable = [...r.maskBuffer].length; // 占位避免 unused
    void editable;
    let editCount = 0;
    for (let y = 0; y < d.height; y++) {
      for (let x = 0; x < d.width; x++) {
        if (alphaAt(d, x, y) === 0) editCount++;
      }
    }
    ok(editCount / (200 * 200) < 0.72, "不会把整个房间设为可编辑");
  }
}

{
  const shade = buildHdWindowMask({
    width: 400,
    height: 400,
    regions: [
      {
        shape: "rect",
        points: [
          [100, 100],
          [200, 250],
        ],
        productCategory: "roller",
      },
    ],
  });
  const drapery = buildHdWindowMask({
    width: 400,
    height: 400,
    regions: [
      {
        shape: "rect",
        points: [
          [100, 100],
          [200, 250],
        ],
        productCategory: "drapery",
      },
    ],
  });
  ok(shade.ok && drapery.ok, "shade 与 drapery mask 均可生成");
  if (shade.ok && drapery.ok) {
    const s = shade.expandedRegions[0]!.points;
    const d = drapery.expandedRegions[0]!.points;
    const shadeW = s[1]![0]! - s[0]![0]!;
    const draperyW = d[1]![0]! - d[0]![0]!;
    ok(draperyW > shadeW, "drapery padding 宽于 shade");
  }
}

{
  const r = buildHdWindowMask({
    width: 50,
    height: 50,
    regions: [
      {
        shape: "rect",
        points: [
          [-10, -10],
          [200, 200],
        ],
        productCategory: "roller",
      },
    ],
  });
  ok(!r.ok && r.code === "WINDOW_MASK_TOO_LARGE", "整图级区域被拒绝");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
