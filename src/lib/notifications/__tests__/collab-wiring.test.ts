/**
 * 协作通知 COLLAB-2：接线（源码断言，design D19）
 * 只断言接线点；行为由纯逻辑测试覆盖。
 * - 讨论区 @：校验在创建之前；创建成功之后才调投递入口；重发分支不发通知；锁与查重在同一个事务里；
 *   成员卡片的头像 @ 只对 active 成员提供
 * - 任务：查看规则移到 src/lib/tasks/access.ts；创建、编辑、批量改状态在写库之后通知；
 *   评论先做 404 校验、@ 校验在创建之前、锁与查重在同一个事务里、写 comment.mentioned 活动记录；
 *   @ 候选人接口做 404 校验
 * - 新文件不导入 LLM 客户端，也不导入 EmailProvider
 * 运行：npx tsx src/lib/notifications/__tests__/collab-wiring.test.ts
 */

import { existsSync, readFileSync } from "node:fs";
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
/** 文件不存在时返回空串，让断言逐条报失败 */
const read = (p: string) => {
  const full = join(process.cwd(), p);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
};
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

console.log("任务查看规则");
{
  const access = read("src/lib/tasks/access.ts");
  ok(/export function canAccessTask\(/.test(access), "access.ts 导出 canAccessTask");
  ok(/export async function canUserViewTask\(/.test(access) && /getVisibleProjectIds\(/.test(access), "access.ts 导出按人判断的 canUserViewTask");
  const detail = read("src/app/api/tasks/[id]/route.ts");
  ok(/import \{ canAccessTask \} from "@\/lib\/tasks\/access"/.test(detail), "详情路由改为导入查看规则");
  ok(!/function canAccessTask\(/.test(detail), "详情路由不再自己定义查看规则");
}

console.log("任务接线：指派与状态");
{
  const notify = read("src/lib/notifications/collab/task-notify.ts");
  for (const fn of ["notifyTaskCreated", "notifyTaskUpdated", "notifyBatchStatusChanged", "notifyTaskCommented", "loadTaskStatuses"]) {
    const body = block(notify, `export async function ${fn}(`);
    ok(body.length > 0, `task-notify 导出 ${fn}`);
    ok(/try \{[\s\S]*\} catch \(err\) \{[\s\S]*console\.error\(/.test(body), `${fn}：出错只记日志，不向外抛`);
  }
  ok(/deliverCollabNotification\(/.test(notify), "事件交给统一投递入口");

  const create = block(read("src/app/api/tasks/route.ts"), "const authenticatedPost");
  ok(inOrder(create, ["db.task.create(", "db.taskActivity.create(", "await notifyTaskCreated({ task, actor: user })", "return NextResponse.json(task, { status: 201 })"]), "POST /api/tasks：创建成功之后通知，再返回原响应");

  const patch = block(read("src/app/api/tasks/[id]/route.ts"), "export const PATCH");
  ok(inOrder(patch, ["db.task.update(", "db.taskActivity.create(", "await notifyTaskUpdated({ before: oldTask, task, actor: user })", "return NextResponse.json({ ...task, projectProgress })"]), "PATCH /api/tasks/[id]：写库之后按前后值通知，再返回原响应");
  ok(patch.indexOf("transitionTaskStatus(") >= 0 && patch.indexOf("transitionTaskStatus(") < patch.indexOf("await notifyTaskUpdated("), "状态通知在 transitionTaskStatus 成功之后");

  const batchRoute = read("src/app/api/tasks/batch/route.ts");
  const statusBranch = batchRoute.slice(batchRoute.indexOf('if (action === "status" && value)'), batchRoute.indexOf('if (action === "priority" && value)'));
  ok(inOrder(statusBranch, ["await loadTaskStatuses(ids)", "db.task.updateMany(", "await notifyBatchStatusChanged({ before, actor: user })", "return NextResponse.json({ updated: ids.length, status: value })"]), "POST /api/tasks/batch：改前记下状态，改后逐条比较并通知，再返回原响应");
  ok(/withAuth\(async \(request, _ctx, user\)/.test(batchRoute), "批量接口拿到操作人");
}

console.log("任务接线：评论");
{
  const route = read("src/app/api/tasks/[id]/comments/route.ts");
  const post = block(route, "export const POST");
  ok(inOrder(post, ["canUserViewTask(user, task)", '{ error: "任务不存在" }, { status: 404 }', "await request.json()"]), "先做查看校验：看不到 → 404「任务不存在」");
  ok(inOrder(post, ["parseMentionList(body.mentions)", 'code: "MENTION_INVALID"', "checkMentionRecipients(", 'code: "MENTION_NOT_ALLOWED"', "$transaction(async (tx)"]), "@ 名单与被 @ 的人在创建之前校验");
  ok(/canView: \(u\) => canUserViewTask\(u, task\)/.test(post), "被 @ 的人按任务查看规则判断");
  ok(inOrder(post, ["$transaction(async (tx)", "pg_advisory_xact_lock", "tx.taskComment.findMany(", "findCommentReplay(", "tx.taskComment.create(", 'action: "comment"', 'action: "comment.mentioned"']), "锁 → 查最近 10 分钟 → 判重 → 创建评论与活动记录，都在同一个事务里");
  ok(/detail: JSON\.stringify\(\{ commentId: comment\.id, userIds: mentionIds \}\)/.test(post), "comment.mentioned 的 detail 为 {commentId, userIds} 的 JSON 字符串");
  ok(!/\bdb\.taskComment\.create\(|\bdb\.taskActivity\.create\(/.test(post), "评论与活动记录只在事务里写");
  ok(inOrder(post, ["if (result.replayed)", "replayed: true", "status: 200", "await notifyTaskCommented("]), "重发：返回 200 与 replayed: true，在通知之前返回");
  // 事务回调在处理函数体的第一层缩进（两个空格）结束
  const txStart = post.indexOf("$transaction(async (tx)");
  const txEnd = post.indexOf("\n  });", txStart);
  ok(txStart >= 0 && txEnd > txStart && post.indexOf("await notifyTaskCommented(") > txEnd, "通知在事务之外、提交之后");
  ok(inOrder(post, ["await notifyTaskCommented(", "NextResponse.json(result.comment, { status: 201 })"]), "新建：201 与原响应形状");
}

console.log("任务接线：@ 候选人");
{
  const route = read("src/app/api/tasks/[id]/mention-candidates/route.ts");
  const get = block(route, "export const GET");
  ok(inOrder(get, ["canUserViewTask(user, task)", '{ error: "任务不存在" }, { status: 404 }', "listTaskMentionCandidates("]), "看不到任务 → 404；看得到才列候选人");
  ok(/NextResponse\.json\(\{ members \}\)/.test(get), "返回 { members }");
  const mentions = read("src/lib/notifications/collab/mentions.ts");
  const list = block(mentions, "export async function listTaskMentionCandidates(");
  ok(/status: "active"/.test(list) && /user: \{ status: "active" \}/.test(list), "项目任务：组织的 active 成员、账号在职");
  ok(/userId: \{ not: callerId \}/.test(list), "不含调用人自己");
  ok(/orderBy: \{ user: \{ name: "asc" \} \}/.test(list) && /take: MENTION_CANDIDATE_MAX/.test(list), "按姓名排序，最多 200 人");
  const viewers = mentions.slice(
    mentions.indexOf("async function filterTaskViewers("),
    mentions.indexOf("export async function listTaskMentionCandidates("),
  );
  ok(/filterTaskViewers\(users, task\)/.test(list) && /canUserViewTask\(u, task\)/.test(viewers), "逐个按任务查看规则过滤");
  ok(/task\.creatorId, task\.assigneeId/.test(list), "没有项目的任务：只看创建人与负责人");
}

console.log("新文件不导入 LLM 客户端与对外邮件通道");
{
  const files = [
    "src/lib/notifications/collab/deliver.ts",
    "src/lib/notifications/collab/recipients.ts",
    "src/lib/notifications/collab/redact.ts",
    "src/lib/notifications/collab/mentions.ts",
    "src/lib/notifications/collab/events.ts",
    "src/lib/notifications/collab/mention-input.ts",
    "src/lib/notifications/collab/task-notify.ts",
    "src/lib/tasks/access.ts",
    "src/app/api/tasks/[id]/mention-candidates/route.ts",
  ];
  const banned = /from "(@\/lib\/ai\/[^"]*|openai|@anthropic-ai\/sdk|@\/lib\/google-email)"|EmailProvider/;
  for (const f of files) {
    const src = read(f);
    ok(src.length > 0 && !banned.test(src), `${f.replace("src/", "")} 不导入 LLM 客户端或 EmailProvider`);
  }
}

console.log(`\ncollab-wiring: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
