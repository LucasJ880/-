/**
 * 发给国内 / 退回自产（LM-01..）：字段原样带过去、提示重排、事务落库、草稿 / 版本门禁、不对外发送
 * 运行：npx tsx src/lib/sunny-process/__tests__/line-moves.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { moveProcessOrderLines, type ProcessOrderDb } from "../autogen";
import { computeIssues } from "../issues";
import { domesticRowToItem, itemToDomesticRow, planLineMove, type MovableItem } from "../line-moves";
import { emptySpec, type ProcessSpec } from "../process-spec";
import { mapQuoteFormToProcessOrder } from "../quote-mapping";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); } };

const shade = (o: Record<string, unknown>) => ({ location: "Living", widthWhole: "36", widthFrac: "8", heightWhole: "60", heightFrac: "0", product: "Zebra", sku: "ZB-1", mount: "I", lift: "L", bracket: "C", valance: "Cassette", note: "", ...o });
const mapped = mapQuoteFormToProcessOrder(JSON.stringify({
  shadeOrders: [
    shade({ location: "Living", note: "客户要求静音" }),
    shade({ location: "Kitchen", product: "Roller", lift: "M", mount: "O", bracket: "W", valance: "None", sku: "RL-7" }),
    shade({ location: "Bath", product: "SHANGRILA", lift: "R", valance: "Fascia", sku: "SG-2" }),
  ],
  shutterOrders: [], drapeOrders: [],
}));
const items: MovableItem[] = mapped.blindsItems.map((it, i) => ({ ...it, id: `it${i + 1}`, bottomBarWidth: null }));
const spec: ProcessSpec = { ...mapped.spec, version: 1, source: null };

console.log("发给国内 / 退回自产");

// LM-01 自产行 → 国内下单行：销售写的原样带过去
{
  const d = itemToDomesticRow(items[1]!);
  ok(d.code === "Kitchen" && d.widthIn === 36.5 && d.heightIn === 60 && d.productType === "卷帘" && d.sku === "RL-7" && d.measure === "外装" && d.control === "电机" && d.side === "右" && d.headrail === "单轨无盒" && d.mount === "墙装" && d.quoteProduct === "Roller", "LM-01a: 卷帘 OUT/电动/R/单轨无盒/墙装 → 外装/电机/右/单轨无盒/墙装", d);
  ok(itemToDomesticRow(items[0]!).remark === "客户要求静音" && itemToDomesticRow({ ...items[0]!, measureType: "Tight" }).remark === "测量 Tight；客户要求静音", "LM-01b: 备注带过去；Tight 写进备注（国内下单表只有内装/外装）");
}

// LM-02 发给国内：选中行移走、提示随行重排
{
  const p = planLineMove(items, spec, { to: "domestic", itemIds: ["it1"] });
  ok(p.moved === 1 && p.items.length === 2 && (p.items[0] as MovableItem).id === "it2" && p.spec.domestic.length === 1 && p.spec.domestic[0]!.code === "Living", "LM-02a: 斑马帘行移到国内下单表，剩余自产行顺序不变");
  const blindsNotes = p.spec.notes.filter((n) => n.section === "blinds");
  ok(!blindsNotes.some((n) => n.field === "fabricRatio") && blindsNotes.some((n) => n.line === 1 && n.field === "controlSide") && blindsNotes.every((n) => n.line <= 2), "LM-02b: 被移走行的提示丢弃；原第 2 行的提示变成第 1 行", blindsNotes);
  const issues = computeIssues(p.items as never, p.spec);
  ok(issues.filter((i) => i.section === "blinds" && i.field === "controlSide" && i.line === 1).length === 1, "LM-02c: 重排后待核对仍挂在正确的行上");
  const all = planLineMove(items, spec, { to: "domestic", itemIds: items.map((i) => i.id) });
  ok(all.moved === 3 && all.items.length === 0 && all.spec.domestic.length === 3 && !all.spec.notes.some((n) => n.section === "blinds"), "LM-02d: 全部发给国内");
  ok(planLineMove(items, spec, { to: "domestic", itemIds: ["nope"] }).moved === 0, "LM-02e: 未知行 → 不挪");
}

// LM-03 退回自产：只有卷帘 / 斑马帘 / 香格里拉；斑马帘查布纱比
{
  const sent = planLineMove(items, spec, { to: "domestic", itemIds: ["it1", "it3"] });
  const withCell: ProcessSpec = { ...sent.spec, domestic: [...sent.spec.domestic, { ...sent.spec.domestic[0]!, productType: "蜂窝帘", code: "Den" }] };
  const back = planLineMove(sent.items as MovableItem[], withCell, { to: "in_house", domesticLines: [1, 3] }, [{ codes: ["ZB"], fabric: 3.25, silk: 2.1875, noteZh: "" }]);
  ok(back.moved === 1 && back.items.length === 2 && back.spec.domestic.length === 2 && back.spec.domestic.some((r) => r.productType === "蜂窝帘"), "LM-03a: 斑马帘退回自产；蜂窝帘不能退回", back.spec.domestic);
  const z = back.items[1] as ReturnType<typeof domesticRowToItem>["item"];
  ok(z.productType === "斑马帘" && z.measureType === "IN" && z.controlType === "普通" && z.controlSide === "L" && z.headrailType === "亮白插片圆盒" && z.fabricRatio === 3.25 && z.silkRatio === 2.1875 && z.itemRemark === "客户要求静音", "LM-03b: 字段换回自产写法；布纱比查表（ZB ↔ ZB-1）", z);
  ok(back.spec.notes.some((n) => n.section === "blinds" && n.line === 2 && n.field === "fabricRatio" && n.messageZh.includes("对照表「ZB」")), "LM-03c: 退回行的布纱比来源写进待核对", back.spec.notes);
  const odd = domesticRowToItem({ ...withCell.domestic[0]!, headrail: "木盒", remark: "测量 Tight；客户要求静音" });
  ok(odd.item.headrailType === "亮白插片圆盒" && odd.defaults.some((d) => d.field === "headrailType") && odd.item.measureType === "Tight" && odd.item.itemRemark === "客户要求静音", "LM-03d: 罩盒不在减尺表 → 默认 + 提示；Tight 从备注还原", odd);
  const round = planLineMove(items, spec, { to: "domestic", itemIds: ["it2"] });
  const roundBack = planLineMove(round.items as MovableItem[], round.spec, { to: "in_house", domesticLines: [1] });
  const r = roundBack.items[2] as ReturnType<typeof domesticRowToItem>["item"];
  ok(r.productType === "卷帘" && r.measureType === "OUT" && r.controlType === "电动" && r.controlSide === "R" && r.headrailType === "单轨无盒" && r.mountType === "墙装" && r.width === 36.5, "LM-03e: 发出去再退回，字段不丢", r);
}

// LM-04 事务落库（内存假体）
interface Order { id: string; code: string; status: string; items: Record<string, unknown>[]; ruleVersion?: string }
function fake(order: Order, specRow: ProcessSpec) {
  const audits: { action: string; targetType: string; targetId: string; afterData: string; createdAt: Date }[] = [
    { action: "process_order.spec", targetType: "blinds_order", targetId: order.id, afterData: JSON.stringify(specRow), createdAt: new Date(1) },
  ];
  let clock = 10;
  const writes: string[] = [];
  const db = {
    salesQuote: { findUnique: async () => null },
    blindsOrder: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === order.id ? { ...order, items: order.items.map((x) => ({ ...x })) } : null),
      create: async () => { throw new Error("unused"); },
      update: async ({ data }: { data: { items: { create: Record<string, unknown>[] }; ruleVersion: string } }) => {
        writes.push("order.update");
        order.items = data.items.create.map((x, i) => ({ ...x, id: `new${i + 1}` }));
        return order;
      },
    },
    blindsOrderItem: { deleteMany: async () => { writes.push("items.deleteMany"); order.items = []; } },
    auditLog: {
      findFirst: async ({ where }: { where: { targetId: string; action: string } }) => audits.filter((a) => a.targetId === where.targetId && a.action === where.action).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      create: async ({ data }: { data: (typeof audits)[number] }) => { writes.push("audit"); audits.push({ ...data, createdAt: new Date((clock += 1)) }); return data; },
    },
    $queryRaw: async () => { writes.push("lock"); return []; },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>) { return fn(db); },
  };
  return { db: db as unknown as ProcessOrderDb, order, audits, writes };
}

async function main() {
  {
    const f = fake({ id: "o1", code: "G1", status: "draft", items: items.map((x) => ({ ...x, itemNumber: 0 })) }, spec);
    const r = await moveProcessOrderLines(f.db, "o1", { to: "domestic", itemIds: ["it1"] }, { userId: "u1", orgId: "org1" }, { baseVersion: 1 });
    ok(r.ok && r.moved === 1 && r.spec.version === 2 && r.spec.domestic.length === 1, "LM-04a: 发给国内 → 参数 v2、国内下单 1 行", r);
    ok(f.order.items.length === 2 && f.order.items.map((x) => x.itemNumber).join(",") === "1,2" && f.order.items[0]!.location === "Kitchen", "LM-04b: 自产行重写并重新编号", f.order.items.map((x) => [x.itemNumber, x.location]));
    ok(JSON.stringify(f.writes) === JSON.stringify(["lock", "items.deleteMany", "order.update", "audit"]), "LM-04c: 锁内一次事务：删行 → 重建 → 追加参数版本", f.writes);
    const stale = await moveProcessOrderLines(f.db, "o1", { to: "domestic", itemIds: ["new1"] }, { userId: "u1", orgId: "org1" }, { baseVersion: 1 });
    ok(!stale.ok && stale.status === 409 && f.order.items.length === 2, "LM-04d: baseVersion 落后 → 409，不动数据", stale);
    const back = await moveProcessOrderLines(f.db, "o1", { to: "in_house", domesticLines: [1] }, { userId: "u1", orgId: "org1" }, { baseVersion: 2 });
    ok(back.ok && back.spec.version === 3 && back.spec.domestic.length === 0 && f.order.items.length === 3 && f.order.items[2]!.productType === "斑马帘" && f.order.items[2]!.fabricRatio === 3, "LM-04e: 退回自产 → v3，斑马帘回到第 3 行（未命中对照表默认 3:2）", f.order.items[2]);
    const none = await moveProcessOrderLines(f.db, "o1", { to: "in_house", domesticLines: [9] }, { userId: "u1", orgId: "org1" });
    ok(!none.ok && none.status === 400, "LM-04f: 没有可挪的行 → 400");
  }
  {
    const f = fake({ id: "o2", code: "G2", status: "confirmed", items: [] }, emptySpec());
    const r = await moveProcessOrderLines(f.db, "o2", { to: "domestic", itemIds: [] }, { userId: "u", orgId: null });
    ok(!r.ok && r.status === 409 && f.writes.length === 1, "LM-04g: 非草稿 → 409（只拿了锁，没写）", f.writes);
    const m = await moveProcessOrderLines(f.db, "nope", { to: "domestic", itemIds: [] }, { userId: "u", orgId: null });
    ok(!m.ok && m.status === 404, "LM-04h: 工艺单不存在 → 404");
  }

  // LM-05 守卫：挪行不对外发送（不碰 PendingAction / 邮件 / 通知），路由可见性同工艺单
  {
    const src = readFileSync(join(__dirname, "..", "line-moves.ts"), "utf-8") + readFileSync(join(__dirname, "..", "..", "..", "app", "api", "blinds-orders", "[id]", "move-lines", "route.ts"), "utf-8");
    ok(!/pendingAction|sendEmail|gmail|createNotification|fetch\(/i.test(src), "LM-05a: 挪行代码不含任何对外发送");
    ok(/canViewBlindsOrder/.test(src) && /baseVersion/.test(src), "LM-05b: 路由走工艺单可见性 + 乐观锁");
  }
}

main().then(() => {
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}, (err) => { console.error(err); process.exit(1); });
