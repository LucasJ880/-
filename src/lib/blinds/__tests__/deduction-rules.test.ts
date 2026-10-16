/**
 * 减尺规则 / 裁切引擎 回归测试
 * 运行：npx tsx src/lib/blinds/__tests__/deduction-rules.test.ts
 *
 * GOLDEN 矩阵不是手抄的 —— 是把
 *   Blinds 工艺单_圆盒侧盖加厚标准版20251024.xlsx → 盖盒Ref
 * 三张表（普通/无绳/电动 × 8 罩盒 × 7 部件 = 168 格）的公式逐格求值后导出的。
 * 车间改了 Excel，就重新求值一次并在这里更新 + 升规则版本。
 */

import assert from "node:assert/strict";
import {
  RULE_VERSION,
  RULE_VERSIONS,
  getDeductionRules,
  resolveRuleVersion,
  getComponentQuantities,
  getCutClass,
  hasHeadrailCover,
  V2_PATCHES,
  CONTROL_TYPE_SHOP_LABEL,
  type ControlType,
  type HeadrailType,
} from "../deduction-rules";
import {
  calculateItem,
  getCordLengthTier,
  calcZebraCuttingPosition,
  resolveFabricRatio,
} from "../calculation-engine";
import {
  HEADRAIL_OPTIONS,
  HEADRAIL_LABELS,
  isHeadrailType,
  headrailLabelEn,
} from "../headrail-labels";
import {
  lookupFabricRatio,
  listConflictingSkus,
  parseRatioValue,
  FABRIC_RATIO_CATALOG,
} from "../fabric-ratio-catalog";

type Comp = "headrail" | "tube38" | "rollerBar" | "zebraBar" | "coreRod" | "shangrilaBar" | "fabricWidth";

