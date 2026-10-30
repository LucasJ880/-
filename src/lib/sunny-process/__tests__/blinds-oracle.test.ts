/**
 * Blinds 工艺引擎 × Excel 原件逐值对照（卷帘 / 斑马帘 / 香格里拉）
 * 原件：Blinds 工艺单_圆盒侧盖加厚标准版（20241007 新），第 1 窗位模板
 * 运行：npx tsx src/lib/sunny-process/__tests__/blinds-oracle.test.ts
 */
import { calculateItem, getCordLengthTier } from "@/lib/blinds/calculation-engine";
import { loadFixture, Tally, type ExcelValue } from "./oracle-helpers";

interface BlindsCase {
  id: string;
  input: {
    width: number; height: number; productType: string; measureType: string; controlType: string;
    headrailType: string; fabricRatio: number | null; silkRatio: number | null;
  };
  expected: {
    cutHeadrail: ExcelValue; cutTube38: ExcelValue; cutRollerBar: ExcelValue; cutZebraBar: ExcelValue;
    cutCoreRod: ExcelValue; cutShangrilaBar: ExcelValue; cutFabricWidth: ExcelValue; cutFabricLength: ExcelValue;
    zebraCutPos: ExcelValue; insertSize: ExcelValue; cordTier: ExcelValue;
    qty: Record<"headrail" | "tube38" | "rollerBar" | "zebraBar" | "coreRod" | "shangrilaBar" | "fabricWidth" | "fabricLength", ExcelValue>;
    cutCategory: ExcelValue; squareFeet: ExcelValue; sheetCordLength: ExcelValue; sheetCordSleeve: ExcelValue;
  };
}

/** 原件尺寸单元格："*N/A" / "Invalid Input" / 空 / FALSE(0 且非数值件) → null */
function dim(v: ExcelValue): number | null {
  return typeof v === "number" ? v : null;
}
/** 原件"0 表示不适用"的单元格（插片 / 裁剪位 / 分档） */
function zeroAsNull(v: ExcelValue): number | string | null {
  if (v === 0 || v === "" || v === null) return null;
  return typeof v === "number" || typeof v === "string" ? v : null;
}
/** 原件数量单元格："" → 0 */
function qty(v: ExcelValue): number {
  return typeof v === "number" ? v : 0;
}

const fx = loadFixture<BlindsCase>("blinds");
const t = new Tally();
console.log(`Blinds × 原件《${fx.source.title}》 sha256=${fx.source.sha256.slice(0, 12)}… 用例 ${fx.cases.length}`);

const TYPO_HEADRAILS = new Set(["亮白插片圆盒", "灰弧", "白弧"]);

for (const c of fx.cases) {
  const i = c.input;
  const e = c.expected;
  const r = calculateItem({ ...i });
  const L = (k: string) => `${c.id} ${i.productType}/${i.controlType}/${i.headrailType}/${i.measureType} ${k}`;

  t.eq(r.cutHeadrail, dim(e.cutHeadrail), L("罩盒"));
  t.eq(r.cutTube38, dim(e.cutTube38), L("38管"));
  t.eq(r.cutRollerBar, dim(e.cutRollerBar), L("卷帘下杆"));
  t.eq(r.cutZebraBar, dim(e.cutZebraBar), L("斑马帘下杆"));
  t.eq(r.cutCoreRod, dim(e.cutCoreRod), L("圆芯杆"));
  t.eq(r.cutShangrilaBar, dim(e.cutShangrilaBar), L("香格里拉下杆"));
  t.eq(r.cutFabricWidth, dim(e.cutFabricWidth), L("面料宽度"));
  t.eq(r.cutFabricLength, dim(e.cutFabricLength), L("面料长度"));
  t.eq(r.insertSize, zeroAsNull(e.insertSize), L("插片"));
  t.eq(r.cordTier, zeroAsNull(e.cordTier), L("拉绳分档"));
  t.eq(r.squareFeet, e.squareFeet, L("SF"));
  t.eq(r.cutCategory, e.cutCategory, L("切割类别"));

  // 斑马帘裁剪位：原件对非斑马帘返回 FALSE（读作 0）
  if (i.productType === "斑马帘") t.eq(r.zebraCutPos, dim(e.zebraCutPos), L("斑马帘裁剪位"));
  else t.eq(r.zebraCutPos, null, L("非斑马帘无裁剪位"));

  // 裁剪数量
  t.eq(r.quantities.headrail, qty(e.qty.headrail), L("罩盒数量"));
  t.eq(r.quantities.tube38, qty(e.qty.tube38), L("38管数量"));
  t.eq(r.quantities.fabricWidth, qty(e.qty.fabricWidth), L("面料宽数量"));
  t.eq(r.quantities.fabricLength, qty(e.qty.fabricLength), L("面料长数量"));
  const barCell = i.productType === "卷帘" ? e.qty.rollerBar : i.productType === "斑马帘" ? e.qty.zebraBar : e.qty.shangrilaBar;
  if (i.productType !== "斑马帘" && TYPO_HEADRAILS.has(i.headrailType)) {
    t.skip("X-2");
    t.eq(qty(barCell), 0, L("原件下杆数量确为 0（X-2 前提）"));
    t.eq(r.quantities.bottomBar, 1, L("系统下杆数量 = 1"));
  } else {
    t.eq(r.quantities.bottomBar, qty(barCell), L("下杆数量"));
  }
  t.eq(r.quantities.coreRod, i.productType === "斑马帘" ? qty(e.qty.coreRod) : 0, L("圆芯杆数量"));

  // 拉绳 / 绳套：原件布料表对所有操控都计（X-1）
  if (i.controlType === "普通") {
    t.eq(r.cordLength, dim(e.sheetCordLength), L("拉绳长度"));
    const sleeve = dim(e.sheetCordSleeve);
    t.eq(r.cordSleeveLen ?? 0, sleeve ?? 0, L("绳套长度"));
  } else {
    t.skip("X-1");
    t.eq(r.cordLength, null, L("非普通无拉绳"));
  }
}

// 分档文本逐字（含 "1.0 & 0.7" 的一位小数，不能写成 "1 & 0.7"）
t.ok(getCordLengthTier(1.0 / (0.8 * 0.0254), "普通") === "1.0 & 0.7", "分档文本保留一位小数");
t.ok(getCordLengthTier(40, "电动") === null && getCordLengthTier(40, "无绳") === null, "电动 / 无绳无分档");

t.report("Blinds 原件对照");
