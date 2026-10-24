/**
 * 签名 → 工艺单：报价端 → Vinyl 引擎的映射测试
 * 运行：npx tsx src/lib/work-orders/__tests__/from-quote-mapping.test.ts
 *
 * 重点不是"能映射"，而是**不能猜**：
 * 报价端表达不了的东西必须留空 + 标待补，而不是填一个看起来合理的值。
 */

import assert from "node:assert/strict";
import {
  parseQuoteFormSnapshot,
  fractionToInches,
} from "../quote-form-snapshot";
import {
  mapShutterLineToVinyl,
  resolveLouverSize,
  mapFrameType,
  derivePanelCode,
  parseMidRail,
} from "@/lib/vinyl/from-quote";
import { calculateVinylItem } from "@/lib/vinyl/calculation-engine";
import { isWorkOrderAutogenEnabledWithEnv } from "../flags";
import {
  mapShadeLineToBlinds,
  mapProductType,
  mapLift,
  mapBracket,
  mapMount,
} from "@/lib/blinds/from-quote";
import { calculateItem as calcBlinds } from "@/lib/blinds/calculation-engine";

const line = (over: Partial<Record<string, unknown>> = {}) => ({
  location: "客厅", widthIn: 36, heightIn: 60,
  frame: "L", openDirection: "LR", mountType: "I",
  midRail: "", panelCount: 2, draft: "",
  ...over,
} as Parameters<typeof mapShutterLineToVinyl>[0]);

const codesOf = (m: ReturnType<typeof mapShutterLineToVinyl>) =>
  m.notes.map((n) => n.code).sort();
const todos = (m: ReturnType<typeof mapShutterLineToVinyl>) =>
  m.notes.filter((n) => n.kind === "todo").map((n) => n.code).sort();

// ── 1. formDataJson 防御式解析 ────────────────────────────
{
  assert.equal(parseQuoteFormSnapshot(null).ok, false);
  assert.equal(parseQuoteFormSnapshot("").ok, false);
  assert.equal(parseQuoteFormSnapshot("不是 json").ok, false, "坏 JSON 不能抛");
  assert.equal(parseQuoteFormSnapshot("[1,2]").shutterOrders.length, 0);

  assert.equal(fractionToInches("36", "8"), 36.5);
  assert.equal(fractionToInches("36", "0"), 36);
  assert.equal(fractionToInches("", ""), 0);

  const snap = parseQuoteFormSnapshot(JSON.stringify({
    shutterMaterial: "Vinyl",
    shutterLouverSize: '3-1/2"',
    shutterOrders: [
      { location: "客厅", widthWhole: "36", widthFrac: "8", heightWhole: "60", heightFrac: "0",
        frame: "L", openDirection: "lr", mountType: "i", midRail: "", panelCount: 2, draft: "备注" },
      { location: "", widthWhole: "", widthFrac: "0", heightWhole: "", heightFrac: "0" }, // 空行
    ],
    shadeOrders: [
      { location: "客厅", widthWhole: "40", widthFrac: "0", heightWhole: "60", heightFrac: "0",
        product: "Zebra", sku: "SD-ZB-F1091", mount: "i", lift: "l", bracket: "c",
        valance: "亮白插片圆盒", note: "" },
      { location: "", widthWhole: "", widthFrac: "0" }, // 空行，应被剔除
    ],
    drapeOrders: [{}],
  }));
  assert.equal(snap.ok, true);
  assert.equal(snap.shutterOrders.length, 1, "空行应被剔除");
  assert.equal(snap.shutterOrders[0].widthIn, 36.5, "16 分制合并");
  assert.equal(snap.shutterOrders[0].openDirection, "LR", "统一大写");
  assert.equal(snap.shutterOrders[0].mountType, "I");
  assert.equal(snap.shadeOrders.length, 1, "Shades 空行也应被剔除");
  assert.equal(snap.shadeOrders[0].lift, "L", "lift 统一大写");
  assert.equal(snap.shadeOrders[0].bracket, "C");
  assert.equal(snap.shadeOrders[0].valance, "亮白插片圆盒");
  assert.equal(snap.drapeOrderCount, 1);
}

