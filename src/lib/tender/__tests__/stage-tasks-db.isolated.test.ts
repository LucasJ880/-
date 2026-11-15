/**
 * FIX-7 阶段推进之后的自动任务——真实 DB（隔离库）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender/__tests__/stage-tasks-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 项目）。不发任何邮件，不调任何外部接口。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-7 阶段任务 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-7 stage tasks DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { db } = await import("@/lib/db");
  const { onStageAdvancedTasks } = await import("../stage-tasks");
  const { advanceProjectStage } = await import("../stage-transition");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const abandonRoute = await import("@/app/api/projects/[id]/abandon/route");

  console.log("FIX-7 stage tasks — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `stowner_${stamp}`, OTHER = `stother_${stamp}`, ORG = `storg_${stamp}`;
  const DAY = 86_400_000;
  for (const id of [OWNER, OTHER]) await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `st-${stamp}`, ownerId: OWNER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(closeInDays: number | null) {
    seq += 1;
    const id = `stproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", closeDate: closeInDays === null ? null : new Date(Date.now() + closeInDays * DAY) } });
    return id;
  }
  const tasks = (projectId: string, prefix?: string) => db.task.findMany({ where: { projectId, ...(prefix ? { title: { startsWith: prefix } } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { title: true, status: true, priority: true, dueDate: true, completedAt: true, creatorId: true, assigneeId: true, createdAt: true, description: true } });
  // 任务表没有排序列：比的是有哪几条，不比先后
  const names = (xs: Array<{ title: string }>) => xs.map((x) => x.title).sort().join("|");
  const sorted = (s: string) => s.split("|").sort().join("|");
  const actor = { id: OWNER, name: "Fixture", email: `${OWNER}@fixture.test` };
  const advance = (projectId: string, targetStage: "interpretation" | "supplier_inquiry" | "supplier_quote" | "submission") => advanceProjectStage({ projectId, targetStage, reason: "fixture", source: "manual", actor, humanConfirmed: true });
  async function waitFor(projectId: string, prefix: string, n: number) {
    for (let i = 0; i < 40; i++) { const xs = await tasks(projectId, prefix); if (xs.length >= n) return xs; await sleep(100); }
    return tasks(projectId, prefix);
  }
  // 推进之后建任务不等结果：等到这一次推进的任务写完（锁释放）
  const settle = () => sleep(800);

  let triggerMade = false;
  try {
    /* ---------- 1. 逐个阶段真的建出来 ---------- */
    const P = await mkProject(10);
    const closeDate = (await db.project.findUniqueOrThrow({ where: { id: P }, select: { closeDate: true } })).closeDate!;
    const t0 = Date.now();
    await onStageAdvancedTasks(P, "initiation", "distribution", OWNER);
    const created = await tasks(P, "[项目分发]");
    ok(names(created) === sorted("[项目分发] 分配项目负责人|[项目分发] 初步评估项目可行性"), "直接调用、进入项目分发：建出 2 条（以前这一步每次都失败）", created);
    const t0b = Date.now();
    const pr = (title: string) => created.find((t) => t.title.endsWith(title));
    ok(created.every((t) => t.status === "todo" && t.creatorId === OWNER && t.assigneeId === OWNER && !!t.description && t.completedAt === null) && pr("分配项目负责人")?.priority === "high" && pr("初步评估项目可行性")?.priority === "medium", "每条：待办、创建人与负责人是推进的人、有说明；优先级与模板一致");
    const inWindow = (d: Date | null, days: number, a: number, b: number) => !!d && d.getTime() >= a + days * DAY && d.getTime() <= b + days * DAY;
    ok(inWindow(pr("分配项目负责人")!.dueDate, 1, t0, t0b) && inWindow(pr("初步评估项目可行性")!.dueDate, 2, t0, t0b), "到期日 = 进入阶段那一刻 + 模板里的天数（误差不超过这一次调用的耗时）", created.map((t) => t.dueDate));

    await onStageAdvancedTasks(P, "distribution", "interpretation", OWNER);
    ok((await tasks(P, "[项目分发]")).every((t) => t.status === "done" && !!t.completedAt) && names(await tasks(P, "[项目解读]")) === sorted("[项目解读] 精读招标文件|[项目解读] 确认投标资质要求|[项目解读] 编制投标计划"), "进入项目解读：上一阶段的 2 条被标为完成并记下完成时间；新建 3 条");

    /* ---------- 2. 关掉上一阶段的：只动该动的 ---------- */
    const manual = await db.task.create({ data: { title: "给业主打电话确认现场踏勘时间", status: "todo", priority: "medium", projectId: P, creatorId: OWNER, assigneeId: OWNER } });
    const cancelled = await db.task.create({ data: { title: "[项目解读] 已取消的一条", status: "cancelled", priority: "low", projectId: P, creatorId: OWNER } });
    const inProgress = await db.task.updateMany({ where: { projectId: P, title: "[项目解读] 确认投标资质要求" }, data: { status: "in_progress" } });
    const blocked = await db.task.create({ data: { title: "[项目解读] 等业主答疑", status: "blocked", priority: "medium", projectId: P, creatorId: OWNER, blockedReason: "等答疑" } });
    // 同一个组织的另一个项目，正好也有「[项目解读]」的任务：P 推进时不能动它
    const PX = await mkProject(10);
    const foreign = await db.task.create({ data: { title: "[项目解读] 精读招标文件", status: "todo", priority: "high", projectId: PX, creatorId: OWNER, assigneeId: OWNER } });
    await onStageAdvancedTasks(P, "interpretation", "supplier_inquiry", OWNER);
    const foreignAfter = await db.task.findUniqueOrThrow({ where: { id: foreign.id }, select: { status: true, completedAt: true } });
    ok(foreignAfter.status === "todo" && foreignAfter.completedAt === null, "别的项目里同名的自动任务没有被关掉（只动本项目的）", foreignAfter);
    const after = await db.task.findMany({ where: { id: { in: [manual.id, cancelled.id, blocked.id] } }, select: { id: true, status: true } });
    const st = (id: string) => after.find((x) => x.id === id)?.status;
    ok(inProgress.count === 1 && (await tasks(P, "[项目解读] 精读")).every((t) => t.status === "done") && (await tasks(P, "[项目解读] 确认")).every((t) => t.status === "done") && (await tasks(P, "[项目解读] 编制")).every((t) => t.status === "done"), "上一阶段待办与进行中的自动任务都被标为完成");
    ok(st(manual.id) === "todo" && st(cancelled.id) === "cancelled" && st(blocked.id) === "blocked", "人自己建的任务、已取消的、被阻塞的：都没有被动", after);
    ok((await tasks(P, "[项目分发]")).length === 2 && names(await tasks(P, "[供应商询价]")) === sorted("[供应商询价] 发送供应商询价单|[供应商询价] 跟进供应商回复"), "更早阶段的任务不受影响；新建供应商询价的 2 条");

    /* ---------- 3. 供应商报价：5 条，「提交投标」到期日是截标时间 ---------- */
    const t1 = Date.now();
    await onStageAdvancedTasks(P, "supplier_inquiry", "supplier_quote", OWNER);
    const quote = await tasks(P, "[供应商报价]");
    const t1b = Date.now();
    const q = (title: string) => quote.find((t) => t.title === `[供应商报价] ${title}`);
    ok(names(quote) === sorted("[供应商报价] 汇总供应商报价|[供应商报价] 生成项目报价单|[供应商报价] 报价内部审核|[供应商报价] 准备投标文件|[供应商报价] 提交投标"), "进入供应商报价：5 条（含挪过来的「准备投标文件」「提交投标」）", names(quote));
    ok(q("提交投标")!.dueDate!.getTime() === closeDate.getTime() && inWindow(q("汇总供应商报价")!.dueDate, 2, t1, t1b) && inWindow(q("生成项目报价单")!.dueDate, 3, t1, t1b) && inWindow(q("报价内部审核")!.dueDate, 4, t1, t1b) && inWindow(q("准备投标文件")!.dueDate, 5, t1, t1b) && q("准备投标文件")!.priority === "urgent" && q("提交投标")!.priority === "urgent", "「提交投标」的到期日就是项目的截标时间（10 天后）；别的按天数", quote.map((t) => t.dueDate));
    const PN = await mkProject(null);
    const t2 = Date.now();
    await onStageAdvancedTasks(PN, "supplier_inquiry", "supplier_quote", OWNER);
    ok(inWindow((await tasks(PN, "[供应商报价] 提交投标"))[0].dueDate, 6, t2, Date.now()), "项目没有截标时间：「提交投标」按天数算");
    const PO = await mkProject(-1);
    const t3 = Date.now();
    await onStageAdvancedTasks(PO, "supplier_inquiry", "supplier_quote", OWNER);
    ok(inWindow((await tasks(PO, "[供应商报价] 提交投标"))[0].dueDate, 6, t3, Date.now()), "截标时间已过：同样按天数算（不给一个已经过去的到期日）");
    const PC = await mkProject(1);
    const pcClose = (await db.project.findUniqueOrThrow({ where: { id: PC }, select: { closeDate: true } })).closeDate!;
    await onStageAdvancedTasks(PC, "supplier_inquiry", "supplier_quote", OWNER);
    const pcTasks = await tasks(PC, "[供应商报价]");
    ok(pcTasks.length === 5 && pcTasks.every((t) => t.dueDate!.getTime() === pcClose.getTime()), "截标只剩 1 天：5 条的到期日都是截标时间（没有截标之后才到期的）", pcTasks.map((t) => t.dueDate));

    /* ---------- 4. 不重复 ---------- */
    await onStageAdvancedTasks(P, "supplier_inquiry", "supplier_quote", OWNER);
    ok((await tasks(P, "[供应商报价]")).length === 5, "同一个阶段再调一次：不再建一批");
    await Promise.all(Array.from({ length: 8 }, () => onStageAdvancedTasks(PN, "distribution", "interpretation", OTHER)));
    const conc = await tasks(PN, "[项目解读]");
    ok(conc.length === 3 && conc.every((t) => t.creatorId === OTHER && t.assigneeId === OTHER), "同时调 8 次：只建一批（3 条）；创建人与负责人是这一次推进的那个人", conc.length);
    // 再来 5 个项目、每个同时调 8 次：没加锁时几乎每一轮都会多建
    const counts: number[] = [];
    for (let r = 0; r < 5; r++) {
      const PCC = await mkProject(10);
      await Promise.all(Array.from({ length: 8 }, () => onStageAdvancedTasks(PCC, "interpretation", "supplier_inquiry", OWNER)));
      counts.push((await tasks(PCC, "[供应商询价]")).length);
    }
    ok(counts.every((c) => c === 2), "5 个项目各同时调 8 次：每个都只建一批（2 条）", counts);
    const PD = await mkProject(10);
    await db.task.create({ data: { title: "[供应商询价] 人自己建的一条", status: "todo", priority: "low", projectId: PD, creatorId: OWNER } });
    await onStageAdvancedTasks(PD, "interpretation", "supplier_inquiry", OWNER);
    ok((await tasks(PD, "[供应商询价]")).length === 1, "新阶段已有一条没完成的同前缀任务（待办）：不再建一批");
    const PD2 = await mkProject(10);
    await db.task.create({ data: { title: "[供应商询价] 进行中的一条", status: "in_progress", priority: "low", projectId: PD2, creatorId: OWNER } });
    await onStageAdvancedTasks(PD2, "interpretation", "supplier_inquiry", OWNER);
    ok((await tasks(PD2, "[供应商询价]")).length === 1, "已有的是进行中的：同样不再建");

    /* ---------- 5. 进入项目提交：只关不建 ---------- */
    await onStageAdvancedTasks(P, "supplier_quote", "submission", OWNER);
    ok((await tasks(P, "[供应商报价]")).every((t) => t.status === "done") && (await tasks(P, "[项目提交]")).length === 0, "进入项目提交：供应商报价的 5 条（含「提交投标」）被标为完成；没有新任务");

    // 调用方指明不建：只关上一阶段的，不为新阶段建
    const PS = await mkProject(10);
    await onStageAdvancedTasks(PS, "initiation", "distribution", OWNER);
    await onStageAdvancedTasks(PS, "distribution", "interpretation", OWNER, { skipCreate: true });
    ok((await tasks(PS, "[项目分发]")).length === 2 && (await tasks(PS, "[项目分发]")).every((t) => t.status === "done") && (await tasks(PS)).length === 2, "指明不建任务：上一阶段的 2 条被关掉，新阶段一条也没建");
    await onStageAdvancedTasks(PS, "distribution", "interpretation", OWNER);
    ok((await tasks(PS, "[项目解读]")).length === 3 && (await tasks(PX)).length === 1, "不指明时照常建（对照）；别的项目始终没有多出任务");

    /* ---------- 6. 从阶段推进的入口走一遍 ---------- */
    const PE = await mkProject(20);
    const adv = await advance(PE, "supplier_inquiry");
    const viaEntry = await waitFor(PE, "[供应商询价]", 2);
    ok(adv.success && names(viaEntry) === sorted("[供应商询价] 发送供应商询价单|[供应商询价] 跟进供应商回复"), "调用阶段推进把项目推进到供应商询价：推进成功，项目里出现这一阶段的 2 条任务", { adv, viaEntry: names(viaEntry) });
    await settle();
    const adv2 = await advance(PE, "submission");
    await settle();
    ok(adv2.success && (await tasks(PE, "[供应商询价]")).every((t) => t.status === "done") && (await tasks(PE, "[项目提交]")).length === 0 && (await tasks(PE)).length === 2, "再推进到项目提交：之前的任务被关掉，没有建「提交投标」之类的任务");

    /* ---------- 7. 阶段时间被绕过阶段推进写入、跳级推进：更早阶段的也关掉 ---------- */
    const PB = await mkProject(20);
    await advance(PB, "interpretation");
    const interp = await waitFor(PB, "[项目解读]", 3);
    await settle();
    // 与询价发出时一样（src/lib/tender-rfq/execute.ts）：直接写供应商询价的时间，不经阶段推进
    await db.project.update({ where: { id: PB }, data: { supplierInquiredAt: new Date() } });
    const advB = await advance(PB, "supplier_quote");
    await waitFor(PB, "[供应商报价]", 5);
    await settle();
    const interpAfter = await tasks(PB, "[项目解读]");
    ok(interp.length === 3 && advB.success && interpAfter.every((t) => t.status === "done" && !!t.completedAt) && (await tasks(PB, "[供应商报价]")).length === 5, "询价时间被直接写入之后再推进到供应商报价：项目解读的 3 条也被关掉（以前只关「上一阶段」= 供应商询价，它们会一直挂着逾期）", interpAfter.map((t) => t.status));
    const PJ = await mkProject(20);
    await onStageAdvancedTasks(PJ, "initiation", "distribution", OWNER);
    await onStageAdvancedTasks(PJ, "distribution", "supplier_quote", OWNER);
    ok((await tasks(PJ, "[项目分发]")).every((t) => t.status === "done") && (await tasks(PJ, "[供应商报价]")).length === 5, "跳级（项目分发 → 供应商报价）：项目分发的任务被关掉，建供应商报价的 5 条");

    /* ---------- 8. 已放弃的项目不建；放弃项目时撤掉还没完成的自动任务 ---------- */
    const PA = await mkProject(20);
    await onStageAdvancedTasks(PA, "initiation", "distribution", OWNER);
    await db.project.update({ where: { id: PA }, data: { status: "abandoned" } });
    await onStageAdvancedTasks(PA, "distribution", "interpretation", OWNER);
    ok((await tasks(PA, "[项目解读]")).length === 0 && (await tasks(PA, "[项目分发]")).every((t) => t.status === "done"), "项目已放弃：之前的照样关掉，但不建新任务");
    const PR = await mkProject(20);
    await advance(PR, "interpretation");
    await waitFor(PR, "[项目解读]", 3);
    await settle();
    await db.task.updateMany({ where: { projectId: PR, title: "[项目解读] 精读招标文件" }, data: { status: "done", completedAt: new Date() } });
    const own = await db.task.create({ data: { title: "整理一下踏勘照片", status: "todo", priority: "low", projectId: PR, creatorId: OWNER } });
    const cookie = `qy_session=${await createSession({ sub: OWNER, email: `${OWNER}@fixture.test`, role: "user" })}`;
    const res = await abandonRoute.POST(new NextRequest(`http://localhost/api/projects/${PR}/abandon`, { method: "POST", headers: { "content-type": "application/json", cookie, "x-org-id": ORG }, body: JSON.stringify({ reason: "fixture" }) }), { params: Promise.resolve({ id: PR }) });
    const prTasks = await tasks(PR, "[项目解读]");
    const ownAfter = await db.task.findUniqueOrThrow({ where: { id: own.id }, select: { status: true } });
    ok(res.status === 200 && prTasks.filter((t) => t.status === "cancelled").length === 2 && prTasks.filter((t) => t.status === "done").length === 1 && ownAfter.status === "todo", "调放弃项目接口：还没完成的 2 条自动任务标为已取消，已完成的那条不动，人自己建的不动", { status: res.status, prTasks: prTasks.map((t) => t.status), own: ownAfter.status });

    /* ---------- 9. 建任务失败：阶段推进照样成功，留下错误日志 ---------- */
    const PF = await mkProject(20);
    // 只让这个项目的任务写入失败（临时触发器，测试结束删掉）
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION fix5_fail_task_${stamp}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fix5 fixture: task insert refused'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER fix5_fail_task_${stamp} BEFORE INSERT ON "Task" FOR EACH ROW WHEN (NEW."projectId" = '${PF}') EXECUTE FUNCTION fix5_fail_task_${stamp}()`);
    triggerMade = true;
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...a: unknown[]) => { errors.push(a); };
    let adv3: { success: boolean } = { success: false };
    try {
      adv3 = await advance(PF, "interpretation");
      for (let i = 0; i < 40 && !errors.some((e) => String((e as unknown[])[0]).includes("[StageTasks] failed")); i++) await sleep(100);
    } finally {
      console.error = origError;
    }
    const pf = await db.project.findUniqueOrThrow({ where: { id: PF }, select: { interpretedAt: true, tenderStatus: true } });
    ok(adv3.success && !!pf.interpretedAt && (await tasks(PF)).length === 0, "任务写入被拒：阶段推进照样成功（项目解读的时间写上了），没有任务", { adv3, pf });
    ok(errors.some((e) => String((e as unknown[])[0]).includes("[StageTasks] failed") && JSON.stringify(String((e as unknown[])[1])).includes("task insert refused")), "留下了「[StageTasks] failed」的错误日志，带着真正的原因", errors.length);
  } finally {
    await sleep(300);
    if (triggerMade) {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fix5_fail_task_${stamp} ON "Task"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fix5_fail_task_${stamp}()`);
    }
    await db.projectReview.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.notification.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.task.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectMessage.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectConversation.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { projectId: { in: projectIds } }] } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: [OWNER, OTHER] } } });
    await db.$disconnect();
  }

  console.log(`\nFIX-7 stage tasks DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
