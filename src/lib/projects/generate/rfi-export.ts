/**
 * RFI 问题清单导出（Lane 2）：把备忘录策略 RFI + 分析器澄清问题合成一份
 * 可直接提交给业主的中英对照问题单。
 *  - 来源只有两处（memo.strategicRfis / analystSynthesis.clarifications），去重后编号；
 *  - AI 只做中→英翻译（数字/代号逐字），不新增问题；翻译失败该条 EN 留空并标注待人工补译；
 *  - 渲染为 HTML（走 persistGeneratedHtml → Chromium PDF，中文完好）。
 */

import { z } from "zod";
import {
  callStructured,
  createUnifiedRuntimeInvoker,
  type LlmInvoker,
} from "@/lib/tender-understanding/llm";

export type RfiSource = "memo" | "analysis";

export type RfiItem = {
  n: number;
  questionZh: string;
  whyZh: string | null;
  source: RfiSource;
  questionEn: string | null;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s，。？！、“”"'()（）:：;；\-–—]/g, "")
    .slice(0, 80);

export function buildRfiItems(input: {
  memoRfis: Array<{ questionZh?: unknown; whyZh?: unknown }> | null | undefined;
  synthesisClarifications: Array<{ questionZh?: unknown; reasonZh?: unknown; priority?: unknown }> | null | undefined;
  max?: number;
}): RfiItem[] {
  const out: RfiItem[] = [];
  const seen = new Set<string>();
  const push = (q: unknown, why: unknown, source: RfiSource) => {
    const question = typeof q === "string" ? q.trim() : "";
    if (!question) return;
    const key = norm(question);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      n: out.length + 1,
      questionZh: question.slice(0, 400),
      whyZh: typeof why === "string" && why.trim() ? why.trim().slice(0, 300) : null,
      source,
      questionEn: null,
    });
  };
  // 备忘录策略 RFI 优先（面向评分/竞争的关键问题），其后分析器澄清（BLOCKING/HIGH 在前）
  for (const r of input.memoRfis ?? []) push(r?.questionZh, r?.whyZh, "memo");
  const clars = [...(input.synthesisClarifications ?? [])].sort((a, b) => {
    const rank = (p: unknown) => (p === "BLOCKING" ? 0 : p === "HIGH" ? 1 : 2);
    return rank(a?.priority) - rank(b?.priority);
  });
  for (const c of clars) push(c?.questionZh, c?.reasonZh, "analysis");
  return out.slice(0, input.max ?? 20);
}

const enSchema = z.object({
  items: z.array(z.object({ i: z.number().int().min(0), en: z.string().min(1) })),
});

const EN_SYSTEM_PROMPT = `You translate bidder clarification questions from Simplified Chinese into formal, concise English suitable for submission to a Canadian public-sector procurement office (RFI / "Submit a Question").
Rules: translate faithfully (no new questions, no answers, no assumptions); keep numbers, dates, clause references, form names and proper nouns EXACTLY; one polite question per item; no preamble.
Output strict JSON: {"items":[{"i":<index>,"en":"<English question>"}]} covering EVERY index exactly once.`;

/** 反向守卫：译文须以拉丁字母为主（防照抄中文或混入说明） */
export function looksEnglish(s: string): boolean {
  const t = s.trim();
  if (t.length < 8) return false;
  const latin = t.match(/[A-Za-z]/g)?.length ?? 0;
  const cjk = t.match(/[一-鿿]/g)?.length ?? 0;
  return latin / t.length > 0.4 && cjk === 0;
}

