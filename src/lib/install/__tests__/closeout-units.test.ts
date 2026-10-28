/**
 * INSTALL-2a：收口单元（Blinds 行 + 工艺参数四段）构建 / 编号 / id 编解码 / 位置快照比对
 * 运行：npx tsx src/lib/install/__tests__/closeout-units.test.ts
 */
import {
  aggregateCloseout,
  buildCloseoutUnits,
  missingWindows,
  parseSpecUnitId,
  sameLocation,
  specUnitId,
  specUnitLogTargetId,
  type BlindsRowInput,
  type CloseoutLog,
  type SpecSectionsInput,
} from "../closeout";
import { emptySpec, type DrapeSpecRow, type DomesticSpecRow, type VinylSpecWindow } from "@/lib/sunny-process/process-spec";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const vinyl = (location: string): VinylSpecWindow => ({
  location, width: 30, height: 60, panels: 2, openCode: "LR", posts: "", rail1In: null, rail1Ratio: null, rod: "", split: "",
  frame: "L", frameCount: 4, inOut: "内装", structure: "有框", rail2In: null, quoteFrame: "L", quoteOpenDirection: "", quoteMidRail: "",
});
const drape = (location: string, part: "drape" | "sheer"): DrapeSpecRow => ({
  location, part, widthIn: 80, heightIn: 90, sku: part === "sheer" ? "S-01" : "D-01", qty: 2, craft: "韩褶P", layer: part === "sheer" ? "纱" : "布",
  liner: "否", fullness: 2.3, mount: "顶装C", rod: "R1", rodColor: "黑",
});
const domestic = (location: string): DomesticSpecRow => ({
  location, quoteProduct: "Cordless Cellular", code: "Ly26-1", widthIn: 36, heightIn: 48, productType: "蜂巢帘", sku: "CC-WH",
  measure: "Tight", control: "无绳", side: "", headrail: "", mount: "内装", remark: "",
});
const spec = (s: Partial<SpecSectionsInput>): SpecSectionsInput => ({ ...emptySpec(), ...s });
const blinds = (id: string, itemNumber: number, location: string): BlindsRowInput => ({
  id, itemNumber, location, width: 40, height: 50, productType: "斑马帘", fabricSku: "Z-01",
  controlType: "拉绳", controlSide: "R", mountType: "内装", itemRemark: null,
});
const unitLog = (targetId: string, at: string, location: string | undefined, n = 1): CloseoutLog => ({
  targetId,
  createdAt: at,
  userId: "u-installer",
  afterData: JSON.stringify({ pathname: `install-photos/org/o1/x/${n}.jpg`, proxyUrl: `/api/files/install-photos/org/o1/x/${n}.jpg`, note: "", ...(location !== undefined ? { location } : {}) }),
});

console.log("INSTALL-2a 收口单元构建");
{
  const units = buildCloseoutUnits("o1", [], spec({ vinyl: [vinyl("Living"), vinyl("Kitchen"), vinyl("Bed")] }));
  ok(units.length === 3, "只有 Vinyl 3 扇窗 → 3 个单元");
  ok(units.map((u) => u.id).join(",") === "spec-vinyl-0,spec-vinyl-1,spec-vinyl-2", "单元 id spec-vinyl-0…2", units.map((u) => u.id));
  ok(units.map((u) => u.itemNumber).join(",") === "1,2,3", "序号 1–3");
  ok(units.every((u) => u.section === "vinyl" && u.sectionLabel === "Vinyl 百叶" && u.productType === "Vinyl 百叶"), "品类标签 Vinyl 百叶");
  ok(units[1].logTargetId === "o1:vinyl:1" && units[1].matchLocation === true, "审计目标 <orderId>:vinyl:1，需比对位置");
}
{
  const units = buildCloseoutUnits(
    "o2",
    [blinds("b2", 2, "Den"), blinds("b1", 1, "Hall")],
    spec({ domestic: [domestic("Office")], drapes: [drape("Master", "drape"), drape("Master", "sheer")] }),
  );
  ok(units.length === 5, "混合单：2 Blinds + 1 国内 + 布帘 + 纱帘 = 5 个单元");
  ok(units.map((u) => u.itemNumber).join(",") === "1,2,3,4,5", "序号 1–5 连续", units.map((u) => u.itemNumber));
  ok(units.map((u) => u.section).join(",") === "blinds,blinds,domestic,drapes,drapes", "顺序：Blinds → 国内下单 → 窗帘", units.map((u) => u.section));
  ok(units[0].id === "b1" && units[0].logTargetId === "b1" && units[0].matchLocation === false, "Blinds 行单元 id = 行 id，不比对位置");
  ok(units[3].productType === "窗帘 · 布帘" && units[4].productType === "窗帘 · 纱帘", "布帘、纱帘各一个单元");
  ok(units[2].productType === "Cordless Cellular" && units[2].fabricSku === "CC-WH", "国内下单行显示报价产品名与色号");
}
{
  const units = buildCloseoutUnits("o3", [blinds("b9", 9, "A")], spec({ vinyl: [vinyl("V")], purchase: [{
    section: "shutter", categoryZh: "Wooden 百叶", location: "Porch", widthIn: 20, heightIn: 30, qty: 1,
    fields: [{ label: "Frame", value: "Z" }, { label: "Color", value: "Snow" }], reasonZh: "无模板", remark: "",
  }] }));
  ok(units.map((u) => u.itemNumber).join(",") === "9,10,11", "序号接在 Blinds 最大序号之后", units.map((u) => u.itemNumber));
  ok(units[2].id === "spec-purchase-0" && units[2].productType === "外采购 · Wooden 百叶" && units[2].fabricSku === "Snow", "外采购行标签与颜色");
}
{
  const units = buildCloseoutUnits("o4", [], spec({ domestic: [domestic("1"), domestic("2"), domestic("3"), domestic("4")] }));
  ok(units.length === 4 && units.every((u) => u.section === "domestic"), "全部发给国内 → 国内下单 4 行即收口单元");
}
{
  const none = buildCloseoutUnits("o5", [], spec({}));
  const agg = aggregateCloseout(none, []);
  ok(none.length === 0 && !agg.allCompleted && agg.total === 0 && missingWindows(agg).length === 0, "零单元：total 0、不算完成");
  ok(buildCloseoutUnits("o6", [blinds("b1", 1, "X")], null).length === 1, "无工艺参数 → 只有 Blinds 行");
}

