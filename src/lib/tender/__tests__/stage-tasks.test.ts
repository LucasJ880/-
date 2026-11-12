/**
 * FIX-5 阶段推进之后的自动任务 — 纯逻辑测试
 * 运行：npx tsx src/lib/tender/__tests__/stage-tasks.test.ts
 * 真实数据库里的行为另见 stage-tasks-db.isolated.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGE_TASK_TEMPLATES, buildStageTaskRows } from "../stage-tasks";
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
  ok("任务数据里只有这九项——没有 sortOrder，也没有别的任务表不认识的列", all.every((r) => Object.keys(r).sort().join() === "assigneeId,createdAt,creatorId,description,dueDate,priority,projectId,status,title"));
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const taskModel = schema.slice(schema.indexOf("model Task {"), schema.indexOf("\n}", schema.indexOf("model Task {")));
  ok("这九项在任务表里都有对应的列（任务表仍然没有 sortOrder）", Object.keys(all[0]).every((k) => new RegExp(`^\\s+${k}\\s`, "m").test(taskModel)) && !/^\s+sortOrder\s/m.test(taskModel));
}

console.log("顺序与到期日");
{
  const q = rows("supplier_quote");
  ok("同一批任务的创建时间依次加 1 毫秒：按创建时间排就是模板的顺序", q.map((r) => r.createdAt.getTime() - NOW.getTime()).join() === "0,1,2,3,4");
  ok("到期日 = 进入阶段那一刻 + 模板里的天数", q.map((r) => Math.round((r.dueDate!.getTime() - NOW.getTime()) / DAY)).join() === "2,3,4,5,6" && rows("distribution").map((r) => (r.dueDate!.getTime() - NOW.getTime()) / DAY).join() === "1,2");
  const close = new Date(NOW.getTime() + 10 * DAY + 3_600_000);
  const withClose = rows("supplier_quote", close);
  ok("有截标时间（10 天后）：「提交投标」的到期日就是截标时间；别的任务仍按天数", withClose[4].dueDate!.getTime() === close.getTime() && withClose.slice(0, 4).map((r) => Math.round((r.dueDate!.getTime() - NOW.getTime()) / DAY)).join() === "2,3,4,5");
  ok("截标时间只剩 1 天：「提交投标」照样取截标时间（比按天数算的更早）", rows("supplier_quote", new Date(NOW.getTime() + DAY))[4].dueDate!.getTime() === NOW.getTime() + DAY);
  ok("没有截标时间、截标时间已过、正好是现在：按天数算", [null, new Date(NOW.getTime() - DAY), new Date(NOW.getTime())].every((c) => rows("supplier_quote", c)[4].dueDate!.getTime() === NOW.getTime() + 6 * DAY));
  ok("只有「提交投标」一条看截标时间", Object.values(STAGE_TASK_TEMPLATES).flat().filter((t) => t?.dueAtClose).map((t) => t!.title).join() === "提交投标");
  ok("确定性：同样的输入两次结果相同", JSON.stringify(rows("interpretation", close)) === JSON.stringify(rows("interpretation", close)));
}

console.log("接线");
{
  const src = readFileSync(join(process.cwd(), "src/lib/tender/stage-tasks.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const transition = readFileSync(join(process.cwd(), "src/lib/tender/stage-transition.ts"), "utf8");
  ok("代码里不再往任务上写 sortOrder", !/sortOrder/.test(code));
  ok("先关上一阶段的、再建新阶段的；指明不建时只关不建；新阶段已有没完成的自动任务时不再建", (() => { const close = code.indexOf('status: "done",'); const skip = code.indexOf("if (opts.skipCreate) return;"); const dedupe = code.indexOf("if (existing > 0) return;"); const create = code.indexOf("db.task.createMany({ data: tasks })"); return close > 0 && close < skip && skip < dedupe && dedupe < create; })());
  ok("建任务用的就是上面那个纯函数算出来的内容，截标时间取自项目", code.includes("const tasks = buildStageTaskRows({ stage: toStage, projectId, actorId, now, closeDate: project?.closeDate ?? null });") && code.includes("db.project.findUnique({ where: { id: projectId }, select: { closeDate: true } })"));
  ok("关任务只认「[上一阶段名]」开头、待办或进行中的", /title: \{ startsWith: prefix \},\s*status: \{ in: \["todo", "in_progress"\] \},/.test(code));
  ok("阶段推进调用它；失败只记日志，不让阶段推进失败", /onStageAdvancedTasks\(projectId, currentStage, targetStage, actor\.id[^)]*\)\s*\.catch\(\(err\) => console\.error\("\[StageTasks\] failed:", err\)\);/.test(transition));
  ok("不调模型、不发请求", !/createCompletion|openai|anthropic|fetch\(/i.test(code));
}

console.log(`\n✓ stage-tasks: ${passed} 项断言全部通过`);