// ── 2. 百叶尺寸：只认 2-1/2" 与 3-1/2" ───────────────────
{
  assert.deepEqual(resolveLouverSize('2-1/2"'), { ok: true, louverSize: 2.5 });
  assert.deepEqual(resolveLouverSize('3-1/2"'), { ok: true, louverSize: 3.5 });
  // Lucas 2026-08-29 确认：Vinyl 暂不做
  assert.equal(resolveLouverSize('4-1/2"').ok, false);
  assert.equal(resolveLouverSize("Arch").ok, false);
  assert.equal(resolveLouverSize("").ok, false);
}

// ── 3. 框型：仅 L / Z 重合 ────────────────────────────────
{
  assert.equal(mapFrameType("L"), "L");
  assert.equal(mapFrameType("Z"), "Z");
  assert.equal(mapFrameType("z"), "Z");
  for (const f of ["S", "G", "M", "Casing", ""]) {
    assert.equal(mapFrameType(f), null, `${f} 不该被映射成任何引擎框型`);
  }
}

// ── 4. 开启码：只在能唯一确定时才给 ───────────────────────
{
  assert.equal(derivePanelCode("L", 1, 3.5), "L");
  assert.equal(derivePanelCode("R", 1, 3.5), "R");
  assert.equal(derivePanelCode("LR", 2, 3.5), "LR");

  // 关键：4 扇填 LR 绝不能当成 "LR"（条盖 3/1），实际 LLRR 是 5/3 —— 会错料
  assert.equal(derivePanelCode("LR", 4, 3.5), null, "多扇不得推断开启码");
  assert.equal(derivePanelCode("L", 2, 3.5), null, "2 扇填 L 也确定不了");
  assert.equal(derivePanelCode("LR", 1, 3.5), null);
  assert.equal(derivePanelCode("", 2, 3.5), null);
  assert.equal(derivePanelCode("LR", null, 3.5), null);
}

// ── 5. 分隔档自由文本解析 ─────────────────────────────────
{
  assert.deepEqual(parseMidRail(""), { absolute: null, ratio: null, unparsed: false });
  assert.deepEqual(parseMidRail("40"), { absolute: 40, ratio: null, unparsed: false });
  assert.deepEqual(parseMidRail("40.5"), { absolute: 40.5, ratio: null, unparsed: false });
  assert.deepEqual(parseMidRail("0.5"), { absolute: null, ratio: 0.5, unparsed: false });
  assert.deepEqual(parseMidRail("50%"), { absolute: null, ratio: 0.5, unparsed: false });
  assert.equal(parseMidRail("半高").unparsed, true, "看不懂就说看不懂");
  assert.equal(parseMidRail("中间偏上").unparsed, true);
  assert.equal(parseMidRail("150%").unparsed, true);
}

// ── 6. 三级映射：能推的推、有默认的默认、要判断的留空 ──────
{
  // 最顺的一行：L 框 / 2 扇 / LR / I
  const good = mapShutterLineToVinyl(line(), 1, { louverSize: 3.5 });
  assert.equal(good.input.frameType, "L");
  assert.equal(good.input.inOut, "IN");
  assert.equal(good.input.panelCode, "LR");
  assert.equal(good.input.width, 36);
  assert.equal(good.input.panelCount, 2);
  // 即使最顺的一行，报价端没有的三项也必须标出来
  assert.deepEqual(codesOf(good), [
    "DEFAULT_FRAME_COUNT", "DEFAULT_STRUCTURE", "MISSING_DIVIDER",
  ]);
  assert.deepEqual(todos(good), ["MISSING_DIVIDER"], "框数/结构是默认值，分隔柱是待补");
  assert.equal(good.input.frameCount, "4", "默认 4 框");
  assert.equal(good.input.structure, "有框", "默认有框");
  assert.equal(good.input.dividerSpec, null, "分隔柱留空，不猜");

  // 这一行能算出真尺寸（默认值让它可算，但待补项仍在）
  const calc = calculateVinylItem(good.input, { louverSize: 3.5 });
  assert.equal(calc.frameLabel, "L / 4 / IN");
  assert.ok(calc.cavityWidth > 0 && calc.panelWidth > 0);
  assert.deepEqual(calc.panelSpec, { strips: 3, caps: 1 }, "LR → 3/1");
}

