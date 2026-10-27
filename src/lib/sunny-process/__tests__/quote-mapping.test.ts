/**
 * 报价 Order Form → 工艺单映射 + 待核对清单（QM-01..）
 * 口径：2026-10-27 Lucas 拍板（L/R=普通拉绳、M=电动；罩盒默认映射；草稿；窗帘默认 6cm）
 * 运行：npx tsx src/lib/sunny-process/__tests__/quote-mapping.test.ts
 */
import { blockingIssues, computeIssues } from "../issues";
import { emptySpec, type ProcessSpec } from "../process-spec";
import { deriveOpenCode, mapQuoteFormToProcessOrder } from "../quote-mapping";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); } };

const shade = (o: Record<string, unknown>) => ({ id: "x", location: "Living", widthWhole: "36", widthFrac: "8", heightWhole: "60", heightFrac: "0", product: "Zebra", sku: "ZB-1", mount: "I", lift: "L", bracket: "C", valance: "Cassette", note: "", ...o });
const form = (o: Record<string, unknown>) => JSON.stringify({ orderNumber: "G1027-01-Z1", shadeOrders: [], shutterOrders: [], drapeOrders: [], shutterMaterial: "Vinyl", shutterLouverSize: '3-1/2"', shadeValanceType: "", shadeBracketType: "", ...o });
const specOf = (m: ReturnType<typeof mapQuoteFormToProcessOrder>): ProcessSpec => ({ ...m.spec, version: 1, source: null });

console.log("报价 → 工艺单映射");

// QM-01 spec 场景：斑马帘 Mount=O、Lift=L、Bracket=W、Valance=Cassette
{
  const m = mapQuoteFormToProcessOrder(form({ shadeOrders: [shade({ mount: "O", lift: "L", bracket: "W", valance: "Cassette" })] }));
  const it = m.blindsItems[0]!;
  ok(m.blindsItems.length === 1 && it.productType === "斑马帘" && it.measureType === "OUT" && it.controlType === "普通" && it.controlSide === "L" && it.headrailType === "亮白插片圆盒" && it.mountType === "墙装", "QM-01: 斑马帘 O/L/W/Cassette → OUT/普通/L/亮白插片圆盒/墙装", it);
  ok(it.width === 36.5 && it.height === 60, "QM-01b: 英寸 + 16 分数合并", it);
  ok(it.fabricRatio === 3 && it.silkRatio === 2, "QM-01c: 斑马帘布纱比默认 3:2");
  const issues = computeIssues(m.blindsItems as never, specOf(m));
  ok(issues.some((i) => i.level === "info" && i.field === "headrailType") && issues.some((i) => i.level === "info" && i.field === "fabricRatio"), "QM-01d: 罩盒默认映射与布纱比默认进待核对（提示级）");
  ok(blockingIssues(issues).length === 0, "QM-01e: 无阻断项", blockingIssues(issues));
}

// QM-02 Lift M → 电动 + 电机侧默认 R 提示；Lift R → 普通
{
  const m = mapQuoteFormToProcessOrder(form({ shadeOrders: [shade({ product: "Roller", lift: "M", valance: "None" }), shade({ product: "Roller", lift: "R", valance: "Fascia" })] }));
  const [a, b] = m.blindsItems;
  ok(a!.controlType === "电动" && a!.controlSide === "R" && a!.headrailType === "单轨无盒", "QM-02a: Roller M → 电动 / R / None→单轨无盒", a);
  ok(m.spec.notes.some((n) => n.section === "blinds" && n.line === 1 && n.field === "controlSide" && n.messageZh.includes("电机侧默认 R")), "QM-02b: 电机侧默认 R 进待核对");
  ok(b!.controlType === "普通" && b!.controlSide === "R" && b!.headrailType === "哑白方型罩盒", "QM-02c: Lift R → 普通拉绳；Fascia → 哑白方型罩盒", b);
  ok(a!.fabricRatio === null, "QM-02d: 非斑马帘无布纱比");
}

// QM-03 行内 Bracket 为空 → 取单头 Brackets Type；都空 → 顶装 + 提示；Valance 空 → 取单头 Valance
{
  const m = mapQuoteFormToProcessOrder(form({ shadeBracketType: "Wall", shadeValanceType: "Fascia", shadeOrders: [shade({ bracket: "", valance: "" })] }));
  ok(m.blindsItems[0]!.mountType === "墙装" && m.blindsItems[0]!.headrailType === "哑白方型罩盒", "QM-03a: 行内空 → 单头 Brackets / Valance");
  const m2 = mapQuoteFormToProcessOrder(form({ shadeOrders: [shade({ bracket: "", mount: "", lift: "" })] }));
  const notes = m2.spec.notes.map((n) => n.field);
  ok(m2.blindsItems[0]!.mountType === "顶装" && notes.includes("mountType") && notes.includes("measureType") && notes.includes("controlSide"), "QM-03b: 都空 → 顶装 / IN / 普通R，三条提示", notes);
}

