/**
 * 斑马帘布纱比对照表（ZR-01..）：原件种子、匹配规则、清洗、报价映射查表
 * 运行：npx tsx src/lib/sunny-process/__tests__/zebra-ratios.test.ts
 */
import { computeIssues } from "../issues";
import { mapQuoteFormToProcessOrder } from "../quote-mapping";
import {
  lookupZebraRatio,
  parseRatioPart,
  ratioPartText,
  readZebraRatios,
  sanitizeZebraRatios,
  withZebraRatios,
  ZEBRA_RATIO_SEED,
  type ZebraRatioEntry,
} from "../zebra-ratios";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); } };

console.log("斑马帘布纱比对照表");

// ZR-01 种子 = 原件 Sheet1 W 列（逐条核对几条有代表性的）
{
  const by = (code: string) => ZEBRA_RATIO_SEED.find((e) => e.codes.includes(code));
  ok(ZEBRA_RATIO_SEED.length === 24, "ZR-01a: 原件 W2–W29 去重后 24 条（W11 与 W3 同一面料）", ZEBRA_RATIO_SEED.length);
  ok(by("ZE-215-F1091")?.fabric === 3.125 && by("ZE-215-F1091")?.silk === 2.125 && by("SD-ZB-F1091") === by("ZE-215-F1091"), "ZR-01b: ZE-215-F1091 3 2/16:2 2/16，括号别名 SD-ZB-F1091 同一条");
  ok(by("SA-ZC-A19-3")?.fabric === 4 + 13 / 16 && by("SA-ZC-A19-3")?.silk === 3.5, "ZR-01c: SA-ZC-A19-3 4 13/16:3 8/16");
  ok(by("YJ85-221-4")?.fabric === 3 && by("YJ85-221-4")?.silk === 2.125, "ZR-01d: YJ85-221-4 3:2 2/16");
  ok(by("SC-ZD-XZ74-1")!.noteZh.includes("两处不一致"), "ZR-01e: 原件两处不一致的 SC-ZD-XZ74-1 标注请核对");
  ok(new Set(ZEBRA_RATIO_SEED.flatMap((e) => e.codes.map((c) => c.toUpperCase()))).size === ZEBRA_RATIO_SEED.flatMap((e) => e.codes).length, "ZR-01f: 种子编码不重复");
}

// ZR-02 匹配规则
{
  const t: ZebraRatioEntry[] = [
    { codes: ["AQUAWIDE3"], fabric: 3.25, silk: 2.1875, noteZh: "" },
    { codes: ["AQUAWIDE3-BEIGE-LF"], fabric: 3.5, silk: 2.25, noteZh: "" },
    { codes: ["BL201"], fabric: 3.125, silk: 1.9375, noteZh: "" },
    { codes: ["Modina White"], fabric: 2.875, silk: 1.9375, noteZh: "" },
    { codes: ["F1091"], fabric: 3.125, silk: 2.125, noteZh: "" },
  ];
  ok(lookupZebraRatio(t, "aquawide3-beige-lf")?.entry.fabric === 3.5 && lookupZebraRatio(t, "aquawide3-beige-lf")?.exact === true, "ZR-02a: 完全相同优先（忽略大小写）");
  ok(lookupZebraRatio(t, "AQUAWIDE3-GRAY-LF")?.code === "AQUAWIDE3", "ZR-02b: 系列名作为完整段命中");
  ok(lookupZebraRatio(t, "LOUIA-WHITE-LF-BL201")?.code === "BL201", "ZR-02c: 编码出现在 SKU 末段命中");
  ok(lookupZebraRatio(t, "Modina-White-DO")?.code === "Modina White" && lookupZebraRatio(t, "MODINA_WHITE")?.code === "Modina White", "ZR-02d: 空格 / 下划线 / 连字符等价");
  ok(lookupZebraRatio(t, "AQUAWIDE4-GRAY-LF") === null && lookupZebraRatio(t, "SD-ZB-F10912") === null && lookupZebraRatio(t, "XBL201") === null, "ZR-02e: 不在段边界不算命中（AQUAWIDE4 / F10912 / XBL201）");
  ok(lookupZebraRatio(t, "") === null && lookupZebraRatio([], "AQUAWIDE3") === null, "ZR-02f: 空 SKU / 空表 → 未命中");
  ok(lookupZebraRatio(ZEBRA_RATIO_SEED, "SB-ZB-BL201")?.entry.silk === 1 + 15 / 16, "ZR-02g: 种子别名可直接查");
}

