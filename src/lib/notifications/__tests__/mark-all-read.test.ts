/**
 * notif-mark-all-read：通知"全部已读"标记本人全部未读——源码断言
 *
 *   小铃铛面板与通知页的"全部已读"调用 POST /api/notifications/read-all（不再用面板已加载的 12 条拼 id）；
 *   通知页勾选栏按钮为"标为已读"；接口只认登录身份、不读请求体。
 *
 * 运行：npx tsx src/lib/notifications/__tests__/mark-all-read.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

console.log("mark-all-read（notif-mark-all-read）");

// ── 小铃铛面板 ──
{
  const header = src("src/components/header.tsx");
  const i = header.indexOf("m.header_notif_mark_all_read");
  const button = header.slice(Math.max(0, i - 700), i);
  ok(i > 0, "小铃铛有全部已读按钮");
  ok(button.includes(`"/api/notifications/read-all"`), "小铃铛全部已读调用 /api/notifications/read-all", button);
  ok(!/unreadItems\.map\(/.test(button), "小铃铛全部已读不再用已加载条目拼 id");
  ok(!button.includes("/api/notifications/batch"), "小铃铛全部已读不再走 batch");
  ok(/unreadTotal > 0 &&/.test(button), "小铃铛全部已读按本人未读总数显示");
}

// ── 通知页 ──
{
  const page = src("src/app/(main)/notifications/page.tsx");
  ok(page.includes(`apiFetch("/api/notifications/read-all", { method: "POST" })`), "通知页全部已读调用 /api/notifications/read-all");
  ok(/onClick=\{markAllRead\}[\s\S]{0,400}全部已读/.test(page), "通知页页头全部已读按钮接 markAllRead");
  ok(/unreadTotal > 0 && \(/.test(page), "通知页全部已读只在本人有未读时显示");
  ok(/batchOp\("mark_read"\)[\s\S]{0,400}标为已读/.test(page), "勾选栏按钮文字为标为已读");
  ok(!/batchOp\("mark_read"\)[\s\S]{0,400}全部已读/.test(page), "勾选栏不再叫全部已读");
}

// ── 接口 ──
{
  const route = src("src/app/api/notifications/read-all/route.ts");
  ok(/export async function POST\(/.test(route), "read-all 只有 POST");
  ok(route.includes("requireAuth(request)"), "read-all 用 requireAuth 取登录用户");
  ok(route.includes("markAllRead(auth.user.id)"), "read-all 按登录用户 id 标记");
  ok(!/request\.(json|formData|text)\(|searchParams/.test(route), "read-all 不读请求体与查询参数");
  ok(route.includes("{ ok: true, count }"), "read-all 返回 { ok: true, count }");
}

// ── 服务端条件 ──
{
  const service = src("src/lib/notifications/service.ts");
  const i = service.indexOf("export async function markAllRead");
  const body = service.slice(i, i + 400);
  ok(i > 0, "service 导出 markAllRead");
  ok(body.includes(`where: { userId, status: "unread" }`), "markAllRead 只更新本人未读");
  ok(body.includes(`data: { status: "read", readAt: new Date() }`), "markAllRead 标为已读并写已读时间");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
