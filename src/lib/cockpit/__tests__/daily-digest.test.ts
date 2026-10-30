/**
 * A-5 夜间岗位日结（openspec change org-cockpit-daily-digest，spec cockpit/post-daily-digest）
 * 纯函数 + 假依赖 + 源码断言，无 DB。
 * 运行：npx tsx src/lib/cockpit/__tests__/daily-digest.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTOMATION_REGISTRY, orgsAtLocalHour } from "@/lib/automation/registry";
import { AUDIT_ACTION_LABELS, auditSource } from "../audit-labels";
import {
  DIGEST_COUNT_FIELDS,
  POST_DAILY_DIGEST_ACTION,
  POST_DAILY_DIGEST_AUTOMATION_KEY,
  POST_DAILY_DIGEST_HOURS,
  buildPostDailyDigest,
  digestDayFor,
  postDailyDigestExistingWhere,
  postDailyDigestLockKey,
  runPostDailyDigest,
  runPostDailyDigests,
  type PostDailyDigest,
  type PostDailyDigestDeps,
  type PostDailyDigestOrg,
} from "../daily-digest";
import { postForAutomation } from "../posts";
import { AUTOMATION_SCHEDULES } from "../schedule";
import {
  WORKLOAD_MIN_DAYS,
  WORKLOAD_ROW_ORDER,
  emptyCounts,
  localDayKeys,
  workloadRowName,
  type WorkloadCounts,
  type WorkloadResult,
  type WorkloadRowKey,
} from "../workload";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 500)}`}`);
  }
}

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const TZ = "America/Toronto";
/** 多伦多 2026-10-31 00:00（EDT，UTC-4） */
const NOW = new Date("2026-10-31T04:00:00Z");

/** 按 A-4 的行与列造一份汇总：fill(key, dayIndex) 返回要覆盖的计数 */
function workloadOf(now: Date, fill: (key: WorkloadRowKey, dayIndex: number) => Partial<WorkloadCounts>, truncated = false): WorkloadResult {
  const days = localDayKeys(now, TZ, WORKLOAD_MIN_DAYS);
  return {
    timezone: TZ,
    days,
    signalWindowDays: 7,
    thresholds: {} as WorkloadResult["thresholds"],
    availability: {} as WorkloadResult["availability"],
    rows: WORKLOAD_ROW_ORDER.map((key) => ({
      key,
      name: workloadRowName(key),
      nav: null,
      daily: days.map((_, i) => ({ ...emptyCounts(), ...fill(key, i) })),
      last7: emptyCounts(),
      costRecorded: false,
      signals: [],
    })),
    truncated,
  };
}