/** 盖盒Ref 三张表求值结果（2026-08-29 从 xlsx 导出） */
const GOLDEN: Record<string, Record<string, Record<Comp, number>>> = {
  "普通": {
    "亮白插片圆盒": { headrail: -0.5, tube38: -1.125, rollerBar: -1.125, zebraBar: -1.125, coreRod: -1.25, shangrilaBar: -0.875, fabricWidth: -1.25 },
    "哑灰方型罩盒": { headrail: -0.4375, tube38: -1.25, rollerBar: -1.375, zebraBar: -1.1875, coreRod: -1.375, shangrilaBar: -1.375, fabricWidth: -1.4375 },
    "哑白方型罩盒": { headrail: -0.4375, tube38: -1.25, rollerBar: -1.375, zebraBar: -1.1875, coreRod: -1.375, shangrilaBar: -1.375, fabricWidth: -1.4375 },
    "灰弧": { headrail: -0.5, tube38: -1.125, rollerBar: -1.1875, zebraBar: -1.0625, coreRod: -1.25, shangrilaBar: -0.875, fabricWidth: -1.3125 },
    "白弧": { headrail: -0.5, tube38: -1.125, rollerBar: -1.1875, zebraBar: -1.0625, coreRod: -1.25, shangrilaBar: -0.875, fabricWidth: -1.3125 },
    "双轨无盒": { headrail: 0, tube38: -1.4375, rollerBar: -1.1875, zebraBar: 0, coreRod: 0, shangrilaBar: -1.1875, fabricWidth: -1.625 },
    "双轨半盒": { headrail: -0.375, tube38: -1, rollerBar: -1.1875, zebraBar: -1, coreRod: -1.1875, shangrilaBar: -0.75, fabricWidth: -1.25 },
    "单轨无盒": { headrail: 0, tube38: -1.625, rollerBar: -1.25, zebraBar: 0, coreRod: 0, shangrilaBar: -1.25, fabricWidth: -1.8125 },
  },
  "无绳": {
    "亮白插片圆盒": { headrail: -0.5, tube38: -0.9375, rollerBar: -0.625, zebraBar: -0.8125, coreRod: -1, shangrilaBar: -0.625, fabricWidth: -1.0625 },
    "哑灰方型罩盒": { headrail: -0.5, tube38: -1, rollerBar: -1.0625, zebraBar: -1.25, coreRod: -1.4375, shangrilaBar: -1.0625, fabricWidth: -1.4375 },
    "哑白方型罩盒": { headrail: -0.5, tube38: -1, rollerBar: -1.0625, zebraBar: -1.25, coreRod: -1.4375, shangrilaBar: -1.0625, fabricWidth: -1.4375 },
    "灰弧": { headrail: -0.25, tube38: -0.5, rollerBar: -0.5625, zebraBar: -0.75, coreRod: -0.9375, shangrilaBar: -0.5625, fabricWidth: -0.9375 },
    "白弧": { headrail: -0.25, tube38: -0.5, rollerBar: -0.5625, zebraBar: -0.75, coreRod: -0.9375, shangrilaBar: -0.5625, fabricWidth: -0.9375 },
    "双轨无盒": { headrail: 0, tube38: 0, rollerBar: 0, zebraBar: 0, coreRod: 0, shangrilaBar: 0, fabricWidth: 0 },
    "双轨半盒": { headrail: -0.375, tube38: -0.6875, rollerBar: -0.5, zebraBar: -0.6875, coreRod: -0.875, shangrilaBar: -0.5, fabricWidth: -0.875 },
    "单轨无盒": { headrail: 0, tube38: 0, rollerBar: 0, zebraBar: 0, coreRod: 0, shangrilaBar: 0, fabricWidth: 0 },
  },
  "电动": {
    "亮白插片圆盒": { headrail: -0.5, tube38: -1.125, rollerBar: -1.3125, zebraBar: -1.125, coreRod: -1.25, shangrilaBar: -0.875, fabricWidth: -1.25 },
    "哑灰方型罩盒": { headrail: -0.4375, tube38: -1.1875, rollerBar: -1.375, zebraBar: -1.1875, coreRod: -1.375, shangrilaBar: -1.375, fabricWidth: -1.375 },
    "哑白方型罩盒": { headrail: -0.4375, tube38: -1.1875, rollerBar: -1.375, zebraBar: -1.1875, coreRod: -1.375, shangrilaBar: -1.375, fabricWidth: -1.375 },
    "灰弧": { headrail: -0.5, tube38: -1.0625, rollerBar: -1.1875, zebraBar: -1.0625, coreRod: -1.25, shangrilaBar: -0.875, fabricWidth: -1.25 },
    "白弧": { headrail: -0.5, tube38: -1.0625, rollerBar: -1.1875, zebraBar: -1.0625, coreRod: -1.25, shangrilaBar: -0.875, fabricWidth: -1.25 },
    "双轨无盒": { headrail: 0, tube38: 0, rollerBar: 0, zebraBar: 0, coreRod: 0, shangrilaBar: 0, fabricWidth: 0 },
    "双轨半盒": { headrail: -0.375, tube38: -0.9375, rollerBar: -1.1875, zebraBar: -0.9375, coreRod: -1.1875, shangrilaBar: -0.75, fabricWidth: -1.1875 },
    "单轨无盒": { headrail: 0, tube38: 0, rollerBar: 0, zebraBar: 0, coreRod: 0, shangrilaBar: 0, fabricWidth: 0 },
  },
};

const COMPONENTS: Comp[] = [
  "headrail", "tube38", "rollerBar", "zebraBar", "coreRod", "shangrilaBar", "fabricWidth",
];

// ── 1. v2 必须与 Excel 168 格逐格一致 ──────────────────────
{
  const v2 = getDeductionRules("blinds_20251024_v2");
  let checked = 0;
  for (const ctrl of Object.keys(GOLDEN) as ControlType[]) {
    for (const hr of Object.keys(GOLDEN[ctrl]) as HeadrailType[]) {
      for (const c of COMPONENTS) {
        assert.equal(
          v2[ctrl][hr][c],
          GOLDEN[ctrl][hr][c],
          `v2 与 Excel 不一致: ${ctrl}/${hr}/${c}`,
        );
        checked++;
      }
    }
  }
  assert.equal(checked, 168, "应覆盖 168 格");
}

