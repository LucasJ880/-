/**
 * Security-1 Preview API 验收（真实登录 + 权限断言）
 * 运行：npx tsx scripts/security1-preview-api-acceptance.ts [baseUrl]
 */

import { authorize } from "../src/lib/authorization";
import { canSelfSwitchOrganizations } from "../src/lib/organizations/org-access";
import { db } from "../src/lib/db";

const BASE =
  process.argv[2] ||
  "https://git-feature-security-1-workforce-a-233948-lucas-9039s-projects.vercel.app";
const PASSWORD = process.env.SECURITY1_QA_PASSWORD;
if (!PASSWORD) {
  throw new Error("SECURITY1_QA_PASSWORD is required");
}

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

function ok(name: string, cond: boolean, detail?: string) {
  checks.push({ name, ok: cond, detail });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function login(email: string): Promise<string | null> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) {
    console.log(`login fail ${email}: ${res.status} ${await res.text()}`);
    return null;
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookieHeader =
    setCookie.map((c) => c.split(";")[0]).join("; ") ||
    res.headers.get("set-cookie")?.split(",").map((c) => c.split(";")[0].trim()).join("; ");
  return cookieHeader || null;
}

async function api(
  cookie: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Cookie: cookie,
      "Content-Type": "application/json",
    },
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function main() {
  console.log("=== Security-1 Preview API acceptance ===");
  console.log("base:", BASE);

  const sunny = await db.organization.findFirst({
    where: { code: "sunny-home-deco" },
  });
  const mengxin = await db.organization.findFirst({
    where: { code: "mengxin-home-textile" },
  });
  if (!sunny || !mengxin) throw new Error("orgs missing");

  const custB = await db.salesCustomer.findFirst({
    where: { orgId: sunny.id, name: { contains: "SalesB Customer" } },
  });
  const custA = await db.salesCustomer.findFirst({
    where: { orgId: sunny.id, name: { contains: "SalesA Customer" } },
  });
  if (!custA || !custB) throw new Error("QA customers missing — run prepare script");

  // —— Sales A ——
  const salesACookie = await login("alex@sunnyshutter.ca");
  ok("Sales A 登录", !!salesACookie);
  if (salesACookie) {
    const me = await api(salesACookie, "/api/auth/switch-org");
    const body = me.json as {
      canSwitch?: boolean;
      orgAccessMode?: string;
      activeOrgId?: string;
      organizations?: unknown[];
    };
    ok(
      "Sales A FIXED 不可切换",
      body.canSwitch === false && body.orgAccessMode === "FIXED",
      JSON.stringify({
        canSwitch: body.canSwitch,
        mode: body.orgAccessMode,
        active: body.activeOrgId,
      }),
    );
    ok(
      "Sales A activeOrg=Sunny",
      body.activeOrgId === sunny.id,
      body.activeOrgId,
    );

    const list = await api(
      salesACookie,
      `/api/sales/customers?orgId=${sunny.id}`,
    );
    const customers =
      (list.json as { customers?: Array<{ id: string; name: string }> })
        ?.customers || [];
    ok("Sales A 客户列表 200", list.status === 200, `status=${list.status}`);
    ok(
      "Sales A 只见自己客户（含 QA A，不含 B）",
      customers.some((c) => c.id === custA.id) &&
        !customers.some((c) => c.id === custB.id),
      `count=${customers.length}`,
    );

    const cross = await api(
      salesACookie,
      `/api/sales/customers/${custB.id}?orgId=${sunny.id}`,
    );
    ok(
      "Sales A 访问 B 客户 → 403/404",
      cross.status === 403 || cross.status === 404,
      `status=${cross.status}`,
    );

    const createOpp = await api(salesACookie, "/api/sales/opportunities", {
      method: "POST",
      body: JSON.stringify({
        orgId: sunny.id,
        customerId: custB.id,
        title: "[Sec1-QA] should fail",
      }),
    });
    ok(
      "Sales A 不能给 B 客户建商机",
      createOpp.status === 403 || createOpp.status === 404,
      `status=${createOpp.status}`,
    );

    const createQuote = await api(salesACookie, "/api/sales/quotes", {
      method: "POST",
      body: JSON.stringify({
        orgId: sunny.id,
        customerId: custB.id,
        formDataJson: "{}",
      }),
    });
    ok(
      "Sales A 不能给 B 客户建报价",
      createQuote.status === 403 || createQuote.status === 404,
      `status=${createQuote.status}`,
    );

    const opps = await api(
      salesACookie,
      `/api/sales/opportunities?orgId=${sunny.id}`,
    );
    const oppList =
      (opps.json as { opportunities?: Array<{ title: string }> })
        ?.opportunities || [];
    ok(
      "Sales A 可见自己或分配商机",
      oppList.some((o) => o.title.includes("SalesA Own")) ||
        oppList.some((o) => o.title.includes("Assigned to SalesA")),
      `count=${oppList.length}`,
    );
  }

  // —— Admin ——
  const adminCookie = await login("security1-admin@test.qingyan.ai");
  ok("Admin 登录", !!adminCookie);
  if (adminCookie) {
    const salesList = await api(
      adminCookie,
      `/api/sales/customers?orgId=${sunny.id}`,
    );
    ok(
      "Admin 销售客户 API 非伪装成功（403）",
      salesList.status === 403,
      `status=${salesList.status} body=${JSON.stringify(salesList.json).slice(0, 120)}`,
    );

    const users = await api(adminCookie, "/api/users");
    ok(
      "Admin 访问 /api/users → 403",
      users.status === 403,
      `status=${users.status}`,
    );

    const members = await api(
      adminCookie,
      `/api/organizations/${sunny.id}/members`,
    );
    ok(
      "Admin 可管理/查看 Sunny 成员",
      members.status === 200,
      `status=${members.status}`,
    );
  }

  // —— Owner ——
  const ownerCookie = await login("security1-owner@test.qingyan.ai");
  ok("Owner 登录", !!ownerCookie);
  if (ownerCookie) {
    const salesList = await api(
      ownerCookie,
      `/api/sales/customers?orgId=${sunny.id}`,
    );
    const customers =
      (salesList.json as { customers?: Array<{ id: string }> })?.customers ||
      [];
    ok("Owner 销售列表 200", salesList.status === 200, `status=${salesList.status}`);
    ok(
      "Owner 可见 A 与 B 客户",
      customers.some((c) => c.id === custA.id) &&
        customers.some((c) => c.id === custB.id),
      `count=${customers.length}`,
    );

    const analytics = await api(
      ownerCookie,
      `/api/sales/analytics/customer-matrix?orgId=${sunny.id}&startDate=2026-01-01&endDate=2026-12-31`,
    );
    ok(
      "Owner 可看销售分析",
      analytics.status === 200,
      `status=${analytics.status}`,
    );

    // 梦馨客户（若有）交叉
    const mxCust = await db.salesCustomer.findFirst({
      where: { orgId: mengxin.id, archivedAt: null },
    });
    if (mxCust) {
      const cross = await api(
        ownerCookie,
        `/api/sales/customers/${mxCust.id}?orgId=${sunny.id}`,
      );
      ok(
        "Owner 不能用 Sunny 上下文读梦馨客户",
        cross.status === 403 || cross.status === 404,
        `status=${cross.status}`,
      );
    } else {
      const decision = await authorize({
        principal: {
          type: "HUMAN",
          id: (
            await db.user.findUnique({
              where: { email: "security1-owner@test.qingyan.ai" },
            })
          )!.id,
          orgId: sunny.id,
        },
        orgId: sunny.id,
        permission: "sales.customer.read",
        resource: {
          type: "sales_customer",
          orgId: mengxin.id,
          ownerId: "x",
        },
      });
      ok(
        "Owner authorize 拒绝梦馨资源",
        !decision.allowed,
        decision.reasonCode,
      );
    }
  }

  // —— Trade ——
  const tradeCookie = await login("security1-trade@test.qingyan.ai");
  ok("Trade 登录", !!tradeCookie);
  if (tradeCookie) {
    const sw = await api(tradeCookie, "/api/auth/switch-org");
    const body = sw.json as { canSwitch?: boolean; activeOrgId?: string };
    ok(
      "Trade FIXED 不可切换且在梦馨",
      body.canSwitch === false && body.activeOrgId === mengxin.id,
      JSON.stringify(body),
    );
    const sales = await api(
      tradeCookie,
      `/api/sales/customers?orgId=${mengxin.id}`,
    );
    ok(
      "Trade 无销售客户读权限（403）",
      sales.status === 403,
      `status=${sales.status}`,
    );
    const sunnySales = await api(
      tradeCookie,
      `/api/sales/customers/${custA.id}?orgId=${sunny.id}`,
    );
    ok(
      "Trade 不能读 Sunny 客户",
      sunnySales.status === 403 || sunnySales.status === 404,
      `status=${sunnySales.status}`,
    );
  }

  // —— MULTI_ORG ——
  const multiUser = await db.user.findUnique({
    where: { email: "security1-multi@test.qingyan.ai" },
  });
  ok(
    "MULTI_ORG 账号模式正确",
    !!multiUser &&
      canSelfSwitchOrganizations({
        orgAccessMode: multiUser.orgAccessMode,
        canSelfSwitchOrg: multiUser.canSelfSwitchOrg,
        activeOrgId: multiUser.activeOrgId,
      }),
    multiUser
      ? `${multiUser.orgAccessMode}/${multiUser.canSelfSwitchOrg}`
      : "missing",
  );

  const multiCookie = await login("security1-multi@test.qingyan.ai");
  ok("MULTI_ORG 登录", !!multiCookie);
  if (multiCookie && multiUser) {
    const before = multiUser.activeOrgId;
    const swGet = await api(multiCookie, "/api/auth/switch-org");
    const swBody = swGet.json as {
      canSwitch?: boolean;
      organizations?: Array<{ id: string; name: string }>;
    };
    ok("MULTI_ORG canSwitch=true", swBody.canSwitch === true);
    const orgIds = (swBody.organizations || []).map((o) => o.id);
    ok(
      "切换列表仅含 Sunny+梦馨",
      orgIds.includes(sunny.id) &&
        orgIds.includes(mengxin.id) &&
        orgIds.length === 2,
      JSON.stringify(swBody.organizations),
    );
    ok(
      "切换列表不含 archived",
      !(swBody.organizations || []).some((o) =>
        /Bid Lead|archived/i.test(o.name),
      ),
    );

    const doSwitch = await api(multiCookie, "/api/auth/switch-org", {
      method: "POST",
      body: JSON.stringify({ orgId: mengxin.id }),
    });
    ok(
      "切换到梦馨成功",
      doSwitch.status === 200,
      `status=${doSwitch.status}`,
    );

    const afterUser = await db.user.findUnique({
      where: { id: multiUser.id },
      select: { activeOrgId: true },
    });
    ok(
      "activeOrgId 已变为梦馨",
      afterUser?.activeOrgId === mengxin.id,
      afterUser?.activeOrgId,
    );

    const audit = await db.auditLog.findFirst({
      where: {
        userId: multiUser.id,
        action: "org.switch_active",
        targetId: mengxin.id,
      },
      orderBy: { createdAt: "desc" },
    });
    ok("AuditLog org.switch_active 存在", !!audit, audit?.id);
    if (audit) {
      const beforeData = audit.beforeData
        ? JSON.parse(audit.beforeData)
        : null;
      const afterData = audit.afterData ? JSON.parse(audit.afterData) : null;
      ok(
        "Audit before/after activeOrgId",
        beforeData?.activeOrgId === before &&
          afterData?.activeOrgId === mengxin.id,
        JSON.stringify({ beforeData, afterData }),
      );
    }

    // 切回 Sunny 以便后续 UI
    await api(multiCookie, "/api/auth/switch-org", {
      method: "POST",
      body: JSON.stringify({ orgId: sunny.id }),
    });
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