console.log("INSTALL-2a 单元 id 编解码");
ok(specUnitId("drapes", 3) === "spec-drapes-3", "specUnitId");
ok(JSON.stringify(parseSpecUnitId("spec-purchase-12")) === JSON.stringify({ section: "purchase", index: 12 }), "parseSpecUnitId");
ok(parseSpecUnitId("spec-blinds-0") === null && parseSpecUnitId("clx123abc") === null && parseSpecUnitId("spec-vinyl-x") === null && parseSpecUnitId("spec-vinyl-1/../2") === null, "非法单元 id → null");
ok(specUnitLogTargetId("ord", "vinyl", 0) === "ord:vinyl:0", "specUnitLogTargetId");

console.log("INSTALL-2a 位置快照比对");
{
  const units = buildCloseoutUnits("o7", [], spec({ drapes: [drape("Living Room", "drape"), drape("次卧", "drape")] }));
  const logs: CloseoutLog[] = [
    unitLog("o7:drapes:0", "2026-10-28T10:00:00Z", " Living Room "),
    unitLog("o7:drapes:1", "2026-10-28T10:05:00Z", "主卧", 2),
  ];
  const agg = aggregateCloseout(units, logs);
  ok(agg.windows[0].photoCount === 1 && agg.windows[0].locationChanged === null, "\" Living Room \" vs \"Living Room\"：大小写与空白不算变化，计入");
  ok(agg.windows[1].photoCount === 0 && agg.windows[1].locationChanged?.previousLocation === "主卧", "拍照时\"主卧\"、现为\"次卧\" → 未收口，标记位置已变、原位置主卧", agg.windows[1]);
  ok(agg.completed === 1 && !agg.allCompleted && missingWindows(agg).map((m) => m.location).join() === "次卧", "未收口清单含位置已变的单元");
  const fixed = aggregateCloseout(units, [...logs, unitLog("o7:drapes:1", "2026-10-28T11:00:00Z", "次卧", 3)]);
  ok(fixed.allCompleted && fixed.windows[1].photoCount === 1 && fixed.windows[1].locationChanged === null, "补拍后（位置一致）计入，全部完成；旧位置照片不计张数");
  ok(sameLocation("living room", " LIVING ROOM") && !sameLocation("主卧", "次卧"), "sameLocation 口径");
}
{
  const units = buildCloseoutUnits("o8", [blinds("b1", 1, "Hall")], null);
  const agg = aggregateCloseout(units, [unitLog("b1", "2026-10-28T10:00:00Z", undefined)]);
  ok(agg.allCompleted && agg.windows[0].locationChanged === null, "Blinds 行（INSTALL-1 记录无位置快照）照旧计入");
  const other = aggregateCloseout(units, [unitLog("o8:vinyl:0", "2026-10-28T10:00:00Z", "Hall")]);
  ok(!other.allCompleted, "别的单元的记录不计入");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