// ── 2. v1 与 v2 只差 patch 声明的那些格 ────────────────────
{
  const v1 = getDeductionRules("blinds_20251024_v1");
  const v2 = getDeductionRules("blinds_20251024_v2");
  const diffs: string[] = [];
  for (const ctrl of Object.keys(GOLDEN) as ControlType[]) {
    for (const hr of Object.keys(GOLDEN[ctrl]) as HeadrailType[]) {
      for (const c of COMPONENTS) {
        if (v1[ctrl][hr][c] !== v2[ctrl][hr][c]) diffs.push(`${ctrl}/${hr}/${c}`);
      }
    }
  }
  assert.equal(diffs.length, V2_PATCHES.length, `v1→v2 差异数应等于 patch 数，实际: ${diffs.join(", ")}`);
  assert.deepEqual(diffs, ["普通/亮白插片圆盒/fabricWidth"]);
  assert.equal(v1["普通"]["亮白插片圆盒"].fabricWidth, -1.375, "v1 保持旧值（历史单要能重现）");
  assert.equal(v2["普通"]["亮白插片圆盒"].fabricWidth, -1.25, "v2 对齐 Excel");
}

// ── 3. 版本解析 fail-closed：不认识的一律按 v1 ─────────────
{
  assert.equal(resolveRuleVersion(null), "blinds_20251024_v1");
  assert.equal(resolveRuleVersion(""), "blinds_20251024_v1");
  assert.equal(resolveRuleVersion("blinds_9999_v9"), "blinds_20251024_v1");
  assert.equal(resolveRuleVersion("blinds_20251024_v2"), "blinds_20251024_v2");
  assert.equal(RULE_VERSION, "blinds_20251024_v2");
  assert.equal(RULE_VERSIONS.length, 2);
}

// ── 4. 同一扇窗按不同版本算，面料宽差 2/16 ────────────────
{
  const input = {
    width: 40, height: 60,
    productType: "斑马帘", measureType: "IN",
    controlType: "普通", headrailType: "亮白插片圆盒",
  };
  const v1 = calculateItem(input, "blinds_20251024_v1");
  const v2 = calculateItem(input, "blinds_20251024_v2");
  assert.equal(v1.cutFabricWidth, 40 - 1.375);
  assert.equal(v2.cutFabricWidth, 40 - 1.25);
  assert.equal(v2.cutFabricWidth! - v1.cutFabricWidth!, 0.125, "差 2/16");
  // 其余部件不受影响
  assert.equal(v1.cutZebraBar, v2.cutZebraBar);
  assert.equal(v1.cutTube38, v2.cutTube38);
  assert.equal(v1.ruleVersion, "blinds_20251024_v1");
  assert.equal(v2.ruleVersion, "blinds_20251024_v2");
  // 不传版本 = 当前版本
  assert.equal(calculateItem(input).ruleVersion, RULE_VERSION);
}

// ── 5. OUT/Tight 仍然 +3/16 ────────────────────────────────
{
  const base = { width: 40, height: 60, productType: "卷帘", controlType: "普通", headrailType: "灰弧" };
  const inn = calculateItem({ ...base, measureType: "IN" });
  const out = calculateItem({ ...base, measureType: "OUT" });
  const tight = calculateItem({ ...base, measureType: "Tight" });
  assert.equal(out.cutRollerBar! - inn.cutRollerBar!, 0.1875);
  assert.equal(tight.cutRollerBar, out.cutRollerBar);
}

// ── 6. 拉绳分档：v2 的 ≤27" 短绳特例 ──────────────────────
{
  // 工艺组装!K5 第一分支
  assert.equal(getCordLengthTier(27, "普通", "blinds_20251024_v2"), "0.45 & 0.15");
  assert.equal(getCordLengthTier(20, "普通", "blinds_20251024_v2"), "0.45 & 0.15");
  // v1 没这条，落到米制第一档
  assert.equal(getCordLengthTier(27, "普通", "blinds_20251024_v1"), "0.6 & 0.3");
  // 27" 以上两版一致
  assert.equal(getCordLengthTier(60, "普通", "blinds_20251024_v2"), "1.2 & 0.9");
  assert.equal(getCordLengthTier(60, "普通", "blinds_20251024_v1"), "1.2 & 0.9");
  // 只有普通操控有拉绳
  assert.equal(getCordLengthTier(60, "电动"), null);
  assert.equal(getCordLengthTier(60, "无绳"), null);
}

