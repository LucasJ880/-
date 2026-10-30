/**
 * notif-mark-all-read：通知"全部已读"——真实 DB（隔离库）+ 真实路由
 *
 *   本人 15 条未读（多于小铃铛一次加载的 12 条）→ count = 15、未读数 0、已读时间已写；
 *   本人已读 / 已完成 / 稍后提醒不变；他人未读不变；请求体塞他人 userId 无效；再调一次 count = 0；未登录 401。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/notifications/__tests__/mark-all-read-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 通知全部已读 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "notif-mark-all-read DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "notif-mark-all-read-isolated-test-secret-0123456789";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1200) : "");
  }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const readAllRoute = await import("@/app/api/notifications/read-all/route");
  const unreadRoute = await import("@/app/api/notifications/unread-count/route");

  const stamp = Date.now().toString(36);
  const A = `nmar_a_${stamp}`;
  const B = `nmar_b_${stamp}`;
  const email = (id: string) => `${id}@fixture.test`;
  for (const id of [A, B]) await db.user.create({ data: { id, email: email(id), name: `Example ${id}`, role: "user" } });

  const req = async (uid: string, method: string, url: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: {
        ...(uid ? { cookie: `qy_session=${await createSession({ sub: uid, email: email(uid), role: "user" })}` } : {}),
        "x-forwarded-for": "10.72.0.9",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const json = async (r: Response) => (await r.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const snoozeUntil = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const doneAt = new Date(Date.now() - 60 * 60 * 1000);
    const readAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db.notification.createMany({
      data: [
        ...Array.from({ length: 15 }, (_, i) => ({ userId: A, title: `A 未读 ${i + 1}` })),
        { userId: A, title: "A 已读", status: "read", readAt },
        { userId: A, title: "A 已完成", status: "done", doneAt },
        { userId: A, title: "A 稍后提醒", status: "snoozed", snoozeUntil },
        ...Array.from({ length: 3 }, (_, i) => ({ userId: B, title: `B 未读 ${i + 1}` })),
      ],
    });
    const before = await db.notification.findMany({ where: { userId: A, status: { not: "unread" } } });

    // 未登录
    const anon = await readAllRoute.POST(await req("", "POST", "/api/notifications/read-all"));
    ok(anon.status === 401, "未登录 401", anon.status);
    ok((await db.notification.count({ where: { userId: A, status: "unread" } })) === 15, "未登录后 A 未读仍为 15");

    // A 全部已读（请求体塞 B 的 userId 无效）
    const t0 = Date.now();
    const r1 = await readAllRoute.POST(await req(A, "POST", "/api/notifications/read-all", { userId: B }));
    const b1 = await json(r1);
    ok(r1.status === 200 && b1.ok === true && b1.count === 15, "A 全部已读：{ ok: true, count: 15 }", { status: r1.status, b1 });
    ok((await db.notification.count({ where: { userId: A, status: "unread" } })) === 0, "A 未读数 0");
    const marked = await db.notification.findMany({ where: { userId: A, title: { startsWith: "A 未读" } } });
    ok(
      marked.length === 15 && marked.every((n) => n.status === "read" && n.readAt !== null && n.readAt.getTime() >= t0 - 1000),
      "15 条均为已读且写了已读时间",
      marked.map((n) => [n.status, n.readAt]),
    );

    // A 其他状态不变
    const after = await db.notification.findMany({ where: { id: { in: before.map((n) => n.id) } } });
    const same = before.every((n) => {
      const m = after.find((x) => x.id === n.id);
      return (
        m &&
        m.status === n.status &&
        String(m.readAt) === String(n.readAt) &&
        String(m.doneAt) === String(n.doneAt) &&
        String(m.snoozeUntil) === String(n.snoozeUntil)
      );
    });
    ok(same, "A 已读 / 已完成 / 稍后提醒的状态与时间不变", after.map((n) => [n.title, n.status]));

    // B 不受影响
    ok((await db.notification.count({ where: { userId: B, status: "unread" } })) === 3, "B 未读仍为 3（含请求体塞 B 的 id）");

    // 角标接口：A 为 0、B 为 3
    const ua = await json(await unreadRoute.GET(await req(A, "GET", "/api/notifications/unread-count")));
    const ub = await json(await unreadRoute.GET(await req(B, "GET", "/api/notifications/unread-count")));
    ok(ua.count === 0, "A 角标 0", ua);
    ok(ub.count === 3, "B 角标 3", ub);

    // 再调一次
    const r2 = await readAllRoute.POST(await req(A, "POST", "/api/notifications/read-all"));
    const b2 = await json(r2);
    ok(r2.status === 200 && b2.ok === true && b2.count === 0, "没有未读时 count = 0", b2);
  } finally {
    await db.notification.deleteMany({ where: { userId: { in: [A, B] } } });
    await db.userNotificationPreference.deleteMany({ where: { userId: { in: [A, B] } } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: [A, B] } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\n通知全部已读 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
