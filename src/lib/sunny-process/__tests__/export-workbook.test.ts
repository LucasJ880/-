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
    { location: "Loft", widthWhole: "50", widthFrac: "4", heightWhole: "70", heightFrac: "0", product: "Vertical", sku: "VT-9", mount: "O", lift: "L", bracket: "W", valance: "", note: "客户要灰色", manualPrice: "321.45" },
  ],
  shutterOrders: [{ location: "Bed", widthWhole: "48", widthFrac: "0", heightWhole: "60", heightFrac: "0", frame: "L", openDirection: "LR", mountType: "I", midRail: "30", panelCount: 4, draft: "" }],
  drapeOrders: [{ location: "Dining", drapeWidthWhole: "100", drapeWidthFrac: "0", drapeHeightWhole: "96", drapeHeightFrac: "0", drapeFabricSku: "635", drapeFullness: "230", drapePanels: "D", drapePleatStyle: "R", drapeLiner: false, drapeBracket: "C", sheerWidthWhole: "", sheerHeightWhole: "", sheerFabricSku: "" },
    { location: "Study", drapeWidthWhole: "80", drapeWidthFrac: "0", drapeHeightWhole: "90", drapeHeightFrac: "0", drapeFabricSku: "650", drapeFullness: "180", drapePanels: "S", drapePleatStyle: "G", drapeLiner: true, drapeBracket: "W", sheerWidthWhole: "", sheerHeightWhole: "", sheerFabricSku: "", accessoriesSku: "RING-8", note: "" }],
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
  const want = ["开料表", "工艺单", "开料表（布料）", "Blinds 标签", "国内下单表", "国内下单标签", "窗帘工艺单", "窗帘物料", "Vinyl 工艺单", "Vinyl 下料总表", "Vinyl 标签", "外采购单", "待核对"];
  ok(JSON.stringify(names) === JSON.stringify(want), "EX-01a: 全产品线 13 张表齐全且顺序固定", names);

  // EX-01b 外采购单：按销售填写原样
  const pur = wb.getWorksheet("外采购单")!;
  const pr = (r: number) => [2, 3, 4, 5, 6, 7].map((c) => pur.getRow(r).getCell(c).value);
  const p1 = pr(5), p2 = pr(6);
  ok(p1[0] === "帘子 Vertical" && p1[1] === "Loft" && p1[2] === 50.25 && String(p1[5]).includes("SKU: VT-9") && String(p1[5]).includes("Note: 客户要灰色") && String(p1[5]).includes("Width: 50 4/16"), "EX-01b: 外采购单列出无模板帘子的销售填写原值", p1);
  ok(p2[0] === "打孔窗帘（Grommet）" && p2[4] === 1 && String(p2[5]).includes("Accessories SKU: RING-8") && String(p2[5]).includes("Liner: Yes"), "EX-01c: 打孔窗帘进外采购单", p2);

  // EX-01d 窗帘：成品帘子高 = 成品高 − 2；底部说明为新版 7 条
  const dws = wb.getWorksheet("窗帘工艺单")!;
  const fh = dws.getRow(5).getCell(6).value, fin = dws.getRow(5).getCell(9).value;
  let notesText = "";
  dws.eachRow((row) => { notesText += ` ${String(row.getCell(1).value ?? "")}`; });
  ok(typeof fh === "number" && fin === fh - 2 && fh === Math.round(96 * 2.54 - 6), "EX-01d: 顶装 96in → 成品高 238、成品帘子高 236", { fh, fin });
  ok(notesText.includes("6.纱帘均加铅块") && notesText.includes("7.成品检查注意") && !notesText.includes("不要寄过来"), "EX-01e: 窗帘工艺单底部为新版 7 条说明");

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

  // EX-03d 审查发现 #9：有阻断的 Vinyl 窗不进下料总表与标签
  {
    const blocked: ProcessSpec = { ...spec, vinyl: [{ ...spec.vinyl[0]!, frame: "" }, { ...spec.vinyl[0]!, location: "Guest", posts: "", openCode: "LLRR" }] };
    const wbB = await sheetsOf(await generateBlindsExcel(order, { spec: blocked, issues: computeIssues(items, blocked, order.code) }));
    let windowsCol = "";
    wbB.getWorksheet("Vinyl 下料总表")!.eachRow((row, i) => { if (i >= 5) windowsCol += ` ${String(row.getCell(8).value ?? "")}`; });
    let labelText = "";
    wbB.getWorksheet("Vinyl 标签")!.eachRow((row) => { labelText += ` ${String(row.getCell(2).value ?? "")}`; });
    const header = String(wbB.getWorksheet("Vinyl 下料总表")!.getCell(2, 1).value);
    ok(!windowsCol.includes("#1×") && windowsCol.includes("#2×") && !labelText.includes("#1 ") && labelText.includes("#2 ") && header.includes("1 窗有阻断"), "EX-03d: 缺外框的 #1 窗不进下料总表 / 标签，表头注明", { windowsCol, header });
  }

  // EX-04 只含窗帘 → 三张表
  const onlyDrapes: ProcessSpec = { ...spec, domestic: [], vinyl: [], purchase: [] };
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
