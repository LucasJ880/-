/**
 * 工艺单导出工作簿（EX-01..）：按产品线出表、可读回、不含任何价格
 * 运行：npx tsx src/lib/sunny-process/__tests__/export-workbook.test.ts
 */
import ExcelJS from "exceljs";
import { generateBlindsExcel } from "@/lib/blinds/excel-export";
import { computeIssues } from "../issues";
import type { ProcessSpec } from "../process-spec";
import { mapQuoteFormToProcessOrder } from "../quote-mapping";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); } };

const form = JSON.stringify({
  orderNumber: "G1027-09",
  shadeOrders: [
    { location: "Living", widthWhole: "36", widthFrac: "8", heightWhole: "60", heightFrac: "0", product: "Zebra", sku: "ZB-1", mount: "I", lift: "L", bracket: "C", valance: "Cassette", note: "", price: 321.45 },
    { location: "Den", widthWhole: "30", widthFrac: "0", heightWhole: "40", heightFrac: "0", product: "Cordless Cellular", sku: "CEL-1", mount: "I", lift: "", bracket: "C", valance: "", note: "" },
  ],
  shutterOrders: [{ location: "Bed", widthWhole: "48", widthFrac: "0", heightWhole: "60", heightFrac: "0", frame: "L", openDirection: "LR", mountType: "I", midRail: "30", panelCount: 4, draft: "" }],
  drapeOrders: [{ location: "Dining", drapeWidthWhole: "100", drapeWidthFrac: "0", drapeHeightWhole: "96", drapeHeightFrac: "0", drapeFabricSku: "635", drapeFullness: "230", drapePanels: "D", drapePleatStyle: "R", drapeLiner: false, drapeBracket: "C", sheerWidthWhole: "", sheerHeightWhole: "", sheerFabricSku: "" }],
  shutterMaterial: "Vinyl", shutterLouverSize: '3-1/2"', depositAmount: "777.77", partALines: [{ msrp: 8888.88, price: 6666.66 }],
});

async function sheetsOf(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

async function main() {
  const m = mapQuoteFormToProcessOrder(form);
  const spec: ProcessSpec = { ...m.spec, version: 1, source: { quoteId: "q", orderNumber: "G1027-09", signedAt: null, customerName: "Alice" } };
  spec.vinyl[0]!.posts = "1T";
  spec.vinyl[0]!.openCode = "LLTRR";
  const items = m.blindsItems.map((it, i) => ({ ...it, itemNumber: i + 1, bottomBarWidth: null }));
  const order = { code: "G1027-09", customerName: "Alice", phone: null, address: null, installDate: null, remarks: null, ruleVersion: "x", createdAt: new Date(), items };
  const issues = computeIssues(items, spec, order.code);

  // EX-01 全产品线
  const wb = await sheetsOf(await generateBlindsExcel(order, { spec, issues }));
  const names = wb.worksheets.map((w) => w.name);
  const want = ["开料表", "工艺单", "开料表（布料）", "Blinds 标签", "国内下单表", "国内下单标签", "窗帘工艺单", "窗帘物料", "Vinyl 工艺单", "Vinyl 下料总表", "Vinyl 标签", "待核对"];
  ok(JSON.stringify(names) === JSON.stringify(want), "EX-01a: 全产品线 12 张表齐全且顺序固定", names);

  // EX-02 不含价格 / 定金
  let text = "";
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => { text += ` ${String(c.value ?? "")}`; })));
  ok(!/321\.45|777\.77|8888\.88|6666\.66/.test(text), "EX-02: 导出物不含报价单价格 / 定金");

  // EX-03 Vinyl 下料总表含 T柱（偏离 X-4）；窗帘按 6cm
  const cut = wb.getWorksheet("Vinyl 下料总表")!;
  let hasPost = false;
  cut.eachRow((row) => { if (row.getCell(2).value === "T柱") hasPost = true; });
  ok(hasPost, "EX-03a: 下料总表含 T柱 行");
  ok(String(wb.getWorksheet("窗帘工艺单")!.getCell(2, 1).value).includes("6cm"), "EX-03b: 窗帘工艺单标注 6cm 版本");
  const bead = wb.getWorksheet("窗帘工艺单")!.getRow(5).getCell(16).value;
  ok(bead === "6cm", "EX-03c: 蛇形帘走珠扣 6cm", bead);

  // EX-04 只含窗帘 → 三张表
  const onlyDrapes: ProcessSpec = { ...spec, domestic: [], vinyl: [], unsupported: [] };
  const wb2 = await sheetsOf(await generateBlindsExcel({ ...order, items: [] }, { spec: onlyDrapes, issues: computeIssues([], onlyDrapes) }));
  ok(JSON.stringify(wb2.worksheets.map((w) => w.name)) === JSON.stringify(["窗帘工艺单", "窗帘物料", "待核对"]), "EX-04: 只有窗帘 → 窗帘工艺单 / 窗帘物料 / 待核对", wb2.worksheets.map((w) => w.name));

  // EX-05 既有调用（无 spec）不变：只出 Blinds 表
  const wb3 = await sheetsOf(await generateBlindsExcel(order));
  ok(JSON.stringify(wb3.worksheets.map((w) => w.name)) === JSON.stringify(["开料表", "工艺单", "开料表（布料）", "Blinds 标签"]), "EX-05: 不传 spec 时只出 Blinds 四张表");

  // EX-06 开料表件数 / 切割类型列
  const parts = wb.getWorksheet("开料表")!;
  ok(parts.getRow(4).getCell(12).value === "件数" && parts.getRow(4).getCell(13).value === "切割类型" && parts.getRow(5).getCell(13).value === "A类", "EX-06: 开料表有件数 / 切割类型");
}

main().then(() => {
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}, (err) => {
  console.error(err);
  process.exit(1);
});
