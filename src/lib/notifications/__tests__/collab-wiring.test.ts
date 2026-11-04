/**
 * 协作通知 COLLAB-2：接线（源码断言，design D19）
 * 只断言接线点；行为由纯逻辑测试覆盖。
 * - 讨论区 @：校验在创建之前；创建成功之后才调投递入口；重发分支不发通知；锁与查重在同一个事务里；
 *   成员卡片的头像 @ 只对 active 成员提供
 * 运行：npx tsx src/lib/notifications/__tests__/collab-wiring.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
let failed = 0;
function ok(cond: unknown, name: string, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** 从 marker 开始截到下一个顶层 export（或文件尾） */
function block(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start < 0) return "";
  const next = src.indexOf("\nexport ", start + marker.length);
  return src.slice(start, next < 0 ? undefined : next);
}
/** 各片段在 src 中依次出现 */
function inOrder(src: string, parts: string[]): boolean {
  let at = -1;
  for (const p of parts) {
    const i = src.indexOf(p, at + 1);
    if (i < 0 || i <= at) return false;
    at = i;
  }
  return true;
}

console.log("讨论区 @");
{
  const route = read("src/app/api/projects/[id]/discussion/messages/route.ts");
  const post = block(route, "export const POST");
  ok(/parseMentionList\(body\.mentions\)/.test(post), "解析 @ 名单");
  ok(/code: "MENTION_INVALID"/.test(post) && /code: "MENTION_NOT_ALLOWED"/.test(post) && /invalidUserIds/.test(post), "两种 400 错误码");
  ok(inOrder(post, ["checkMentionRecipients(", "sendMentionMessageOnce("]), "先校验被 @ 的人，再创建消息");
  ok(/canViewProjectDiscussion\(/.test(post), "被 @ 的人按讨论区查看规则判断");
  ok(inOrder(post, ["sendMentionMessageOnce(", "if (result.replayed)", "await deliverCollabNotification(discussionMentionEvent("]), "创建成功之后才调投递入口");
  const replayBranch = post.slice(post.indexOf("if (result.replayed)"), post.indexOf("await deliverCollabNotification("));
  ok(/replayed: true/.test(replayBranch) && /status: 200/.test(replayBranch) && /return NextResponse\.json/.test(replayBranch), "重发：返回 200 与 replayed: true，在投递之前返回");
  const tryStart = post.indexOf("try {");
  const tryEnd = post.indexOf("} catch", tryStart);
  ok(tryStart >= 0 && post.indexOf("deliverCollabNotification(") > tryEnd, "投递入口不在创建消息的 try 里（投递不影响创建结果）");
  ok(/\{ message: result\.message \}, \{ status: 201 \}/.test(post), "新建：201 与原响应形状");

  const service = read("src/lib/project-discussion/service.ts");
  const once = block(service, "export async function sendMentionMessageOnce");
  ok(once.length > 0, "service 提供 sendMentionMessageOnce");
  ok(inOrder(once, ["$transaction(async (tx)", "pg_advisory_xact_lock", "tx.projectMessage.findMany(", "findDiscussionReplay(", "tx.projectMessage.create("]), "锁 → 查最近 10 分钟 → 判重 → 创建，都在同一个事务里");
  ok(!/\bdb\.projectMessage\./.test(once), "事务里不绕开 tx 直接用 db");
  ok(/export async function sendMessage\(/.test(service), "不带 @ 的消息仍走原来的 sendMessage");

  const section = read("src/components/project-discussion/project-discussion-section.tsx");
  ok(/prev\.some\(\(m\) => m\.id === msg\.id\)/.test(section), "讨论区收到重发返回的同一条消息时不重复显示");

  const workbench = read("src/components/project-detail/tabs/workbench-tab.tsx");
  ok(/m\.status === "active" \? \(\s*<button[\s\S]{0,300}onClick=\{\(\) => onMention\(\{ userId: m\.user\.id/.test(workbench), "成员卡片：只有 active 成员的头像提供 @");
  ok((workbench.match(/onMention\(\{ userId: m\.user\.id/g) ?? []).length === 1, "成员卡片：只有一处头像 @");
}

console.log(`\ncollab-wiring: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
