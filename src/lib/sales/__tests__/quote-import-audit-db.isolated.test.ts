/**
 * QUOTE-1b：导入留痕与审计 quote_imported——真实 DB（隔离库）+ 真实路由
 *
 *   新建带 importSource 的报价 → formDataJson 含留痕、AuditLog 一条 quote_imported（不含客户电话 / 邮箱 / 地址）；
 *   同一次导入再保存两次 → 仍一条；把文件导入一张原本没有留痕的已存报价 → 多一条；
 *   同一张报价又导入一次（导入时间不同）→ 再多一条；手工录入的报价 → 没有。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/sales/__tests__/quote-import-audit-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过导入留痕审计 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "QUOTE-1b quote import audit DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "quote-1b-isolated-test-secret-0123456789abcdef";

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

const PHONE = "416-555-0100";
const EMAIL = "homeowner@fixture.test";
const ADDRESS = "1 Example St, Toronto";
const item = { product: "Zebra", fabric: "Light Filtering", widthIn: 40, heightIn: 50, location: "Living", discountOverridePct: 0.15 };
const source = (o: Record<string, unknown> = {}) => ({
  tool: "sunny-quote-studio", fileVersion: 1, quoteId: "tool-q1", quoteNumber: "SQ-TEST", plan: "A",
  exportedAt: "2026-11-14T15:00:00.000Z", pricelistVersion: "2026.11-local.1", fileGrandTotal: 8224.5,
  importedAt: "2026-11-15T10:00:00.000Z", pricelistMatch: true, rowCount: 16, ...o,
});
const form = (importSource?: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    customerName: "Example Homeowner", customerPhone: PHONE, customerEmail: EMAIL, customerAddress: ADDRESS,
    shadeOrders: [], shutterOrders: [], drapeOrders: [], partBAddons: [], ...extra,
    ...(importSource === undefined ? {} : { importSource }),
  });

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const createRoute = await import("@/app/api/sales/quotes/route");
  const quoteRoute = await import("@/app/api/sales/quotes/[quoteId]/route");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");

  const stamp = Date.now().toString(36);
  const REP = `qirep_${stamp}`;
  const ORG = `qiorg_${stamp}`;
  const CUST = `qicust_${stamp}`;
  const quoteIds: string[] = [];

  await db.user.create({ data: { id: REP, email: `${REP}@fixture.test`, name: "Example Rep", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Example Blinds Fixture", code: `qio-${stamp}`, ownerId: REP, industryPackId: "window_covering_services_v1" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: REP, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  for (const key of ["owner", "pricing_lead", "sales_rep"]) {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: REP, roleProfileId: profile!.id, status: "active" } });
  }
  await db.salesCustomer.create({ data: { id: CUST, orgId: ORG, name: "Example Homeowner", phone: PHONE, email: EMAIL, address: ADDRESS, createdById: REP } });

  const cookie = `qy_session=${await createSession({ sub: REP, email: `${REP}@fixture.test`, role: "user" })}`;
  const headers = { "content-type": "application/json", cookie, "x-forwarded-for": "10.31.0.5" };
  const post = async (body: Record<string, unknown>) => {
    const r = new NextRequest(`http://localhost/api/sales/quotes?orgId=${ORG}`, { method: "POST", headers, body: JSON.stringify({ orgId: ORG, customerId: CUST, ...body }) });
    const res = await (createRoute.POST as unknown as (r: unknown) => Promise<Response>)(r);
    const json = (await res.json()) as { quote?: { id?: string } } & Record<string, unknown>;
    if (json.quote?.id) quoteIds.push(json.quote.id);
    return { status: res.status, body: json, id: json.quote?.id ?? "" };
  };
  const put = async (quoteId: string, body: Record<string, unknown>) => {
    const r = new NextRequest(`http://localhost/api/sales/quotes/${quoteId}?orgId=${ORG}`, { method: "PUT", headers, body: JSON.stringify({ orgId: ORG, ...body }) });
    const res = await (quoteRoute.PUT as unknown as (r: unknown, c: unknown) => Promise<Response>)(r, { params: Promise.resolve({ quoteId }) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const audits = (quoteId: string) => db.auditLog.findMany({ where: { targetId: quoteId, action: "quote_imported" }, orderBy: { createdAt: "asc" } });

  try {
    console.log("\n[1] 新建一张带导入留痕的报价 → 一条 quote_imported");
    const c1 = await post({ items: [item], installMode: "default", formDataJson: form(source()) });
    const q1 = await db.salesQuote.findUnique({ where: { id: c1.id }, include: { items: true } });
    const saved = JSON.parse(q1?.formDataJson ?? "{}") as { importSource?: Record<string, unknown> };
    ok(c1.status === 201 && saved.importSource?.quoteNumber === "SQ-TEST" && saved.importSource?.exportedAt === "2026-11-14T15:00:00.000Z", "201，落库的 formDataJson 含 importSource", { status: c1.status, src: saved.importSource });
    ok(q1?.items.length === 1 && q1.items[0]!.discountPct === 0.15, "随行提交的行级折扣 15% 生效（不套企业默认）", q1?.items.map((i) => i.discountPct));
    const a1 = await audits(c1.id);
    const text1 = JSON.stringify(a1[0] ?? {});
    ok(a1.length === 1 && a1[0]!.userId === REP && a1[0]!.orgId === ORG && a1[0]!.targetType === "sales_quote", "AuditLog 多一条 quote_imported，记在操作人与企业上", a1.length);
    ok(text1.includes("SQ-TEST") && text1.includes("2026-11-14T15:00:00.000Z") && text1.includes("tool-q1"), "审计内容含工具报价号、报价 id 与导出时间", text1.slice(0, 400));
    ok(!text1.includes(PHONE) && !text1.includes(EMAIL) && !text1.includes(ADDRESS), "审计内容不含客户电话、邮箱、地址");

    console.log("\n[2] 同一次导入再保存两次 → 仍只有一条");
    const u1 = await put(c1.id, { items: [item], installMode: "default", formDataJson: form(source()) });
    const u2 = await put(c1.id, { items: [item], installMode: "default", formDataJson: form(source(), { partBNotes: "只改备注" }) });
    ok(u1.status === 200 && u2.status === 200 && (await audits(c1.id)).length === 1, "两次 PUT 200，quote_imported 仍一条", { u1: u1.status, u2: u2.status, n: (await audits(c1.id)).length });

    console.log("\n[3] 手工录入的报价 → 没有 quote_imported；之后把文件导入这张报价 → 多一条");
    const c2 = await post({ items: [{ ...item, discountOverridePct: undefined }], installMode: "default", formDataJson: form() });
    ok(c2.status === 201 && (await audits(c2.id)).length === 0, "不带留痕的新建：没有 quote_imported", { status: c2.status });
    const u3 = await put(c2.id, { items: [item], installMode: "default", formDataJson: form() });
    ok(u3.status === 200 && (await audits(c2.id)).length === 0, "不带留痕的修改：仍没有");
    const u4 = await put(c2.id, { items: [item], installMode: "default", formDataJson: form(source({ quoteId: "tool-q2", quoteNumber: "SQ-OTHER" })) });
    const a2 = await audits(c2.id);
    ok(u4.status === 200 && a2.length === 1 && JSON.stringify(a2[0]).includes("SQ-OTHER"), "修改路径：导入到已存报价 → 多一条 quote_imported", { status: u4.status, n: a2.length });

    console.log("\n[4] 同一张报价再导入一次（导入时间不同）→ 再多一条；不拦截重复导入");
    const u5 = await put(c2.id, { items: [item], installMode: "default", formDataJson: form(source({ quoteId: "tool-q2", quoteNumber: "SQ-OTHER", importedAt: "2026-11-16T09:00:00.000Z" })) });
    ok(u5.status === 200 && (await audits(c2.id)).length === 2, "PUT 200，quote_imported 共两条", { status: u5.status, n: (await audits(c2.id)).length });
    const c3 = await post({ items: [item], installMode: "default", formDataJson: form(source()) });
    ok(c3.status === 201 && c3.id !== c1.id && (await audits(c3.id)).length === 1, "同一份文件新建第二张报价：照常保存并各有一条审计（不查重）", { status: c3.status });

    console.log("\n[5] 留痕形状不对 → 照常保存，不写审计");
    const c4 = await post({ items: [item], installMode: "default", formDataJson: form({ tool: "sunny-quote-studio", quoteId: "x" }) });
    ok(c4.status === 201 && (await audits(c4.id)).length === 0, "缺导出 / 导入时间的留痕：201，没有 quote_imported", { status: c4.status });
  } finally {
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: quoteIds } }, { userId: REP }, { orgId: ORG }] } });
    await db.notification.deleteMany({ where: { userId: REP } });
    await db.salesQuote.deleteMany({ where: { OR: [{ id: { in: quoteIds } }, { orgId: ORG }] } });
    await db.salesOpportunity.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.salesCustomer.deleteMany({ where: { id: CUST } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: REP } });
    await db.$disconnect();
  }

  console.log(`\n导入留痕审计 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
