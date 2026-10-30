/**
 * 签字 → 草稿工艺单 → 核对 → 确认 → 导出：真实 DB（隔离库）+ 真实路由端到端
 *
 *   mark-signed 生成 draft 工艺单（幂等）；公开签字路径同样生成；阻断项存在时 transition 与 PUT status 都 409；
 *   PUT spec 补外框后版本 +1、可确认；确认后参数不可改；导出按产品线出表；其他组织的用户导出 / 改参数 404；
 *   报价创建人收到 process_order_generated 站内通知。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/sunny-process/__tests__/autogen-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构客户。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 Sunny 工艺单自动生成 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "Sunny process order autogen DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "sunny-process-isolated-test-secret-0123456789";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : "");
  }
}

const formData = (orderNumber: string) => JSON.stringify({
  orderNumber,
  customerName: "Example Homeowner",
  shadeOrders: [
    { location: "Living", widthWhole: "36", widthFrac: "8", heightWhole: "60", heightFrac: "0", product: "Zebra", sku: "ZB-FIXTURE", mount: "I", lift: "L", bracket: "C", valance: "Cassette", note: "" },
    { location: "Den", widthWhole: "30", widthFrac: "0", heightWhole: "40", heightFrac: "0", product: "Cordless Cellular", sku: "CEL-FIXTURE", mount: "I", lift: "", bracket: "C", valance: "", note: "" },
  ],
  shutterOrders: [
    { location: "Bed", widthWhole: "48", widthFrac: "0", heightWhole: "60", heightFrac: "0", frame: "", openDirection: "LR", mountType: "I", midRail: "30", panelCount: 4, draft: "" },
  ],
  drapeOrders: [
    { location: "Dining", drapeWidthWhole: "100", drapeWidthFrac: "0", drapeHeightWhole: "96", drapeHeightFrac: "0", drapeFabricSku: "635", drapeFullness: "230", drapePanels: "D", drapePleatStyle: "R", drapeLiner: false, drapeBracket: "C", sheerFabricSku: "" },
  ],
  shutterMaterial: "Vinyl",
  shutterLouverSize: '3-1/2"',
  depositAmount: "500",
});

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const ExcelJS = (await import("exceljs")).default;
  const markSigned = await import("@/app/api/sales/quotes/[quoteId]/mark-signed/route");
  const publicSign = await import("@/app/api/sales/quotes/share/[token]/sign/route");
  const transition = await import("@/app/api/blinds-orders/[id]/transition/route");
  const orderRoute = await import("@/app/api/blinds-orders/[id]/route");
  const listRoute = await import("@/app/api/blinds-orders/route");
  const specRoute = await import("@/app/api/blinds-orders/[id]/spec/route");
  const exportRoute = await import("@/app/api/blinds-orders/[id]/export/route");
  const moveRoute = await import("@/app/api/blinds-orders/[id]/move-lines/route");
  const ratioRoute = await import("@/app/api/sunny-process/zebra-ratios/route");

  const stamp = Date.now().toString(36);
  const SALES = `spsales_${stamp}`;
  const FACTORY = `spfactory_${stamp}`;
  const OUTSIDER = `spout_${stamp}`;
  const PLAIN = `spplain_${stamp}`;
  const ORG = `sporg_${stamp}`;
  const ORG_X = `sporgx_${stamp}`;
  const CUST = `spcust_${stamp}`;
  const Q1 = `spq1_${stamp}`;
  const Q2 = `spq2_${stamp}`;
  const TOKEN = `sptoken_${stamp}`;
  const users = [SALES, FACTORY, OUTSIDER, PLAIN];

  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id}`, role: "sales" } });
  }
  await db.organization.create({ data: { id: ORG, name: "Example Shutters Fixture", code: `spo-${stamp}`, ownerId: SALES } });
  await db.organization.create({ data: { id: ORG_X, name: "Other Blinds Fixture", code: `spx-${stamp}`, ownerId: OUTSIDER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: SALES, role: "org_owner", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: FACTORY, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: PLAIN, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG_X, userId: OUTSIDER, role: "org_owner", status: "active" } });
  await db.salesCustomer.create({ data: { id: CUST, orgId: ORG, name: "Example Homeowner", phone: "000-000-0000", address: "1 Example St", createdById: SALES } });
  await db.salesQuote.create({ data: { id: Q1, orgId: ORG, customerId: CUST, status: "sent", orderNumber: `G1027-E2E-${stamp}`, formDataJson: formData(`G1027-E2E-${stamp}`), grandTotal: 1234.5, createdById: SALES } });
  await db.salesQuote.create({ data: { id: Q2, orgId: ORG, customerId: CUST, status: "sent", orderNumber: `G1027-PUB-${stamp}`, formDataJson: formData(`G1027-PUB-${stamp}`), grandTotal: 999, shareToken: TOKEN, createdById: SALES } });

  const cookie = async (id: string) => `qy_session=${await createSession({ sub: id, email: `${id}@fixture.test`, role: "sales" })}`;
  const cSales = await cookie(SALES);
  const cFactory = await cookie(FACTORY);
  const cOut = await cookie(OUTSIDER);
  const cPlain = await cookie(PLAIN);
  const req = (url: string, c: string, method = "GET", body?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: { "content-type": "application/json", cookie: c, "x-forwarded-for": "10.31.0.2" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const call = async (handler: (r: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>, r: InstanceType<typeof NextRequest>, params: Record<string, string>) => {
    const res = await handler(r, { params: Promise.resolve(params) });
    const ct = res.headers.get("content-type") || "";
    return { status: res.status, body: ct.includes("json") ? ((await res.json()) as Record<string, unknown>) : null, raw: ct.includes("json") ? null : Buffer.from(await res.arrayBuffer()) };
  };

  let orderId = "";
  let order2Id = "";
  try {
    console.log("\n[1] 销售现场 mark-signed → 生成 draft 工艺单");
    const s1 = await call(markSigned.POST as never, req(`/api/sales/quotes/${Q1}/mark-signed`, cSales, "POST"), { quoteId: Q1 });
    const po = s1.body?.processOrder as { created: boolean; id: string; code: string; blockingCount: number } | undefined;
    ok(s1.status === 200 && po?.created === true && po.code === `G1027-E2E-${stamp}`, "mark-signed 200，processOrder.created=true，编号 = 报价 orderNumber", s1.body);
    orderId = po?.id ?? "";
    const order = await db.blindsOrder.findUnique({ where: { id: orderId }, include: { items: true } });
    ok(order?.status === "draft" && order.customerId === CUST && order.creatorId === SALES && order.items.length === 1 && order.items[0]!.productType === "斑马帘", "工艺单 draft，关联客户，1 个 Blinds 行（斑马帘）", order);
    ok((await db.salesQuote.findUnique({ where: { id: Q1 } }))?.status === "signed", "报价已 signed");
    const links = await db.auditLog.count({ where: { targetType: "sales_quote", targetId: Q1, action: "process_order.generated" } });
    ok(links === 1, "AuditLog 有一条报价 → 工艺单关联", links);
    const note = await db.notification.findFirst({ where: { userId: SALES, type: "process_order_generated", entityId: orderId } });
    ok(!!note && note.title.includes("Example Homeowner") && note.entityType === "blinds_order", "报价创建人收到 process_order_generated 通知", note);

    console.log("\n[2] 幂等：再次 mark-signed 不再创建");
    const s2 = await call(markSigned.POST as never, req(`/api/sales/quotes/${Q1}/mark-signed`, cSales, "POST"), { quoteId: Q1 });
    const po2 = s2.body?.processOrder as { created: boolean; id: string; reason: string } | undefined;
    ok(s2.status === 200 && po2?.created === false && po2.reason === "ALREADY_GENERATED" && po2.id === orderId, "第二次返回既有单", s2.body);
    ok((await db.blindsOrder.count({ where: { customerId: CUST } })) === 1, "工艺单仍只有 1 张");

    console.log("\n[2b] PERM-3：改单 / 推进按品类（品类含参数行），工厂绑定三个出单岗位");
    const t0 = await call(transition.POST as never, req(`/api/blinds-orders/${orderId}/transition`, cFactory, "POST", { toStatus: "confirmed" }), { id: orderId });
    ok(t0.status === 403 && t0.body?.code === "FULFILLMENT_CATEGORY_FORBIDDEN" && (t0.body?.missingCategories as string[]).join(",") === "vinyl,drapery,shades", "未绑定出单岗位的同组织成员推进 → 403，缺 vinyl / drapery（参数行）+ shades（斑马帘行）", t0.body);
    const d0 = await call(orderRoute.GET as never, req(`/api/blinds-orders/${orderId}`, cPlain), { id: orderId });
    ok(d0.status === 200 && (d0.body?.access as { canEdit: boolean }).canEdit === false, "同组织普通成员仍可读详情（只读）", d0.body?.access);
    await db.organization.update({ where: { id: ORG }, data: { industryPackId: "window_covering_services_v1" } });
    const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
    await seedOrgAuthorizationProfiles(ORG);
    for (const key of ["fulfillment_vinyl", "fulfillment_drapery", "fulfillment_shades"]) {
      const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
      await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: FACTORY, roleProfileId: profile!.id, status: "active" } });
    }
    const pc = await call(orderRoute.PUT as never, req(`/api/blinds-orders/${orderId}`, cFactory, "PUT", { status: "cancelled" }), { id: orderId });
    ok(pc.status === 409 && pc.body?.code === "USE_TRANSITION", "PUT {status:cancelled} 不能绕过作废审批 → 409", pc.body);

    console.log("\n[3] 阻断项存在时确认被拒（transition 与 PUT status 同一门禁）");
    const t1 = await call(transition.POST as never, req(`/api/blinds-orders/${orderId}/transition`, cFactory, "POST", { toStatus: "confirmed" }), { id: orderId });
    const issues = (t1.body?.issues ?? []) as { messageZh: string; section: string }[];
    ok(t1.status === 409 && t1.body?.code === "PROCESS_ORDER_BLOCKED" && issues.some((i) => i.section === "vinyl" && i.messageZh === "缺外框类型"), "transition → 409 PROCESS_ORDER_BLOCKED（Vinyl 缺外框类型）", t1.body);
    const p1 = await call(orderRoute.PUT as never, req(`/api/blinds-orders/${orderId}`, cFactory, "PUT", { status: "confirmed" }), { id: orderId });
    ok(p1.status === 409 && p1.body?.code === "PROCESS_ORDER_BLOCKED", "PUT {status:confirmed} 同样 409", p1.body);
    for (const st of ["in_production", "completed", "ready"]) {
      const px = await call(orderRoute.PUT as never, req(`/api/blinds-orders/${orderId}`, cFactory, "PUT", { status: st }), { id: orderId });
      ok(px.status === 409 && px.body?.code === "PROCESS_ORDER_BLOCKED", `PUT {status:${st}} 也被门禁拦下（不可绕过）`, px.body);
    }
    ok((await db.blindsOrder.findUnique({ where: { id: orderId } }))?.status === "draft", "工艺单仍为 draft");

    console.log("\n[4] 其他组织用户：参数 / 导出 404");
    const o1 = await call(specRoute.GET as never, req(`/api/blinds-orders/${orderId}/spec`, cOut), { id: orderId });
    const o2 = await call(exportRoute.GET as never, req(`/api/blinds-orders/${orderId}/export`, cOut), { id: orderId });
    ok(o1.status === 404 && o2.status === 404, "外部组织 GET spec / export → 404", { o1: o1.status, o2: o2.status });
    const o3 = await call(orderRoute.GET as never, req(`/api/blinds-orders/${orderId}`, cOut), { id: orderId });
    ok(o3.status === 404, "外部组织 GET 工艺单详情 → 404（含客户电话地址）", o3.status);
    const listOut = await listRoute.GET(req(`/api/blinds-orders`, cOut), { params: Promise.resolve({}) } as never);
    const listFac = await listRoute.GET(req(`/api/blinds-orders`, cFactory), { params: Promise.resolve({}) } as never);
    const idsOut = ((await listOut.json()) as { id: string }[]).map((o) => o.id);
    const idsFac = ((await listFac.json()) as { id: string }[]).map((o) => o.id);
    ok(idsFac.includes(orderId) && !idsOut.includes(orderId), "工艺单列表：同组织工厂能看到自动生成的单，外部组织看不到", { fac: idsFac.includes(orderId), out: idsOut.includes(orderId) });

    console.log("\n[5] 工厂补外框 → 版本 +1 → 可确认 → 确认后参数锁定");
    const g = await call(specRoute.GET as never, req(`/api/blinds-orders/${orderId}/spec`, cFactory), { id: orderId });
    const spec = g.body?.spec as { version: number; vinyl: Record<string, unknown>[]; drapes: unknown[]; domestic: unknown[] };
    ok(g.status === 200 && spec.version === 1 && spec.vinyl.length === 1 && spec.drapes.length === 1 && spec.domestic.length === 1, "GET spec：v1，Vinyl 1 / 窗帘 1 / 国内下单 1", g.body);
    spec.vinyl[0]!.frame = "L";
    const stale = await call(specRoute.PUT as never, req(`/api/blinds-orders/${orderId}/spec`, cFactory, "PUT", { spec, baseVersion: 0 }), { id: orderId });
    ok(stale.status === 409, "PUT spec 基于过期版本 → 409", stale.body);
    const put = await call(specRoute.PUT as never, req(`/api/blinds-orders/${orderId}/spec`, cFactory, "PUT", { spec, baseVersion: 1 }), { id: orderId });
    ok(put.status === 200 && (put.body?.spec as { version: number }).version === 2, "PUT spec → 200，版本 2", put.body);
    const blockedLeft = ((put.body?.issues ?? []) as { level: string }[]).filter((i) => i.level === "block");
    ok(blockedLeft.length === 0, "补外框后无阻断项", blockedLeft);

    console.log("\n[5b] 布纱比对照表（组织 settingsJson）+ 发给国内 / 退回自产");
    const r0 = await call(ratioRoute.GET as never, req(`/api/sunny-process/zebra-ratios`, cPlain), {});
    ok(r0.status === 200 && r0.body?.seeded === true && (r0.body?.entries as unknown[]).length === 24 && r0.body?.orgId === ORG && r0.body?.canEdit === false, "GET 对照表：未保存过 → 原件种子 24 条；普通成员只读", r0.body?.seeded);
    const rDenied = await call(ratioRoute.PUT as never, req(`/api/sunny-process/zebra-ratios`, cPlain, "PUT", { entries: [] }), {});
    ok(rDenied.status === 403, "未绑定出单岗位的普通成员保存对照表 → 403（影响全组织裁剪位）", rDenied.body);
    const vinylProfile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key: "fulfillment_vinyl" } } });
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: PLAIN, roleProfileId: vinylProfile!.id, status: "active" } });
    const rVinyl = await call(ratioRoute.PUT as never, req(`/api/sunny-process/zebra-ratios`, cPlain, "PUT", { entries: [] }), {});
    ok(rVinyl.status === 403, "只持出单·Vinyl（orders.fulfillment.update.vinyl）保存斑马帘对照表 → 403（斑马帘属 shades）", rVinyl.body);
    // 2026-10-27 Lucas：权限给出工艺单的人 → 绑定「出单·Roller/Zebra/Roman」岗位（PERM-3 起持 orders.fulfillment.update.shades）后可保存（[2b] 已绑定）
    const rBound = await call(ratioRoute.GET as never, req(`/api/sunny-process/zebra-ratios`, cFactory), {});
    ok(rBound.status === 200 && rBound.body?.canEdit === true, "绑定出单岗位后 GET canEdit = true", rBound.body?.canEdit);
    const r1 = await call(ratioRoute.PUT as never, req(`/api/sunny-process/zebra-ratios`, cFactory, "PUT", { entries: [{ codes: ["ZB-FIXTURE"], fabric: "3 4/16", silk: "2 3/16", noteZh: "e2e" }, { codes: [], fabric: 3, silk: 2 }] }), {});
    ok(r1.status === 200 && (r1.body?.entries as unknown[]).length === 1 && r1.body?.dropped === 1, "出单岗位成员 PUT 对照表 → 200：保存 1 条，非法行丢弃", r1.body);
    const rOwner = await call(ratioRoute.GET as never, req(`/api/sunny-process/zebra-ratios`, cSales), {});
    ok(rOwner.body?.canEdit === true, "组织负责人（org_owner）仍可编辑", rOwner.body?.canEdit);
    const orgRow = await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } });
    const ratioAudit = await db.auditLog.count({ where: { targetType: "organization", targetId: ORG, action: "sunny_process.zebra_ratios" } });
    ok(JSON.stringify(orgRow?.settingsJson).includes("ZB-FIXTURE") && ratioAudit === 1, "落在 Organization.settingsJson.sunnyProcess.zebraRatios，记 AuditLog", { ratioAudit });
    const rOut = await call(ratioRoute.GET as never, req(`/api/sunny-process/zebra-ratios`, cOut), {});
    ok(rOut.status === 200 && rOut.body?.orgId === ORG_X && rOut.body?.seeded === true, "外部组织读到的是自己的表（种子），看不到本组织的", rOut.body?.orgId);

    const mOut = await call(moveRoute.POST as never, req(`/api/blinds-orders/${orderId}/move-lines`, cOut, "POST", { to: "domestic", itemIds: "all", baseVersion: 2 }), { id: orderId });
    ok(mOut.status === 404, "外部组织挪行 → 404", mOut.status);
    const mStale = await call(moveRoute.POST as never, req(`/api/blinds-orders/${orderId}/move-lines`, cFactory, "POST", { to: "domestic", itemIds: "all", baseVersion: 1 }), { id: orderId });
    ok(mStale.status === 409 && (await db.blindsOrderItem.count({ where: { orderId } })) === 1, "挪行基于过期版本 → 409，自产行不动", mStale.body);
    const beforeMove = (await db.blindsOrder.findUnique({ where: { id: orderId } }))!.updatedAt.toISOString();
    const oldItems = (await db.blindsOrderItem.findMany({ where: { orderId } })).map((it) => ({ ...it, id: undefined }));
    const m1 = await call(moveRoute.POST as never, req(`/api/blinds-orders/${orderId}/move-lines`, cFactory, "POST", { to: "domestic", itemIds: "all", baseVersion: 2 }), { id: orderId });
    const m1spec = m1.body?.spec as { version: number; domestic: { productType: string; sku: string; code: string; control: string; side: string }[] };
    const sent = m1spec?.domestic.find((d) => d.productType === "斑马帘");
    ok(m1.status === 200 && m1spec.version === 3 && (await db.blindsOrderItem.count({ where: { orderId } })) === 0 && !!sent && sent.sku === "ZB-FIXTURE" && sent.code === "Living" && sent.control === "普通" && sent.side === "左", "全部发给国内 → 自产行清空、国内下单表多一行斑马帘（销售填写原样），参数 v3", m1.body);
    const staleEdit = await call(orderRoute.PUT as never, req(`/api/blinds-orders/${orderId}`, cFactory, "PUT", { items: oldItems, baseUpdatedAt: beforeMove }), { id: orderId });
    ok(staleEdit.status === 409 && staleEdit.body?.code === "ORDER_STALE" && (await db.blindsOrderItem.count({ where: { orderId } })) === 0, "发给国内后，旧编辑页整表保存 → 409，不把已挪走的行写回（审查发现）", staleEdit.body);
    const zebraLine = m1spec.domestic.findIndex((d) => d.productType === "斑马帘") + 1;
    const m2 = await call(moveRoute.POST as never, req(`/api/blinds-orders/${orderId}/move-lines`, cFactory, "POST", { to: "in_house", domesticLines: [zebraLine], baseVersion: 3 }), { id: orderId });
    const back = await db.blindsOrderItem.findMany({ where: { orderId } });
    ok(m2.status === 200 && (m2.body?.spec as { version: number }).version === 4 && back.length === 1 && back[0]!.productType === "斑马帘" && back[0]!.fabricRatio === 3 && back[0]!.silkRatio === 2 && back[0]!.cutZebraBar !== null, "退回自产 → 自产行重建、布纱比按发出去前的值带回（对照表后来改了也不回写已生成的行）、开料重新计算，参数 v4", { status: m2.status, back });
    spec.version = 4;
    const xls = await call(exportRoute.GET as never, req(`/api/blinds-orders/${orderId}/export`, cFactory), { id: orderId });
    const wb = new ExcelJS.Workbook();
    if (xls.raw) await wb.xlsx.load(xls.raw as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    ok(xls.status === 200 && ["开料表", "国内下单表", "窗帘工艺单", "Vinyl 下料总表", "待核对"].every((n) => names.includes(n)), "工厂导出 xlsx：含 Blinds / 国内下单 / 窗帘 / Vinyl / 待核对", names);
    const t2 = await call(transition.POST as never, req(`/api/blinds-orders/${orderId}/transition`, cFactory, "POST", { toStatus: "confirmed" }), { id: orderId });
    ok(t2.status === 200 && (await db.blindsOrder.findUnique({ where: { id: orderId } }))?.status === "confirmed", "transition → 200，工艺单 confirmed", t2.body);
    const locked = await call(specRoute.PUT as never, req(`/api/blinds-orders/${orderId}/spec`, cFactory, "PUT", { spec }), { id: orderId });
    ok(locked.status === 409, "确认后再改参数 → 409", locked.body);

    console.log("\n[6] 客户线上签字路径同样生成");
    const sig = await publicSign.POST(
      new NextRequest(`http://localhost/api/sales/quotes/share/${TOKEN}/sign`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ signatureDataUrl: "data:image/png;base64,iVBORw0KGgo=" }),
      }),
      { params: Promise.resolve({ token: TOKEN }) },
    );
    const sigBody = (await sig.json()) as Record<string, unknown>;
    const link2 = await db.auditLog.findFirst({ where: { targetType: "sales_quote", targetId: Q2, action: "process_order.generated" } });
    order2Id = String((link2?.afterData ? JSON.parse(link2.afterData) : {}).orderId ?? "");
    const order2 = order2Id ? await db.blindsOrder.findUnique({ where: { id: order2Id } }) : null;
    ok(sig.status === 200 && sigBody.signed === true && order2?.status === "draft" && order2.code === `G1027-PUB-${stamp}`, "公开签字 200，生成 draft 工艺单", { sigBody, order2 });
    ok(!JSON.stringify(sigBody).includes(order2Id), "公开签字响应不向客户暴露工艺单信息");
  } finally {
    const orderIds = (await db.blindsOrder.findMany({ where: { customerId: CUST }, select: { id: true } })).map((o) => o.id);
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: [Q1, Q2, ...orderIds] } }, { userId: { in: users } }] } });
    await db.orderStatusLog.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.blindsOrder.deleteMany({ where: { id: { in: orderIds } } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.customerInteraction.deleteMany({ where: { customerId: CUST } });
    await db.salesQuote.deleteMany({ where: { id: { in: [Q1, Q2] } } });
    await db.salesCustomer.deleteMany({ where: { id: CUST } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_X] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_X] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
}

main().then(() => {
  console.log(`\nSunny 工艺单自动生成 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}, (err) => {
  console.error(err);
  process.exit(1);
});
