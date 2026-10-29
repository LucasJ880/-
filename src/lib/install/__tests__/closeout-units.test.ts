/**
 * INSTALL-2a：收口单元（Blinds 行 + 工艺参数四段）构建 / 编号 / id 编解码 / 位置快照比对
 * INSTALL-2d：问题记录与收口记录取最新一条（有问题 / 已收口 / 未处理）
 * INSTALL-2e：返修预约的收口范围（只含维修单行对应的单元）
 * 运行：npx tsx src/lib/install/__tests__/closeout-units.test.ts
 */
import {
  aggregateCloseout,
  buildCloseoutUnits,
  missingWindows,
  parseSpecUnitId,
  sameLocation,
  specUnitId,
  unhandledUnits,
  specUnitLogTargetId,
  type BlindsRowInput,
  type CloseoutLog,
  type SpecSectionsInput,
} from "../closeout";
import { returnRepairFor, scopeUnits, type RepairEvent } from "../repair";
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

console.log("INSTALL-2c 收口单元品类");
{
  const units = buildCloseoutUnits("oc", [blinds("bz", 1, "Hall")], spec({ vinyl: [vinyl("Living")], drapes: [drape("Master", "drape")], domestic: [domestic("Office")], purchase: [
    { section: "shutter", categoryZh: "Wooden 百叶", location: "Porch", widthIn: 20, heightIn: 30, qty: 1, fields: [], reasonZh: "", remark: "" },
    { section: "drape", categoryZh: "打孔窗帘", location: "Den", widthIn: 20, heightIn: 30, qty: 2, fields: [], reasonZh: "", remark: "" },
    { section: "shade", categoryZh: "帘子 Roman", location: "Bath", widthIn: 20, heightIn: 30, qty: 1, fields: [], reasonZh: "", remark: "" },
  ] }));
  const byId = Object.fromEntries(units.map((u) => [u.id, u.category]));
  ok(byId["bz"] === "shades", "斑马帘 Blinds 行 → 帘类");
  ok(byId["spec-domestic-0"] === "shades" && byId["spec-drapes-0"] === "drapery" && byId["spec-vinyl-0"] === "vinyl", "国内下单 → 帘类、窗帘 → 窗帘、Vinyl → Shutters");
  ok(byId["spec-purchase-0"] === "vinyl" && byId["spec-purchase-1"] === "drapery" && byId["spec-purchase-2"] === "shades", "外采购按段：百叶 / 窗帘 / 帘子");
  const odd = buildCloseoutUnits("od", [{ ...blinds("bx", 1, "X"), productType: "百叶窗X" }], null);
  ok(odd[0].category === null, "无法识别的产品类型 → 无品类");
  const mixed = buildCloseoutUnits("om", [blinds("b1", 1, "A")], spec({ vinyl: [vinyl("V")], drapes: [drape("D", "drape")] }));
  ok(mixed.map((u) => u.category).join() === "shades,drapery,vinyl", "混合单（斑马帘 + Vinyl + 窗帘）：按单元序号为 帘类、窗帘、Shutters", mixed.map((u) => u.category));
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

console.log("INSTALL-2d 问题记录与收口记录取最新");
{
  const issueLog = (targetId: string, at: string, location: string | undefined, extra: Record<string, unknown> = {}): CloseoutLog => ({
    ...unitLog(targetId, at, location, 9),
    action: "install.window.issue",
    afterData: JSON.stringify({
      pathname: "install-photos/org/o1/x/i.jpg", proxyUrl: "/api/files/install-photos/org/o1/x/i.jpg", note: "",
      issueType: "wrong_size", needsFactory: true, description: "高度短 2cm", ...(location !== undefined ? { location } : {}), ...extra,
    }),
  });
  const units = buildCloseoutUnits("o9", [blinds("b1", 1, "Hall"), blinds("b2", 2, "Den"), blinds("b3", 3, "Kitchen")], null);
  const later = aggregateCloseout(units, [unitLog("b1", "2026-10-28T10:00:00Z", undefined), unitLog("b3", "2026-10-28T10:00:00Z", undefined), issueLog("b3", "2026-10-28T10:30:00Z", undefined)]);
  const w3 = later.windows[2];
  ok(w3.state === "issue" && w3.issue?.issueTypeLabel === "尺寸不符需重做" && w3.issue.needsFactory && w3.issue.description === "高度短 2cm" && w3.issue.photos.length === 1, "3 号窗先拍完工照后标问题 → 有问题，带类型名 / 描述 / 问题照", w3);
  ok(later.completed === 1 && later.issueCount === 1 && !later.allCompleted, "有问题不计入已收口：已收口 1，有问题 1", later);
  ok(unhandledUnits(later).map((u) => u.itemNumber).join() === "2" && missingWindows(later).map((u) => u.itemNumber).join() === "2,3", "未处理只含 2 号；未收口清单含 2、3 号");
  const fixed = aggregateCloseout(units, [issueLog("b3", "2026-10-28T10:00:00Z", undefined), unitLog("b3", "2026-10-28T10:40:00Z", undefined)]);
  ok(fixed.windows[2].state === "done" && fixed.windows[2].issue === null && fixed.issueCount === 0 && fixed.completed === 1, "3 号窗先标问题、修好后补拍完工照 → 已收口，有问题数 0", fixed.windows[2]);
  const twice = aggregateCloseout(units, [issueLog("b2", "2026-10-28T10:00:00Z", undefined), issueLog("b2", "2026-10-28T10:10:00Z", undefined, { description: "补充：漏发支架" })]);
  ok(twice.windows[1].issue?.description === "补充：漏发支架" && twice.windows[1].issue.photos.length === 2, "同一单元再标问题：取最新描述，问题照累积");
  ok(twice.windows[0].state === "pending" && twice.windows[0].issue === null, "没有记录 → 未处理");
  const bad = aggregateCloseout(units, [issueLog("b1", "2026-10-28T10:00:00Z", undefined, { issueType: "bogus" })]);
  ok(bad.windows[0].state === "pending", "未知问题类型的记录不计入");
  const specUnits = buildCloseoutUnits("o10", [], spec({ vinyl: [vinyl("次卧")] }));
  const stale = aggregateCloseout(specUnits, [issueLog("o10:vinyl:0", "2026-10-28T10:00:00Z", "主卧")]);
  ok(stale.windows[0].state === "pending" && stale.windows[0].locationChanged?.previousLocation === "主卧", "工艺参数单元：问题记录位置已变 → 不计入，标记位置已变");
  const match = aggregateCloseout(specUnits, [issueLog("o10:vinyl:0", "2026-10-28T10:00:00Z", " 次卧 ")]);
  ok(match.windows[0].state === "issue", "工艺参数单元：问题记录位置一致 → 有问题");
}

console.log("INSTALL-2e 返修预约的收口范围");
{
  const units = buildCloseoutUnits("o11", [], spec({ vinyl: [vinyl("Living Room"), vinyl("Den"), vinyl("Kitchen")] }));
  const r1 = { id: "r1", rows: [{ unitId: "spec-vinyl-1" }] } as unknown as Parameters<typeof scopeUnits>[1] & { id: string };
  const r2 = { id: "r2", rows: [{ unitId: "spec-vinyl-1" }, { unitId: "spec-vinyl-2" }] } as unknown as typeof r1;
  const ev = (repairId: string, appointmentId: string, at: string): RepairEvent => ({ id: `${repairId}-${at}`, action: "install.repair.scheduled", repairId, at, userId: "ops", data: { appointmentId } });
  const events = [ev("r1", "a-return-1", "2026-10-29T10:00:00Z"), ev("r2", "a-return-2", "2026-11-05T10:00:00Z")];
  ok(returnRepairFor("a-return-1", [r1, r2], events)?.id === "r1" && returnRepairFor("a-return-2", [r1, r2], events)?.id === "r2", "返修预约 → 对应维修单");
  ok(returnRepairFor("a-first", [r1, r2], events) === null, "首装预约不是返修预约 → null");
  const moved = [...events, ev("r1", "a-return-1b", "2026-10-30T10:00:00Z")];
  ok(returnRepairFor("a-return-1", [r1], moved) === null && returnRepairFor("a-return-1b", [r1], moved)?.id === "r1", "同一维修单换了预约：以最新排期为准");
  ok(scopeUnits(units, r1).map((u) => u.location).join() === "Den", "返修范围：只有 Den");
  ok(scopeUnits(units, r2).map((u) => u.location).join() === "Den,Kitchen", "返修范围：Den、Kitchen");
  ok(scopeUnits(units, null).length === 3, "普通预约：全部单元");
  const agg = aggregateCloseout(scopeUnits(units, r1), [unitLog("o11:vinyl:0", "2026-10-28T10:00:00Z", "Living Room")]);
  ok(agg.total === 1 && agg.completed === 0 && !agg.allCompleted, "范围外单元的记录不影响返修计数：0 / 1");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