async function main() {
  // ── 触发时刻 ──────────────────────────────────────────────────
  console.log("触发时刻（spec：日结的触发时刻）");
  {
    ok(JSON.stringify(POST_DAILY_DIGEST_HOURS) === "[0,1]", "门控小时为 0 与 1（1 点补一次）");
    ok(digestDayFor(NOW, TZ) === "2026-10-30", "场景「多伦多 00 点」：2026-10-31 00:00 → 本地日 2026-10-30", digestDayFor(NOW, TZ));
    const org = { id: "o1", settingsJson: { timezone: TZ } };
    ok(orgsAtLocalHour([org], NOW, [0]).length === 1, "多伦多 00:00 的组织被 [0] 选中");
    ok(orgsAtLocalHour([org], new Date("2026-10-31T05:00:00Z"), POST_DAILY_DIGEST_HOURS).length === 1, "场景「01 点补一次」：多伦多 01:00 也被选中");
    ok(digestDayFor(new Date("2026-10-31T05:30:00Z"), TZ) === "2026-10-30", "01:30 补写的仍是同一个前一本地日");
    ok(orgsAtLocalHour([org], new Date("2026-10-31T06:00:00Z"), POST_DAILY_DIGEST_HOURS).length === 0, "场景「没有组织到点」：多伦多 02:00 不被选中");
    // 哈瓦那 2026-03-08 夏令时开始：当地 00:00 直接跳到 01:00，那天没有 00 点
    const havana = { id: "o2", settingsJson: { timezone: "America/Havana" } };
    const havanaHours = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(2026, 2, 8, 2 + i)))
      .filter((t) => orgsAtLocalHour([havana], t, POST_DAILY_DIGEST_HOURS).length === 1);
    ok(
      havanaHours.length === 1 && orgsAtLocalHour([havana], havanaHours[0], [0]).length === 0 && digestDayFor(havanaHours[0], "America/Havana") === "2026-03-07",
      "场景「01 点补一次」：哈瓦那夏令时开始那天没有 00 点，01 点补写 2026-03-07",
      havanaHours.map((t) => t.toISOString()),
    );
    // 夏令时：2026-11-01 02:00 回拨；2027-03-14 02:00 拨快
    ok(digestDayFor(new Date("2026-11-02T05:00:00Z"), TZ) === "2026-11-01", "夏令时结束后的第一个 00:00（EST）→ 2026-11-01（25 小时的那天）");
    ok(digestDayFor(new Date("2027-03-15T04:00:00Z"), TZ) === "2027-03-14", "夏令时开始后的第一个 00:00（EDT）→ 2027-03-14（23 小时的那天）");
    ok(digestDayFor(new Date("2026-10-30T16:00:00Z"), "Asia/Shanghai") === "2026-10-30", "上海 2026-10-31 00:00 → 2026-10-30（按组织自己的时区）");
    ok(digestDayFor(new Date("2026-10-31T04:59:00Z"), TZ) === "2026-10-30", "00:59 仍是前一天");
  }

  // ── 内容只含计数 ──────────────────────────────────────────────
  console.log("内容（spec：日结只含按岗位的计数）");
  {
    const day = digestDayFor(NOW, TZ);
    const w = workloadOf(NOW, (key, i) => {
      const isDay = i === WORKLOAD_MIN_DAYS - 2;
      const isToday = i === WORKLOAD_MIN_DAYS - 1;
      if (key === "inbound_sales" && isDay) return { proposed: 3, approved: 2, inputTokens: 900, outputTokens: 300, cost: 1.25 };
      if (key === "inbound_sales" && isToday) return { proposed: 9 };
      // 平台级自动化运行与成本不进日结：只有这些的行视为空行
      if (key === "ops_knowledge" && isDay) return { automationRuns: 40, cost: 0.5 };
      if (key === "tender" && i === 0) return { approved: 7 };
      return {};
    });
    const d = buildPostDailyDigest(w, day);
    ok(d !== null && d.day === day && d.timezone === TZ && d.source === "system" && d.truncated === false, "带本地日、时区、来源 system、截断标记", d);
    ok(d?.rows.length === 1 && d.rows[0].key === "inbound_sales" && d.rows[0].name === workloadRowName("inbound_sales"), "场景「只有询盘销售有活动」：只有询盘销售一行", d?.rows);
    ok(d?.rows[0].proposed === 3 && d.rows[0].approved === 2 && DIGEST_COUNT_FIELDS.filter((f) => f !== "proposed" && f !== "approved").every((f) => d.rows[0][f] === 0), "起草 3、批准 2，其余计数为 0", d?.rows[0]);
    ok(JSON.stringify(Object.keys(d?.rows[0] ?? {})) === JSON.stringify(["key", "name", ...DIGEST_COUNT_FIELDS]), "每行只有 key、name 与十个计数", Object.keys(d?.rows[0] ?? {}));
    ok(DIGEST_COUNT_FIELDS.length === 10, "十个计数字段");
    const json = JSON.stringify(d);
    ok(!/automationRuns|Tokens|cost|nav|signals|last7|costRecorded/.test(json), "不含平台级自动化运行、token、成本与驾驶舱展示字段", json);
    ok(JSON.stringify(Object.keys(d ?? {})) === JSON.stringify(["day", "timezone", "rows", "truncated", "source"]), "afterData 只有五个键，day 在首位（幂等查找依赖）");

    const truncated = buildPostDailyDigest(workloadOf(NOW, (k, i) => (k === "service" && i === WORKLOAD_MIN_DAYS - 2 ? { expired: 1 } : {}), true), day);
    ok(truncated?.truncated === true && truncated.rows[0].key === "service" && truncated.rows[0].expired === 1, "透传 A-4 的截断标记", truncated);

    const all = buildPostDailyDigest(
      workloadOf(NOW, (k, i) => (i === WORKLOAD_MIN_DAYS - 2 && (k === "unattributed" || k === "inbound_sales_trade_show") ? { agentRuns: 1, guardrailBlocked: 2 } : {})),
      day,
    );
    ok(all?.rows.map((r) => r.key).join(",") === "inbound_sales_trade_show,unattributed", "展会子行与未归属行同样按非零保留，按 A-4 行序", all?.rows);

    ok(buildPostDailyDigest(workloadOf(NOW, () => ({})), day) === null, "场景「空日不写」：全部为 0 → null");
    ok(buildPostDailyDigest(workloadOf(NOW, (_k, i) => (i === WORKLOAD_MIN_DAYS - 1 ? { approved: 5 } : {})), day) === null, "只有今天有活动 → 前一天为空 → null");
    let threw = false;
    try {
      buildPostDailyDigest(workloadOf(NOW, () => ({})), "2026-01-01");
    } catch {
      threw = true;
    }
    ok(threw, "汇总里没有该本地日 → 抛错（由入口收成 error）");
  }

  // ── 写入条件 ──────────────────────────────────────────────────
  console.log("写入条件（spec：写入审计且同日幂等）");
  {
    ok(postDailyDigestLockKey("o1", "2026-10-30") === "post-daily-digest:o1:2026-10-30", "锁键 = 组织 + 本地日");
    const where = postDailyDigestExistingWhere("o1", "2026-10-30");
    ok(
      JSON.stringify(where) === JSON.stringify({ orgId: "o1", action: POST_DAILY_DIGEST_ACTION, targetType: "organization", targetId: "o1", afterData: { contains: '"day":"2026-10-30"' } }),
      "已有记录条件：组织 + 动作 + 目标组织 + afterData 的 day",
      where,
    );
    ok(POST_DAILY_DIGEST_ACTION === "cockpit.post_daily_digest", "动作代码 cockpit.post_daily_digest");
    const digest: PostDailyDigest = { day: "2026-10-30", timezone: TZ, rows: [], truncated: false, source: "system" };
    ok(JSON.stringify(digest).includes(where.afterData.contains), "条件命中 writeAuditLog 序列化后的 afterData");
    ok(!JSON.stringify({ ...digest, day: "2026-10-29" }).includes(where.afterData.contains), "别的本地日不命中");
  }

  // ── 入口（假依赖） ────────────────────────────────────────────
  console.log("入口（假依赖）");
  {
    const day = digestDayFor(NOW, TZ);
    const active = workloadOf(NOW, (k, i) => (k === "inbound_sales" && i === WORKLOAD_MIN_DAYS - 2 ? { proposed: 3, approved: 2 } : {}));
    const store = new Map<string, PostDailyDigest>();
    const calls: Array<{ orgId: string; days: number; now: Date }> = [];
    const writes: string[] = [];
    const deps = (byOrg: Record<string, WorkloadResult | Error>): PostDailyDigestDeps => ({
      workload: async (orgId, days, now) => {
        calls.push({ orgId, days, now });
        const w = byOrg[orgId];
        if (w instanceof Error) throw w;
        return w;
      },
      writeIfAbsent: async (org, d) => {
        writes.push(org.id);
        const key = postDailyDigestLockKey(org.id, d.day);
        if (store.has(key)) return false;
        store.set(key, d);
        return true;
      },
    });
    const o1: PostDailyDigestOrg = { id: "o1", ownerId: "u_owner1", timezone: TZ };
    const o2: PostDailyDigestOrg = { id: "o2", ownerId: "u_owner2", timezone: TZ };

    const r1 = await runPostDailyDigest(o1, NOW, deps({ o1: active }));
    ok(r1.status === "written" && r1.day === day && r1.rows === 1 && store.size === 1, "有活动 → written，写一条", r1);
    ok(calls[0]?.orgId === "o1" && calls[0].days === WORKLOAD_MIN_DAYS && calls[0].now === NOW, "按组织读 A-4 汇总：7 天窗口、同一个 now", calls[0]);
    const r2 = await runPostDailyDigest(o1, NOW, deps({ o1: active }));
    ok(r2.status === "exists" && store.size === 1, "场景「重复触发」：第二次 → exists，仍只有一条", r2);

    const writesBefore = writes.length;
    const r3 = await runPostDailyDigest(o2, NOW, deps({ o2: workloadOf(NOW, () => ({})) }));
    ok(r3.status === "empty" && r3.rows === 0 && writes.length === writesBefore, "场景「空日不写」：empty，不调用写入", r3);

    store.clear();
    const batch = await runPostDailyDigests([o1, o2], NOW, deps({ o1: new Error("db timeout"), o2: active }));
    ok(
      batch.failedCount === 1 && batch.succeededCount === 1 && batch.processedCount === 2 && !("status" in batch),
      "场景「一个组织读取失败」：失败计数 1、成功 1，不指定状态（runner 据此记 partial）",
      batch,
    );
    const lone = await runPostDailyDigests([o1], NOW, deps({ o1: new Error("db timeout") }));
    ok("status" in lone && lone.status === "failed" && lone.failedCount === 1 && lone.succeededCount === 0, "场景「唯一到点的组织失败」：运行记 failed", lone);
    ok(batch.data.orgs[0].status === "error" && batch.data.orgs[0].error === "db timeout" && batch.data.orgs[1].status === "written" && store.has(postDailyDigestLockKey("o2", day)), "另一个组织照常写日结", batch.data);

    const writeFails: PostDailyDigestDeps = { workload: async () => active, writeIfAbsent: async () => Promise.reject(new Error("lock timeout")) };
    const r4 = await runPostDailyDigest(o1, NOW, writeFails);
    ok(r4.status === "error" && r4.error === "lock timeout", "写入失败同样收成 error，不外抛", r4);
    const empties = await runPostDailyDigests([o2], NOW, deps({ o2: workloadOf(NOW, () => ({})) }));
    ok(empties.failedCount === 0 && empties.succeededCount === 1 && !("status" in empties), "无活动不算失败");
    const none = await runPostDailyDigests([], NOW, deps({}));
    ok(none.processedCount === 0 && !("status" in none), "没有组织时不判 failed");
  }

  // ── 注册表、岗位、调度、标签 ──────────────────────────────────
  console.log("注册与驾驶舱");
  {
    const def = AUTOMATION_REGISTRY.find((d) => d.key === POST_DAILY_DIGEST_AUTOMATION_KEY);
    ok(!!def && def.category === "operations" && def.timezone === "org" && def.name === "岗位日结（审计记录）", "自动化注册表：post-daily-digest，运维类，组织时区", def);
    ok(postForAutomation("post-daily-digest") === "ops_knowledge", "岗位归属：运维与知识");
    const s = AUTOMATION_SCHEDULES["post-daily-digest"];
    ok(s.kind === "local_hours" && s.route === "/api/cron/daily-brief" && s.cron === "0 * * * *" && JSON.stringify(s.hours) === JSON.stringify(POST_DAILY_DIGEST_HOURS) && s.timezone === "org", "调度：daily-brief 唤醒、组织本地 0 点与 1 点", s);
    ok(AUDIT_ACTION_LABELS[POST_DAILY_DIGEST_ACTION] === "岗位日结" && auditSource(POST_DAILY_DIGEST_ACTION) === "system", "company.log：岗位日结，来源 system");
    ok(!read("vercel.json").includes("digest"), "vercel.json 不新增条目");
  }

  // ── 源码断言 ──────────────────────────────────────────────────
  console.log("源码断言");
  {
    const route = stripComments(read("src/app/api/cron/daily-brief/route.ts"));
    ok(/select: \{ id: true, name: true, ownerId: true, settingsJson: true \}/.test(route), "路由：一次查询在用组织，多取 ownerId");
    ok(/const orgs = orgsAtLocalHour\(activeOrgs, now, \[7\]\);/.test(route) && /const digestOrgs = orgsAtLocalHour\(activeOrgs, now, \[0, 1\]\);/.test(route), "路由：简报组织 [7]、日结组织 [0, 1]，各绑各的变量");
    const skipAt = route.indexOf("orgs.length === 0 && digestOrgs.length === 0");
    ok(skipAt > 0 && route.indexOf("skipped: true") > skipAt && route.indexOf("skipped: true") < route.indexOf('runTrackedAutomation("daily-brief"'), "路由：两组都空才 skipped，且在记任何运行之前返回");
    ok(
      /const runPostDailyDigest = \(\) =>\s*runTrackedAutomation\("post-daily-digest", \(\) => runPostDailyDigests\(digestOrgs, now\)\)\.catch\(/.test(route),
      "路由：日结整段异常被收住，不影响简报",
    );
    const calls = [...route.matchAll(/await runPostDailyDigest\(\)/g)].map((m) => m.index ?? -1);
    const briefAt = route.indexOf('runTrackedAutomation("daily-brief"');
    ok(
      calls.length === 2 &&
        /postDailyDigest: await runPostDailyDigest\(\)/.test(route.slice(route.indexOf("if (orgs.length === 0) {"), briefAt)) &&
        calls[1] > briefAt &&
        /digestOrgs\.length \? \{ \.\.\.data, postDailyDigest: await runPostDailyDigest\(\) \} : data/.test(route),
      "路由：只有日结组织非空才记 post-daily-digest 运行；有简报时排在简报之后",
      calls,
    );
    ok(
      /runTrackedAutomation\("daily-brief"/.test(route) &&
        /generateBriefingsForOrg\(org\.id\)/.test(route) &&
        /sendOwnerInquiryBrief\(org\.id, org\.timezone, \{ now \}\)/.test(route) &&
        /remindOverdueRepairs\(org\.id, org\.timezone, now\)/.test(route) &&
        /sendBoothSummary\(org\.id, day, org\.timezone\)/.test(route),
      "路由：简报部分逻辑不变（四步仍在，对 [7] 的组织）",
    );

    const src = stripComments(read("src/lib/cockpit/daily-digest.ts"));
    ok(!/memoryClaim|corporate-memory|notification|wechat|muse|pendingAction|createPendingAction|@\/lib\/ai\b|llm/i.test(src), "日结不碰企业记忆、通知、微信 / Muse、审批、LLM");
    const lockAt = src.indexOf("pg_advisory_xact_lock");
    const findAt = src.indexOf("tx.auditLog.findFirst");
    const writeAt = src.indexOf("writeAuditLog(tx");
    ok(src.includes("db.$transaction") && lockAt > 0 && findAt > lockAt && writeAt > findAt, "同一事务内：加锁 → 先查 → 再写");
    ok(/userId: org\.ownerId/.test(src) && /targetType: "organization"/.test(src) && /targetId: org\.id/.test(src), "操作人挂所有者，目标为组织");
    ok(/getOrgWorkload\(\{ orgId \}, days, \{ \.\.\.defaultWorkloadDeps\(\), now: \(\) => now \}\)/.test(src), "默认依赖复用 A-4 读模型，时刻与定时任务一致");
  }

  console.log(`\n组织驾驶舱岗位日结: ${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