export async function translateRfiToEn(
  items: RfiItem[],
  opts: { invoker?: LlmInvoker; timeoutMs?: number } = {},
): Promise<{ translated: number; failed: number; llmCalls: number }> {
  if (items.length === 0) return { translated: 0, failed: 0, llmCalls: 0 };
  try {
    const invoker = opts.invoker ?? createUnifiedRuntimeInvoker();
    const res = await callStructured(
      invoker,
      {
        promptName: "tender-rfi-translate-en",
        promptVersion: "1",
        systemPrompt: EN_SYSTEM_PROMPT,
        userPrompt: JSON.stringify({ items: items.map((it, i) => ({ i, zh: it.questionZh })) }),
        maxTokens: 8_000,
        timeoutMs: opts.timeoutMs ?? 60_000,
      },
      enSchema,
    );
    if (!res.ok) return { translated: 0, failed: items.length, llmCalls: res.logs.length };
    let translated = 0;
    const seen = new Set<number>();
    for (const it of res.value.items) {
      if (it.i < 0 || it.i >= items.length || seen.has(it.i)) continue;
      seen.add(it.i);
      const en = it.en.trim().slice(0, 600);
      if (!looksEnglish(en)) continue;
      items[it.i]!.questionEn = en;
      translated += 1;
    }
    return { translated, failed: items.length - translated, llmCalls: res.logs.length };
  } catch {
    return { translated: 0, failed: items.length, llmCalls: 1 };
  }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderRfiHtml(input: {
  projectName: string;
  tenderNumber: string | null;
  buyer: string | null;
  questionDeadline: string | null;
  closing: string | null;
  submitChannel: string | null;
  items: RfiItem[];
  generatedAt: string;
}): string {
  const rows = input.items
    .map(
      (it) => `<tr>
<td class="n">${it.n}</td>
<td class="en">${it.questionEn ? esc(it.questionEn) : '<span class="pending">(EN translation pending — 请人工补译)</span>'}</td>
<td class="zh">${esc(it.questionZh)}${it.whyZh ? `<div class="why">为什么问：${esc(it.whyZh)}</div>` : ""}</td>
<td class="src">${it.source === "memo" ? "策略备忘录" : "文件分析"}</td>
</tr>`,
    )
    .join("\n");
  const meta = [
    input.tenderNumber ? `招标编号：${esc(input.tenderNumber)}` : null,
    input.buyer ? `业主：${esc(input.buyer)}` : null,
    `提问截止：${input.questionDeadline ? esc(input.questionDeadline) : "文件未明确——请以门户公告为准"}`,
    input.closing ? `截标：${esc(input.closing)}` : null,
    input.submitChannel ? `提交渠道：${esc(input.submitChannel)}` : null,
  ]
    .filter(Boolean)
    .join(" ｜ ");
  return `<!doctype html><meta charset="utf-8"><title>RFI 问题清单</title>
<style>
body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;color:#1c1c1c;max-width:960px;margin:0 auto;padding:28px 24px;font-size:12px;line-height:1.6}
h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;margin:18px 0 6px}
.meta{color:#555;margin-bottom:12px}.note{background:#fff8e6;border:1px solid #f0d58c;padding:8px 10px;margin:10px 0}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #d6d6d6;padding:6px 8px;vertical-align:top;text-align:left}
th{background:#f3f4f6}.n{width:28px}.en{width:42%}.zh{width:40%}.src{width:70px;color:#666}
.why{color:#666;font-size:11px;margin-top:4px}.pending{color:#b45309}
@media print{body{padding:0}}
</style>
<h1>RFI 问题清单 / Clarification Questions</h1>
<div class="meta">${esc(input.projectName)}${meta ? " ｜ " + meta : ""} ｜ 生成：${esc(input.generatedAt)}</div>
<div class="note">英文列为可直接提交版本（AI 翻译，提交前请人工核对）；中文列供内部审阅。只问文件未明确的事项，不重复已在文件中回答的问题。</div>
<h2>Questions for submission (EN) / 问题（中文对照）</h2>
<table><thead><tr><th>#</th><th>Question (EN)</th><th>问题（中文）</th><th>来源</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="4">暂无问题——备忘录与分析均未产出 RFI。</td></tr>'}
</tbody></table>
<h2>Internal checklist（内部）</h2>
<ul><li>逐条核对英文措辞与数字/条款号</li><li>合并同类问题，删除文件已回答的</li><li>在门户「Submit a Question」逐条提交并留存截图</li></ul>`;
}
