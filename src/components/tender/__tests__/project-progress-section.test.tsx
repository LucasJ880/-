/**
 * FLOW-H1b 项目进度区渲染出来的内容（服务端静态渲染，无浏览器 / 无 DB）
 * （openspec change tender-web-progress-from-facts，spec tender/web-progress）
 * 运行：npx tsx src/components/tender/__tests__/project-progress-section.test.tsx
 */
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TenderProject } from "@/lib/tender/types";
import { ProjectProgressSection } from "../project-progress-section";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// 把时钟定在测试开始的这一刻：两次渲染之间时间不走（时间轴上「今天」的位置精确到毫秒），
// 这样「渲染结果逐字相同」才比得了。日期仍相对真实的现在算，不会到某一天之后失效。
const RealDate = Date;
const FIXED = RealDate.now();
class FixedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(FIXED);
    else super(...(args as [number]));
  }
  static now() {
    return FIXED;
  }
}
globalThis.Date = FixedDate as DateConstructor;

const DAY = 86_400_000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const project = (o: Partial<TenderProject> = {}): TenderProject => ({
  createdAt: iso(-12), tenderStatus: null, publicDate: null, questionCloseDate: null, closeDate: iso(40), dueDate: null,
  distributedAt: iso(-10), interpretedAt: null, supplierInquiredAt: null, supplierQuotedAt: null, submittedAt: null, awardDate: null, intakeStatus: "dispatched", ...o,
});
type Extra = { shownStage?: string | null; recordedStageNow?: string | null };
const html = (p: TenderProject, extra: Extra = {}) => renderToStaticMarkup(<ProjectProgressSection project={p} projectId="p1" canManage {...extra} />);
/** 去掉标签后的文字（标签之间不留空格，方便按「当前阶段：供应商报价」这样连着核对） */
const text = (markup: string) => markup.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"');
/** 六段各自的状态，按顺序 */
const steps = (markup: string) => [...markup.matchAll(/data-stage="([a-z_]+)" data-status="([a-z_]+)"/g)].map((m) => `${m[1]}:${m[2]}`).join();
const note = (markup: string) => markup.match(/<p[^>]*data-testid="progress-stage-note"[^>]*>([\s\S]*?)<\/p>/)?.[1].replace(/<!--.*?-->/g, "") ?? null;
/** 进度条那一条的宽度 */
const barWidth = (markup: string) => markup.match(/style="width:(\d+)%"/)?.[1] ?? null;

console.log("没有「下一步」：与原来相同");
const p = project(); // 记录的阶段：项目分发
const base = html(p);
{
  ok("当前阶段是记录的项目分发，完成 0%，没有说明", text(base).includes("当前阶段：项目分发") && text(base).includes("完成进度：0%") && note(base) === null, text(base).slice(0, 200));
  ok("六段：立项已完成，项目分发是当前，其余待办", steps(base) === "initiation:completed,distribution:current,interpretation:pending,supplier_inquiry:pending,supplier_quote:pending,submission:pending", steps(base));
  ok("两项都不传、传空、只传记录的阶段、传认不出的值：渲染结果逐字相同", [{}, { shownStage: null, recordedStageNow: null }, { shownStage: undefined }, { recordedStageNow: "supplier_quote" }, { shownStage: "nonsense", recordedStageNow: "supplier_quote" }, { shownStage: "" }].every((e) => html(p, e) === base));
}

