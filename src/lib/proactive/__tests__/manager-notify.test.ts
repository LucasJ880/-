/**
 * 主动提醒 — 定时任务为管理层补发（A-3b，openspec change org-cockpit-proactive-notify）测试：纯函数 + 假依赖 + 源码静态断言，无 DB。
 *   候选查询条件（角色 / 在职 / 组织在用 / 30 天登录 / 排除平台管理员）、去重与排除、上限与游标续排（含预算截断）、时间预算、
 *   单人失败隔离、只提醒不执行自动动作、定时任务两轮（计数 / mode / 整轮失败计入）、通知按用户去重（全局唯一 sourceKey）、既有调用方行为不变
 * 运行：npx tsx src/lib/proactive/__tests__/manager-notify.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MANAGER_ACTIVE_WINDOW_DAYS,
  MANAGER_CANDIDATE_LIMIT,
  MANAGER_NOTIFY_CAP,
  PROACTIVE_RUN_BUDGET_MS,
  candidateSegmentWhere,
  managerCandidateWhere,
  planManagerNotifyRun,
  resumeAfterOf,
  resumeRunWhere,
  runManagerNotify,
  runProactiveScanCron,
  type ManagerCandidate,
  type ManagerNotifyDeps,
  type ManagerNotifyRun,
  type ProactiveCronDeps,
} from "../manager-notify";
import {
  legacyProactiveSourceKey,
  proactiveSourceKey,
  syncSuggestionsToNotifications,
  type ProactiveNotificationRow,
  type ProactiveNotifyDeps,
} from "../notify";
import type { ProactiveSuggestion } from "../types";

let pass = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
const NOW = new Date("2026-10-26T17:15:00Z");
const c = (userId: string, platformRole = "user"): ManagerCandidate => ({ userId, platformRole });
const ids = (list: Array<{ userId: string }>) => list.map((x) => x.userId);
const users = (n: number) => Array.from({ length: n }, (_, i) => c(`u${String(i).padStart(4, "0")}`));

/** 假依赖：每次扫描耗时 tickMs；failFor 抛错 */
function fakeNotifyDeps(over: Partial<{ candidates: ManagerCandidate[]; failFor: string; tickMs: number; truncated: boolean }> = {}) {
  const calls: Array<[string, string]> = [];
  let t = 0;
  const deps: ManagerNotifyDeps = {
    loadCandidates: async () => ({ candidates: over.candidates ?? [c("u1", "boss"), c("u2")], truncated: over.truncated ?? false }),
    scanNotifyOnly: async (userId, role) => {
      calls.push([userId, role]);
      t += over.tickMs ?? 1;
      if (userId === over.failFor) throw new Error("boom");
      return { suggestions: 3, notifications: 1 };
    },
    nowMs: () => t,
  };
  return { deps, calls };
}

/** 假 Notification 表：sourceKey 全局唯一（与 prisma/schema.prisma `sourceKey String? @unique` 同语义），createMany 冲突跳过 */
function fakeNotificationTable(seed: Array<{ userId: string; sourceKey: string }> = []) {
  const rows = [...seed];
  const deps: ProactiveNotifyDeps = {
    existingKeys: async (userId, keys) => rows.filter((r) => r.userId === userId && keys.includes(r.sourceKey)).map((r) => r.sourceKey),
    createMany: async (data: ProactiveNotificationRow[]) => {
      let count = 0;
      for (const d of data) {
        if (rows.some((r) => r.sourceKey === d.sourceKey)) continue;
        rows.push({ userId: d.userId, sourceKey: d.sourceKey });
        count++;
      }
      return count;
    },
  };
  return { rows, deps };
}

const suggestion = (dedupeKey: string, severity: ProactiveSuggestion["severity"] = "urgent"): ProactiveSuggestion => ({
  id: dedupeKey,
  projectId: "P1",
  kind: "deadline_approaching",
  severity,
  title: "截标临近",
  description: "项目 2 天后截标",
  suggestedAction: null,
  dedupeKey,
  createdAt: NOW.toISOString(),
});

