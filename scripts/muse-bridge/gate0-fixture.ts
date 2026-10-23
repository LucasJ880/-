/**
 * GATE-0 固定数据：造一个 [MUSE-QA] 投标项目 + 一张待批 PendingAction（type=grader.project_task，批准只会建一条 Task，无外发副作用）。
 * createDraft 会触发 P0-6 挂钩 → approval.requested 事件进 outbox → /events 能拉到 → 从 Muse 批准/驳回可闭环。
 *
 * 运行：
 *   MUSE_BRIDGE_ENABLED=1 npx tsx scripts/muse-bridge/gate0-fixture.ts --org <orgId> --email <青砚邮箱>
 *   npx tsx scripts/muse-bridge/gate0-fixture.ts --org <orgId> --cleanup      # 删除 [MUSE-QA] 数据
 *
 * 只操作 [MUSE-QA] 前缀数据；assertSafeTestDatabase 拒绝生产库。
 */

import { PrismaClient } from "@prisma/client";
import { assertSafeTestDatabase } from "../../src/lib/testing/assert-safe-test-database";

assertSafeTestDatabase({ scriptName: "scripts/muse-bridge/gate0-fixture.ts" });

const db = new PrismaClient();
const PREFIX = "[MUSE-QA]";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
}

async function cleanup(orgId: string) {
  const projects = await db.project.findMany({ where: { orgId, name: { startsWith: PREFIX } }, select: { id: true } });
  const ids = projects.map((p) => p.id);
  const pa = await db.pendingAction.deleteMany({ where: { orgId, title: { startsWith: PREFIX } } });
  const nt = await db.notification.deleteMany({ where: { orgId, projectId: { in: ids } } });
  const tk = await db.task.deleteMany({ where: { projectId: { in: ids } } }).catch(() => ({ count: 0 }));
  const pj = await db.project.deleteMany({ where: { id: { in: ids } } });
  console.log(`✓ cleanup: projects=${pj.count} pendingActions=${pa.count} notifications=${nt.count} tasks=${tk.count}`);
}

async function main() {
  const orgId = arg("org");
  if (!orgId) throw new Error("缺 --org <orgId>");
  if (process.argv.includes("--cleanup")) return cleanup(orgId);

  const email = arg("email");
  if (!email) throw new Error("缺 --email <青砚邮箱>（将作为项目 owner 与审批收件人）");
  if (process.env.MUSE_BRIDGE_ENABLED !== "1") throw new Error("请以 MUSE_BRIDGE_ENABLED=1 运行，否则挂钩会短路、事件不会落库");

  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`用户不存在：${email}`);
  const member = await db.organizationMember.findFirst({ where: { orgId, userId: user.id, status: "active" } });
  if (!member) throw new Error(`${email} 不是该组织有效成员`);

  const close = new Date(Date.now() + 9 * 86_400_000);
  const project = await db.project.create({
    data: {
      orgId,
      ownerId: user.id,
      name: `${PREFIX} Halifax 媒体监测服务（Muse 联调）`,
      workDomain: "tender",
      tenderStatus: "pursuing",
      closeDate: close,
      distributedAt: new Date(),
      interpretedAt: new Date(),
      clientOrganization: "Halifax Regional Municipality",
      solicitationNumber: "MUSE-QA-0001",
    },
    select: { id: true, name: true },
  });
  console.log(`✓ 项目 ${project.id}  ${project.name}  截标 ${close.toISOString().slice(0, 10)}`);

  // 走正式入口 createDraft → 触发 P0-6 挂钩
  const { createDraft } = await import("../../src/lib/pending-actions/drafts");
  const res = await createDraft({
    type: "grader.project_task",
    title: `${PREFIX} 补齐保险额度证明（强制要求 R-07）`,
    preview: "招标文件 §4.2 要求 CGL ≥ $5M，当前资料库无对应证明，批准后建一条任务给项目负责人。",
    payload: {
      projectId: project.id,
      title: `${PREFIX} 补齐保险额度证明`,
      reason: "强制要求 R-07 无证据",
      priority: "high",
      metadata: { orgId, projectId: project.id }, // executor 以此做跨组织校验，缺失会「缺少组织信息，拒绝写入」
    },
    userId: user.id,
    orgId,
    projectId: project.id,
    ttlHours: 48,
    idempotencyKey: `muse-qa:${project.id}:insurance`,
  });
  if (!res.success) throw new Error(`createDraft 失败：${res.error}`);
  const actionId = (res.data as { actionId?: string } | null)?.actionId ?? JSON.stringify(res.data);
  console.log(`✓ PendingAction ${actionId}`);

  // 等挂钩（void 异步）落库
  await new Promise((r) => setTimeout(r, 1500));
  const ev = await db.notification.findFirst({
    where: { orgId, projectId: project.id, category: "muse_bridge" },
    select: { id: true, title: true, summary: true, createdAt: true },
  });
  if (ev) console.log(`✓ approval.requested 已进 outbox：${ev.title} — ${ev.summary}`);
  else console.log("✗ outbox 里没有 muse_bridge 事件：检查 MUSE_BRIDGE_ENABLED 是否生效、以及 drafts.ts 挂钩是否在");

  console.log("\n接下来：");
  console.log(`  PROJECT_ID=${project.id} APPROVAL_ID=${actionId}  →  bash scripts/muse-bridge/smoke-gate0.sh`);
}

main()
  .catch((e) => {
    console.error("失败：", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
