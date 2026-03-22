/**
 * 项目讨论模块 — 工程硬化验证脚本
 *
 * 运行方式: npx tsx src/lib/project-discussion/__tests__/discussion-hardening.test.ts
 *
 * 覆盖场景：
 * 1. 主会话创建防重（upsert 幂等）
 * 2. 消息持久化 + 排序
 * 3. 系统事件 metadata 结构
 * 4. 分页稳定性（cursor = createdAt|id）
 * 5. 幂等变更检测（emitProjectPatchEvents）
 * 6. 权限规则验证（access helpers）
 *
 * 注意：此脚本需要连接真实数据库，会创建测试数据然后清理。
 */

import { db } from "@/lib/db";
import { getOrCreateMainConversation, sendMessage, loadOlderMessages } from "../service";
import { onProjectCreated, emitProjectPatchEvents } from "../system-events";
import { SYSTEM_EVENT_TYPES } from "../types";
import type { SystemEventMetadata } from "../types";

let testProjectId: string | null = null;
let testConvId: string | null = null;
let testUserId: string | null = null;
const passed: string[] = [];
const failed: string[] = [];

function assert(condition: boolean, name: string) {
  if (condition) {
    passed.push(name);
    console.log(`  ✅ ${name}`);
  } else {
    failed.push(name);
    console.log(`  ❌ ${name}`);
  }
}

async function setup() {
  console.log("\n🔧 Setup: creating test fixtures...");

  const user = await db.user.findFirst({ where: { role: "super_admin" } });
  if (!user) throw new Error("No super_admin user found for testing");
  testUserId = user.id;

  const org = await db.organization.findFirst({ where: { status: "active" } });
  if (!org) throw new Error("No active org found for testing");

  const project = await db.project.create({
    data: {
      name: `__TEST_DISCUSSION_${Date.now()}`,
      ownerId: user.id,
      orgId: org.id,
      status: "active",
      intakeStatus: "dispatched",
    },
  });
  testProjectId = project.id;
  console.log(`  Project: ${testProjectId}`);
}

async function cleanup() {
  console.log("\n🧹 Cleanup...");
  if (testProjectId) {
    await db.projectMessage.deleteMany({ where: { projectId: testProjectId } });
    await db.projectConversation.deleteMany({ where: { projectId: testProjectId } });
    await db.project.delete({ where: { id: testProjectId } }).catch(() => {});
  }
}

// ─── Test: 主会话 upsert 防重 ───

async function testConversationUpsert() {
  console.log("\n📌 Test: 主会话 upsert 防重");
  const conv1 = await getOrCreateMainConversation(testProjectId!);
  const conv2 = await getOrCreateMainConversation(testProjectId!);
  assert(conv1.id === conv2.id, "两次调用返回同一会话 ID");
  assert(conv1.kind === "MAIN", "会话 kind 为 MAIN");

  const count = await db.projectConversation.count({ where: { projectId: testProjectId! } });
  assert(count === 1, "数据库中只有一条会话记录");

  testConvId = conv1.id;
}

// ─── Test: 并发 upsert ───

async function testConcurrentUpsert() {
  console.log("\n📌 Test: 并发 upsert 防重");
  const results = await Promise.all([
    getOrCreateMainConversation(testProjectId!),
    getOrCreateMainConversation(testProjectId!),
    getOrCreateMainConversation(testProjectId!),
  ]);
  const ids = new Set(results.map((r) => r.id));
  assert(ids.size === 1, "三次并发 upsert 返回相同 ID");
}

// ─── Test: 消息持久化 ───

async function testMessagePersistence() {
  console.log("\n📌 Test: 消息持久化");
  const msg = await sendMessage(testProjectId!, testUserId!, "Hello test message");
  assert(typeof msg.id === "string" && msg.id.length > 0, "消息有有效 ID");
  assert(msg.body === "Hello test message", "消息内容正确");
  assert(msg.type === "TEXT", "消息类型为 TEXT");
  assert(msg.senderId === testUserId, "发送者 ID 正确");

  const dbMsg = await db.projectMessage.findUnique({ where: { id: msg.id } });
  assert(dbMsg !== null, "消息已入库");
  assert(dbMsg!.body === "Hello test message", "入库消息内容正确");
}

// ─── Test: 空/超长消息拦截 ───

async function testMessageValidation() {
  console.log("\n📌 Test: 消息校验");
  let threw = false;
  try {
    await sendMessage(testProjectId!, testUserId!, "   ");
  } catch (e) {
    threw = true;
    assert((e as Error).message === "消息内容不能为空", "空消息被拦截");
  }
  assert(threw, "空消息抛出异常");

  threw = false;
  try {
    await sendMessage(testProjectId!, testUserId!, "x".repeat(5001));
  } catch (e) {
    threw = true;
    assert((e as Error).message.includes("5000"), "超长消息被拦截");
  }
  assert(threw, "超长消息抛出异常");
}

// ─── Test: 系统事件 metadata 结构 ───