// QM-04 外购帘 → 国内下单
{
  const m = mapQuoteFormToProcessOrder(form({ shadeOrders: [shade({ product: "Cordless Cellular", lift: "" }), shade({ product: "Allusion", lift: "M", mount: "O" }), shade({ product: "Roman Shade", lift: "L" }), shade({ product: "SkylightHoneycomb" })] }));
  const d = m.spec.domestic;
  ok(d.length === 4 && m.blindsItems.length === 0, "QM-04a: 外购帘全部进国内下单表");
  ok(d[0]!.productType === "蜂窝帘" && d[0]!.control === "无绳", "QM-04b: Cordless Cellular → 蜂窝帘 / 无绳", d[0]);
  ok(d[1]!.productType === "梦幻帘" && d[1]!.control === "电机" && d[1]!.measure === "外装" && d[1]!.side === "无", "QM-04c: Allusion → 梦幻帘 / 电机 / 外装", d[1]);
  ok(d[2]!.productType === "罗马帘" && m.spec.notes.some((n) => n.section === "domestic" && n.line === 3 && n.field === "productType"), "QM-04d: Roman Shade → 罗马帘 + 原件无罗马帘提示");
  ok(d[3]!.remark.includes("天窗"), "QM-04e: Skylight 备注天窗蜂窝帘");
}

// QM-05 缺宽高的行跳过；未知产品 → 无模板（阻断）
{
  const m = mapQuoteFormToProcessOrder(form({ shadeOrders: [shade({ widthWhole: "" }), shade({ product: "Vertical" })] }));
  ok(m.blindsItems.length === 0 && m.spec.unsupported.length === 1 && m.producible, "QM-05a: 缺宽跳过；未知产品进无模板段");
  ok(blockingIssues(computeIssues([], specOf(m))).some((i) => i.section === "unsupported"), "QM-05b: 无模板行是阻断项");
  ok(!mapQuoteFormToProcessOrder("{not json").producible && !mapQuoteFormToProcessOrder(null).producible, "QM-05c: 坏 JSON / 空 → 无可生产行");
}

// QM-06 Vinyl
{
  const sh = (o: Record<string, unknown>) => ({ id: "s", location: "Bed", widthWhole: "48", widthFrac: "0", heightWhole: "60", heightFrac: "0", frame: "L", openDirection: "LR", mountType: "I", midRail: "30", panelCount: 4, draft: "", ...o });
  const m = mapQuoteFormToProcessOrder(form({ shutterOrders: [sh({}), sh({ frame: "S", midRail: "中间", openDirection: "L", panelCount: 2, mountType: "O" })] }));
  const [a, b] = m.spec.vinyl;
  ok(m.spec.settings.vinyl.louver === 3.5 && a!.openCode === "LLRR" && a!.frame === "L" && a!.rail1In === 30 && a!.inOut === "IN" && a!.frameCount === 4 && a!.structure === "有框", "QM-06a: 3-1/2\" → 3.5；LR×4 → LLRR；Mid Rail 30 → 第一档 30\"", a);
  ok(b!.frame === "" && b!.quoteFrame === "S" && b!.openCode === "LL" && b!.rail1In === null && b!.inOut === "OUT", "QM-06b: S 框留空；L×2 → LL；Mid Rail 文本不解析", b);
  const issues = computeIssues([], specOf(m));
  ok(blockingIssues(issues).some((i) => i.section === "vinyl" && i.line === 2 && i.field === "frame" && i.messageZh === "缺外框类型"), "QM-06c: 缺外框类型是阻断项", issues);
  ok(issues.some((i) => i.level === "info" && i.section === "vinyl" && i.line === 2 && i.field === "rail1In"), "QM-06d: Mid Rail 不可解析 → 提示");
  // 补上外框后阻断消失
  const fixed = specOf(m);
  fixed.vinyl[1] = { ...fixed.vinyl[1]!, frame: "L", inOut: "IN" };
  ok(!blockingIssues(computeIssues([], fixed)).some((i) => i.section === "vinyl" && i.line === 2), "QM-06e: 补 L 框 + IN 后该窗无阻断", blockingIssues(computeIssues([], fixed)));
  // 不支持的组合
  const bad = specOf(m);
  bad.vinyl[0] = { ...bad.vinyl[0]!, inOut: "OUT", frameCount: "3+1" };
  ok(blockingIssues(computeIssues([], bad)).some((i) => i.line === 1 && i.messageZh.startsWith("外框组合 L/OUT/3+1 不受支持")), "QM-06f: L-OUT-3+1 不受支持 → 阻断");
  const mm = specOf(m);
  mm.vinyl[0] = { ...mm.vinyl[0]!, openCode: "LLR" };
  ok(blockingIssues(computeIssues([], mm)).some((i) => i.line === 1 && i.messageZh === "扇数/开合不匹配"), "QM-06g: 开合与扇数不符 → 阻断");
  ok(deriveOpenCode("LR", 3) === "LLR" && deriveOpenCode("R", 2) === "RR" && deriveOpenCode("", 2) === "", "QM-06h: 开合编码推导");
  const w = mapQuoteFormToProcessOrder(form({ shutterMaterial: "Wooden", shutterOrders: [sh({})] }));
  ok(w.spec.vinyl.length === 0 && w.spec.unsupported[0]?.reasonZh.includes("Wooden"), "QM-06i: Wooden 百叶 → 无模板（阻断）");
  const big = mapQuoteFormToProcessOrder(form({ shutterLouverSize: '4-1/2"', shutterOrders: [sh({})] }));
  ok(big.spec.settings.vinyl.louver === null && blockingIssues(computeIssues([], specOf(big))).some((i) => i.field === "vinyl.louver"), "QM-06j: 4-1/2\" 百叶 → 阻断");
}

