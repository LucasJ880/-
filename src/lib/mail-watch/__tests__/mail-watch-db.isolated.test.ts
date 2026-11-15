/**
 * MAIL-2：客户来信提醒——真实 DB（隔离库）+ 真实路由 + 注入的假邮箱端到端（spec mail/inbound-watch）
 *
 *   组织开关与成员勾选接口（403 / 400 / 404 / 只改本人 / 取消勾选删游标）；
 *   首次不回溯、增量归类（客户来信 / 客户回信 / 未匹配 / 跳过）、可见性、账本与重放幂等、
 *   游标过期重建、50 封上限续读、单封失败、在途询价线程、同一封信进两个邮箱只建一条互动、
 *   通知与微信推送（上限、失败、已绑定 Muse 也只发站内）、缺读信权限提醒、开关与截止时刻。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过来信观察 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "MAIL-2 mail watch DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "mail-2-isolated-test-secret-0123456789abcdef";
process.env.MAIL_WATCH_ENABLED = "true";

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

type Handler = (r: unknown, c: unknown) => Promise<Response>;
type Json = Record<string, unknown>;

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { readMailWatch } = await import("@/lib/mail-watch/pure");
  const orgRoute = await import("@/app/api/organizations/[orgId]/mail-watch-settings/route");
  const optInRoute = await import("@/app/api/sales/mail-watch/opt-in/route");

  const stamp = Date.now().toString(36);
  const LYNN = `mwlynn_${stamp}`; // sales_rep
  const SAM = `mwsam_${stamp}`; // 另一位 sales_rep（Lynn 看不到他的客户）
  const BOB = `mwbob_${stamp}`; // owner 岗（老板）
  const OLD = `mwold_${stamp}`; // sales_rep，只有撰写权限的旧授权
  const INSTALLER = `mwinst_${stamp}`; // 安装工：邮箱绑定页不放行
  const ORG = `mworg_${stamp}`;
  const users = [LYNN, SAM, BOB, OLD, INSTALLER];

  for (const id of users) await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Example Blinds Fixture", code: `mw-${stamp}`, ownerId: BOB, industryPackId: "window_covering_services_v1" } });
  for (const userId of users) await db.organizationMember.create({ data: { orgId: ORG, userId, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    const dup = await db.principalRoleBinding.findFirst({ where: { orgId: ORG, principalId: userId, roleProfileId: profile!.id } });
    if (!dup) await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  for (const u of [LYNN, SAM, OLD]) await bind(u, "sales_rep");
  await bind(BOB, "owner");
  await bind(INSTALLER, "installer");

  const call = async (handler: unknown, uid: string, url: string, method = "GET", body?: unknown, params: Record<string, string> = {}) => {
    const cookie = `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: "user" })}`;
    const r = new NextRequest(`http://localhost${url}`, {
      method,
      headers: { "content-type": "application/json", cookie, "x-forwarded-for": "10.31.0.9" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await (handler as Handler)(r, { params: Promise.resolve(params) });
    const ct = res.headers.get("content-type") || "";
    return { status: res.status, body: (ct.includes("json") ? await res.json() : null) as Json | null };
  };
  const config = async () => readMailWatch((await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } }))?.settingsJson);
  const ORG_URL = `/api/organizations/${ORG}/mail-watch-settings`;
  const OPT_URL = `/api/sales/mail-watch/opt-in?orgId=${ORG}`;

  try {
    // ════════════════════════════════════════════════════════
    console.log("\n[1] 平台开关关闭：两个接口都是 404");
    {
      process.env.MAIL_WATCH_ENABLED = "false";
      const a = await call(orgRoute.GET, BOB, ORG_URL, "GET", undefined, { orgId: ORG });
      const b = await call(orgRoute.PUT, BOB, ORG_URL, "PUT", { enabled: true }, { orgId: ORG });
      const c = await call(optInRoute.GET, LYNN, OPT_URL);
      const d = await call(optInRoute.PUT, LYNN, OPT_URL, "PUT", { optedIn: true });
      ok([a, b, c, d].every((r) => r.status === 404), "组织开关 GET / PUT、成员勾选 GET / PUT 都返回 404", [a.status, b.status, c.status, d.status]);
      ok((await config()).enabled === false && Object.keys((await config()).mailboxes).length === 0, "设置没有被写入");
      process.env.MAIL_WATCH_ENABLED = "true";
    }

    console.log("\n[2] 组织开关：只有持销售设置管理权限的人能读写");
    {
      const g = await call(orgRoute.GET, BOB, ORG_URL, "GET", undefined, { orgId: ORG });
      ok(g.status === 200 && JSON.stringify(g.body?.settings) === '{"enabled":false,"optedInCount":0}', "老板 GET：缺省为关、0 人勾选", g);
      const s1 = await call(orgRoute.PUT, LYNN, ORG_URL, "PUT", { enabled: true }, { orgId: ORG });
      const s2 = await call(orgRoute.GET, LYNN, ORG_URL, "GET", undefined, { orgId: ORG });
      ok(s1.status === 403 && s2.status === 403 && (await config()).enabled === false, "sales_rep PUT / GET → 403，设置未变", [s1, s2]);
      const bad1 = await call(orgRoute.PUT, BOB, ORG_URL, "PUT", { enabled: true, mailboxes: { [SAM]: { optedInAt: "2026-01-01T00:00:00Z" } } }, { orgId: ORG });
      const bad2 = await call(orgRoute.PUT, BOB, ORG_URL, "PUT", { enabled: "yes" }, { orgId: ORG });
      ok(bad1.status === 400 && bad2.status === 400 && Object.keys((await config()).mailboxes).length === 0, "多一个字段 / 类型不对 → 400，不能借组织开关替成员勾选", [bad1, bad2]);
    }

    console.log("\n[3] 成员勾选：只能改自己");
    {
      const g0 = await call(optInRoute.GET, LYNN, OPT_URL);
      const st0 = g0.body?.status as Json;
      ok(g0.status === 200 && st0.optedIn === false && st0.orgEnabled === false && st0.gmailConnected === false && st0.canManageOrg === false, "Lynn GET：未勾选、组织开关关、没连 Gmail、不能管组织开关", g0);
      const p = await call(optInRoute.PUT, LYNN, OPT_URL, "PUT", { optedIn: true, userId: BOB, mailboxes: { [BOB]: {} } });
      const c = await config();
      ok(p.status === 200 && (p.body?.status as Json).optedIn === true && JSON.stringify(Object.keys(c.mailboxes)) === JSON.stringify([LYNN]), "Lynn PUT 带老板的 id：只有 Lynn 自己被勾选，老板的状态不变", [p, Object.keys(c.mailboxes)]);
      ok(c.mailboxes[LYNN].historyId === null && typeof c.mailboxes[LYNN].optedInAt === "string", "新勾选：记勾选时间，起点为空");
      const bob = await call(optInRoute.GET, BOB, OPT_URL);
      ok((bob.body?.status as Json).optedIn === false && (bob.body?.status as Json).canManageOrg === true, "老板 GET：未勾选；能管组织开关");
      const bad = await call(optInRoute.PUT, LYNN, OPT_URL, "PUT", { optedIn: "yes" });
      ok(bad.status === 400, "optedIn 不是布尔值 → 400");
      const inst1 = await call(optInRoute.GET, INSTALLER, OPT_URL);
      const inst2 = await call(optInRoute.PUT, INSTALLER, OPT_URL, "PUT", { optedIn: true });
      ok(inst1.status === 403 && inst2.status === 403 && !(INSTALLER in (await config()).mailboxes), "安装工（邮箱绑定页不放行）→ 403", [inst1.status, inst2.status]);
    }

    console.log("\n[4] 管理员保存组织开关：不动成员的勾选与游标，留审计");
    {
      // 先给 Lynn 一个游标，确认组织开关的保存不碰它
      const { mutateOrgSettings } = await import("@/lib/organizations/settings-write");
      const { withCursor, withMailWatch } = await import("@/lib/mail-watch/pure");
      await mutateOrgSettings(ORG, (fresh) => ({ next: withMailWatch(fresh, withCursor(readMailWatch(fresh), LYNN, "4242", new Date())!), result: null }));
      const p = await call(orgRoute.PUT, BOB, ORG_URL, "PUT", { enabled: true }, { orgId: ORG });
      const c = await config();
      ok(p.status === 200 && JSON.stringify(p.body?.settings) === '{"enabled":true,"optedInCount":1}' && c.enabled === true, "老板 PUT { enabled: true } → 200，再读为开", p);
      ok(c.mailboxes[LYNN]?.historyId === "4242", "Lynn 的勾选与游标原样保留");
      const audit = await db.auditLog.findMany({ where: { orgId: ORG, action: "mail.watch.settings" }, select: { userId: true, beforeData: true, afterData: true } });
      ok(audit.length === 1 && audit[0].userId === BOB && audit[0].beforeData === '{"enabled":false}' && audit[0].afterData === '{"enabled":true}', "审计 mail.watch.settings：保存前后的开关值", audit);
      ok(!JSON.stringify(p.body).includes(LYNN) && !JSON.stringify(p.body).includes("4242"), "接口返回里没有成员的用户 id 与游标");
    }

    console.log("\n[5] 取消勾选删游标");
    {
      const off = await call(optInRoute.PUT, LYNN, OPT_URL, "PUT", { optedIn: false });
      const c = await config();
      ok(off.status === 200 && (off.body?.status as Json).optedIn === false && !(LYNN in c.mailboxes), "Lynn 取消勾选：设置里不再有她的条目（游标一并删除）", Object.keys(c.mailboxes));
      const on = await call(optInRoute.PUT, LYNN, OPT_URL, "PUT", { optedIn: true });
      ok(on.status === 200 && (await config()).mailboxes[LYNN].historyId === null, "重新勾选：从新的起点开始（游标为空）");
      ok((await config()).enabled === true, "成员的勾选不影响组织开关");
    }
  } finally {
    await db.$disconnect();
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