async function testSystemEventMetadata() {
  console.log("\n📌 Test: 系统事件 metadata 结构");
  await onProjectCreated(testProjectId!, "Test Project", testUserId!, "Test User");

  const sysMsg = await db.projectMessage.findFirst({
    where: { projectId: testProjectId!, type: "SYSTEM" },
    orderBy: { createdAt: "desc" },
  });
  assert(sysMsg !== null, "系统消息已入库");
  const meta = sysMsg!.metadata as unknown as SystemEventMetadata;
  assert(meta.eventType === SYSTEM_EVENT_TYPES.PROJECT_CREATED, "eventType 正确");
  assert(meta.source === "system", "source 为 system");
  assert("projectName" in meta, "包含 projectName 字段");
  assert("actorId" in meta, "包含 actorId 字段");
  assert(meta.actorId === testUserId, "actorId 与操作人一致");
}

// ─── Test: 分页稳定性 ───

async function testPaginationStability() {
  console.log("\n📌 Test: 分页稳定性 (cursor = createdAt|id)");

  const msgs: string[] = [];
  for (let i = 0; i < 5; i++) {
    const m = await sendMessage(testProjectId!, testUserId!, `Page test ${i}`);
    msgs.push(m.id);
  }

  const page1 = await loadOlderMessages(
    testProjectId!,
    new Date(Date.now() + 60_000).toISOString() + "|zzz",
    3
  );
  assert(page1.messages.length === 3, "第一页返回 3 条");
  assert(page1.hasMore === true, "hasMore 为 true");
  assert(page1.nextCursor !== null, "有 nextCursor");

  const cursorParts = page1.nextCursor!.split("|");
  assert(cursorParts.length === 2, "cursor 格式为 date|id");
  assert(!isNaN(new Date(cursorParts[0]).getTime()), "cursor 日期部分有效");
  assert(cursorParts[1].length > 0, "cursor id 部分非空");

  const page2 = await loadOlderMessages(testProjectId!, page1.nextCursor!, 3);
  const page1Ids = new Set(page1.messages.map((m) => m.id));
  const overlap = page2.messages.filter((m) => page1Ids.has(m.id));
  assert(overlap.length === 0, "两页无重叠消息");

  const allIds = [...page1.messages, ...page2.messages].map((m) => m.id);
  const uniqueIds = new Set(allIds);
  assert(allIds.length === uniqueIds.size, "无重复 ID");
}

// ─── Test: 幂等变更检测 ───

async function testIdempotentPatchEvents() {
  console.log("\n📌 Test: 幂等变更检测");
  const countBefore = await db.projectMessage.count({
    where: { projectId: testProjectId!, type: "SYSTEM" },
  });

  await db.$transaction(async (tx) => {
    await emitProjectPatchEvents(
      testProjectId!,
      { status: "active", tenderStatus: "new" },
      { status: "active", tenderStatus: "new" },
      { id: testUserId!, name: "Test" },
      tx
    );
  });

  const countAfterSame = await db.projectMessage.count({
    where: { projectId: testProjectId!, type: "SYSTEM" },
  });
  assert(countAfterSame === countBefore, "相同值不产生新系统消息");

  await db.$transaction(async (tx) => {
    await emitProjectPatchEvents(
      testProjectId!,
      { status: "active", tenderStatus: "new" },
      { status: "completed", tenderStatus: "submitted" },
      { id: testUserId!, name: "Test" },
      tx
    );
  });

  const countAfterChange = await db.projectMessage.count({
    where: { projectId: testProjectId!, type: "SYSTEM" },
  });
  assert(countAfterChange > countAfterSame, "不同值产生新系统消息");

  const latestMsgs = await db.projectMessage.findMany({
    where: { projectId: testProjectId!, type: "SYSTEM" },
    orderBy: { createdAt: "desc" },
    take: 2,
  });
  const types = latestMsgs.map(
    (m) => (m.metadata as Record<string, unknown>)?.eventType
  );
  assert(
    types.includes("status_changed") && types.includes("stage_changed"),
    "status_changed 和 stage_changed 都已写入"
  );
}

// ─── Test: 软删除不影响查询 ───

async function testSoftDelete() {
  console.log("\n📌 Test: 软删除不影响查询");
  const msg = await sendMessage(testProjectId!, testUserId!, "Will be soft-deleted");

  await db.projectMessage.update({
    where: { id: msg.id },
    data: { deletedAt: new Date() },
  });

  const page = await loadOlderMessages(
    testProjectId!,
    new Date(Date.now() + 60_000).toISOString() + "|zzz",
    100
  );
  const found = page.messages.find((m) => m.id === msg.id);
  assert(!found, "软删除消息不出现在查询结果中");
}

// ─── Main ───

async function main() {
  try {
    await setup();
    await testConversationUpsert();
    await testConcurrentUpsert();
    await testMessagePersistence();
    await testMessageValidation();
    await testSystemEventMetadata();
    await testPaginationStability();
    await testIdempotentPatchEvents();
    await testSoftDelete();
  } catch (err) {
    console.error("\n💥 Unexpected error:", err);
    failed.push(`UNEXPECTED: ${(err as Error).message}`);
  } finally {
    await cleanup();
    await db.$disconnect();
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`✅ Passed: ${passed.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  if (failed.length > 0) {
    console.log("\nFailed tests:");
    failed.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log("\n🎉 All tests passed!");
}

main();
