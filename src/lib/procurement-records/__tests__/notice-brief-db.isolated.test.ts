/**
 * P2-3b「今日新标」早报：sendNoticeBrief —— 隔离库
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/procurement-records/__tests__/notice-brief-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。不发任何外部请求、不调模型。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 P2-3b 今日新标早报 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "P2-3b notice brief DB test" });
process.env.PROCUREMENT_RECORDS_SCHEMA_READY = "1";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { sendNoticeBrief } = await import("../notice-brief");
  const { noticeBriefSourceKey } = await import("../notice-brief-pure");

  console.log("P2-3b notice brief — isolated DB");
  const stamp = Date.now().toString(36);
  const ADMIN = `nbadmin_${stamp}`, CREATOR = `nbcreator_${stamp}`, GONE = `nbgone_${stamp}`, OUT = `nbout_${stamp}`;
  const ORG = `nborg_${stamp}`, ORG_B = `nborgb_${stamp}`, ORG_C = `nborgc_${stamp}`;
  const users = [ADMIN, CREATOR, GONE, OUT];
  const orgs = [ORG, ORG_B, ORG_C];
  const email = (id: string) => `${id}@fixture.test`;
  const H = 3_600_000;
  const now = new Date("2026-11-16T12:00:00.000Z"); // 多伦多 07:00
  const TZ = "America/Toronto";
  let seq = 0;
  const mkInst = async (orgId: string, o: Record<string, unknown> = {}) => {
    seq += 1;
    const num = `NB${stamp}${seq}`;
    return (await db.procurementInstrument.create({
      data: {
        orgId, jurisdiction: "CA-FED", instrumentClass: "SOLICITATION", officialNumber: num, normalizedNumber: num.toLowerCase(),
        procuringEntityKey: "pspc", dedupeKey: `CA-FED|pspc|SOLICITATION|${num.toLowerCase()}`, title: `Brief notice ${seq}`,
        publishedAt: new Date(now.getTime() - seq * H), closingAt: new Date("2026-11-30T19:00:00.000Z"), triageStatus: "CANDIDATE", origin: "SCAN",
        firstSeenAt: new Date(now.getTime() - 2 * H), ...o,
      } as never,
    })).id;
  };
  const mkWatch = (orgId: string, o: Record<string, unknown>) =>
    db.procurementWatch.create({ data: { orgId, name: "default", scheduleJson: {}, filtersJson: {}, limitsJson: {}, sourcesJson: {}, ...o } as never });
  const notes = (orgId: string) => db.notification.findMany({ where: { orgId, type: "procurement_notice_brief" }, orderBy: { userId: "asc" } });

  try {
    for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id.split("_")[0]}`, role: "user" } });
    for (const [id, owner] of [[ORG, ADMIN], [ORG_B, OUT], [ORG_C, OUT]] as const) await db.organization.create({ data: { id, name: `Fixture ${id}`, code: `nb-${id}`, ownerId: owner } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: ADMIN, role: "org_admin", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: CREATOR, role: "org_admin", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: GONE, role: "org_member", status: "removed" } });
    await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUT, role: "org_admin", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG_C, userId: OUT, role: "org_admin", status: "active" } });

    // 本组织：监控开启人 ADMIN、创建人 CREATOR
    await mkWatch(ORG, { enabled: true, enabledById: ADMIN, createdById: CREATOR });
    // 新标：N1..N6（6 条，进早报）；最新发布的排前面
    // 插入顺序、发现顺序、发布顺序三者都不同，证明排序按发布时间（审查 L1）
    const pubHoursAgo = [3, 1, 5, 2, 6, 4];
    const N = [] as string[];
    for (let i = 0; i < 6; i++) N.push(await mkInst(ORG, { title: `Pub ${pubHoursAgo[i]}h ago`, publishedAt: new Date(now.getTime() - pubHoursAgo[i] * H), firstSeenAt: new Date(now.getTime() - 2 * H + (i + 1) * 60_000) }));
    // 没有发布日期、发现得最晚：排最后（Postgres 降序默认把空值排最前）
    const UNKNOWN = await mkInst(ORG, { closingAt: null, publishedAt: null, title: "Closing unknown", firstSeenAt: new Date(now.getTime() - 60_000) });
    // 窗口边界：正好前一天 07:00 发现的算今天；正好今天 07:00 发现的算明天
    await mkInst(ORG, { title: "At start", publishedAt: new Date(now.getTime() - 30 * H), firstSeenAt: new Date(now.getTime() - 24 * H) });
    await mkInst(ORG, { title: "At end", publishedAt: new Date(now.getTime() - 30 * H), firstSeenAt: now });
    // 不进：24 小时前发现、已截标、合同、忽略 / 归档 / 历史、未来时间（防御）、别的组织
    await mkInst(ORG, { firstSeenAt: new Date(now.getTime() - 25 * H), title: "Old find" });
    await mkInst(ORG, { closingAt: new Date(now.getTime() - 1000), title: "Closed" });
    await mkInst(ORG, { instrumentClass: "AWARD_INSTRUMENT", title: "Award" });
    for (const t of ["IGNORED", "ARCHIVED", "HISTORY"]) await mkInst(ORG, { triageStatus: t, title: t });
    await mkInst(ORG, { firstSeenAt: new Date(now.getTime() + H), title: "Future" });
    await mkInst(ORG_B, { title: "Other org" });
    // 已关注的新标照样算（还没截标）
    const WATCHING = await mkInst(ORG, { triageStatus: "WATCHING", title: "Watching one" });

    const r = await sendNoticeBrief(ORG, TZ, { now });
    ok(r.skipped === null && r.total === 9, "总数：6 条 + 截标未知 1 条 + 窗口起点 1 条 + 已关注 1 条", r);
    ok(r.day === "2026-11-16", "当地日期", r.day);
    ok(r.recipients === 2 && r.sent === 2, "发给开启人与创建人（已离开的成员不算）", r);
    const ns = await notes(ORG);
    ok(ns.length === 2 && ns.every((n) => [ADMIN, CREATOR].includes(n.userId)), "通知只给两人", ns.map((n) => n.userId));
    const n0 = ns[0];
    ok(n0.title === "今日新标 9 条", "标题", n0.title);
    const lines = (n0.summary ?? "").split("\n");
    ok(lines.filter((l) => l.startsWith("· ")).length === 5 && lines.includes("另有 4 条"), "列 5 条 + 另有 4 条", lines);
    ok(lines[0] === "· Pub 1h ago（截标 11-30 14:00）", "最新发布排第一、截标按多伦多时间", lines[0]);
    ok(lines.slice(0, 5).join("|").startsWith("· Pub 1h ago（截标 11-30 14:00）|· Pub 2h ago（截标 11-30 14:00）|· Pub 3h ago"), "按发布时间新到旧", lines.slice(0, 5));
    ok(!(n0.summary ?? "").includes("Closing unknown"), "没有发布日期的不排前面", lines);
    ok(!(n0.summary ?? "").includes("At end"), "正好今天 07:00 发现的不算今天", lines);
    ok(!(n0.summary ?? "").match(/Old find|Closed|Award|IGNORED|ARCHIVED|HISTORY|Future|Other org/), "不该出现的都不在", n0.summary);
    ok(n0.entityType === "procurement_new_notices" && n0.entityId === "2026-11-16" && n0.orgId === ORG && n0.category === "procurement_watch", "跳转对象与分类", n0);
    ok(n0.sourceKey === noticeBriefSourceKey(ORG, "2026-11-16", n0.userId), "去重键");
    void N; void UNKNOWN; void WATCHING;

    // 同一天再跑：不重复
    const again = await sendNoticeBrief(ORG, TZ, { now: new Date(now.getTime() + 30 * 60_000) });
    ok(again.sent === 0 && (await notes(ORG)).length === 2, "同一天再跑不重复", again);

    // 第二天：只含今天 07:00 之后发现的（Future 08:00、At end 正好 07:00）——前后两天不重不漏
    const next = await sendNoticeBrief(ORG, TZ, { now: new Date(now.getTime() + 24 * H) });
    const nextNote = (await notes(ORG)).find((n) => n.sourceKey?.includes("2026-11-17"));
    ok(next.total === 2 && next.sent === 2 && nextNote?.title === "今日新标 2 条" && (nextNote?.summary ?? "").includes("Future") && (nextNote?.summary ?? "").includes("At end"), "第二天只含今天 07:00 之后发现的（含正好 07:00 的）", { next, s: nextNote?.summary });
    // 第三天：没有新发现就不发
    const third = await sendNoticeBrief(ORG, TZ, { now: new Date(now.getTime() + 48 * H) });
    ok(third.skipped === "no_new_notices" && third.sent === 0, "没有新发现不发", third);

    // 开启人与创建人是同一人：只发一条
    await mkWatch(ORG_B, { enabled: true, enabledById: OUT, createdById: OUT });
    // 组织时区决定日期：奥克兰此刻已是 11-17（UTC 仍是 11-16）
    const b = await sendNoticeBrief(ORG_B, "Pacific/Auckland", { now });
    ok(b.recipients === 1 && b.sent === 1 && b.total === 1, "同一人只发一条、只算本组织", b);
    ok(b.day === "2026-11-17" && (await notes(ORG_B))[0]?.sourceKey === noticeBriefSourceKey(ORG_B, "2026-11-17", OUT), "日期按组织时区", b.day);

    // 监控未启用：不发
    await mkWatch(ORG_C, { enabled: false, createdById: OUT });
    await mkInst(ORG_C);
    const c = await sendNoticeBrief(ORG_C, TZ, { now });
    ok(c.skipped === "watch_disabled" && (await notes(ORG_C)).length === 0, "监控未启用不发", c);

    // 暗合并闸关：不发、不查
    process.env.PROCUREMENT_RECORDS_SCHEMA_READY = "0";
    const off = await sendNoticeBrief(ORG, TZ, { now });
    ok(off.skipped === "schema_not_ready", "闸关不发", off);
    process.env.PROCUREMENT_RECORDS_SCHEMA_READY = "1";

    // 账号停用（成员关系仍是在用）：不发给他（审查 L2）
    await db.user.update({ where: { id: OUT }, data: { status: "disabled" } });
    await db.organizationMember.create({ data: { orgId: ORG_C, userId: CREATOR, role: "org_admin", status: "active" } });
    await db.procurementWatch.updateMany({ where: { orgId: ORG_C }, data: { enabled: true, enabledById: OUT, createdById: CREATOR } });
    const disabled = await sendNoticeBrief(ORG_C, TZ, { now });
    const cNotes = await notes(ORG_C);
    ok(disabled.recipients === 1 && cNotes.length === 1 && cNotes[0].userId === CREATOR, "停用账号不发", { disabled, to: cNotes.map((n) => n.userId) });
    await db.notification.deleteMany({ where: { orgId: ORG_C } });
    await db.user.update({ where: { id: OUT }, data: { status: "active" } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG_C, userId: CREATOR } });
    await db.procurementWatch.updateMany({ where: { orgId: ORG_C }, data: { createdById: OUT } });

    // 收件人都不在组织了（创建人 OUT 的成员关系改为已移除，开启人 GONE 不是本组织成员）：不发
    await db.organizationMember.updateMany({ where: { orgId: ORG_C }, data: { status: "removed" } });
    await db.procurementWatch.updateMany({ where: { orgId: ORG_C }, data: { enabled: true, enabledById: GONE } });
    const gone = await sendNoticeBrief(ORG_C, TZ, { now });
    ok(gone.skipped === "no_recipients" && gone.total === 1 && (await notes(ORG_C)).length === 0, "收件人都不在组织不发", gone);
  } finally {
    await db.notification.deleteMany({ where: { orgId: { in: orgs } } });
    await db.procurementInstrument.deleteMany({ where: { orgId: { in: orgs } } });
    await db.procurementWatch.deleteMany({ where: { orgId: { in: orgs } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgs } } });
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