// ── 7. 裁剪数量：双轨=2，其余=1；弧形盒不再漏裁 ───────────
{
  // 原表 E8/H8 拿中文罩盒名比 "GREY ARC"/"White ARC"，弧形盒的卷帘/香格里拉
  // 下杆数量会落到 0（已确认是 bug）。修好后必须是 1。
  for (const pt of ["卷帘", "香格里拉", "斑马帘"]) {
    for (const hr of ["灰弧", "白弧"] as HeadrailType[]) {
      assert.equal(getComponentQuantities(pt, hr).bottomBar, 1, `${pt}/${hr} 下杆数量`);
    }
  }
  const dbl = getComponentQuantities("斑马帘", "双轨无盒");
  assert.equal(dbl.tube38, 2);
  assert.equal(dbl.bottomBar, 2);
  assert.equal(dbl.coreRod, 2);
  assert.equal(dbl.headrail, null, "双轨无盒没有罩盒");
  const half = getComponentQuantities("卷帘", "双轨半盒");
  assert.equal(half.tube38, 2);
  assert.equal(half.headrail, 1, "双轨半盒有罩盒");
  assert.equal(half.coreRod, null, "卷帘没有圆芯杆");
  assert.equal(getComponentQuantities("斑马帘", "亮白插片圆盒").tube38, 1);
  assert.equal(getComponentQuantities("卷帘", "单轨无盒").headrail, null);
  assert.equal(hasHeadrailCover("亮白插片圆盒"), true);
  assert.equal(hasHeadrailCover("单轨无盒"), false);
}

// ── 8. 切割分类（工艺组装!K8 → 开料表!O） ──────────────────
{
  assert.equal(getCutClass("哑白方型罩盒"), "B类");
  assert.equal(getCutClass("哑灰方型罩盒"), "B类");
  assert.equal(getCutClass("双轨无盒"), "C类");
  assert.equal(getCutClass("单轨无盒"), "C类");
  assert.equal(getCutClass("亮白插片圆盒"), "A类");
  assert.equal(getCutClass("灰弧"), "A类");
  assert.equal(getCutClass("双轨半盒"), "A类");
}

// ── 9. 插片尺寸：只有插片圆盒和双轨半盒有 ──────────────────
{
  const base = { width: 40, height: 60, productType: "斑马帘", measureType: "IN", controlType: "普通" };
  assert.notEqual(calculateItem({ ...base, headrailType: "亮白插片圆盒" }).insertSize, null);
  assert.notEqual(calculateItem({ ...base, headrailType: "双轨半盒" }).insertSize, null);
  assert.equal(calculateItem({ ...base, headrailType: "灰弧" }).insertSize, null);
}

// ── 10. 面料长度：斑马帘 h*2+6，其余 h+2 ───────────────────
{
  const base = { width: 40, height: 60, measureType: "IN", controlType: "普通", headrailType: "灰弧" };
  assert.equal(calculateItem({ ...base, productType: "斑马帘" }).cutFabricLength, 126);
  assert.equal(calculateItem({ ...base, productType: "卷帘" }).cutFabricLength, 62);
  assert.equal(calculateItem({ ...base, productType: "香格里拉" }).cutFabricLength, 62);
}

// ── 11. 布纱比目录 ─────────────────────────────────────────
{
  assert.equal(parseRatioValue("3"), 3);
  assert.equal(parseRatioValue("3 2/16"), 3.125);
  assert.equal(parseRatioValue("2 15/16"), 2.9375);
  assert.equal(FABRIC_RATIO_CATALOG.length, 25, "Sheet1!W 誊录 25 条");

  const ok = lookupFabricRatio("SD-ZB-F1091");
  assert.equal(ok.status, "ok");
  if (ok.status === "ok") {
    assert.equal(ok.fabric, 3.125);
    assert.equal(ok.silk, 2.125);
  }
  // 厂商编号与内部 SKU 都能查
  assert.equal(lookupFabricRatio("ZE-215-F1091").status, "ok");
  // 大小写/空格归一
  assert.equal(lookupFabricRatio(" ze-215-f1091 ").status, "ok");
  // 目录里同 SKU 两个不同比例 → 拒绝返回值，不猜
  assert.equal(lookupFabricRatio("SC-ZD-XZ74-1").status, "conflict");
  assert.deepEqual(listConflictingSkus(), ["SC-ZD-XZ74-1"]);
  // 查不到就是查不到
  assert.equal(lookupFabricRatio("BL 201").status, "not_found");
  assert.equal(lookupFabricRatio(null).status, "not_found");
}