async function main() {
  console.log("manager-notify");

  console.log("\n候选范围");

  await ok("场景「长期未登录」/「平台管理员兼组织所有者」：查询条件 = 在职成员 + 组织在用 + 账号在职 + 30 天内登录 + 管理层角色，排除平台 admin / super_admin", () => {
    const where = managerCandidateWhere(NOW);
    assert.deepEqual(where, {
      status: "active",
      org: { status: "active" },
      user: {
        status: "active",
        lastLoginAt: { gte: new Date(NOW.getTime() - MANAGER_ACTIVE_WINDOW_DAYS * 86_400_000) },
        role: { notIn: ["admin", "super_admin"] },
      },
      OR: [{ role: { in: ["org_owner", "org_admin"] } }, { user: { role: { in: ["boss", "manager"] } } }],
    });
    assert.equal(MANAGER_ACTIVE_WINDOW_DAYS, 30);
    // 45 天前登录的人落在窗口外
    assert.ok(new Date(NOW.getTime() - 45 * 86_400_000) < where.user.lastLoginAt.gte);
  });

  await ok("场景「开了自动化偏好的管理层」：自动化一轮处理过的不重复；同一人多个组织只算一次；平台管理员再排除一次", () => {
    const plan = planManagerNotifyRun({
      candidates: [c("u3"), c("u1", "boss"), c("u1", "boss"), c("u2"), c("u_admin", "admin"), c("u_sa", "super_admin")],
      alreadyScanned: new Set(["u2"]),
      resumeAfter: null,
    });
    assert.deepEqual(ids(plan), ["u1", "u3"]);
  });

  console.log("\n上限与游标续排");

  await ok("场景「超过上限」：150 人、上限 100 → 本轮 100 人，下一轮从本轮最后一人之后接着，两轮覆盖全部", () => {
    const all = users(150);
    const a = planManagerNotifyRun({ candidates: all, alreadyScanned: new Set(), resumeAfter: null });
    const b = planManagerNotifyRun({ candidates: all, alreadyScanned: new Set(), resumeAfter: a[a.length - 1].userId });
    assert.equal(a.length, MANAGER_NOTIFY_CAP);
    assert.equal(b.length, MANAGER_NOTIFY_CAP);
    assert.deepEqual([a[0].userId, b[0].userId], ["u0000", "u0100"]);
    assert.equal(new Set([...ids(a), ...ids(b)]).size, 150);
  });

  await ok("游标：从第一个 userId 大于游标的人开始、循环到开头；游标在末尾或游标那人已不在候选里也能接上", () => {
    const five = [c("a"), c("c"), c("e"), c("g"), c("i")];
    const plan = (resumeAfter: string | null, cap?: number) => ids(planManagerNotifyRun({ candidates: five, alreadyScanned: new Set(), resumeAfter, cap }));
    assert.deepEqual(plan(null), ["a", "c", "e", "g", "i"]);
    assert.deepEqual(plan("e"), ["g", "i", "a", "c", "e"]);
    assert.deepEqual(plan("d"), ["e", "g", "i", "a", "c"]); // d 已不在候选里
    assert.deepEqual(plan("z"), ["a", "c", "e", "g", "i"]); // 游标在末尾之后 → 从头
    assert.deepEqual(plan("c", 2), ["e", "g"]);
    assert.deepEqual(planManagerNotifyRun({ candidates: [], alreadyScanned: new Set(), resumeAfter: "x" }), []);
  });

  await ok("场景「预算截断后接着处理」：每轮只处理得完一部分人时，连续若干轮覆盖全部（80 / 100 / 200 / 250 人 × 每轮 40 / 60 人）", async () => {
    for (const [n, perRun] of [
      [80, 40],
      [100, 60],
      [200, 60],
      [250, 40],
    ] as const) {
      const all = users(n);
      const seen = new Set<string>();
      let resumeAfter: string | null = null;
      const runs = Math.ceil(n / perRun);
      for (let i = 0; i < runs; i++) {
        // 每次扫描 1ms、预算 perRun ms → 本轮恰好处理 perRun 人
        const r = await runManagerNotify({ now: NOW, alreadyScanned: new Set(), budgetMs: perRun, resumeAfter }, fakeNotifyDeps({ candidates: all }).deps);
        for (const x of r.results) seen.add(x.userId);
        resumeAfter = r.lastUserId ?? resumeAfter;
      }
      assert.equal(seen.size, n, `n=${n} perRun=${perRun}`);
    }
  });

  console.log("\n执行");

  await ok("场景「不执行自动动作」/ 运行结果：逐人只提醒，结果标 notify_only；单人失败不影响其他人；记下最后处理的人", async () => {
    const f = fakeNotifyDeps({ failFor: "u1" });
    const r = await runManagerNotify({ now: NOW, alreadyScanned: new Set(), budgetMs: 10_000, resumeAfter: null }, f.deps);
    assert.deepEqual(f.calls, [
      ["u1", "boss"],
      ["u2", "user"],
    ]);
    assert.deepEqual(r, {
      results: [
        { userId: "u1", mode: "notify_only", error: "boom" },
        { userId: "u2", mode: "notify_only", suggestions: 3, notifications: 1 },
      ],
      planned: 2,
      stoppedByBudget: false,
      candidatesTruncated: false,
      lastUserId: "u2",
    });
  });

  await ok("时间预算用完即停，剩下的由游标留给后面几轮；候选读满上限时标出", async () => {
    const f = fakeNotifyDeps({ candidates: [c("u1"), c("u2"), c("u3")], tickMs: 50, truncated: true });
    const r = await runManagerNotify({ now: NOW, alreadyScanned: new Set(), budgetMs: 100, resumeAfter: null }, f.deps);
    assert.deepEqual([r.results.length, r.planned, r.stoppedByBudget, r.lastUserId, r.candidatesTruncated], [2, 3, true, "u2", true]);
    const none = await runManagerNotify({ now: NOW, alreadyScanned: new Set(), budgetMs: 0, resumeAfter: null }, fakeNotifyDeps().deps);
    assert.deepEqual([none.results.length, none.stoppedByBudget, none.lastUserId], [0, true, null]);
  });

  await ok("运行记录游标：只读本定时任务已完成的运行；metadata 里没有或格式不对 → null", () => {
    assert.deepEqual(resumeRunWhere(), { automationKey: "proactive-scan", status: { in: ["succeeded", "partial"] } });
    assert.equal(resumeAfterOf({ notifyOnlyResumeAfter: "u9" }), "u9");
    for (const bad of [null, undefined, "u9", ["u9"], {}, { notifyOnlyResumeAfter: 3 }, { notifyOnlyResumeAfter: "" }]) assert.equal(resumeAfterOf(bad), null);
  });

  console.log("\n定时任务两轮");

  function fakeCron(over: Partial<{ automation: string[]; disabled: string[]; failAutomation: string; notify: (input: Parameters<ProactiveCronDeps["notifyManagers"]>[0]) => Promise<ManagerNotifyRun>; resumeAfter: string | null; resumeFails: boolean; automationMs: number }> = {}) {
    const seen: Array<Parameters<ProactiveCronDeps["notifyManagers"]>[0]> = [];
    let clock = NOW.getTime();
    const deps: ProactiveCronDeps = {
      nowMs: () => clock,
      loadAutomationUsers: async () => (over.automation ?? ["a1", "a2", "a3"]).map((userId) => ({ userId, role: "user" })),
      automationEnabled: async (userId) => !(over.disabled ?? []).includes(userId),
      scanWithAutomation: async (userId) => {
        clock += over.automationMs ?? 0;
        if (userId === over.failAutomation) throw new Error("scan failed");
        return { suggestions: 2, actions: 1, notifications: 1 };
      },
      loadResumeAfter: async () => {
        if (over.resumeFails) throw new Error("db down");
        return over.resumeAfter ?? null;
      },
      notifyManagers: async (input) => {
        seen.push(input);
        if (over.notify) return over.notify(input);
        const results = ["m1", "m2", "m3", "m4", "m5"].map((userId) => ({ userId, mode: "notify_only" as const, suggestions: 1, notifications: 1 }));
        return { results, planned: 5, stoppedByBudget: false, candidatesTruncated: false, lastUserId: "m5" };
      },
    };
    return { deps, seen };
  }

  await ok("场景「运行结果区分两轮」：自动化 3 人、补发 5 人 → 3 条 automation、5 条 notify_only，元数据分别计 3 与 5；补发排除自动化一轮的人、用剩余预算、带上一轮游标", async () => {
    const f = fakeCron({ resumeAfter: "m0" });
    const out = await runProactiveScanCron(f.deps);
    assert.deepEqual(out.data.users.map((u) => u.mode), ["automation", "automation", "automation", "notify_only", "notify_only", "notify_only", "notify_only", "notify_only"]);
    assert.deepEqual(out.data.users[0], { userId: "a1", mode: "automation", suggestions: 2, actions: 1, notifications: 1 });
    assert.deepEqual([out.processedCount, out.succeededCount, out.failedCount], [8, 8, 0]);
    assert.deepEqual(out.metadata, {
      enabledUsers: 3,
      notifyOnlyUsers: 5,
      notifyOnlyPlanned: 5,
      notifyOnlyStoppedByBudget: false,
      notifyOnlyCandidatesTruncated: false,
      notifyOnlyResumeAfter: "m5",
    });
    assert.deepEqual([...f.seen[0].alreadyScanned], ["a1", "a2", "a3"]);
    assert.equal(f.seen[0].budgetMs, PROACTIVE_RUN_BUDGET_MS);
    assert.equal(f.seen[0].resumeAfter, "m0");
    assert.equal(f.seen[0].now.getTime(), NOW.getTime());
  });

  await ok("补发用剩余预算与当前时刻：自动化一轮用掉 150 秒 → 补发预算 90 秒，now 为补发开始时刻；用超了预算为 0", async () => {
    const f = fakeCron({ automationMs: 50_000 });
    await runProactiveScanCron(f.deps);
    assert.equal(f.seen[0].budgetMs, PROACTIVE_RUN_BUDGET_MS - 150_000);
    assert.equal(f.seen[0].now.getTime(), NOW.getTime() + 150_000);
    const over = fakeCron({ automationMs: 100_000 });
    await runProactiveScanCron(over.deps);
    assert.equal(over.seen[0].budgetMs, 0);
  });

  await ok("自动化一轮：关了自动化的跳过；单人失败记 error 且计失败、仍进入已处理名单", async () => {
    const f = fakeCron({ disabled: ["a2"], failAutomation: "a3" });
    const out = await runProactiveScanCron(f.deps);
    assert.deepEqual(ids(out.data.users.filter((u) => u.mode === "automation")), ["a1", "a3"]);
    assert.equal(out.data.users[1].error, "scan failed");
    assert.deepEqual([out.failedCount, out.metadata!.enabledUsers], [1, 2]);
    assert.deepEqual([...f.seen[0].alreadyScanned], ["a1", "a3"]);
  });

  await ok("补发整轮出错：记 notifyOnlyError、运行记 partial（计数仍按人），自动化一轮结果保留，游标沿用上一轮", async () => {
    const f = fakeCron({
      resumeAfter: "m2",
      notify: async () => {
        throw new Error("candidates query failed");
      },
    });
    const out = await runProactiveScanCron(f.deps);
    assert.equal(out.data.users.length, 3);
    assert.equal(out.status, "partial");
    assert.deepEqual([out.processedCount, out.succeededCount, out.failedCount], [3, 3, 0]);
    assert.equal(out.metadata!.notifyOnlyError, "candidates query failed");
    assert.equal(out.metadata!.notifyOnlyResumeAfter, "m2");
  });

  await ok("游标读不到时从头开始、不影响本轮并在元数据记下；一个都没补发时沿用上一轮游标；正常时不标 partial", async () => {
    const f = fakeCron({ resumeFails: true });
    const failed = await runProactiveScanCron(f.deps);
    assert.equal(f.seen[0].resumeAfter, null);
    assert.equal(failed.metadata!.notifyOnlyResumeError, "db down");
    assert.equal(failed.status, undefined);
    const empty = fakeCron({ resumeAfter: "m3", notify: async () => ({ results: [], planned: 0, stoppedByBudget: true, candidatesTruncated: false, lastUserId: null }) });
    const out = await runProactiveScanCron(empty.deps);
    assert.equal(out.metadata!.notifyOnlyResumeAfter, "m3");
  });

  await ok("候选分段：游标之后（gt）/ 从头到游标（lte）/ 不分段", () => {
    assert.deepEqual(candidateSegmentWhere(NOW, { gt: "u5" }), { ...managerCandidateWhere(NOW), userId: { gt: "u5" } });
    assert.deepEqual(candidateSegmentWhere(NOW, { lte: "u5" }), { ...managerCandidateWhere(NOW), userId: { lte: "u5" } });
    assert.deepEqual(candidateSegmentWhere(NOW, null), managerCandidateWhere(NOW));
  });

  await ok("场景「候选超过读取上限」：2100 位管理层、每段只读 2000 行 → 游标在查询里，21 轮内每个人都被处理（排在最后的 100 人不被永久跳过）", async () => {
    const all = users(2100);
    // 假 DB：与默认依赖同一分段规则（游标之后一段 + 从头一段，各按 userId 升序取 MANAGER_CANDIDATE_LIMIT 行）
    const loadCandidates: ManagerNotifyDeps["loadCandidates"] = async (_now, resumeAfter) => {
      const after = resumeAfter ? all.filter((x) => x.userId > resumeAfter).slice(0, MANAGER_CANDIDATE_LIMIT) : [];
      const head = all.filter((x) => resumeAfter === null || x.userId <= resumeAfter).slice(0, MANAGER_CANDIDATE_LIMIT);
      return { candidates: [...after, ...head], truncated: after.length >= MANAGER_CANDIDATE_LIMIT || head.length >= MANAGER_CANDIDATE_LIMIT };
    };
    const seen = new Set<string>();
    let resumeAfter: string | null = null;
    for (let hour = 0; hour < 21; hour++) {
      const r = await runManagerNotify({ now: NOW, alreadyScanned: new Set(), budgetMs: 10_000, resumeAfter }, { ...fakeNotifyDeps().deps, loadCandidates });
      for (const x of r.results) seen.add(x.userId);
      resumeAfter = r.lastUserId ?? resumeAfter;
    }
    assert.equal(seen.size, 2100);
    assert.ok(seen.has("u2099"));
  });

  await ok("多轮定时任务端到端：游标经运行记录 metadata 传到下一轮，预算截断下若干小时内每位管理层都被处理", async () => {
    const all = users(130);
    const seen = new Set<string>();
    let lastMetadata: unknown = null;
    for (let hour = 0; hour < 4; hour++) {
      const notifyDeps = fakeNotifyDeps({ candidates: all }).deps;
      const deps: ProactiveCronDeps = {
        ...fakeCron({ automation: [] }).deps,
        loadResumeAfter: async () => resumeAfterOf(lastMetadata),
        // 每轮只来得及处理 40 人
        notifyManagers: (input) => runManagerNotify({ ...input, budgetMs: 40 }, notifyDeps),
      };
      const out = await runProactiveScanCron(deps);
      for (const u of out.data.users) seen.add(u.userId);
      lastMetadata = out.metadata;
    }
    assert.equal(seen.size, 130);
  });

  console.log("\n通知按用户去重");

  await ok("场景「同组织两位管理层都收到」：同一条建议分别写给两人，各一条（sourceKey 带 userId，不再被先扫到的人占掉）", async () => {
    const table = fakeNotificationTable();
    const s = [suggestion("deadline:P1:3d")];
    assert.equal(await syncSuggestionsToNotifications("owner_A", s, table.deps), 1);
    assert.equal(await syncSuggestionsToNotifications("admin_B", s, table.deps), 1);
    assert.deepEqual(table.rows, [
      { userId: "owner_A", sourceKey: proactiveSourceKey("owner_A", "deadline:P1:3d") },
      { userId: "admin_B", sourceKey: proactiveSourceKey("admin_B", "deadline:P1:3d") },
    ]);
    assert.equal(proactiveSourceKey("u1", "k"), "proactive:u1:k");
  });

  await ok("场景「同一条提醒不重复」：连续两轮同一条建议，该用户只有一条；本人名下已有旧格式 key 的视为已发；info 级不写", async () => {
    const table = fakeNotificationTable([
      { userId: "u_old", sourceKey: legacyProactiveSourceKey("deadline:P1:3d") },
      { userId: "someone_else", sourceKey: legacyProactiveSourceKey("opendate:P2:1d") },
    ]);
    const s = [suggestion("deadline:P1:3d"), suggestion("opendate:P2:1d", "warning"), suggestion("stage:P3", "info")];
    assert.equal(await syncSuggestionsToNotifications("u1", s, table.deps), 2);
    assert.equal(await syncSuggestionsToNotifications("u1", s, table.deps), 0);
    assert.equal(table.rows.filter((r) => r.userId === "u1").length, 2);
    // 旧格式 key 在本人名下 → 不重发；在别人名下 → 不影响本人
    assert.equal(await syncSuggestionsToNotifications("u_old", s, table.deps), 1);
    assert.deepEqual(table.rows.filter((r) => r.userId === "u_old").map((r) => r.sourceKey), [legacyProactiveSourceKey("deadline:P1:3d"), proactiveSourceKey("u_old", "opendate:P2:1d")]);
  });

  await ok("返回实际新建条数：写入时冲突被跳过的不算", async () => {
    const table = fakeNotificationTable();
    const racing: ProactiveNotifyDeps = {
      existingKeys: async () => [],
      createMany: async (rows) => {
        // 并发：同一刻另一处已写入第一条
        table.rows.push({ userId: rows[0].userId, sourceKey: rows[0].sourceKey });
        return table.deps.createMany(rows);
      },
    };
    assert.equal(await syncSuggestionsToNotifications("u1", [suggestion("k1"), suggestion("k2")], racing), 1);
  });

  console.log("\n接入点与既有行为");

  await ok("默认依赖：补发调 runProactiveScanForUser(..., { autoActions: false })；候选按 userId 排序、带上限；自动化一轮查询与调用不变", () => {
    const src = strip(read("src/lib/proactive/manager-notify.ts"));
    assert.match(src, /runProactiveScanForUser\(userId, platformRole, \{ autoActions: false \}\)/);
    assert.match(src, /orderBy: \[\{ userId: "asc" \}, \{ id: "asc" \}\],\s*take: MANAGER_CANDIDATE_LIMIT,/);
    assert.match(src, /resumeAfter \? segment\(candidateSegmentWhere\(now, \{ gt: resumeAfter \}\)\) : Promise\.resolve\(\[\]\),\s*segment\(candidateSegmentWhere\(now, resumeAfter \? \{ lte: resumeAfter \} : null\)\),/);
    assert.match(src, /truncated: after\.length >= MANAGER_CANDIDATE_LIMIT \|\| head\.length >= MANAGER_CANDIDATE_LIMIT,/);
    // 通知默认依赖：只查本人名下的 key（否则别人名下的旧 key 会挡住本人）；冲突跳过并返回实际条数
    const notifySrc = strip(read("src/lib/proactive/notify.ts"));
    assert.match(notifySrc, /db\.notification\.findMany\(\{ where: \{ userId, sourceKey: \{ in: keys \} \}, select: \{ sourceKey: true \} \}\)/);
    assert.match(notifySrc, /const \{ count \} = await db\.notification\.createMany\(\{ data: rows, skipDuplicates: true \}\);\s*return count;/);
    assert.equal(MANAGER_CANDIDATE_LIMIT, 2000);
    assert.match(src, /where: \{ metadata: \{ not: null \}, user: \{ status: "active" \} \},\s*select: \{ userId: true, user: \{ select: \{ role: true \} \} \},\s*orderBy: \{ updatedAt: "asc" \},\s*take: 100,/);
    assert.match(src, /const r = await runProactiveScanForUser\(userId, role\);/);
    assert.match(src, /where: resumeRunWhere\(\), orderBy: \{ startedAt: "desc" \}/);
    assert.doesNotMatch(src, /executeAutoActions/);
  });

  await ok("run-scan：autoActions 默认执行（不传 options 行为不变），为 false 时跳过自动动作；写通知走按用户去重", () => {
    const src = strip(read("src/lib/proactive/run-scan.ts"));
    assert.match(src, /export async function runProactiveScanForUser\(userId: string, userRole: string, options\?: \{ autoActions\?: boolean \}\)/);
    assert.match(src, /const autoActions = prefs\.enabled && options\?\.autoActions !== false\s*\? await executeAutoActions\(userId, suggestions, prefs\)\s*: \[\];/);
    assert.match(src, /await syncSuggestionsToNotifications\(userId, suggestions\);/);
    assert.match(strip(read("src/lib/proactive/notify.ts")), /const sourceKey = proactiveSourceKey\(userId, s\.dedupeKey\);/);
  });

  await ok("POST /api/proactive/scan 未改：仍按当前用户扫描并执行其自动化", () => {
    assert.match(strip(read("src/app/api/proactive/scan/route.ts")), /const result = await runProactiveScanForUser\(user\.id, user\.role\);/);
  });

  await ok("定时任务接入：runTrackedAutomation(\"proactive-scan\") 包住两轮主体；不新增 cron", () => {
    const src = strip(read("src/app/api/cron/proactive-scan/route.ts"));
    // 字面量 "proactive-scan"：schedule.test.ts 按路由文件里的 key 字面量核对调度
    assert.match(src, /const data = await runTrackedAutomation\("proactive-scan", \(\) => runProactiveScanCron\(\)\);/);
    assert.match(src, /export const maxDuration = 300;/);
    const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
    assert.deepEqual(vercel.crons.filter((x) => x.path === "/api/cron/proactive-scan"), [{ path: "/api/cron/proactive-scan", schedule: "15 * * * *" }]);
  });

  console.log(`\nmanager-notify: ${pass} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