console.log("记录落后：显示实际到达的阶段，并写明");
{
  const m = html(p, { shownStage: "supplier_quote", recordedStageNow: "distribution" });
  const t = text(m);
  ok("「当前阶段」写的是供应商报价（不是记录的项目分发）", t.includes("当前阶段：供应商报价") && !t.includes("当前阶段：项目分发"), t.slice(0, 200));
  ok("完成进度两处都是 40%：上面的文字与进度条旁的数字；进度条宽度 40%", t.includes("完成进度：40%") && (t.match(/40%/g) ?? []).length === 2 && !t.includes("完成进度：0%") && barWidth(m) === "40", { t: t.slice(0, 300), width: barWidth(m) });
  ok("六段：前四段已完成，供应商报价是当前，项目提交待办", steps(m) === "initiation:completed,distribution:completed,interpretation:completed,supplier_inquiry:completed,supplier_quote:current,submission:pending", steps(m));
  ok("有一行说明，看得见（没有被隐藏），写出记录的阶段「项目分发」和「没有自动推进」", note(m) === "这里显示的是按实际进度得出的阶段。记录的阶段还是「项目分发」——阶段记录没有自动推进，别处（项目列表等）看到的仍是记录的阶段。" && !/<p[^>]*class="[^"]*\b(hidden|sr-only|invisible)\b[^"]*"[^>]*data-testid="progress-stage-note"/.test(m), note(m));
}

console.log("说明里的「记录的阶段」用接口那一刻读到的，不用页面上可能过时的项目数据");
{
  // 页面上的项目数据还是项目分发；接口说阶段记录已经到了供应商询价、显示供应商报价
  const m = html(p, { shownStage: "supplier_quote", recordedStageNow: "supplier_inquiry" });
  ok("说明写的是接口给的「供应商询价」，不是页面上旧的「项目分发」", !!note(m) && note(m)!.includes("记录的阶段还是「供应商询价」") && !note(m)!.includes("项目分发"), note(m));
  // 接口说阶段记录已经到了供应商询价、显示的也是供应商询价（别处刚把阶段记录写过）
  const same = html(p, { shownStage: "supplier_inquiry", recordedStageNow: "supplier_inquiry" });
  ok("接口说记录的与显示的相同：没有说明——即使页面上的项目数据还停在更早的一段", note(same) === null && text(same).includes("当前阶段：供应商询价") && text(same).includes("完成进度：20%"), text(same).slice(0, 200));
  // 接口没给记录的阶段（只给了显示的）：退回页面上的
  const noRecorded = html(p, { shownStage: "supplier_quote" });
  ok("接口只给了显示的阶段：说明里的记录的阶段退回页面上的项目数据", !!note(noRecorded) && note(noRecorded)!.includes("「项目分发」"), note(noRecorded));
}

console.log("记录超前、两者相同：没有说明");
{
  const ahead = project({ interpretedAt: iso(-8), supplierInquiredAt: iso(-6), supplierQuotedAt: iso(-3) });
  const m = html(ahead, { shownStage: "supplier_quote", recordedStageNow: "supplier_quote" });
  ok("记录已到供应商报价、接口显示的也是：与不传逐字相同，没有说明", m === html(ahead) && note(m) === null && text(m).includes("当前阶段：供应商报价"));
}

console.log("已逾期、已结束");
{
  const overdue = project({ closeDate: iso(-2) });
  const m = html(overdue, { shownStage: "supplier_inquiry", recordedStageNow: "distribution" });
  ok("已逾期：按显示的供应商询价画——前三段已完成，之后都是逾期；逾期提示照样在", steps(m) === "initiation:completed,distribution:completed,interpretation:completed,supplier_inquiry:overdue,supplier_quote:overdue,submission:overdue" && text(m).includes("项目已逾期，尚未提交") && text(m).includes("已逾期") && text(m).includes("当前阶段：供应商询价"), steps(m));
  ok("已逾期且不传：逾期提示同样在（与显示哪一段无关）", text(html(overdue)).includes("项目已逾期，尚未提交"));
  // 已结束的项目：接口给的显示的阶段就是记录的阶段
  const lost = project({ tenderStatus: "lost", interpretedAt: iso(-8), supplierInquiredAt: iso(-6) });
  const lm = html(lost, { shownStage: "supplier_inquiry", recordedStageNow: "supplier_inquiry" });
  ok("未中标的项目（接口给的显示的阶段 = 记录的）：与不传逐字相同，40%，没有说明", lm === html(lost) && text(lm).includes("完成进度：40%") && note(lm) === null);
}

console.log(`\n✓ project-progress-section: ${passed} 项断言全部通过`);