// ── 12. 布纱比解析优先级 & 裁剪位不再锁 3:2 ────────────────
{
  const base = { width: 40, height: 60, productType: "斑马帘", measureType: "IN", controlType: "普通", headrailType: "亮白插片圆盒" };

  const manual = resolveFabricRatio({ ...base, fabricRatio: 3, silkRatio: 2, fabricSku: "SD-ZB-F1091" });
  assert.equal(manual.source, "manual", "人工填的优先于目录");
  assert.equal(manual.fabric, 3);

  const fromCatalog = resolveFabricRatio({ ...base, fabricSku: "SD-ZB-F1091" });
  assert.equal(fromCatalog.source, "catalog");
  assert.equal(fromCatalog.fabric, 3.125);

  assert.equal(resolveFabricRatio({ ...base, fabricSku: "不存在的SKU" }).source, "missing");
  assert.equal(resolveFabricRatio({ ...base, fabricSku: "SC-ZD-XZ74-1" }).source, "conflict");

  // 旧实现只有 3:2 出数；真实比例必须也能算
  assert.notEqual(calcZebraCuttingPosition(60, 3.125, 2.125), null);
  assert.notEqual(calcZebraCuttingPosition(60, 2.9375, 1.9375), null);
  // 未知比例不再假设 3:2
  assert.equal(calcZebraCuttingPosition(60, null, null), null);
  assert.equal(calcZebraCuttingPosition(60, 0, 2), null);

  // 纵向Ref!C28/D28 手算核对：h=60, 布3 纱2 → total=5
  //   raw = ((60-0.2)/5 - INT(...)) * 5 + 0.5 = (11.96-11)*5+0.5 = 5.3
  //   5.3 >= 3 → 5.3-3 = 2.3
  assert.equal(calcZebraCuttingPosition(60, 3, 2), 2.3);

  const calc = calculateItem({ ...base, fabricSku: "SD-ZB-F1091" });
  assert.equal(calc.ratioSource, "catalog");
  assert.equal(calc.fabricRatioUsed, 3.125);
}

// ── 13. 车间口径的操控方式写法 ─────────────────────────────
{
  assert.equal(CONTROL_TYPE_SHOP_LABEL["电动"], "电机", "车间表写的是电机");
  assert.equal(CONTROL_TYPE_SHOP_LABEL["普通"], "普通");
  assert.equal(CONTROL_TYPE_SHOP_LABEL["无绳"], "无绳");
}

// ── 14. 报价单 Valance 选项 = 引擎罩盒枚举（1:1 契约） ────
{
  // 报价端 Shade Order Form 的 Valance 下拉直接存引擎枚举，
  // 桥那一层因此不需要任何猜测映射。这里锁住两边不许漂移。
  assert.equal(HEADRAIL_OPTIONS.length, 8, "8 种罩盒全部可选");
  for (const o of HEADRAIL_OPTIONS) {
    assert.ok(isHeadrailType(o.value), `${o.value} 必须是引擎认的罩盒枚举`);
    // 选中后引擎必须能直接算，不能报"无此罩盒"
    const calc = calculateItem({
      width: 40, height: 60, productType: "斑马帘",
      measureType: "IN", controlType: "普通", headrailType: o.value,
    });
    assert.ok(
      calc.cutTube38 !== null && Number.isFinite(calc.cutTube38),
      `罩盒 ${o.value} 选中后引擎应能算出 38 管裁切尺寸`,
    );
    assert.ok(o.label.includes(o.value), "下拉标签应含中文原名，工厂与销售看同一个词");
  }

  // 对客 PDF 印英文
  assert.equal(headrailLabelEn("亮白插片圆盒"), HEADRAIL_LABELS["亮白插片圆盒"].en);
  assert.ok(!headrailLabelEn("亮白插片圆盒").includes("亮白"), "PDF 不该印中文");
  // 历史报价单里的自由文本原样返回，不猜也不吞
  assert.equal(headrailLabelEn("Cassette"), "Cassette");
  assert.equal(headrailLabelEn(""), "");
  assert.equal(headrailLabelEn(null), "");
  assert.equal(isHeadrailType("Cassette"), false);
}

console.log("✅ 减尺规则 / 裁切引擎 全部通过（168 格矩阵 + 14 组断言）");
