/**
 * 主动提醒 — 定时任务为管理层补发（A-3b，openspec change org-cockpit-proactive-notify）测试：纯函数 + 假依赖 + 源码静态断言，无 DB。
 *   候选查询条件（角色 / 在职 / 30 天登录 / 排除平台管理员）、去重与排除、上限与按小时轮转、时间预算、单人失败隔离、
 *   只提醒不执行自动动作、定时任务两轮接入、既有调用方行为不变
 * 运行：npx tsx src/lib/proactive/__tests__/manager-notify.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MANAGER_ACTIVE_WINDOW_DAYS,
  MANAGER_NOTIFY_CAP,
  managerCandidateWhere,
  planManagerNotifyRun,
  runManagerNotify,
  type ManagerCandidate,
  type ManagerNotifyDeps,
} from "../manager-notify";

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
const ids = (list: ManagerCandidate[]) => list.map((x) => x.userId);

async function main() {
  console.log("manager-notify");

  console.log("\n候选范围");

  await ok("场景「长期未登录」/「平台管理员兼组织所有者」：查询条件 = 在职成员 + 账号在职 + 30 天内登录 + 管理层角色，排除平台 admin / super_admin", () => {
    const where = managerCandidateWhere(NOW);
    assert.deepEqual(where, {
      status: "active",
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
      now: NOW,
    });
    assert.deepEqual(ids(plan), ["u1", "u3"]);
  });

  console.log("\n上限与轮转");

  await ok("场景「超过上限」：150 人、上限 100 → 本轮 100 人，下一小时从后面接着，两轮覆盖全部", () => {
    const all = Array.from({ length: 150 }, (_, i) => c(`u${String(i).padStart(3, "0")}`));
    const h0 = new Date(Math.floor(NOW.getTime() / 3_600_000) * 3_600_000);
    const h1 = new Date(h0.getTime() + 3_600_000);
    const a = planManagerNotifyRun({ candidates: all, alreadyScanned: new Set(), now: h0 });
    const b = planManagerNotifyRun({ candidates: all, alreadyScanned: new Set(), now: h1 });
    assert.equal(a.length, MANAGER_NOTIFY_CAP);
    assert.equal(b.length, MANAGER_NOTIFY_CAP);
    assert.equal(new Set([...ids(a), ...ids(b)]).size, 150);
    // 不超上限时每轮全覆盖、顺序稳定
    const few = planManagerNotifyRun({ candidates: all.slice(0, 5).reverse(), alreadyScanned: new Set(), now: h1 });
    assert.deepEqual(ids(few), ["u000", "u001", "u002", "u003", "u004"]);
  });

  console.log("\n执行");

  function fakeDeps(over: Partial<{ candidates: ManagerCandidate[]; failFor: string; tickMs: number }> = {}) {
    const calls: Array<[string, string]> = [];
    let t = 0;
    const deps: ManagerNotifyDeps = {
      loadCandidates: async () => over.candidates ?? [c("u1", "boss"), c("u2")],
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

  await ok("场景「不执行自动动作」/ 运行结果：逐人只提醒，结果标 notify_only；单人失败不影响其他人", async () => {
    const f = fakeDeps({ failFor: "u1" });
    const r = await runManagerNotify({ now: NOW, alreadyScanned: new Set(), budgetMs: 10_000 }, f.deps);
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
    });
  });

  await ok("时间预算用完即停，剩下的留给后面几轮", async () => {
    const f = fakeDeps({ candidates: [c("u1"), c("u2"), c("u3")], tickMs: 50 });
    const r = await runManagerNotify({ now: NOW, alreadyScanned: new Set(), budgetMs: 100 }, f.deps);
    assert.deepEqual([r.results.length, r.planned, r.stoppedByBudget], [2, 3, true]);
    const none = await runManagerNotify({ now: NOW, alreadyScanned: new Set(), budgetMs: 0 }, fakeDeps().deps);
    assert.deepEqual([none.results.length, none.stoppedByBudget], [0, true]);
  });

  await ok("默认依赖：补发调 runProactiveScanForUser(..., { autoActions: false })；查询带上限", () => {
    const src = strip(read("src/lib/proactive/manager-notify.ts"));
    assert.match(src, /runProactiveScanForUser\(userId, platformRole, \{ autoActions: false \}\)/);
    assert.match(src, /where: managerCandidateWhere\(now\),/);
    assert.match(src, /take: 2000,/);
    assert.doesNotMatch(src, /executeAutoActions/);
  });

  console.log("\n接入点与既有行为");

  await ok("run-scan：autoActions 默认执行（不传 options 行为不变），为 false 时跳过自动动作；通知去重不变", () => {
    const src = strip(read("src/lib/proactive/run-scan.ts"));
    assert.match(src, /export async function runProactiveScanForUser\(userId: string, userRole: string, options\?: \{ autoActions\?: boolean \}\)/);
    assert.match(src, /const autoActions = prefs\.enabled && options\?\.autoActions !== false\s*\? await executeAutoActions\(userId, suggestions, prefs\)\s*: \[\];/);
    assert.match(strip(read("src/lib/proactive/notify.ts")), /sourceKey: `proactive:\$\{s\.dedupeKey\}`/);
  });

  await ok("POST /api/proactive/scan 未改：仍按当前用户扫描并执行其自动化", () => {
    assert.match(strip(read("src/app/api/proactive/scan/route.ts")), /const result = await runProactiveScanForUser\(user\.id, user\.role\);/);
  });

  await ok("场景「运行结果区分两轮」：定时任务先自动化一轮、再补发一轮（排除已处理、用剩余预算、单独兜错），元数据分别计数", () => {
    const src = strip(read("src/app/api/cron/proactive-scan/route.ts"));
    const auto = src.indexOf("await runProactiveScanForUser(preference.userId, preference.user.role)");
    const notify = src.indexOf("managers = await runManagerNotify({");
    assert.ok(auto > 0 && notify > auto, JSON.stringify({ auto, notify }));
    assert.match(src, /alreadyScanned: new Set\(results\.map\(\(r\) => r\.userId\)\),/);
    assert.match(src, /budgetMs: Math\.max\(0, RUN_BUDGET_MS - \(Date\.now\(\) - startedAt\)\),/);
    assert.match(src, /\} catch \(error\) \{\s*notifyOnlyError = /);
    assert.match(src, /mode: "automation",/);
    assert.match(src, /enabledUsers: automationUsers,\s*notifyOnlyUsers: managers\.results\.length,/);
    // 不新增 cron：vercel.json 里 proactive-scan 仍是每小时一条
    const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
    assert.deepEqual(vercel.crons.filter((x) => x.path === "/api/cron/proactive-scan"), [{ path: "/api/cron/proactive-scan", schedule: "15 * * * *" }]);
  });

  console.log(`\nmanager-notify: ${pass} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
