/**
 * 协作通知 COLLAB-2：事件通知
 * - 公共部分（design D1、D2）：收件人过滤、去重键、P2002、门禁、失败隔离——数据库与门禁都从参数注入
 * 运行：npx tsx src/lib/notifications/__tests__/collab-events.test.ts
 */

import {
  collabSourceKey,
  deliverCollabNotification,
  isUniqueViolation,
  type CollabDeliverDeps,
  type CollabEvent,
  type CollabNotificationRow,
} from "../collab/deliver";
import { filterCollabRecipients, normalizeCandidates } from "../collab/recipients";

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
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface FakeOpts {
  activeUsers?: string[];
  members?: Record<string, string[]>;
  gateOff?: string[];
  existing?: string[];
  p2002For?: string[];
  failCreateFor?: string[];
  failUserLookup?: boolean;
  failGateFor?: string[];
}

function fakeDeps(opts: FakeOpts = {}) {
  const created: CollabNotificationRow[] = [];
  const errors: string[] = [];
  const memberCalls: string[] = [];
  const existing = new Set(opts.existing ?? []);
  const deps: CollabDeliverDeps = {
    async findActiveUserIds(ids) {
      if (opts.failUserLookup) throw new Error("db down");
      const active = new Set(opts.activeUsers ?? ids);
      return ids.filter((id) => active.has(id));
    },
    async findActiveMemberIds(orgId, ids) {
      memberCalls.push(orgId);
      const members = new Set(opts.members?.[orgId] ?? []);
      return ids.filter((id) => members.has(id));
    },
    async shouldDeliver(userId) {
      if (opts.failGateFor?.includes(userId)) throw new Error("gate boom");
      return !(opts.gateOff ?? []).includes(userId);
    },
    async findBySourceKey(sourceKey) {
      return existing.has(sourceKey) ? { id: `old:${sourceKey}` } : null;
    },
    async createNotification(row) {
      if (opts.failCreateFor?.includes(row.userId)) throw new Error("insert failed");
      if (opts.p2002For?.includes(row.userId)) {
        existing.add(row.sourceKey);
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      created.push(row);
      return { id: `n${created.length}` };
    },
    logError(message) {
      errors.push(message);
    },
  };
  return { deps, created, errors, memberCalls };
}

function event(over: Partial<CollabEvent> = {}): CollabEvent {
  return {
    type: "task_assigned",
    priority: "high",
    title: "张三 把任务「复尺」指派给你",
    summary: "项目 金山湖 · 截止 2026-11-08",
    entityType: "task",
    entityId: "T1",
    eventKey: "1730800000000",
    orgId: "O1",
    projectId: "P1",
    actorId: "A",
    recipientIds: ["B"],
    metadata: { objectLabel: "复尺", dueAt: "2026-11-08" },
    ...over,
  };
}

async function main() {
  console.log("收件人：去重、排除操作人");
  ok(same(normalizeCandidates(["B", "A", null, "", "B", undefined, "C"], "A"), ["B", "C"]), "去掉空值、操作人与重复，保留先后顺序");
  ok(same(normalizeCandidates(["A"], "A"), []), "只有操作人 → 空");
  ok(same(normalizeCandidates(["B", "C"], null), ["B", "C"]), "没有操作人时只去重");

  console.log("收件人：在职、组织 active 成员");
  {
    const { deps, memberCalls } = fakeDeps({ activeUsers: ["B", "D"], members: { O1: ["B", "C"] } });
    const ids = await filterCollabRecipients(["A", "B", "C", "D", "B"], { orgId: "O1", actorId: "A" }, deps);
    ok(same(ids, ["B"]), "C 已离职、D 不是 O1 的 active 成员 → 只剩 B", ids);
    ok(same(memberCalls, ["O1"]), "按对象所属组织查成员");
  }
  {
    const { deps, memberCalls } = fakeDeps({ activeUsers: ["B", "C"] });
    const ids = await filterCollabRecipients(["B", "C"], { orgId: null, actorId: "A" }, deps);
    ok(same(ids, ["B", "C"]), "对象不属于组织 → 只看在职", ids);
    ok(memberCalls.length === 0, "对象不属于组织 → 不查成员");
  }
  {
    const { deps } = fakeDeps();
    const ids = await filterCollabRecipients(["A"], { orgId: "O1", actorId: "A" }, deps);
    ok(ids.length === 0, "没有候选人 → 空，不查库");
  }

  console.log("去重键");
  ok(collabSourceKey("mention", "M1", "created", "U1") === "mention:M1:created:U1", "<类型>:<对象 id>:<事件区分键>:<收件人 id>");
  ok(isUniqueViolation({ code: "P2002" }), "P2002 → 唯一约束冲突");
  ok(!isUniqueViolation({ code: "P2025" }) && !isUniqueViolation(new Error("x")) && !isUniqueViolation(null), "其他错误不算");

  console.log("写入");
  {
    const { deps, created, errors } = fakeDeps({ members: { O1: ["A", "B", "C"] } });
    const r = await deliverCollabNotification(event({ recipientIds: ["A", "B", "C", "B"] }), deps);
    ok(same(r.created, ["B", "C"]), "操作人不收、同一人只写一条", r);
    ok(errors.length === 0, "无错误日志");
    const row = created[0];
    ok(
      row.userId === "B" &&
        row.type === "task_assigned" &&
        row.category === "task_assigned" &&
        row.priority === "high" &&
        row.status === "unread" &&
        row.entityType === "task" &&
        row.entityId === "T1" &&
        row.projectId === "P1" &&
        row.orgId === "O1" &&
        row.title === "张三 把任务「复尺」指派给你" &&
        row.summary === "项目 金山湖 · 截止 2026-11-08",
      "通知行的各字段",
      row,
    );
    ok(row.sourceKey === "task_assigned:T1:1730800000000:B", "写入去重键", row.sourceKey);
    ok(row.metadata === JSON.stringify({ objectLabel: "复尺", dueAt: "2026-11-08" }), "metadata 存 JSON 字符串", row.metadata);
  }
  {
    const { deps, created } = fakeDeps({ members: { O1: ["B"] }, existing: ["task_assigned:T1:1730800000000:B"] });
    const r = await deliverCollabNotification(event(), deps);
    ok(created.length === 0 && same(r.existing, ["B"]), "去重键已存在 → 不再写，记为已存在", r);
  }
  {
    const { deps, created, errors } = fakeDeps({ members: { O1: ["B", "C"] }, p2002For: ["B"] });
    const r = await deliverCollabNotification(event({ recipientIds: ["B", "C"] }), deps);
    ok(same(r.existing, ["B"]) && same(r.created, ["C"]), "并发写同一去重键（P2002）→ 当作已存在，其他人照写", r);
    ok(errors.length === 0 && created.length === 1, "P2002 不记错误日志");
  }
  {
    const { deps, created } = fakeDeps({ members: { O1: ["B", "C"] }, gateOff: ["B"] });
    const r = await deliverCollabNotification(event({ recipientIds: ["B", "C"] }), deps);
    ok(same(r.gated, ["B"]) && created.every((x) => x.userId !== "B"), "门禁不通过 → 不写", r);
  }

  console.log("失败隔离");
  {
    const { deps, created, errors } = fakeDeps({ members: { O1: ["B", "C"] }, failCreateFor: ["B"] });
    let threw = false;
    let r;
    try {
      r = await deliverCollabNotification(event({ recipientIds: ["B", "C"] }), deps);
    } catch {
      threw = true;
    }
    ok(!threw, "写入出错 → 不外抛");
    ok(r && same(r.failed, ["B"]) && created.length === 1 && created[0].userId === "C", "一人写入出错，其他人照写", r);
    ok(errors.length === 1, "写入出错 → 记一条错误日志", errors);
  }
  {
    const { deps, created, errors } = fakeDeps({ failUserLookup: true });
    let threw = false;
    try {
      await deliverCollabNotification(event(), deps);
    } catch {
      threw = true;
    }
    ok(!threw && created.length === 0 && errors.length === 1, "查收件人出错 → 不外抛、不写、记日志", errors);
  }
  {
    const { deps, created, errors } = fakeDeps({ members: { O1: ["B", "C"] }, failGateFor: ["B"] });
    const r = await deliverCollabNotification(event({ recipientIds: ["B", "C"] }), deps);
    ok(same(r.failed, ["B"]) && created.length === 1 && errors.length === 1, "门禁判断出错 → 该人跳过并记日志，其他人照写", r);
  }

  console.log(`\ncollab-events: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
