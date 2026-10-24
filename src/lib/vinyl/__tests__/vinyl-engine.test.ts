/**
 * Vinyl 百叶窗引擎 回归测试
 * 运行：npx tsx src/lib/vinyl/__tests__/vinyl-engine.test.ts
 *
 * 两组完整算例是照着 V15「工艺单」逐格追公式手算出来的（每步都在注释里），
 * 不是跑一遍引擎再把输出抄回来 —— 那样测不出任何东西。
 */

import assert from "node:assert/strict";
import {
  computeFrameSignature,
  resolveFrameConfig,
  FRAME_CONFIGS,
  FRAME_WEIGHTS,
  getLouverSpec,
  VINYL_WASTE_FACTOR,
} from "../frame-rules";
import {
  resolvePanelSpec,
  listPanelCodes,
  parsePanelSpecText,
  formatPanelSpec,
  normalizePanelCode,
  DEFAULT_PANEL_CODES,
} from "../panel-codes";
import { validatePanelCodeInput } from "../panel-code-store";
import {
  calculateVinylItem,
  parseDividerSpec,
  calcSquareFeet,
  type VinylItemInput,
} from "../calculation-engine";
import { buildStileSummary, buildRailSummary, buildBom, buildTotals } from "../aggregation";

const near = (a: number, b: number, msg: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${msg}: 期望 ${b}，实际 ${a}`);

function piece(res: ReturnType<typeof calculateVinylItem>, name: string) {
  const p = res.pieces.find((x) => x.name === name);
  assert.ok(p, `下料清单里应有「${name}」，实有: ${res.pieces.map((x) => x.name).join(", ")}`);
  return p!;
}

// ── 1. J10 框型编码：六种合法组合 ─────────────────────────
{
  assert.equal(computeFrameSignature({ frameType: "L", frameCount: "4", inOut: "IN" }), 6.942);
  assert.equal(computeFrameSignature({ frameType: "L", frameCount: "4", inOut: "OUT" }), 10.805);
  assert.equal(computeFrameSignature({ frameType: "Z", frameCount: "4", inOut: "IN" }), 12.071);
  assert.equal(computeFrameSignature({ frameType: "T", frameCount: "4", inOut: "IN" }), 12.071);
  assert.equal(computeFrameSignature({ frameType: "T", frameCount: "3+1", inOut: "IN" }), 12.903);
  assert.equal(computeFrameSignature({ frameType: "Door", frameCount: "4", inOut: "OUT" }), 16.893);
  assert.equal(computeFrameSignature({ frameType: "Door", frameCount: "3+1", inOut: "OUT" }), 17.725);

  // 权重之和必须真的等于配置里写的 signature
  assert.equal(FRAME_CONFIGS.length, 6);
  for (const c of FRAME_CONFIGS) {
    assert.ok(getLouverSpec(3.5), "3.5 应有百叶参数");
    assert.ok(c.signature > 0, `${c.label} signature`);
  }
  near(
    FRAME_WEIGHTS.frameL + FRAME_WEIGHTS.inSide + FRAME_WEIGHTS.count4,
    6.942,
    "L/4/IN 权重和",
  );
  near(
    FRAME_WEIGHTS.frameDoor + FRAME_WEIGHTS.count3plus1 + FRAME_WEIGHTS.outSide,
    17.725,
    "Door/3+1/OUT 权重和",
  );

  // 大小写不敏感（原表 I8 写的是小写 z）
  assert.equal(computeFrameSignature({ frameType: "z", frameCount: "4", inOut: "in" }), 12.071);
  assert.equal(computeFrameSignature({ frameType: "door", frameCount: "3+1", inOut: "out" }), 17.725);

  // 非法组合：落不到任何分支
  assert.equal(resolveFrameConfig({ frameType: "L", frameCount: "3+1", inOut: "IN" }).config, null);
  assert.equal(resolveFrameConfig({ frameType: "Door", frameCount: "4", inOut: "IN" }).config, null);
  assert.equal(resolveFrameConfig({ frameType: "", frameCount: "", inOut: "" }).config, null);
}

// ── 2. 完整算例 A：3.5" / L / 4 / IN / 无柱无分隔档 ────────
{
  const input: VinylItemInput = {
    location: "客厅", width: 36, height: 60,
    panelCount: 2, panelCode: "LR",
    frameType: "L", frameCount: "4", inOut: "IN", structure: "有框",
  };
  const r = calculateVinylItem(input, { louverSize: 3.5 });
  assert.deepEqual(r.warnings, [], `不该有告警: ${JSON.stringify(r.warnings)}`);
  assert.equal(r.frameSignature, 6.942);
  assert.equal(r.frameLabel, "L / 4 / IN");

  // H2 = 36 - 26/16 = 34.375
  near(r.cavityWidth, 34.375, "内空宽");
  // I2 = 60 - 26/16 = 58.375
  near(r.cavityHeight, 58.375, "内空高");
  // D8 = 58.375 - 4/16 = 58.125
  near(r.panelHeight, 58.125, "成品高");
  // B8 = (34.375 - (2*1.5+0+2)/16 - 0)/2 - 1/16 = (34.375-0.3125)/2-0.0625 = 16.96875
  near(r.panelWidth, 16.96875, "成品窗宽");

  // 无分隔档：F9=0；G9 = ROUNDUP((58.125-180/16)/3)+1 = ROUNDUP(15.625)+1 = 17
  assert.equal(r.topLouvers, 0);
  assert.equal(r.bottomLouvers, 17);
  assert.equal(r.louversPerPanel, 17);
  // G15 = (58.125-11.25)/16 = 2.9296875
  near(r.louverPitch, 2.9296875, "百叶间距");
  assert.equal(r.midRail, 0);
  assert.equal(r.midRailFromBottom, 0);

  // SF = ROUNDUP(36*60/144) = 15
  assert.equal(r.squareFeet, 15);
  assert.deepEqual(r.panelSpec, { strips: 3, caps: 1 }, "LR → 3/1");

  const fw = piece(r, "L 型框-宽");
  near(fw.lengthIn, 35.875, "型框宽");   // 36 - 2/16
  assert.equal(fw.qty, 2);
  assert.equal(fw.angleA, 45);
  assert.equal(fw.angleB, 45);

  const fh = piece(r, "L 型框-高");
  near(fh.lengthIn, 59.875, "型框高");   // 60 - 2/16
  assert.equal(fh.qty, 2);

  const stile = piece(r, "直柱");
  near(stile.lengthIn, 57.9375, "直柱长"); // 58.125 - 3/16
  assert.equal(stile.qty, 4);              // 扇数 × 2

  const rail = piece(r, "上下横档");
  near(rail.lengthIn, 13.46875, "横档长"); // 16.96875 - 3.5
  assert.equal(rail.qty, 4);

  const louver = piece(r, '百叶片 3.5"');
  near(louver.lengthIn, 13.34375, "百叶片长"); // 13.46875 - 2/16
  assert.equal(louver.qty, 34);                // 17 × 2 扇

  // 无分隔档 → 没有上控制杆、没有中间分隔档、没有底框
  assert.equal(r.pieces.find((p) => p.name === "控制杆（上）"), undefined);
  assert.equal(r.pieces.find((p) => p.name === "中间分隔档"), undefined);
  assert.equal(r.pieces.find((p) => p.name === "底框（Z切边）"), undefined);

  const rod = piece(r, "控制杆（下）");
  near(rod.lengthIn, 48.375, "下控制杆");  // 2.9296875*16 + 1.5
  assert.equal(rod.qty, 2);
}

// ── 3. 完整算例 B：2.5" / T / 4 / IN / 2 分隔柱 + 半高分隔档 ──
{
  const input: VinylItemInput = {
    location: "主卧", width: 60, height: 80,
    panelCount: 4, panelCode: "LLRR",
    dividerSpec: "2T", midRailRatio: 0.5,
    frameType: "T", frameCount: "4", inOut: "IN", structure: "有框",
  };
  const r = calculateVinylItem(input, { louverSize: 2.5 });
  assert.deepEqual(r.warnings, [], `不该有告警: ${JSON.stringify(r.warnings)}`);
  assert.equal(r.frameSignature, 12.071);

  near(r.cavityWidth, 58.875, "内空宽");   // 60 - 18/16
  near(r.cavityHeight, 78.875, "内空高");
  near(r.panelHeight, 78.625, "成品高");
  // B8 = (58.875 - (4*1.5+2*2+2)/16 - 2*1)/4 - 1/16 = (58.875-0.75-2)/4-0.0625
  near(r.panelWidth, 13.96875, "成品窗宽");

  assert.equal(r.postCount, 2);
  assert.equal(r.postType, "T");
  assert.equal(r.postLabel, "分隔柱");

  // C5 = 0.5*80 - 10/16 = 39.375
  near(r.midRail, 39.375, "分隔档位置");
  // F9 = ROUNDUP((78.625-39.375-123/16)/2)+1 = ROUNDUP(15.78125)+1 = 17
  assert.equal(r.topLouvers, 17);
  // G9 = ROUNDUP((39.375-7.6875)/2)+1 = ROUNDUP(15.84375)+1 = 17
  assert.equal(r.bottomLouvers, 17);
  // G15 = (78.625 - 2*7.6875)/(17+17-2) = 63.25/32 = 1.9765625
  near(r.louverPitch, 1.9765625, "百叶间距");
  // D5 = (17-1)*1.9765625 + 2.5625 + 5.1875 = 39.375 —— 应与 C5 吻合
  near(r.midRailFromBottom, 39.375, "分隔档从下往上");
  near(r.midRailFromBottom, r.midRail, "D5 应与 C5 一致（自洽性检查）");

  assert.equal(r.squareFeet, 34); // ROUNDUP(4800/144) = 34
  assert.deepEqual(r.panelSpec, { strips: 5, caps: 3 }, "LLRR → 5/3");

  // 分隔柱取内空高；挂柱才取成品高-3/16
  const post = piece(r, "分隔柱");
  near(post.lengthIn, 78.875, "分隔柱长");
  assert.equal(post.qty, 2);

  const divider = piece(r, "中间分隔档");
  near(divider.lengthIn, 10.46875, "中分档长"); // 13.96875 - 3.5
  assert.equal(divider.qty, 4);

  const louver = piece(r, '百叶片 2.5"');
  near(louver.lengthIn, 10.34375, "百叶片长");
  assert.equal(louver.qty, 136); // 34 × 4 扇

  near(piece(r, "控制杆（上）").lengthIn, 33.125, "上控制杆");
  near(piece(r, "控制杆（下）").lengthIn, 33.125, "下控制杆");

  // D11/D12 备用料长：T 框 = 主长 + 2.75，且标了 informational
  const alt = piece(r, "T 型框-宽（备用料长）");
  near(alt.lengthIn, 62.625, "备用框宽"); // 59.875 + 2.75
  assert.equal(alt.informational, true);
  near(piece(r, "T 型框-高（备用料长）").lengthIn, 82.625, "备用框高");
}

// ── 4. Z 框的备用料长走另一条公式 ──────────────────────────
{
  const r = calculateVinylItem(
    { width: 60, height: 80, panelCount: 2, panelCode: "LR",
      frameType: "Z", frameCount: "4", inOut: "IN", structure: "有框" },
    { louverSize: 3.5 },
  );
  // Z: D11 = W - 2/16 - 15/16 = 60 - 1.0625 = 58.9375（不是主长+2.75）
  near(piece(r, "Z 型框-宽（备用料长）").lengthIn, 58.9375, "Z 备用框宽");
  near(piece(r, "Z 型框-高（备用料长）").lengthIn, 78.9375, "Z 备用框高");
}

// ── 5. 3+1 组合：框宽数量 1、框高第二角 90°、出底框 ────────
{
  const r = calculateVinylItem(
    { width: 40, height: 70, panelCount: 2, panelCode: "LR",
      frameType: "T", frameCount: "3+1", inOut: "IN", structure: "有框" },
    { louverSize: 3.5 },
  );
  assert.equal(r.frameSignature, 12.903);
  // 高减 20/16 而宽减 18/16 —— 表里就是不对称
  near(r.cavityWidth, 40 - 18 / 16, "3+1 内空宽");
  near(r.cavityHeight, 70 - 20 / 16, "3+1 内空高");

  const fw = piece(r, "T 型框-宽");
  assert.equal(fw.qty, 1, "3+1 的型框-宽只裁 1 根");
  const fh = piece(r, "T 型框-高");
  assert.equal(fh.qty, 2);
  assert.equal(fh.angleB, 90, "型框-宽只有 1 根时，型框-高第二角是 90°");

  const bottom = piece(r, "底框（Z切边）");
  near(bottom.lengthIn, 40 - 18 / 16, "底框长");
  assert.equal(bottom.angleA, 90);
  assert.equal(bottom.angleB, 90);
}

// Door / 3+1 / OUT 也出底框，但走另一条
{
  const r = calculateVinylItem(
    { width: 40, height: 70, panelCount: 1, panelCode: "L",
      frameType: "Door", frameCount: "3+1", inOut: "OUT", structure: "有框" },
    { louverSize: 3.5 },
  );
  assert.equal(r.frameSignature, 17.725);
  near(r.cavityWidth, 40 + 20 / 16 - 5.25, "Door 内空宽");
  near(r.cavityHeight, 70 + 2 / 16 - 2.625, "Door 内空高");
  near(piece(r, "Door 型框-宽").lengthIn, 40 + 86 / 16 - 5.25, "Door 框宽");
  near(piece(r, "Door 型框-高").lengthIn, 70 + 44 / 16 - 2.625, "Door 框高");
  near(piece(r, "底框（Z切边）").lengthIn, 40 + 20 / 16 - 5.25, "Door 底框");
}

// ── 6. 挂柱(H) 与分隔柱(T) 的差别 ─────────────────────────
{
  const base = {
    width: 60, height: 80, panelCount: 2, panelCode: "LR",
    frameType: "L", frameCount: "4", inOut: "IN", structure: "有框",
  } as const;
  const t = calculateVinylItem({ ...base, dividerSpec: "2T" }, { louverSize: 3.5 });
  const hh = calculateVinylItem({ ...base, dividerSpec: "2H" }, { louverSize: 3.5 });

  assert.equal(t.postLabel, "分隔柱");
  assert.equal(hh.postLabel, "挂柱");
  // 柱长不同：T 取内空高，H 取成品高-3/16
  near(piece(t, "分隔柱").lengthIn, t.cavityHeight, "分隔柱长=内空高");
  near(piece(hh, "挂柱").lengthIn, hh.panelHeight - 3 / 16, "挂柱长=成品高-3/16");
  // 柱占宽不同 → 成品窗宽不同（T=1"，H=28/16"）
  assert.ok(hh.panelWidth < t.panelWidth, "挂柱占宽更大，成品窗更窄");
  near(t.panelWidth - hh.panelWidth, (2 * (28 / 16 - 1)) / 2, "两种柱的宽差");

  assert.deepEqual(parseDividerSpec("2T"), { count: 2, type: "T" });
  assert.deepEqual(parseDividerSpec(" 3h "), { count: 3, type: "H" });
  assert.equal(parseDividerSpec(""), null);
  assert.equal(parseDividerSpec("2X"), null);
  assert.equal(parseDividerSpec("T2"), null);
}

// ── 7. 特殊分隔档优先于比例 ───────────────────────────────
{
  const base = {
    width: 40, height: 80, panelCount: 1, panelCode: "L",
    frameType: "L", frameCount: "4", inOut: "IN", structure: "有框",
  } as const;
  const byRatio = calculateVinylItem({ ...base, midRailRatio: 0.5 }, { louverSize: 3.5 });
  near(byRatio.midRail, 0.5 * 80 - 14 / 16, "比例算出的分隔档");

  const bySpecial = calculateVinylItem(
    { ...base, midRailRatio: 0.5, specialMidRail: 30 },
    { louverSize: 3.5 },
  );
  near(bySpecial.midRail, 30 - 14 / 16, "特殊分隔档优先");
}

// ── 8. 无框 & 异常组合的告警 ──────────────────────────────
{
  // 无框：内空取原始尺寸
  const frameless = calculateVinylItem(
    { width: 40, height: 60, panelCount: 1, panelCode: "L",
      frameType: "", frameCount: "", inOut: "", structure: "无框" },
    { louverSize: 3.5 },
  );
  near(frameless.cavityWidth, 40, "无框内空宽=原始宽");
  near(frameless.cavityHeight, 60, "无框内空高=原始高");
  assert.ok(
    frameless.warnings.some((w) => w.code === "UNKNOWN_FRAME_COMBO"),
    "无框且外框字段全空 → 提示无对应减尺（与原表 J10=0 一致）",
  );

  // 无框却填了合法外框组合 → 报矛盾
  const conflicted = calculateVinylItem(
    { width: 40, height: 60, panelCount: 1, panelCode: "L",
      frameType: "L", frameCount: "4", inOut: "IN", structure: "无框" },
    { louverSize: 3.5 },
  );
  near(conflicted.cavityWidth, 40, "无框仍取原始尺寸");
  assert.ok(conflicted.warnings.some((w) => w.code === "FRAMELESS_WITH_FRAME"));
  assert.ok(conflicted.pieces.some((p) => p.name === "L 型框-宽"), "型框料仍按表出（如实照搬）");

  // 未知百叶尺寸
  const badLouver = calculateVinylItem(
    { width: 40, height: 60, panelCount: 1, panelCode: "L",
      frameType: "L", frameCount: "4", inOut: "IN", structure: "有框" },
    { louverSize: 4 },
  );
  assert.ok(badLouver.warnings.some((w) => w.code === "UNKNOWN_LOUVER_SIZE"));

  // 格式不对的柱
  const badDivider = calculateVinylItem(
    { width: 40, height: 60, panelCount: 1, panelCode: "L", dividerSpec: "两根",
      frameType: "L", frameCount: "4", inOut: "IN", structure: "有框" },
    { louverSize: 3.5 },
  );
  assert.ok(badDivider.warnings.some((w) => w.code === "INVALID_DIVIDER_SPEC"));
}

// ── 9. 开启状态编码表 ─────────────────────────────────────
{
  assert.deepEqual(resolvePanelSpec("L", 3.5), { strips: 1, caps: 1 });
  assert.deepEqual(resolvePanelSpec("llrr", 2.5), { strips: 5, caps: 3 }, "大小写不敏感");
  assert.deepEqual(resolvePanelSpec("LRTLR", 3.5), { strips: 6, caps: 2 });
  assert.deepEqual(resolvePanelSpec("LTLTR", 2.5), { strips: 3, caps: 3 });

  // 只有 3.5" 分支才有的码
  assert.deepEqual(resolvePanelSpec("LT", 3.5), { strips: 1, caps: 1 });
  assert.equal(resolvePanelSpec("LT", 2.5), null, "2.5\" 分支里没有 LT");
  assert.equal(resolvePanelSpec("LRTLRTLR", 2.5), null);
  assert.deepEqual(resolvePanelSpec("LRTLRTLR", 3.5), { strips: 9, caps: 3 });

  // 查不到就是查不到 —— 不退化成 0
  assert.equal(resolvePanelSpec("XYZ", 3.5), null);
  assert.equal(resolvePanelSpec("", 3.5), null);

  // 可配置：覆盖 + 新增
  const overrides = [
    { code: "LLRR", louverSize: null, strips: 7, caps: 4 },
    { code: "LRLRLR", louverSize: 3.5, strips: 11, caps: 5 },
  ];
  assert.deepEqual(resolvePanelSpec("LLRR", 3.5, overrides), { strips: 7, caps: 4 }, "覆盖默认项");
  assert.deepEqual(resolvePanelSpec("LRLRLR", 3.5, overrides), { strips: 11, caps: 5 }, "新增码");
  assert.equal(resolvePanelSpec("LRLRLR", 2.5, overrides), null, "新增码限定 3.5\"");
  assert.deepEqual(resolvePanelSpec("LLRR", 3.5), { strips: 5, caps: 3 }, "覆盖不污染默认表");

  assert.ok(listPanelCodes(3.5).length > listPanelCodes(2.5).length, "3.5\" 是 2.5\" 的超集");
  assert.ok(listPanelCodes(3.5, overrides).includes("LRLRLR"));
  assert.equal(DEFAULT_PANEL_CODES.length, 20);

  // "x/y" 文本按 / 切分，两位数也不会取错（原表 LEFT/RIGHT 会）
  assert.deepEqual(parsePanelSpecText("5/3"), { strips: 5, caps: 3 });
  assert.deepEqual(parsePanelSpecText("10/3"), { strips: 10, caps: 3 });
  assert.equal(parsePanelSpecText("abc"), null);
  assert.equal(formatPanelSpec({ strips: 4, caps: 4 }), "4/4");

  // 引擎里未知码要告警
  const r = calculateVinylItem(
    { width: 40, height: 60, panelCount: 1, panelCode: "ZZZ",
      frameType: "L", frameCount: "4", inOut: "IN", structure: "有框" },
    { louverSize: 3.5 },
  );
  assert.equal(r.panelSpec, null);
  assert.ok(r.warnings.some((w) => w.code === "UNKNOWN_PANEL_CODE"));
}

// ── 10. SF：先各自向上取整再算（订单总表 N 列） ────────────
{
  assert.equal(calcSquareFeet(36, 60), 15);
  assert.equal(calcSquareFeet(60, 80), 34);
  // 36.1 × 60.1 → ROUNDUP 各自到 37 × 61 = 2257/144 = 15.67 → 16
  assert.equal(calcSquareFeet(36.1, 60.1), 16);
  assert.equal(calcSquareFeet(0, 60), 0);
}

// ── 12. 汇总与物料总表 ────────────────────────────────────
{
  const ctx = { louverSize: 3.5 };
  const inputs: VinylItemInput[] = [
    { location: "客厅", width: 36, height: 60, panelCount: 2, panelCode: "LR",
      frameType: "L", frameCount: "4", inOut: "IN", structure: "有框" },
    { location: "书房", width: 40, height: 70, panelCount: 2, panelCode: "LLRR",
      frameType: "T", frameCount: "4", inOut: "IN", structure: "有框", dividerSpec: "1T" },
  ];
  const items = inputs.map((input) => ({ input, calc: calculateVinylItem(input, ctx) }));
  for (const it of items) assert.deepEqual(it.calc.warnings, [], "算例不该有告警");

  const stiles = buildStileSummary(items);
  assert.equal(stiles.length, 2);
  // 第 1 扇：直柱 57.9375" × 4 根 → 米数
  near(stiles[0].stileMeters, 57.9375 * 4 * 0.0254, "直柱米数（乘了数量）");
  assert.equal(stiles[0].strips, 3);
  assert.equal(stiles[0].caps, 1);
  near(stiles[0].stripMeters, 57.9375 * 3 * 0.0254, "条米数 = 直柱长 × 条数");

  const rails = buildRailSummary(items);
  assert.equal(rails[0].louverEndCaps, rails[0].louverQty * 2, "百叶盖头 = 百叶数 × 2");
  assert.equal(rails[0].louverConnectors, rails[0].louverQty, "百叶帧 = 百叶数");

  const totals = buildTotals(items);
  assert.ok(totals.stileMeters > 0 && totals.railMeters > 0 && totals.louverMeters > 0);

  const bom = buildBom(items);
  assert.equal(bom.wasteFactor, VINYL_WASTE_FACTOR);
  assert.equal(bom.wasteFactor, 1.15, "Vinyl 是 1.15，不是 Blinds 的 1.2");
  assert.equal(bom.windowCount, 2);

  const byName = (n: string) => {
    const l = bom.lines.find((x) => x.name === n);
    assert.ok(l, `物料总表应有「${n}」`);
    return l!;
  };
  // 直柱 = Σ(直柱长×数量)×0.0254×1.15
  near(byName("直柱 Stile").qty, Math.round(totals.stileMeters * 1.15 * 100) / 100, "直柱用量");
  // LIGHT BLOCK 盖条 = 直柱 / 2
  near(byName("LIGHT BLOCK 盖条").qty, Math.round((totals.stileMeters * 1.15) / 2 * 100) / 100, "盖条");
  // Corner Key = 窗数 × 4
  assert.equal(byName("Corner Key L角").qty, 8);
  // 弹簧盖 / Flat Cap = 直柱总根数
  assert.equal(byName("弹簧盖 Spring Cap").qty, totals.stileQty);
  assert.equal(byName("Flat Cap 直柱盖").qty, totals.stileQty);
  assert.equal(byName("Stile Support Block 直柱支撑块").qty, totals.stileQty * 2);
  // 框材按框型分开
  assert.ok(byName("L FRAME").qty > 0, "第 1 扇是 L 框");
  assert.ok(byName("T FRAME").qty > 0, "第 2 扇是 T 框");
  assert.equal(byName("Z FRAME").qty, 0);
  assert.equal(byName("Door Frame").qty, 0);
  // T柱：只有第 2 扇有 1 根分隔柱
  assert.ok(byName("T柱").qty > 0);
  // 按个买的不乘损耗
  assert.equal(byName("百叶盖头 Louver End Cap").wasted, false);
  assert.equal(byName("直柱 Stile").wasted, true);
}

// ── 13. 备用料长不进物料汇总（与 Sheet1 (2) 只取 C 列一致） ──
{
  const ctx = { louverSize: 3.5 };
  const input: VinylItemInput = {
    location: "test", width: 60, height: 80, panelCount: 2, panelCode: "LR",
    frameType: "T", frameCount: "4", inOut: "IN", structure: "有框",
  };
  const calc = calculateVinylItem(input, ctx);
  const items = [{ input, calc }];
  const bom = buildBom(items);
  const tFrame = bom.lines.find((l) => l.name === "T FRAME")!;

  // 只算主料：(59.875*2 + 79.875*2) 英寸
  const mainInches = 59.875 * 2 + 79.875 * 2;
  near(tFrame.qty, Math.round(mainInches * 0.0254 * 1.15 * 100) / 100, "框材只算主料");
  // 备用料长确实存在，但没被算进去
  assert.ok(calc.pieces.some((p) => p.informational), "备用料长应在清单里");
}

// ── 14. 精度：控制杆长不能被间距的舍入污染 ────────────────
{
  // 3.5" / T / 4 / IN / 60×80 / 4扇 / 分隔档 0.5
  //   D8 = 78.625；C5 = 40 - 10/16 = 39.375
  //   F9 = ROUNDUP((78.625-39.375-139/16)/3)+1 = ROUNDUP(10.1875)+1 = 12
  //   G9 = ROUNDUP((39.375-8.6875)/3)+1 = ROUNDUP(10.229…)+1 = 12
  //   G15 = (78.625 - 2*8.6875)/(12+12-2) = 61.25/22
  //   控制杆 = 61.25/22*11 + 1.5 = 30.625 + 1.5 = 32.125（精确值）
  const r = calculateVinylItem(
    { width: 60, height: 80, panelCount: 4, panelCode: "LLRR",
      dividerSpec: "2T", midRailRatio: 0.5,
      frameType: "T", frameCount: "4", inOut: "IN", structure: "有框" },
    { louverSize: 3.5 },
  );
  assert.equal(r.topLouvers, 12);
  assert.equal(r.bottomLouvers, 12);
  near(r.louverPitch, 61.25 / 22, "间距");

  // 先把间距舍入再乘 11 会得到 32.1250000001 —— 这里必须是精确的 32.125
  assert.equal(piece(r, "控制杆（上）").lengthIn, 32.125, "上控制杆必须精确");
  assert.equal(piece(r, "控制杆（下）").lengthIn, 32.125, "下控制杆必须精确");

  // 另一组：无分隔档，间距 = 68/23，控制杆 = 68/23*23 + 1.5 = 69.5
  const r2 = calculateVinylItem(
    { width: 40, height: 82, panelCount: 1, panelCode: "L",
      frameType: "Door", frameCount: "3+1", inOut: "OUT", structure: "有框" },
    { louverSize: 3.5 },
  );
  assert.equal(piece(r2, "控制杆（下）").lengthIn, 69.5, "控制杆必须精确");

  // 成品窗宽落在 32 分位上，不能被截成 4 位小数
  const r3 = calculateVinylItem(
    { width: 36, height: 60, panelCount: 2, panelCode: "LR",
      frameType: "L", frameCount: "4", inOut: "IN", structure: "有框" },
    { louverSize: 3.5 },
  );
  assert.equal(r3.panelWidth, 16.96875, "成品窗宽保留全精度（16.9688 是错的）");
  assert.equal(r3.louverPitch, 2.9296875, "间距保留全精度");
}

// ── 14. 编码表落库校验（车间自助加码的入口） ──────────────
{
  assert.equal(normalizePanelCode(" l l r r "), "LLRR");

  const ok = validatePanelCodeInput({ code: " ltlr ", louverSize: 3.5, strips: 4, caps: 2, note: " 左中右 " });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.code, "LTLR", "落库前统一大写去空格");
    assert.equal(ok.value.louverSize, 3.5);
    assert.equal(ok.value.note, "左中右");
  }

  // 通用码：尺寸留空
  const generic = validatePanelCodeInput({ code: "LR", louverSize: "", strips: 3, caps: 1 });
  assert.equal(generic.ok, true);
  if (generic.ok) assert.equal(generic.value.louverSize, null, "空 = 通用");

  // 0 是合法的（某些码确实不出条/盖）
  assert.equal(validatePanelCodeInput({ code: "X", louverSize: null, strips: 0, caps: 0 }).ok, true);

  const bad = (payload: unknown, why: string) => {
    const r = validatePanelCodeInput(payload);
    assert.equal(r.ok, false, `应拒绝: ${why}`);
  };
  bad({ code: "", strips: 1, caps: 1 }, "空码");
  bad({ code: "LL-RR", strips: 1, caps: 1 }, "含非字母");
  bad({ code: "LR1", strips: 1, caps: 1 }, "含数字");
  bad({ code: "LR", louverSize: 4, strips: 1, caps: 1 }, "非法百叶尺寸");
  bad({ code: "LR", strips: 1.5, caps: 1 }, "条数非整数");
  bad({ code: "LR", strips: -1, caps: 1 }, "条数为负");
  bad({ code: "LR", strips: 1, caps: 100 }, "盖数超范围");
  bad({ code: "L".repeat(17), strips: 1, caps: 1 }, "码过长");

  // 加码后引擎立刻认：走 overrides 通路（API 侧从 VinylPanelCode 读出来喂进来）
  const added = validatePanelCodeInput({ code: "LRLRLR", louverSize: 3.5, strips: 11, caps: 5 });
  assert.equal(added.ok, true);
  if (added.ok) {
    const overrides = [{ ...added.value, louverSize: added.value.louverSize }];
    const r = calculateVinylItem(
      { width: 60, height: 80, panelCount: 6, panelCode: "LRLRLR",
        frameType: "L", frameCount: "4", inOut: "IN", structure: "有框" },
      { louverSize: 3.5, panelCodeOverrides: overrides },
    );
    assert.deepEqual(r.panelSpec, { strips: 11, caps: 5 }, "新加的码引擎立刻生效");
    assert.equal(
      r.warnings.some((w) => w.code === "UNKNOWN_PANEL_CODE"), false,
      "加了码就不该再报待补",
    );
    // 没有覆盖表时仍应报待补
    const without = calculateVinylItem(
      { width: 60, height: 80, panelCount: 6, panelCode: "LRLRLR",
        frameType: "L", frameCount: "4", inOut: "IN", structure: "有框" },
      { louverSize: 3.5 },
    );
    assert.ok(without.warnings.some((w) => w.code === "UNKNOWN_PANEL_CODE"));
  }
}

console.log("✅ Vinyl 引擎全部通过（6 种框型 + 2 组逐格算例 + 14 组断言）");