// QM-07 窗帘
{
  const dr = (o: Record<string, unknown>) => ({ id: "d", location: "Dining", drapeWidthWhole: "100", drapeWidthFrac: "0", drapeHeightWhole: "96", drapeHeightFrac: "0", drapeFabricSku: "635", drapeFullness: "230", drapePanels: "D", drapePleatStyle: "P", drapeLiner: true, drapeBracket: "W", sheerWidthWhole: "100", sheerWidthFrac: "0", sheerHeightWhole: "96", sheerHeightFrac: "0", sheerFabricSku: "S-12", sheerFullness: "180", sheerPanels: "S", sheerPleatStyle: "R", sheerBracket: "W", accessoriesSku: "", note: "", ...o });
  const m = mapQuoteFormToProcessOrder(form({ drapeOrders: [dr({}), dr({ sheerFabricSku: "", drapePleatStyle: "G" }), dr({ sheerFabricSku: "", drapePleatStyle: "", drapeBracket: "C" })] }));
  const [a, b, c] = m.spec.drapes;
  ok(m.spec.settings.drapeVersion === "6cm", "QM-07a: 窗帘版本默认 6cm");
  ok(a!.part === "drape" && a!.craft === "韩褶P" && a!.fullness === 2.3 && a!.qty === 2 && a!.liner === "是" && a!.mount === "墙装W" && a!.rod === "方双轨" && a!.layer === "布", "QM-07b: 布帘 P/230/D/liner/W → 韩褶P/2.3/2/是/墙装W/方双轨", a);
  ok(b!.part === "sheer" && b!.craft === "蛇型R" && b!.fullness === 1.8 && b!.qty === 1 && b!.liner === "否" && b!.layer === "纱", "QM-07c: 纱帘 R/180/S → 蛇型R/1.8/1/纱", b);
  ok(m.spec.unsupported.some((u) => u.section === "drape" && u.reasonZh.includes("Grommet")), "QM-07d: Grommet → 无模板（阻断）");
  ok(c!.mount === "顶装C" && c!.rod === "" && c!.craft === "", "QM-07e: 顶装不需杆型；未选工艺留空", c);
  ok(blockingIssues(computeIssues([], specOf(m))).some((i) => i.section === "drapes" && i.line === 3 && i.field === "craft"), "QM-07f: 未选工艺 → 阻断");
}

// QM-07g 审查发现 #11：填了内容但缺宽高的行不进工艺单，但在订单级提示里点名
{
  const m = mapQuoteFormToProcessOrder(form({
    shadeOrders: [shade({ location: "Attic", heightWhole: "" }), shade({})],
    shutterOrders: [{ location: "Bath", widthWhole: "30", widthFrac: "0", heightWhole: "", heightFrac: "0", frame: "L", openDirection: "L", mountType: "I", midRail: "", panelCount: 1 }],
  }));
  const notes = computeIssues(m.blindsItems as never, specOf(m)).filter((i) => i.section === "order" && i.field.startsWith("skipped."));
  ok(m.blindsItems.length === 1 && notes.length === 2 && notes[0]!.messageZh.includes("Attic") && notes[1]!.messageZh.includes("Bath"), "QM-07g: 缺宽高的帘子 / 百叶行在待核对里点名", notes);
  const big = mapQuoteFormToProcessOrder(form({ shutterOrders: [{ location: "X", widthWhole: "30", widthFrac: "0", heightWhole: "40", heightFrac: "0", frame: "L", openDirection: "L", mountType: "I", midRail: "", panelCount: 10000000 }] }));
  ok(big.spec.vinyl[0]!.panels === 20, "QM-07h: 异常大的扇数被截到 20（>9 由待核对阻断）", big.spec.vinyl[0]!.panels);
}

// QM-08 空工艺单是阻断
ok(blockingIssues(computeIssues([], emptySpec())).some((i) => i.field === "lines"), "QM-08: 无任何行 → 阻断");

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
