/**
 * 面料纹理填充 — pattern 缩放语义测试
 * 运行：npx tsx src/lib/visualizer/__tests__/texture-fill.test.ts
 */

import assert from "node:assert/strict";
import { texturePatternScale } from "../texture-fill";

// 纹理原图 800px，region 显示 400px → 缩放 0.5（横向正好铺满一次）
assert.equal(texturePatternScale(800, 400), 0.5);
// 放大场景：原图 200px，region 600px → 3
assert.equal(texturePatternScale(200, 600), 3);
// 等宽 → 1
assert.equal(texturePatternScale(512, 512), 1);
// 非法输入一律回 1（不缩放好过 NaN 崩掉 pattern）
assert.equal(texturePatternScale(0, 400), 1);
assert.equal(texturePatternScale(-10, 400), 1);
assert.equal(texturePatternScale(800, 0), 1);
assert.equal(texturePatternScale(NaN, 400), 1);
assert.equal(texturePatternScale(800, Infinity), 1);

console.log("Visualizer texture fill tests passed");
