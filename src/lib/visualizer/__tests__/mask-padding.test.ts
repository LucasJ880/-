/**
 * 品类 mask padding
 * 运行：npx tsx src/lib/visualizer/__tests__/mask-padding.test.ts
 */
import {
  computeMaskPaddingInsets,
  expandRegionPointsForMask,
  maskPaddingGroupForCategory,
} from "../mask-padding";

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

ok(maskPaddingGroupForCategory("roller") === "shade", "roller → shade");
ok(maskPaddingGroupForCategory("zebra") === "shade", "zebra → shade");
ok(maskPaddingGroupForCategory("honeycomb") === "shade", "honeycomb → shade");
ok(maskPaddingGroupForCategory("vertical") === "vertical", "vertical");
ok(maskPaddingGroupForCategory("drapery") === "drapery", "drapery");
ok(maskPaddingGroupForCategory("sheer") === "drapery", "sheer → drapery");

const shade = computeMaskPaddingInsets({
  category: "roller",
  regionWidth: 200,
  regionHeight: 300,
  imageWidth: 1000,
  imageHeight: 800,
});
const drapery = computeMaskPaddingInsets({
  category: "drapery",
  regionWidth: 200,
  regionHeight: 300,
  imageWidth: 1000,
  imageHeight: 800,
});

ok(drapery.left > shade.left, "drapery 左右 padding 大于 shade");
ok(drapery.bottom > shade.bottom, "drapery 底部 padding 大于 shade");
ok(drapery.top > shade.top, "drapery 顶部 padding 大于 shade");

{
  const expanded = expandRegionPointsForMask({
    shape: "rect",
    points: [
      [100, 100],
      [300, 400],
    ],
    category: "drapery",
    imageWidth: 500,
    imageHeight: 600,
  });
  ok(expanded.points[0]![0]! >= 0, "padding clamp 左边界");
  ok(expanded.points[0]![1]! >= 0, "padding clamp 上边界");
  ok(expanded.points[1]![0]! < 500, "padding clamp 右边界");
  ok(expanded.points[1]![1]! < 600, "padding clamp 下边界");
  const w = expanded.points[1]![0]! - expanded.points[0]![0]!;
  ok(w < 500, "drapery padding 不得覆盖整图宽度");
}

{
  const expanded = expandRegionPointsForMask({
    shape: "rect",
    points: [
      [-50, -20],
      [900, 900],
    ],
    category: "roller",
    imageWidth: 200,
    imageHeight: 200,
  });
  ok(expanded.points[0]![0]! === 0 && expanded.points[0]![1]! === 0, "越界坐标 clamp");
  ok(
    expanded.points[1]![0]! === 199 && expanded.points[1]![1]! === 199,
    "越界右下 clamp 到边界",
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