// ── 7. 表达不了的一律留空 + 待补 ──────────────────────────
{
  // Casing 框：Vinyl 不做
  const casing = mapShutterLineToVinyl(line({ frame: "Casing" }), 2, { louverSize: 3.5 });
  assert.equal(casing.input.frameType, "", "不支持的框型必须留空，不能塞个 L 进去");
  assert.ok(todos(casing).includes("UNSUPPORTED_FRAME"));
  // 留空后引擎自己也会报"无对应减尺规则"，尺寸全 0，不会出错料单
  const casingCalc = calculateVinylItem(casing.input, { louverSize: 3.5 });
  assert.equal(casingCalc.frameLabel, null);
  assert.equal(casingCalc.cavityWidth, 0);

  // 4 扇：开启码推不出来
  const four = mapShutterLineToVinyl(line({ panelCount: 4, openDirection: "LR" }), 3, { louverSize: 3.5 });
  assert.equal(four.input.panelCode, "", "多扇不得猜开启码");
  assert.ok(todos(four).includes("MISSING_PANEL_CODE"));
  const fourCalc = calculateVinylItem(four.input, { louverSize: 3.5 });
  assert.equal(fourCalc.panelSpec, null, "条/盖必须是待补，不是 3/1");

  // 没填内外装 → 默认 IN，但标出来
  const noMount = mapShutterLineToVinyl(line({ mountType: "" }), 4, { louverSize: 3.5 });
  assert.equal(noMount.input.inOut, "IN");
  assert.ok(codesOf(noMount).includes("MISSING_IN_OUT"));
  assert.equal(
    noMount.notes.find((n) => n.code === "MISSING_IN_OUT")?.kind, "default",
  );

  // 没填扇数
  const noPanels = mapShutterLineToVinyl(line({ panelCount: null }), 5, { louverSize: 3.5 });
  assert.ok(todos(noPanels).includes("MISSING_PANEL_COUNT"));

  // 看不懂的分隔档
  const badMid = mapShutterLineToVinyl(line({ midRail: "半高" }), 6, { louverSize: 3.5 });
  assert.equal(badMid.input.specialMidRail, null);
  assert.equal(badMid.input.midRailRatio, null);
  assert.ok(todos(badMid).includes("UNPARSED_MID_RAIL"));
}

// ── 8. 待补信息必须带行号与位置，工厂能定位 ────────────────
{
  const m = mapShutterLineToVinyl(line({ location: "主卧", frame: "M" }), 7, { louverSize: 3.5 });
  const msg = m.notes.find((n) => n.code === "UNSUPPORTED_FRAME")!.message;
  assert.ok(msg.startsWith("#7 主卧:"), `待补信息应带行号与位置，实为: ${msg}`);
  assert.ok(msg.includes("M"), "应说明是哪种框不支持");
}

// ── 9. flag 默认关闭 ──────────────────────────────────────
{
  assert.equal(isWorkOrderAutogenEnabledWithEnv({} as NodeJS.ProcessEnv), false, "default OFF");
  assert.equal(
    isWorkOrderAutogenEnabledWithEnv({ SALES_WORKORDER_AUTOGEN_ENABLED: "true" } as NodeJS.ProcessEnv),
    true,
  );
  assert.equal(
    isWorkOrderAutogenEnabledWithEnv({ SALES_WORKORDER_AUTOGEN_ENABLED: "maybe" } as NodeJS.ProcessEnv),
    false,
    "看不懂的值按关闭",
  );
}

// ── 10. Shades → Blinds 映射 ─────────────────────────────
const shade = (over: Record<string, unknown> = {}) => ({
  location: "客厅", widthIn: 40, heightIn: 60,
  product: "Zebra", sku: "SD-ZB-F1091",
  mount: "I", lift: "L", bracket: "C",
  valance: "亮白插片圆盒", note: "",
  ...over,
} as Parameters<typeof mapShadeLineToBlinds>[0]);

const bTodos = (m: ReturnType<typeof mapShadeLineToBlinds>) =>
  m.notes.filter((n) => n.kind === "todo").map((n) => n.code).sort();

