/**
 * 报价文件校验（QUOTE-1b，openspec change quote-import-studio-file，design D1 / D2 / D11）——纯逻辑，无 DB
 * 运行：npx tsx src/lib/sales/quote-import/__tests__/validate.test.ts
 *
 * 夹具（来源与哈希见 design D2「核对结果」）：
 *   fixtures/sample-16.sunny-quote.json                         任务书附录 A 的脚本生成，16 行，不含照片
 *   fixtures/toolcode-single-with-photos.sunny-quote.json       单方案，带 3 张窗户照片
 *   fixtures/toolcode-multiplan-A-B-active-B.sunny-quote.json   A / B 两套，导出时当前方案是 B，带 3 张照片
 * 后两份是在 Node 里执行工具自己的方案组装与校验代码生成的，不是从界面导出的。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseQuoteFile, planDisplayName } from "@/lib/sales/quote-import/validate";
import { MAX_FILE_BYTES, type ParsedQuoteFile } from "@/lib/sales/quote-import/types";
import { MULTI, SAMPLE, SINGLE, edit } from "./helpers";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d === undefined ? "" : JSON.stringify(d).slice(0, 600)); } };


const parse = (text: string) => parseQuoteFile(text, Buffer.byteLength(text));
const good = (text: string): ParsedQuoteFile => {
  const r = parse(text);
  if (!r.ok) throw new Error(`应当通过却被拒绝：${r.reasonZh}`);
  return r.file;
};
const reason = (text: string, bytes?: number) => { const r = parseQuoteFile(text, bytes ?? Buffer.byteLength(text)); return r.ok ? null : r; };
const JPEG = "data:image/jpeg;base64,/9j/AAAA";

console.log("合法文件");
{
  const f = good(SAMPLE);
  ok(f.plans.length === 1 && f.plans[0].items.length === 16 && f.plans[0].addons.length === 2, "VAL-01: 16 行样例通过：16 行产品、2 个附加项目、1 套方案", { plans: f.plans.length });
  ok(f.fileVersion === 1 && f.quoteId === "q1" && f.quoteNumber === "SQ-TEST" && f.exportedAt === "2026-11-15T02:59:47.752Z", "VAL-02: 报价 id、报价号、导出时间");
  const p = f.plans[0];
  ok(p.planId === "" && p.isActive && p.install && p.delivery && p.downtown && p.deliveryAmount === 50 && p.downtownAmount === 150, "VAL-03: 单方案文件没有方案编号；安装 / 送货 / Downtown 开关与金额", p.planId);
  const r1 = p.items[0], r2 = p.items[1], r12 = p.items[11], r15 = p.items[14], r16 = p.items[15];
  ok(r1.product === "Zebra" && r1.fabric === "Light Filtering" && r1.w === 48.5 && r1.h === 60 && r1.qty === 2 && r1.room === "R1" && r1.sku === "LOUIA-WHITE-BL201-LF" && !r1.cordless && r1.offer === null && r1.discountOverridePct === null && r1.fullness === null && r1.invalid.length === 0, "VAL-04: 行字段逐项读出（第 1 行）", r1);
  ok(r2.cordless === true && r12.fullness === 2 && r15.discountOverridePct === 0.15 && r16.offer === 120, "VAL-05: 无绳、褶皱率、行折扣、成交价");
  ok(p.addons[0].name === "Motor tube" && p.addons[0].qty === 2 && p.addons[0].price === 150 && p.addons[1].name === "Custom bracket" && p.addons[1].price === 35, "VAL-06: 附加项目的名称、数量、单价");
  const pr = f.pricing!;
  ok(!!pr && pr.version === "2026.10-local.1" && pr.tax === 0.13, "VAL-07: 税率取 pricing.tax、文件价表版本取 pricing.version", { v: pr?.version, t: pr?.tax });
  ok(pr.discounts.Zebra === 0.45 && pr.floors.Fauxwood === 209 && pr.cordlessDiscount === 0.3 && pr.cordlessMultiplier === 1.15 && pr.cordlessFloors.Zebra === 159 && pr.cordlessFloors.Roller === 129 && pr.fullness.Drapery === 2 && pr.install.minimum_total === 200 && pr.install.regular === 18, "VAL-08: 文件自带的折扣、最低价、无绳参数、默认褶皱率、安装费标准");
  ok(Object.keys(pr.products).length === 11 && pr.products.Zebra!.widths.length === 15 && pr.products.Zebra!.fabrics["Blackout"].msrp!.length === 15 && pr.products.Roller!.rollerTables.BO.length === 15 && pr.products.Roller!.fabrics["Blackout w Cassette"].cassette === true && pr.products.Sheer!.fabrics["Door Screen Sheer"].special === "door_screen_sheer", "VAL-09: 价表：11 个品类的档位与矩阵、Roller 的引用表、Door Screen Sheer 的标记");
  ok(f.photoCount === 0, "VAL-10: 样例没有照片");
  ok(!("total" in (JSON.parse(SAMPLE).quote)) && !("grand" in (JSON.parse(SAMPLE).quote)), "VAL-11: 文件里没有合计字段（文件合计只能重算）");
}

console.log("\n各类非法文件 → 中文原因，不返回可映射的结果");
{
  const cases: Array<[string, string, ReturnType<typeof reason>, RegExp]> = [
    ["VAL-20", "非 JSON 文本", reason("这不是 JSON {"), /不是合法的 JSON/],
    ["VAL-21", "空文件", reason("   "), /空的/],
    ["VAL-22", "format 不符", reason(edit((r) => { r.format = "sunny-owner-quote"; })), /格式标识是「sunny-owner-quote」/],
    ["VAL-23", "没有 format", reason(edit((r) => { delete r.format; })), /没有格式标识/],
    ["VAL-24", "version 为 2", reason(edit((r) => { r.version = 2; })), /文件版本 2 暂不支持/],
    ["VAL-25", "600 行", reason(edit((r) => { r.quote.items = Array.from({ length: 600 }, () => r.quote.items[0]); })), /产品行有 600 行，超过 500 行上限/],
    ["VAL-26", "201 个附加项目", reason(edit((r) => { r.quote.addons = Array.from({ length: 201 }, () => r.quote.addons[0]); })), /附加项目有 201 项，超过 200 项上限/],
    ["VAL-27", "含未知产品", reason(edit((r) => { r.quote.items[3].product = "Vertical Blinds"; })), /第 4 行的产品「Vertical Blinds」不在青砚的 11 个品类里/],
    ["VAL-28", "青砚有、工具没有的手填价品类 Roman", reason(edit((r) => { r.quote.items[0].product = "Roman"; })), /产品「Roman」不在/],
    ["VAL-29", "超过 35 MB（只看字节数，不读内容）", reason(SAMPLE, MAX_FILE_BYTES + 1), /超过 35 MB/],
    ["VAL-30", "缺少报价主体", reason(edit((r) => { delete r.quote; })), /没有报价内容/],
    ["VAL-31", "报价主体不是对象", reason(edit((r) => { r.quote = [1, 2]; })), /没有报价内容/],
    ["VAL-32", "没有产品行数组", reason(edit((r) => { r.quote.items = "none"; })), /没有产品行/],
    ["VAL-33", "顶层是数组", reason("[1,2,3]"), /不是报价工具导出的报价文件/],
    ["VAL-34", "行不是对象", reason(edit((r) => { r.quote.items[1] = "row"; })), /第 2 行的产品/],
    ["VAL-35", "附加项目不是数组", reason(edit((r) => { r.quote.addons = { a: 1 }; })), /附加项目的格式不对/],
  ];
  for (const [id, name, r, re] of cases) ok(!!r && !r.ok && re.test(r.reasonZh) && !("file" in r), `${id}: ${name} → 「${r?.reasonZh ?? "（竟然通过了）"}」`, r);
  ok(parseQuoteFile(SAMPLE, MAX_FILE_BYTES).ok, "VAL-36: 恰好 35 MB 不拒绝");
  ok(reason(edit((r) => { r.quote.items = Array.from({ length: 500 }, () => r.quote.items[0]); r.quote.addons = Array.from({ length: 200 }, () => r.quote.addons[0]); })) === null, "VAL-37: 恰好 500 行、200 项不拒绝");
}

console.log("\n原型污染键");
{
  const text = SAMPLE
    .replace('"quote":{', '"quote":{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}},')
    .replace('"items":[{', '"items":[{"__proto__":{"rowPolluted":true},"prototype":{"x":1},');
  ok(text !== SAMPLE && text.includes('"__proto__"'), "VAL-40: 测试文本确实带 __proto__ 键");
  const f = good(text);
  const probe = {} as Record<string, unknown>;
  ok(probe.polluted === undefined && probe.polluted2 === undefined && probe.rowPolluted === undefined, "VAL-41: Object.prototype 未被改动");
  const hasUnsafeKey = (v: unknown): boolean => {
    if (!v || typeof v !== "object") return false;
    if (Array.isArray(v)) return v.some(hasUnsafeKey);
    return Object.keys(v).some((k) => k === "__proto__" || k === "constructor" || k === "prototype") || Object.values(v).some(hasUnsafeKey);
  };
  ok(!hasUnsafeKey(f), "VAL-42: 校验结果里没有 __proto__ / constructor / prototype 键");
  ok(Object.getPrototypeOf(f.plans[0].items[0]) === Object.prototype && f.plans[0].items[0].room === "R1", "VAL-43: 行对象的原型没有被换掉，正常字段照读");
  const evilNames = edit((r) => { r.quote.pricing.data.products.Zebra.fabrics["constructor"] = { msrp: r.quote.pricing.data.products.Zebra.fabrics["Blackout"].msrp }; r.quote.pricing.data.install["prototype"] = 5; });
  const g = good(evilNames);
  ok(!Object.keys(g.pricing!.products.Zebra!.fabrics).includes("constructor") && !Object.keys(g.pricing!.install).includes("prototype"), "VAL-44: 价表里以这些名字做键的面料档 / 安装项也不读入");
}

console.log("\n多方案");
{
  const three = edit((r) => {
    const base = { items: r.quote.items.slice(0, 2), addons: [], note: "", install: true, delivery: false, downtown: false, deliveryAmount: 50, downtownAmount: 150 };
    r.quote.planId = "B"; r.quote.planName = "当前";
    r.quote.plans = [{ ...base, planId: "C", planName: "第三套" }, { ...base, planId: "A", planName: "" }];
  });
  const f = good(three);
  ok(f.plans.length === 3 && f.plans.map((p) => p.planId).join("") === "ABC", "VAL-50: 当前方案 + 另外 2 套 → 3 套，按方案编号排序", f.plans.map((p) => p.planId));
  ok(f.plans.filter((p) => p.isActive).length === 1 && f.plans.find((p) => p.isActive)!.planId === "B", "VAL-51: 标出哪一套是导出时的当前方案（顶层那一套，不一定是 A）");
  ok(f.plans[0].items.length === 2 && f.plans[1].items.length === 16 && f.plans[2].items.length === 2, "VAL-52: 每套方案只带自己的行");
  ok(planDisplayName(f.plans[1], true) === "方案 B · 当前（导出时的当前方案）" && planDisplayName(f.plans[0], true) === "方案 A" && planDisplayName(good(SAMPLE).plans[0], false) === "方案", "VAL-53: 方案显示名");
  const badPlan = reason(edit((r) => { r.quote.planId = "A"; r.quote.plans = [{ planId: "B", items: Array.from({ length: 501 }, () => r.quote.items[0]), addons: [] }]; }));
  ok(!!badPlan && /方案 B：产品行有 501 行/.test(badPlan.reasonZh), "VAL-54: 其它方案超限同样拒绝，并写明是哪一套", badPlan);
  const badPlan2 = reason(edit((r) => { r.quote.planId = "A"; r.quote.plans = [{ planId: "B", addons: [] }]; }));
  ok(!!badPlan2 && /方案 B：文件里没有产品行/.test(badPlan2.reasonZh), "VAL-55: 其它方案缺产品行同样拒绝", badPlan2);
  const many = good(edit((r) => { r.quote.planId = "A"; r.quote.plans = Array.from({ length: 30 }, (_, i) => ({ planId: `P${i}`, items: [], addons: [] })); }));
  ok(many.plans.length === 11, "VAL-56: plans[] 最多读 10 套", many.plans.length);
  const junk = good(edit((r) => { r.quote.plans = [null, "x", 3]; }));
  ok(junk.plans.length === 1, "VAL-57: plans[] 里不是对象的项忽略");
}

console.log("\ntoolcode 夹具 · 单方案带照片");
{
  ok(SINGLE.includes("data:image/jpeg;base64"), "VAL-60: 夹具原文确实带图片数据");
  const f = good(SINGLE);
  ok(f.plans.length === 1 && f.plans[0].items.length === 16 && f.plans[0].planId === "", "VAL-61: 1 套方案、16 行");
  ok(f.photoCount === 3, "VAL-62: 数出 3 张窗户照片", f.photoCount);
  const out = JSON.stringify(f);
  ok(!out.includes("data:image") && !out.includes("windowPhotos") && !out.includes("/9j/"), "VAL-63: 校验结果里没有任何图片数据，也没有 windowPhotos 键");
  ok(f.customer.name === "Test Customer" && f.customer.phone === "416-555-0100" && f.customer.email === "test@example.com" && f.customer.address === "1 Test St, Toronto" && f.plans[0].note === "Sample note", "VAL-64: 客户四项与备注");
  ok(!/serviceFeeModes|includeWindowPhotos|hideDimensions|validDays|materialSelection|materials|updatedAt|revision/.test(out), "VAL-65: 展示开关、面料资料等不认识的键不留存");
}

console.log("\ntoolcode 夹具 · 多方案（A / B，导出时当前方案是 B）");
{
  const raw = JSON.parse(MULTI);
  ok(raw.quote.planId === "B" && raw.quote.plans.length === 1 && raw.quote.plans[0].planId === "A", "VAL-70: 夹具原文：顶层是 B，plans[] 里是 A");
  const f = good(MULTI);
  ok(f.plans.length === 2 && f.plans[0].planId === "A" && f.plans[1].planId === "B", "VAL-71: 列出 A、B 两套供选");
  ok(!f.plans[0].isActive && f.plans[1].isActive && f.plans[1].planName === "Blackout upgrade", "VAL-72: B 标为导出时的当前方案");
  ok(f.plans[0].items.length === 16 && f.plans[1].items.length === 15, "VAL-73: A 16 行、B 15 行", f.plans.map((p) => p.items.length));
  ok(f.plans[0].downtown === true && f.plans[1].downtown === false && f.plans[0].addons.length === 2 && f.plans[1].addons.length === 2, "VAL-74: 每套方案用自己的 Downtown 开关与附加项目");
  ok(f.plans[1].items[0].fabric === "Blackout" && f.plans[1].items[0].sku === "MILAN-GREY-BO" && f.plans[0].items[0].fabric === "Light Filtering", "VAL-75: 两套方案第 1 行的面料档不同，各读各的");
  ok(f.photoCount === 3, "VAL-76: 照片同时在行上与 planWindows 里，按窗位去重后是 3 张（不是 6 张）", f.photoCount);
  const out = JSON.stringify(f);
  ok(!out.includes("data:image") && !out.includes("windowPhotos") && !out.includes("planWindows") && !out.includes("planWindowId"), "VAL-77: 两套方案的结果都不带照片数据，也不带 planWindows");
  ok(f.customer.name === "Test Customer" && f.quoteNumber === "SQ-20261116-TEST" && f.pricing!.version === "2026.10-local.1", "VAL-78: 客户、报价号、价表是整份文件共用的");
}

console.log("\n没覆盖到的字段：可能出现、形状未知 → 容忍、不留存");
{
  // windowTrial：按工具校验代码是 { product, sku, colour, image }，但材料里没有带它的文件 → 各种形状都试
  const shapes: unknown[] = [{ product: "Zebra", sku: "X", colour: "White", image: JPEG }, JPEG, [JPEG, JPEG], null, 42, { nested: { deep: [JPEG] } }];
  let allOk = true; let leaked = false;
  for (const shape of shapes) {
    const r = parse(edit((root) => { root.quote.items[0].windowTrial = shape; root.quote.items[5].windowTrial = shape; }));
    if (!r.ok) { allOk = false; continue; }
    const out = JSON.stringify(r.file);
    if (out.includes("data:image") || out.includes("windowTrial") || r.file.plans[0].items.length !== 16 || r.file.photoCount !== 0) leaked = true;
  }
  ok(allOk && !leaked, "VAL-80: 行上的 windowTrial（6 种形状）：通过、不留存、不计入窗户照片张数");

  const mats = parse(edit((root) => {
    root.quote.materials = { "ZB-01": { name: "Zebra white", image: JPEG, pages: [JPEG, JPEG], meta: { a: [1, { b: JPEG }] } }, list: [JPEG] };
    root.quote.materialSelection = { i0: ["ZB-01"], i1: { swatch: JPEG }, weird: 7 };
    root.quote.planId = "A";
    root.quote.plans = [{ planId: "B", items: root.quote.items.slice(0, 1), addons: [], materials: [JPEG], materialSelection: "ZB-01" }];
  }));
  ok(mats.ok && !JSON.stringify(mats.ok ? mats.file : {}).match(/data:image|materials|materialSelection|ZB-01/), "VAL-81: 整单与方案上的 materials / materialSelection（非空、含内嵌图片）：通过、不留存");

  const excel = parse(edit((root) => {
    Object.assign(root.quote.items[2], { source: "excel", excelRow: 14, rawText: "Roller BO 55x72 cassette", reference: 271.88, dealer: { cost: 99 }, importedFrom: { file: "客户报价.xlsx", sheet: 1 }, extra: [1, 2, 3] });
    root.quote.excelImport = { fileName: "客户报价.xlsx", rows: 16, warnings: ["x"] };
  }));
  const excelOut = excel.ok ? JSON.stringify(excel.file) : "";
  ok(excel.ok && excel.file.plans[0].items[2].fabric === "Blackout w Cassette" && excel.file.plans[0].items[2].w === 55 && !/excelRow|rawText|dealer|importedFrom|客户报价|excelImport|reference/.test(excelOut), "VAL-82: Excel 录入的行带额外键：认识的键照读，额外的键不留存");

  const old = parse(JSON.stringify({
    format: "sunny-quote-studio", version: 1,
    quote: {
      customer: "Old Customer",
      items: [
        { product: "Zebra", fabric: "Light Filtering", w: 40, h: 50, qty: 1 },
        { product: "Roller", fabric: "Blackout (Open Roll)", w: 36, h: 48, qty: 2, room: null, sku: undefined, cordless: "yes", offer: "", note: 7 },
      ],
    },
  }));
  ok(old.ok, "VAL-83: 旧版本保存的报价（缺 id / number / exportedAt / addons / pricing / 各行的后加字段）：不拒绝", old);
  if (old.ok) {
    const f = old.file; const [a, b] = f.plans[0].items;
    ok(f.quoteId === "" && f.quoteNumber === "" && f.exportedAt === "" && f.pricing === null && f.plans[0].addons.length === 0, "VAL-84: 缺的整单字段按空处理；没有价表 → pricing 为 null（按价表不一致处理）");
    ok(a.room === "" && a.sku === "" && a.cordless === false && a.offer === null && a.discountOverridePct === null && a.fullness === null && a.note === "" && a.invalid.length === 0, "VAL-85: 缺的行字段按空 / 否 / 未填处理", a);
    ok(b.cordless === false && b.offer === null && b.note === "7" && b.room === "" && b.invalid.length === 0, "VAL-86: 无绳只认 true；空串的成交价视为未填", b);
    ok(!f.plans[0].install && !f.plans[0].delivery && !f.plans[0].downtown && f.plans[0].deliveryAmount === null && f.plans[0].downtownAmount === null, "VAL-87: 缺的费用开关按「否」、金额按未填");
  }
  const noPricing = good(edit((r) => { r.quote.pricing = "v1"; }));
  const badMatrix = good(edit((r) => { r.quote.pricing.data.products.Zebra.fabrics["Blackout"].msrp[0] = [1, 2, 3]; }));
  ok(noPricing.pricing === null && badMatrix.pricing !== null && badMatrix.pricing.products.Zebra === undefined && !!badMatrix.pricing.products.Roller, "VAL-88: 价表形状不对：整份不对 → null；某个品类的矩阵不对 → 只是该品类不可用");
}

console.log("\n不信任文件里的值");
{
  const f = good(edit((r) => {
    Object.assign(r.quote.items[0], { w: "48.5", h: null, qty: "2", offer: "abc", discountOverridePct: { pct: 0.1 }, fullness: [2], room: "R".repeat(500), sku: "S".repeat(500), note: "N".repeat(5000) });
    r.quote.items[1].w = 1e400; // JSON 里写不出 Infinity，序列化后是 null
    r.quote.customer = "C".repeat(900); r.quote.address = "A".repeat(900); r.quote.note = "备".repeat(5000);
    r.quote.addons[0] = { name: "X".repeat(900), qty: "2", price: null, unit: "ea", note: "n" };
    r.quote.deliveryAmount = "50"; r.quote.install = "true";
  }));
  const a = f.plans[0].items[0];
  ok(a.w === null && a.h === null && a.qty === null && a.offer === null && a.discountOverridePct === null && a.fullness === null, "VAL-90: 不是有限数的数字字段一律为 null（字符串数字不转换）");
  ok(["w", "qty", "offer", "discountOverridePct", "fullness"].every((k) => a.invalid.includes(k)) && !a.invalid.includes("h"), "VAL-91: 填了但不是数的字段名记下来（映射时阻断，不静默丢）；本来就是空的不记", a.invalid);
  ok(a.room.length === 200 && a.sku.length === 200 && a.note.length === 2000 && f.customer.name.length === 200 && f.customer.address.length === 300 && f.plans[0].note.length === 2000 && f.plans[0].addons[0].name.length === 200, "VAL-92: 字符串截断（房间名 / SKU / 名称 200 字，备注 2000 字）");
  ok(f.plans[0].addons[0].qty === null && f.plans[0].addons[0].price === null && f.plans[0].deliveryAmount === null && f.plans[0].install === false, "VAL-93: 附加项目与费用同样只认数字与布尔值");
}

console.log("\n源码");
{
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = strip(readFileSync(join(process.cwd(), "src/lib/sales/quote-import/validate.ts"), "utf8")) + strip(readFileSync(join(process.cwd(), "src/lib/sales/quote-import/types.ts"), "utf8"));
  ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|apiFetch|apiJson|WebSocket|EventSource|from\s+["'](?:next|react|@\/lib\/db|@\/lib\/api)/.test(src), "VAL-95: 校验模块是纯函数：没有网络调用，不引框架与数据库");
  ok(!/windowPhotos\s*:|windowTrial\s*:|materials\s*:|materialSelection\s*:/.test(src), "VAL-96: 结果对象里不写照片 / 试装图 / 面料资料这些键");
  ok(/byteLength > MAX_FILE_BYTES/.test(src) && src.indexOf("byteLength > MAX_FILE_BYTES") < src.indexOf("JSON.parse("), "VAL-97: 先判大小，再解析");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