// ZR-03 16 分写法与清洗
{
  ok(parseRatioPart("3 2/16") === 3.125 && parseRatioPart("3") === 3 && parseRatioPart("2.5") === 2.5 && parseRatioPart("abc") === null && parseRatioPart("0") === null, "ZR-03a: 解析 3 2/16 / 3 / 2.5；拒绝非法");
  ok(ratioPartText(3.125) === "3 2/16" && ratioPartText(2) === "2" && ratioPartText(1 + 15 / 16) === "1 15/16", "ZR-03b: 回写为原件 16 分写法");
  ok(ratioPartText(3.1) === "3.1" && parseRatioPart(ratioPartText(3.1)) === 3.1 && parseRatioPart(ratioPartText(2.1875)) === 2.1875, "ZR-03b2: 非整 1/16 的小数原样显示，回存不漂移（审查发现）");
  const clean = sanitizeZebraRatios([
    { codes: " AQUAWIDE3 , AQUA3 ", fabric: "3 4/16", silk: "2 3/16", noteZh: "x" },
    { codes: [], fabric: 3, silk: 2 },
    { codes: ["X"], fabric: 0, silk: 2 },
    { codes: ["Y"], fabric: 3, silk: 99 },
    "junk",
  ]);
  ok(clean.length === 1 && clean[0]!.codes.join("|") === "AQUAWIDE3|AQUA3" && clean[0]!.fabric === 3.25 && clean[0]!.silk === 2.1875, "ZR-03c: 逗号分隔编码、16 分文本可输入；无编码 / 非正 / 越界的行丢弃", clean);
}

// ZR-04 组织设置读写（零 schema：settingsJson.sunnyProcess.zebraRatios）
{
  ok(readZebraRatios(null).seeded && readZebraRatios({ museBridge: {} }).entries.length === 24, "ZR-04a: 没保存过 → 原件种子");
  const next = withZebraRatios({ museBridge: { userPrefs: { u: 1 } }, sunnyProcess: { other: true } }, [{ codes: ["A"], fabric: 3, silk: 2, noteZh: "" }]);
  const back = readZebraRatios(next);
  ok(!back.seeded && back.entries.length === 1 && (next.museBridge as { userPrefs: unknown }).userPrefs !== undefined && (next.sunnyProcess as { other: boolean }).other === true, "ZR-04b: 写入不覆盖其它设置键", next);
  ok(readZebraRatios(withZebraRatios({}, [])).entries.length === 0 && !readZebraRatios(withZebraRatios({}, [])).seeded, "ZR-04c: 保存空表 = 全部默认 3:2（不回落到种子）");
}

// ZR-05 报价映射查表：命中用表值（提示写明来源），未命中默认 3:2 + 提示
{
  const shade = (sku: string) => ({ location: "L", widthWhole: "36", widthFrac: "0", heightWhole: "60", heightFrac: "0", product: "Zebra", sku, mount: "I", lift: "L", bracket: "C", valance: "Cassette", note: "" });
  const form = JSON.stringify({ shadeOrders: [shade("AQUAWIDE3-GRAY-LF"), shade("FARO-WHITE-BO")], shutterOrders: [], drapeOrders: [] });
  const table: ZebraRatioEntry[] = [{ codes: ["AQUAWIDE3"], fabric: 3.25, silk: 2.1875, noteZh: "" }];
  const m = mapQuoteFormToProcessOrder(form, { zebraRatios: table });
  const [a, b] = m.blindsItems;
  ok(a!.fabricRatio === 3.25 && a!.silkRatio === 2.1875, "ZR-05a: 命中 → 用对照表布纱比", a);
  ok(b!.fabricRatio === 3 && b!.silkRatio === 2, "ZR-05b: 未命中 → 默认 3:2", b);
  const notes = computeIssues(m.blindsItems as never, { ...m.spec, version: 1, source: null }).filter((i) => i.field === "fabricRatio");
  ok(notes.length === 2 && notes[0]!.messageZh.includes("对照表「AQUAWIDE3」") && notes[0]!.messageZh.includes("3 4/16 : 2 3/16") && notes[1]!.messageZh.includes("FARO-WHITE-BO 不在布纱比对照表里"), "ZR-05c: 待核对写明来源 / 未命中原因", notes);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
