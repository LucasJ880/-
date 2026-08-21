/**
 * RFI 问题清单导出探针（RFI-01..08）
 * 运行：npx tsx src/lib/projects/generate/__tests__/rfi-export.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildRfiItems,
  looksEnglish,
  renderRfiHtml,
  translateRfiToEn,
} from "@/lib/projects/generate/rfi-export";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

async function main() {
  console.log("RFI 问题清单导出探针");

  // RFI-01 合并去重 + 编号 + 来源 + 备忘录优先、澄清按优先级
  const items = buildRfiItems({
    memoRfis: [
      { questionZh: "请确认现任供应商及其年度合同金额。", whyZh: "定价对标" },
      { questionZh: "保险要求是否适用？", whyZh: "RFQ 写 NA，PO 有清单" },
    ],
    synthesisClarifications: [
      { questionZh: "提问截止日期是什么？", reasonZh: "文件未给", priority: "MEDIUM" },
      { questionZh: "请确认现任供应商及其年度合同金额", reasonZh: "重复", priority: "BLOCKING" },
      { questionZh: "境外云托管是否可接受？", reasonZh: "PIIDPA", priority: "BLOCKING" },
    ],
  });
  ok(
    items.length === 4 &&
      items[0]!.source === "memo" && items[1]!.source === "memo" &&
      items[2]!.questionZh.startsWith("境外云托管") && items[2]!.source === "analysis" &&
      items[3]!.questionZh.startsWith("提问截止") &&
      items.map((i) => i.n).join(",") === "1,2,3,4",
    "RFI-01: 备忘录优先 → 澄清按 BLOCKING 先；跨源去重（标点差异不算新问题）；连续编号",
    items.map((i) => `${i.n}:${i.source}:${i.questionZh.slice(0, 10)}`),
  );
  ok(buildRfiItems({ memoRfis: null, synthesisClarifications: null }).length === 0, "RFI-02: 无来源 → 空清单（不编造问题）");
  ok(
    buildRfiItems({ memoRfis: Array.from({ length: 30 }, (_, i) => ({ questionZh: `问题 ${i}？` })), synthesisClarifications: null }).length === 20,
    "RFI-03: 上限 20 条",
  );

  // RFI-04 反向守卫：译文必须是英文
  ok(
    looksEnglish("Please confirm the incumbent supplier and its annual contract value.") &&
      !looksEnglish("请确认现任供应商及其年度合同金额。") &&
      !looksEnglish("Please confirm 现任 supplier"),
    "RFI-04: looksEnglish 两向（含混入中文 → 拒）",
  );

  // RFI-05 翻译：注入 invoker 成功；照抄中文 → 留空待人工；invoker 坏 → 全部留空不抛
  {
    const good: LlmInvoker = async (req) => {
      const p = JSON.parse(req.userPrompt) as { items: { i: number; zh: string }[] };
      return { content: JSON.stringify({ items: p.items.map((it) => ({ i: it.i, en: `Please confirm item ${it.i} (value 42,540.75).` })) }), model: "fake", elapsedMs: 1 };
    };
    const a = buildRfiItems({ memoRfis: [{ questionZh: "问题一？" }, { questionZh: "问题二？" }], synthesisClarifications: null });
    const r1 = await translateRfiToEn(a, { invoker: good });
    const copy: LlmInvoker = async (req) => {
      const p = JSON.parse(req.userPrompt) as { items: { i: number; zh: string }[] };
      return { content: JSON.stringify({ items: p.items.map((it) => ({ i: it.i, en: it.zh })) }), model: "fake", elapsedMs: 1 };
    };
    const b = buildRfiItems({ memoRfis: [{ questionZh: "问题一？" }], synthesisClarifications: null });
    const r2 = await translateRfiToEn(b, { invoker: copy });
    const bad: LlmInvoker = async () => { throw new Error("boom"); };
    const c = buildRfiItems({ memoRfis: [{ questionZh: "问题一？" }], synthesisClarifications: null });
    const r3 = await translateRfiToEn(c, { invoker: bad });
    ok(
      r1.translated === 2 && a.every((i) => i.questionEn?.includes("42,540.75")) &&
        r2.translated === 0 && b[0]!.questionEn === null &&
        r3.translated === 0 && r3.failed === 1 && c[0]!.questionEn === null,
      "RFI-05: 成功回写 EN（数字保留）；照抄中文 → 拒；模型坏 → 留空不抛",
      { r1, r2, r3 },
    );
  }

  // RFI-06 渲染：转义 + 待译标注 + 元信息（提问截止未知时明示）
  {
    const html = renderRfiHtml({
      projectName: "Halifax <Media>",
      tenderNumber: "HRM-2026-0395",
      buyer: "HRM",
      questionDeadline: null,
      closing: "2026-09-08 14:00 Atlantic",
      submitChannel: "Bids&Tenders",
      items: [
        { n: 1, questionZh: "A<b>", whyZh: "w", source: "memo", questionEn: "Please confirm <A>." },
        { n: 2, questionZh: "B", whyZh: null, source: "analysis", questionEn: null },
      ],
      generatedAt: "2026-08-21 10:00",
    });
    ok(
      html.includes("Halifax &lt;Media&gt;") && html.includes("Please confirm &lt;A&gt;.") && html.includes("A&lt;b&gt;") &&
        html.includes("EN translation pending") && html.includes("文件未明确——请以门户公告为准") && html.includes("HRM-2026-0395") &&
        !html.includes("<b>"),
      "RFI-06: HTML 转义、待译标注、提问截止未知明示",
    );
  }

  // RFI-07/08 结构守卫
  {
    const gd = code("src/lib/projects/generate/generate-docs.ts");
    ok(
      gd.includes('import("./rfi-export")') && gd.includes("buildRfiItems(") && gd.includes("translateRfiToEn(") && gd.includes("htmlOverride = renderRfiHtml("),
      "RFI-07: owner_clarification 走 RFI 清单（备忘录 + 分析澄清 → 翻译 → HTML 覆盖）",
    );
    const menu = readFileSync(join(process.cwd(), "src/components/project-generate/project-generate-menu.tsx"), "utf-8");
    ok(menu.includes("RFI 问题清单 PDF"), "RFI-08: 生成菜单文案已改为 RFI 问题清单");
  }

  {
    const slots = readFileSync(join(process.cwd(), "src/components/tender-intel/org-award-intel-slots.tsx"), "utf-8");
    ok(
      slots.includes('data-testid="export-rfi-pdf"') && slots.includes('docType: "owner_clarification"') && slots.includes("提交前请人工核对"),
      "RFI-09: 备忘录卡一键导出按钮走既有文档链，并提示人工核对英文",
    );
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}
void main().catch((e) => { console.error(e); process.exit(1); });