{
  // 产品映射：只有 3 类有减尺规则
  assert.equal(mapProductType("Zebra"), "斑马帘");
  assert.equal(mapProductType("Roller"), "卷帘");
  assert.equal(mapProductType("SHANGRILA"), "香格里拉");
  for (const p of ["Cordless Cellular", "SkylightHoneycomb", "Allusion", "Roman", ""]) {
    assert.equal(mapProductType(p), null, `${p} 不该被映射`);
  }

  // Lift 一列拆成 操控方式 + 拉杆位置
  assert.deepEqual(mapLift("L"), { controlType: "普通", controlSide: "L" });
  assert.deepEqual(mapLift("R"), { controlType: "普通", controlSide: "R" });
  assert.deepEqual(mapLift("M"), { controlType: "电动", controlSide: "M" });
  // 无绳没有拉杆侧：留空而不是塞个默认 R —— 那会让工厂以为有绳在右边
  assert.deepEqual(mapLift("C"), { controlType: "无绳", controlSide: "" });
  assert.equal(mapLift(""), null);
  assert.equal(mapLift("X"), null);

  assert.equal(mapBracket("C"), "顶装");
  assert.equal(mapBracket("W"), "侧装");
  assert.equal(mapBracket(""), null);
  assert.equal(mapMount("I"), "IN");
  assert.equal(mapMount("O"), "OUT");
  assert.equal(mapMount(""), null);
}

// ── 11. 报价端补齐罩盒+无绳后，一行能直接算出真尺寸 ────────
{
  const m = mapShadeLineToBlinds(shade(), 1);
  assert.deepEqual(bTodos(m), [], `不该有待补: ${JSON.stringify(m.notes)}`);
  assert.equal(m.input.productType, "斑马帘");
  assert.equal(m.input.headrailType, "亮白插片圆盒");
  assert.equal(m.input.controlType, "普通");
  assert.equal(m.input.controlSide, "L");
  assert.equal(m.input.measureType, "IN");
  assert.equal(m.input.mountType, "顶装");

  const calc = calcBlinds(m.input);
  // v2：普通/亮白插片圆盒 面料宽 = 宽 - 1.25
  assert.equal(calc.cutFabricWidth, 40 - 1.25);
  assert.notEqual(calc.cutHeadrail, null);
  // 布纱比按 SKU 从目录查出来，不用人填
  assert.equal(calc.ratioSource, "catalog");
  assert.equal(calc.fabricRatioUsed, 3.125);

  // 无绳整条链路
  const cordless = mapShadeLineToBlinds(shade({ lift: "C" }), 2);
  assert.equal(cordless.input.controlType, "无绳");
  assert.equal(cordless.input.controlSide, "");
  const cCalc = calcBlinds(cordless.input);
  // 无绳的减尺与拉绳不同，且无绳没有拉绳长度
  assert.notEqual(cCalc.cutFabricWidth, calc.cutFabricWidth, "无绳减尺应与拉绳不同");
  assert.equal(cCalc.cordLength, null, "无绳没有拉绳");
}

// ── 12. 缺罩盒/缺 Lift/不支持的产品：留空 + 待补 ──────────
{
  // 罩盒是全部减尺的依据，没有就必须待补
  const noHeadrail = mapShadeLineToBlinds(shade({ valance: "" }), 3);
  assert.equal(noHeadrail.input.headrailType, "");
  assert.ok(bTodos(noHeadrail).includes("MISSING_HEADRAIL"));

  // 历史报价单的自由文本罩盒不能当成有效值
  const legacy = mapShadeLineToBlinds(shade({ valance: "Cassette" }), 4);
  assert.equal(legacy.input.headrailType, "", "旧自由文本不能塞进引擎枚举");
  assert.ok(bTodos(legacy).includes("MISSING_HEADRAIL"));

  const noLift = mapShadeLineToBlinds(shade({ lift: "" }), 5);
  assert.equal(noLift.input.controlType, "");
  assert.ok(bTodos(noLift).includes("MISSING_LIFT"));

  const roman = mapShadeLineToBlinds(shade({ product: "Roman" }), 6);
  assert.equal(roman.input.productType, "", "无减尺规则的产品必须留空");
  assert.ok(bTodos(roman).includes("UNSUPPORTED_PRODUCT"));

  // 内外装/Bracket 没填 → 默认值，标 default 而非 todo
  const noMount = mapShadeLineToBlinds(shade({ mount: "", bracket: "" }), 7);
  assert.equal(noMount.input.measureType, "IN");
  assert.equal(noMount.input.mountType, "顶装");
  assert.deepEqual(bTodos(noMount), [], "这两项是默认值不是待补");
  assert.equal(
    noMount.notes.filter((n) => n.kind === "default").length, 2,
  );
}

console.log("✅ 签名→工艺单映射全部通过（12 组断言）");
