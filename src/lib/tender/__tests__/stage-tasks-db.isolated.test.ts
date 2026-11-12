/**
 * FIX-5 阶段推进之后的自动任务——真实 DB（隔离库）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender/__tests__/stage-tasks-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 项目）。不发任何邮件，不调任何外部接口。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-5 阶段任务 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-5 stage tasks DB test" });

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

  console.log("FIX-5 stage tasks — isolated DB");
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
  const names = (xs: Array<{ title: string }>) => xs.map((x) => x.title).join("|");

  try {
    /* ---------- 1. 逐个阶段真的建出来 ---------- */
    const P = await mkProject(10);
    const closeDate = (await db.project.findUniqueOrThrow({ where: { id: P }, select: { closeDate: true } })).closeDate!;
    const t0 = Date.now();
    await onStageAdvancedTasks(P, "initiation", "distribution", OWNER);
    const created = await tasks(P, "[项目分发]");
    ok(names(created) === "[项目分发] 分配项目负责人|[项目分发] 初步评估项目可行性", "进入项目分发：建出 2 条，按模板顺序（以前这一步每次都失败）", created);
    ok(created.every((t) => t.status === "todo" && t.creatorId === OWNER && t.assigneeId === OWNER && !!t.description && t.completedAt === null) && created.map((t) => t.priority).join() === "high,medium", "每条：待办、创建人与负责人是推进的人、有说明；优先级与模板一致");
    ok(created.map((t) => Math.round((t.dueDate!.getTime() - t0) / DAY)).join() === "1,2", "到期日 = 进入阶段那一刻 + 模板里的天数", created.map((t) => t.dueDate));

    await onStageAdvancedTasks(P, "distribution", "interpretation", OWNER);
    ok((await tasks(P, "[项目分发]")).every((t) => t.status === "done" && !!t.completedAt) && names(await tasks(P, "[项目解读]")) === "[项目解读] 精读招标文件|[项目解读] 确认投标资质要求|[项目解读] 编制投标计划", "进入项目解读：上一阶段的 2 条被标为完成并记下完成时间；新建 3 条");

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
    ok((await tasks(P, "[项目分发]")).length === 2 && names(await tasks(P, "[供应商询价]")) === "[供应商询价] 发送供应商询价单|[供应商询价] 跟进供应商回复", "更早阶段的任务不受影响；新建供应商询价的 2 条");

    /* ---------- 3. 供应商报价：5 条，「提交投标」到期日是截标时间 ---------- */
    const t1 = Date.now();
    await onStageAdvancedTasks(P, "supplier_inquiry", "supplier_quote", OWNER);
    const quote = await tasks(P, "[供应商报价]");
    ok(names(quote) === "[供应商报价] 汇总供应商报价|[供应商报价] 生成项目报价单|[供应商报价] 报价内部审核|[供应商报价] 准备投标文件|[供应商报价] 提交投标", "进入供应商报价：5 条，按模板顺序（含挪过来的「准备投标文件」「提交投标」）", names(quote));
    ok(quote[4].dueDate!.getTime() === closeDate.getTime() && quote.slice(0, 4).map((t) => Math.round((t.dueDate!.getTime() - t1) / DAY)).join() === "2,3,4,5" && quote.slice(3).every((t) => t.priority === "urgent"), "「提交投标」的到期日就是项目的截标时间；别的按天数", quote.map((t) => t.dueDate));
    const PN = await mkProject(null);
    const t2 = Date.now();
    await onStageAdvancedTasks(PN, "supplier_inquiry", "supplier_quote", OWNER);
    ok(Math.round(((await tasks(PN, "[供应商报价] 提交投标"))[0].dueDate!.getTime() - t2) / DAY) === 6, "项目没有截标时间：「提交投标」按天数算");
    const PO = await mkProject(-1);
    const t3 = Date.now();
    await onStageAdvancedTasks(PO, "supplier_inquiry", "supplier_quote", OWNER);
    ok(Math.round(((await tasks(PO, "[供应商报价] 提交投标"))[0].dueDate!.getTime() - t3) / DAY) === 6, "截标时间已过：同样按天数算（不给一个已经过去的到期日）");

    /* ---------- 4. 不重复 ---------- */
    await onStageAdvancedTasks(P, "supplier_inquiry", "supplier_quote", OWNER);
    ok((await tasks(P, "[供应商报价]")).length === 5, "同一个阶段再调一次：不再建一批");
    await Promise.all([onStageAdvancedTasks(PN, "distribution", "interpretation", OTHER), sleep(0)]);
    ok((await tasks(PN, "[项目解读]")).every((t) => t.creatorId === OTHER && t.assigneeId === OTHER), "创建人与负责人是这一次推进的那个人");

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
    const adv = await advanceProjectStage({ projectId: PE, targetStage: "supplier_inquiry", reason: "fixture", source: "manual", actor: { id: OWNER, name: "Fixture", email: `${OWNER}@fixture.test` }, humanConfirmed: true });
    let viaEntry = await tasks(PE, "[供应商询价]");
    for (let i = 0; i < 20 && viaEntry.length < 2; i++) { await sleep(100); viaEntry = await tasks(PE, "[供应商询价]"); } // 建任务是推进之后异步做的
    ok(adv.success && names(viaEntry) === "[供应商询价] 发送供应商询价单|[供应商询价] 跟进供应商回复", "调用阶段推进把项目推进到供应商询价：推进成功，项目里出现这一阶段的 2 条任务", { adv, viaEntry: names(viaEntry) });
    const adv2 = await advanceProjectStage({ projectId: PE, targetStage: "submission", reason: "fixture", source: "manual", actor: { id: OWNER, name: "Fixture", email: `${OWNER}@fixture.test` }, humanConfirmed: true });
    await sleep(700);
    ok(adv2.success && (await tasks(PE, "[供应商询价]")).every((t) => t.status === "done") && (await tasks(PE, "[项目提交]")).length === 0 && (await tasks(PE)).length === 2, "再推进到项目提交：上一阶段的任务被关掉，没有建「提交投标」之类的任务");
    // 建任务失败不让阶段推进失败：项目不存在外键指向的人时建任务会失败
    const PF = await mkProject(20);
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...a: unknown[]) => { errors.push(a); };
    const adv3 = await advanceProjectStage({ projectId: PF, targetStage: "interpretation", reason: "fixture", source: "manual", actor: { id: `ghost_${stamp}`, name: "Ghost", email: "ghost@fixture.test" }, humanConfirmed: true }).catch((e) => ({ success: false, thrown: String(e) }));
    await sleep(700);
    console.error = origError;
    ok((await tasks(PF)).length === 0, "推进的人不存在（建任务会因外键失败）：没有建出任务");
    ok(errors.some((e) => JSON.stringify(e).includes("[StageTasks] failed")) || !(adv3 as { success: boolean }).success, "这种失败留下了「[StageTasks] failed」的错误日志（或阶段推进本身就没成功），不是无声无息", { adv3, errors: errors.length });
  } finally {
    await sleep(300);
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

  console.log(`\nFIX-5 stage tasks DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
