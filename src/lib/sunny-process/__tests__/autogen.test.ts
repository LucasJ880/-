/**
 * 签字后自动生成草稿工艺单（AG-01..）：幂等、并发、失败隔离、参数版本化、确认门禁、接线守卫
 * 用内存假体代替 prisma；不连数据库。
 * 运行：npx tsx src/lib/sunny-process/__tests__/autogen.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blockingIssues } from "../issues";
import {
  generateProcessOrderForSignedQuote,
  loadProcessSpec,
  orderIssues,
  saveProcessSpec,
  type NotifyFn,
  type ProcessOrderDb,
} from "../autogen";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); } };

interface Order { id: string; code: string; status: string; items: Record<string, unknown>[]; [k: string]: unknown }
interface Audit { id: string; action: string; targetType: string; targetId: string; afterData: string | null; userId: string; orgId: string | null; createdAt: Date }

function fakeDb(quotes: Record<string, Record<string, unknown>>, opts: { failCreate?: unknown; beforeCreate?: () => void; beforeTx?: () => void } = {}) {
  const orders: Order[] = [];
  const audits: Audit[] = [];
  let seq = 0;
  let clock = Date.parse("2026-10-27T00:00:00Z");
  const db = {
    salesQuote: { findUnique: async ({ where }: { where: { id: string } }) => quotes[where.id] ?? null },
    blindsOrder: {
      findUnique: async ({ where }: { where: { id?: string; code?: string } }) =>
        orders.find((o) => (where.id ? o.id === where.id : o.code === where.code)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        opts.beforeCreate?.();
        if (opts.failCreate) throw opts.failCreate;
        if (orders.some((o) => o.code === data.code)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        const items = ((data.items as { create: Record<string, unknown>[] })?.create ?? []);
        const o: Order = { ...data, id: `ord_${++seq}`, code: String(data.code), status: String(data.status ?? "draft"), items };
        orders.push(o);
        return { id: o.id, code: o.code };
      },
    },
    auditLog: {
      findFirst: async ({ where }: { where: { targetType: string; targetId: string; action: string } }) => {
        const rows = audits.filter((a) => a.targetType === where.targetType && a.targetId === where.targetId && a.action === where.action);
        return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
      },
      create: async ({ data }: { data: Omit<Audit, "id" | "createdAt"> }) => {
        const a: Audit = { ...data, id: `al_${++seq}`, createdAt: new Date((clock += 1000)) };
        audits.push(a);
        return a;
      },
    },
    // advisory lock 在内存假体里无事可做（串行执行）
    $queryRaw: async () => [{ "?column?": 1 }],
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      opts.beforeTx?.();
      const o = orders.length, a = audits.length;
      try {
        return await fn(db);
      } catch (e) {
        orders.length = o;
        audits.length = a;
        throw e;
      }
    },
  };
  return { db: db as unknown as ProcessOrderDb, orders, audits };
}

const formData = JSON.stringify({
  orderNumber: "G1027-01-Z2V4",
  customerName: "Alice",
  shadeOrders: [
    { location: "Living", widthWhole: "36", widthFrac: "8", heightWhole: "60", heightFrac: "0", product: "Zebra", sku: "ZB-1", mount: "I", lift: "L", bracket: "C", valance: "Cassette", note: "" },
    { location: "Kitchen", widthWhole: "30", widthFrac: "0", heightWhole: "40", heightFrac: "0", product: "Roller", sku: "RL-1", mount: "O", lift: "M", bracket: "W", valance: "None", note: "" },
  ],
  shutterOrders: [
    { location: "Bed", widthWhole: "48", widthFrac: "0", heightWhole: "60", heightFrac: "0", frame: "", openDirection: "LR", mountType: "I", midRail: "30", panelCount: 4, draft: "" },
  ],
  drapeOrders: [],
  shutterMaterial: "Vinyl",
  shutterLouverSize: '3-1/2"',
  price: 999, msrp: 1999, depositAmount: "500",
});

const quote = (o: Record<string, unknown> = {}) => ({
  id: "q1", orgId: "org1", status: "signed", signedAt: new Date("2026-10-27T10:00:00Z"), orderNumber: "G1027-01-Z2V4",
  formDataJson: formData, customerId: "c1", opportunityId: "op1", createdById: "u1",
  customer: { name: "Alice", phone: "416", address: "1 King St" }, ...o,
});

console.log("签字后自动生成草稿工艺单");

async function main() {
const sent: Parameters<NotifyFn>[0][] = [];
const notify: NotifyFn = async (n) => { sent.push(n); };

// AG-01 生成
{
  const { db, orders, audits } = fakeDb({ q1: quote() });
  const r = await generateProcessOrderForSignedQuote("q1", { db, notify });
  const o = orders[0]!;
  ok(r.created === true && r.id === o.id && r.code === "G1027-01-Z2V4", "AG-01a: 生成成功，编号 = 报价 orderNumber", r);
  ok(o.status === "draft" && o.customerId === "c1" && o.opportunityId === "op1" && o.creatorId === "u1" && o.customerName === "Alice", "AG-01b: draft，关联客户/商机，创建人 = 报价创建人", o);
  ok(o.items.length === 2 && o.items[0]!.productType === "斑马帘" && o.items[1]!.controlType === "电动" && typeof o.items[0]!.cutZebraBar === "number", "AG-01c: 2 个 Blinds 行已按引擎计算", o.items);
  const spec = await loadProcessSpec(db, o.id);
  ok(spec.version === 1 && spec.vinyl.length === 1 && spec.source?.quoteId === "q1" && spec.source.signedAt === "2026-10-27T10:00:00.000Z", "AG-01d: Vinyl 窗进工艺参数 v1，来源报价可追溯", spec.source);
  ok(audits.some((a) => a.targetType === "sales_quote" && a.targetId === "q1" && a.action === "process_order.generated"), "AG-01e: 按报价 id 可反查关联");
  ok((r.blockingCount ?? 0) >= 1, "AG-01f: 未选外框 → 至少 1 项阻断", r.blockingCount);
  const n = sent[0]!;
  ok(sent.length === 1 && n.type === "process_order_generated" && n.userId === "u1" && n.title.includes("Alice") && n.entityType === "blinds_order" && n.entityId === o.id && (n.metadata as { href: string }).href === `/blinds-orders/${o.id}`, "AG-01g: 通知报价创建人，链接指向工艺单", n);
  const dump = JSON.stringify({ order: o, audits });
  ok(!dump.includes("999") && !dump.includes("1999") && !dump.includes("\"500\""), "AG-01h: 工艺单与参数不带任何价格/定金");

  // AG-02 幂等
  const again = await generateProcessOrderForSignedQuote("q1", { db, notify });
  ok(again.created === false && again.reason === "ALREADY_GENERATED" && again.id === o.id && orders.length === 1, "AG-02: 重复调用返回既有单，不再创建", again);
}

// AG-03 未签字 / 不存在 / 无可生产行
{
  const { db } = fakeDb({ q1: quote({ status: "sent" }), q2: quote({ id: "q2", formDataJson: JSON.stringify({ shadeOrders: [{ product: "Zebra", widthWhole: "", heightWhole: "" }] }) }) });
  ok((await generateProcessOrderForSignedQuote("q1", { db })).reason === "NOT_SIGNED", "AG-03a: 未签字不生成");
  ok((await generateProcessOrderForSignedQuote("nope", { db })).reason === "NOT_FOUND", "AG-03b: 报价不存在");
  ok((await generateProcessOrderForSignedQuote("q2", { db })).reason === "NO_PRODUCIBLE_LINES", "AG-03c: 全部缺宽高 → NO_PRODUCIBLE_LINES");
}

// AG-04 失败隔离：从不抛出
{
  const { db, orders, audits } = fakeDb({ q1: quote() }, { failCreate: new Error("db down") });
  let threw = false;
  let r;
  try { r = await generateProcessOrderForSignedQuote("q1", { db }); } catch { threw = true; }
  ok(!threw && r?.created === false && r.reason === "GENERATION_FAILED" && orders.length === 0 && audits.length === 0, "AG-04: 生成抛错 → GENERATION_FAILED，不抛出、不残留", r);
}

// AG-05 并发：另一请求先建好单 → 唯一约束失败 → 返回既有单
{
  const { db, orders, audits } = fakeDb({ q1: quote() });
  let raced = false;
  const racer = fakeDb({ q1: quote() });
  // 让第二个生成在 create 之前，被"另一请求"抢先写好同编号的单与关联
  const db2 = {
    ...db,
    blindsOrder: {
      ...db.blindsOrder,
      create: async (args: { data: Record<string, unknown> }) => {
        if (!raced) {
          raced = true;
          await generateProcessOrderForSignedQuote("q1", { db });
        }
        return db.blindsOrder.create(args);
      },
    },
    $transaction: <T,>(fn: (tx: unknown) => Promise<T>) => fn(db2),
  } as unknown as ProcessOrderDb;
  const r = await generateProcessOrderForSignedQuote("q1", { db: db2 });
  ok(r.created === false && r.reason === "ALREADY_GENERATED" && orders.length === 1 && audits.filter((a) => a.action === "process_order.generated").length === 1, "AG-05: 并发第二个事务返回既有单", { r, n: orders.length });
  void racer;
}

// AG-05b 审查发现 #2 的交错：B 的事务外预检没看到关联 → A 完整提交 → B 进事务。锁内复查必须拦住，不得用后缀再建一张
{
  let fired = false;
  let dbRef: ProcessOrderDb | null = null;
  const made = fakeDb({ q1: quote() }, {
    beforeTx: () => {
      if (fired) return;
      fired = true;
      pendingA = generateProcessOrderForSignedQuote("q1", { db: dbRef! });
    },
  });
  let pendingA: Promise<unknown> | null = null;
  dbRef = made.db;
  // beforeTx 只同步触发 A；为了让 A 先于 B 的事务体完成，把 B 的事务体延后到 A 完成之后
  const origTx = made.db.$transaction.bind(made.db);
  (made.db as unknown as { $transaction: unknown }).$transaction = async <T,>(fn: (tx: unknown) => Promise<T>) => {
    const r = origTx(async (tx) => {
      if (pendingA) { const a = pendingA; pendingA = null; await a; }
      return fn(tx);
    });
    return r;
  };
  const b = await generateProcessOrderForSignedQuote("q1", { db: made.db });
  ok(b.created === false && b.reason === "ALREADY_GENERATED" && made.orders.length === 1 && !made.orders.some((o) => o.code.includes("-Q")), "AG-05b: 并发交错下锁内复查关联，不会用后缀建第二张单", { b, codes: made.orders.map((o) => o.code) });
}

// AG-06 编号被无关的手工工艺单占用 → 加后缀
{
  const { db, orders } = fakeDb({ q1: quote() });
  await db.blindsOrder.create({ data: { code: "G1027-01-Z2V4", status: "confirmed" } });
  const r = await generateProcessOrderForSignedQuote("q1", { db });
  ok(r.created && r.code === "G1027-01-Z2V4-Qq1" && orders.length === 2, "AG-06: 编号冲突 → <编号>-Q<报价 id 后 6 位>", r);
  const r2 = await generateProcessOrderForSignedQuote("q1", { db });
  ok(r2.reason === "ALREADY_GENERATED" && r2.id === r.id, "AG-06b: 冲突后再次调用仍按关联返回");
}

// AG-07 参数版本化 + 确认门禁
{
  const { db, orders } = fakeDb({ q1: quote() });
  const r = await generateProcessOrderForSignedQuote("q1", { db });
  const o = orders[0]!;
  const v1 = await loadProcessSpec(db, o.id);
  const blocked = blockingIssues(orderIssues(o, v1));
  ok(blocked.some((i) => i.section === "vinyl" && i.messageZh === "缺外框类型"), "AG-07a: 缺外框类型 → 门禁会拦", blocked);
  const fixed = { ...v1, vinyl: [{ ...v1.vinyl[0]!, frame: "L" }], notes: [], source: { quoteId: "evil", orderNumber: null, signedAt: null, customerName: "x" } };
  const saved = await saveProcessSpec(db, o.id, fixed, { userId: "u2", orgId: "org1" });
  ok(saved.ok && saved.spec.version === 2, "AG-07b: 保存 → 版本 +1", saved);
  const v2 = await loadProcessSpec(db, o.id);
  ok(v2.version === 2 && v2.vinyl[0]!.frame === "L" && v2.source?.quoteId === "q1" && v2.notes.length === v1.notes.length, "AG-07c: 读取取最新；来源与默认提示不被入参覆盖", v2.source);
  ok(blockingIssues(orderIssues(o, v2)).length === 0, "AG-07d: 补 L 框后无阻断，可确认", blockingIssues(orderIssues(o, v2)));
  // 审查发现 #6：基于旧版本的保存被拒
  const stale = await saveProcessSpec(db, o.id, fixed, { userId: "u3", orgId: "org1" }, { baseVersion: 1 });
  ok(!stale.ok && stale.status === 409 && (await loadProcessSpec(db, o.id)).version === 2, "AG-07g: baseVersion 落后 → 409，不覆盖", stale);
  const fresh = await saveProcessSpec(db, o.id, fixed, { userId: "u3", orgId: "org1" }, { baseVersion: 2 });
  ok(fresh.ok && fresh.spec.version === 3, "AG-07h: baseVersion 一致 → 保存 v3");
  o.status = "confirmed";
  const locked = await saveProcessSpec(db, o.id, fixed, { userId: "u2", orgId: "org1" });
  ok(!locked.ok && locked.status === 409, "AG-07e: 非草稿不可改参数（409）");
  // 审查发现 #8：手工单（无来源）也不能经 PUT 伪造来源报价
  await db.blindsOrder.create({ data: { code: "MANUAL-1", status: "draft" } });
  const manual = orders.find((x) => x.code === "MANUAL-1")!;
  const forged = await saveProcessSpec(db, manual.id, { ...fixed, source: { quoteId: "evil", orderNumber: "FAKE", signedAt: null, customerName: "x" } }, { userId: "u2", orgId: null });
  ok(forged.ok && forged.spec.source === null, "AG-07i: 入参里的 source 被忽略（手工单仍无来源）", forged);
  const missing = await saveProcessSpec(db, "nope", fixed, { userId: "u2", orgId: "org1" });
  ok(!missing.ok && missing.status === 404, "AG-07f: 工艺单不存在（404）");
  void r;
}

// AG-08 接线守卫（结构）
{
  const root = join(__dirname, "../../../..");
  const read = (p: string) => readFileSync(join(root, p), "utf-8");
  const markSigned = read("src/app/api/sales/quotes/[quoteId]/mark-signed/route.ts");
  const sign = read("src/app/api/sales/quotes/share/[token]/sign/route.ts");
  ok(markSigned.includes("generateForSignedQuote(quoteId)") && markSigned.includes("processOrder,"), "AG-08a: mark-signed 签字后生成并回传 processOrder");
  ok(sign.includes("generateForSignedQuote(quote.id)"), "AG-08b: 公开签字路径也生成");
  const transition = read("src/app/api/blinds-orders/[id]/transition/route.ts");
  ok(transition.includes("PROCESS_ORDER_BLOCKED") && transition.includes("409"), "AG-08c: transition 有确认门禁");
  const exp = read("src/app/api/blinds-orders/[id]/export/route.ts");
  ok(exp.includes("getVisibleProjectIds") || exp.includes("canViewBlindsOrder"), "AG-08d: 导出有可见性校验");
  const svc = read("src/lib/sunny-process/autogen.ts");
  ok(!/sendSalesEmail|pushNotification|fetch\(/.test(svc), "AG-08e: 生成服务不对外发送");
}

}

main().then(() => {
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}, (err) => {
  console.error(err);
  process.exit(1);
});
