/**
 * FIX-5 阶段推进之后的自动任务 — 纯逻辑测试
 * 运行：npx tsx src/lib/tender/__tests__/stage-tasks.test.ts
 * 真实数据库里的行为另见 stage-tasks-db.isolated.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGE_TASK_TEMPLATES, allStagePrefixes, buildStageTaskRows, earlierStagePrefixes } from "../stage-tasks";
import type { TenderStage } from "../types";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const DAY = 86_400_000;
const NOW = new Date("2026-11-12T15:00:00.000Z");
const rows = (stage: TenderStage, closeDate: Date | null = null) => buildStageTaskRows({ stage, projectId: "p1", actorId: "u1", now: NOW, closeDate });
const titles = (stage: TenderStage) => rows(stage).map((r) => r.title).join("|");

console.log("每个阶段建哪几条");
{
  ok("立项：不建任务", rows("initiation").length === 0);
  ok("项目分发：2 条，按模板顺序", titles("distribution") === "[项目分发] 分配项目负责人|[项目分发] 初步评估项目可行性");
  ok("项目解读：3 条", titles("interpretation") === "[项目解读] 精读招标文件|[项目解读] 确认投标资质要求|[项目解读] 编制投标计划");
  ok("供应商询价：2 条", titles("supplier_inquiry") === "[供应商询价] 发送供应商询价单|[供应商询价] 跟进供应商回复");
  ok("供应商报价：5 条——原有的 3 条，加上「准备投标文件」「提交投标」", titles("supplier_quote") === "[供应商报价] 汇总供应商报价|[供应商报价] 生成项目报价单|[供应商报价] 报价内部审核|[供应商报价] 准备投标文件|[供应商报价] 提交投标");
  ok("项目提交：不建任务（进入这个阶段 = 已经提交）", rows("submission").length === 0 && !("submission" in STAGE_TASK_TEMPLATES));
  const all = (["distribution", "interpretation", "supplier_inquiry", "supplier_quote"] as TenderStage[]).flatMap((s) => rows(s));
  ok("每条：待办、属于这个项目、创建人与负责人是推进阶段的人、有说明", all.length === 12 && all.every((r) => r.status === "todo" && r.projectId === "p1" && r.creatorId === "u1" && r.assigneeId === "u1" && r.description.length > 0));
  ok("优先级都是任务表认的值；「准备投标文件」「提交投标」是紧急", all.every((r) => ["low", "medium", "high", "urgent"].includes(r.priority)) && rows("supplier_quote").slice(3).every((r) => r.priority === "urgent"));
  ok("任务数据里只有这八项——没有 sortOrder，也没有别的任务表不认识的列（创建时间用表的默认值）", all.every((r) => Object.keys(r).sort().join() === "assigneeId,creatorId,description,dueDate,priority,projectId,status,title"));
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const taskModel = schema.slice(schema.indexOf("model Task {"), schema.indexOf("\n}", schema.indexOf("model Task {")));
  ok("这八项在任务表里都有对应的列（任务表仍然没有 sortOrder）", Object.keys(all[0]).every((k) => new RegExp(`^\\s+${k}\\s`, "m").test(taskModel)) && !/^\s+sortOrder\s/m.test(taskModel));
}

console.log("顺序与到期日");
{
  const q = rows("supplier_quote");
  ok("到期日 = 进入阶段那一刻 + 模板里的天数", q.map((r) => Math.round((r.dueDate!.getTime() - NOW.getTime()) / DAY)).join() === "2,3,4,5,6" && rows("distribution").map((r) => (r.dueDate!.getTime() - NOW.getTime()) / DAY).join() === "1,2");
  const close = new Date(NOW.getTime() + 10 * DAY + 3_600_000);
  const withClose = rows("supplier_quote", close);
  ok("有截标时间（10 天后）：「提交投标」的到期日就是截标时间；别的任务仍按天数", withClose[4].dueDate!.getTime() === close.getTime() && withClose.slice(0, 4).map((r) => Math.round((r.dueDate!.getTime() - NOW.getTime()) / DAY)).join() === "2,3,4,5");
  const soon = new Date(NOW.getTime() + DAY);
  ok("截标时间只剩 1 天：5 条的到期日都是截标时间（没有截标之后才到期的任务）", rows("supplier_quote", soon).every((r) => r.dueDate!.getTime() === soon.getTime()));
  const mid = new Date(NOW.getTime() + 3.5 * DAY);
  ok("截标时间在 3.5 天后：按天数早于截标的照天数（2、3 天），晚于截标的都取截标时间", rows("supplier_quote", mid).map((r) => r.dueDate!.getTime() === mid.getTime() ? "close" : String(Math.round((r.dueDate!.getTime() - NOW.getTime()) / DAY))).join() === "2,3,close,close,close");
  ok("别的阶段同样不晚于截标时间：供应商询价「跟进供应商回复」（5 天）在截标 3.5 天后时取截标时间", rows("supplier_inquiry", mid).map((r) => r.dueDate!.getTime()).join() === [NOW.getTime() + 2 * DAY, mid.getTime()].join());
  ok("没有截标时间、截标时间已过、正好是现在：5 条都按天数算", [null, new Date(NOW.getTime() - DAY), new Date(NOW.getTime())].every((c) => rows("supplier_quote", c).map((r) => (r.dueDate!.getTime() - NOW.getTime()) / DAY).join() === "2,3,4,5,6"));
  ok("只有「提交投标」一条看截标时间", Object.values(STAGE_TASK_TEMPLATES).flat().filter((t) => t?.dueAtClose).map((t) => t!.title).join() === "提交投标");
  ok("确定性：同样的输入两次结果相同", JSON.stringify(rows("interpretation", close)) === JSON.stringify(rows("interpretation", close)));
}

console.log("要关哪些阶段的");
{
  ok("进入供应商报价：关项目分发、项目解读、供应商询价三个阶段的（不只上一阶段）", earlierStagePrefixes("supplier_quote").join() === "[项目分发],[项目解读],[供应商询价]");
  ok("进入项目提交：关四个有模板的阶段", earlierStagePrefixes("submission").join() === "[项目分发],[项目解读],[供应商询价],[供应商报价]");
  ok("进入项目分发：没有要关的（立项没有模板）", earlierStagePrefixes("distribution").length === 0 && earlierStagePrefixes("initiation").length === 0);
  ok("放弃项目时撤掉的：四个有模板的阶段", allStagePrefixes().join() === "[项目分发],[项目解读],[供应商询价],[供应商报价]");
}

console.log("接线");
{
  const src = readFileSync(join(process.cwd(), "src/lib/tender/stage-tasks.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const transition = readFileSync(join(process.cwd(), "src/lib/tender/stage-transition.ts"), "utf8");
  ok("代码里不再往任务上写 sortOrder", !/sortOrder/.test(code));
  ok("先关之前阶段的、再看要不要建；不是进行中的项目不建；加锁之后查重、再建", (() => { const close = code.indexOf('status: "done",'); const skip = code.indexOf("if (opts.skipCreate) return;"); const active = code.indexOf('if (!project || project.status !== "active") return;'); const lock = code.indexOf("pg_advisory_xact_lock(hashtext(${`stage-tasks:${projectId}`}))"); const dedupe = code.indexOf("if (existing > 0) return;"); const create = code.indexOf("await tx.task.createMany({ data: tasks });"); return close > 0 && close < skip && skip < active && active < lock && lock < dedupe && dedupe < create; })());
  ok("建任务用的就是上面那个纯函数算出来的内容，截标时间取自项目", code.includes("const tasks = buildStageTaskRows({ stage: toStage, projectId, actorId, now, closeDate: project.closeDate ?? null });") && code.includes("db.project.findUnique({ where: { id: projectId }, select: { closeDate: true, status: true } })"));
  ok("关任务认的是新阶段之前所有阶段的前缀、待办或进行中的", /OR: prefixes\.map\(\(p\) => \(\{ title: \{ startsWith: p \} \}\)\),\s*status: \{ in: OPEN_AUTO_STATUSES \},/.test(code) && code.includes("const prefixes = earlierStagePrefixes(toStage);") && code.includes('const OPEN_AUTO_STATUSES = ["todo", "in_progress"];'));
  const abandon = readFileSync(join(process.cwd(), "src/app/api/projects/[id]/abandon/route.ts"), "utf8");
  ok("放弃项目：在同一个事务里、项目标为放弃之后撤掉还没完成的自动任务", (() => { const upd = abandon.indexOf('status: "abandoned",'); const cancel = abandon.indexOf("await cancelOpenStageTasks(id, tx);"); const end = abandon.indexOf("return result;"); return upd > 0 && upd < cancel && cancel < end; })());
  ok("阶段推进调用它；失败只记日志，不让阶段推进失败", /onStageAdvancedTasks\(projectId, currentStage, targetStage, actor\.id[^)]*\)\s*\.catch\(\(err\) => console\.error\("\[StageTasks\] failed:", err\)\);/.test(transition));
  ok("不调模型、不发请求", !/createCompletion|openai|anthropic|fetch\(/i.test(code));
}

console.log(`\n✓ stage-tasks: ${passed} 项断言全部通过`);
