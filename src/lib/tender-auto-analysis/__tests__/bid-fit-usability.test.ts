/**
 * 合规矩阵可用性批次探针（BF-01..10）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/bid-fit-usability.test.ts
 *
 * 覆盖：分组契约全覆盖（枚举扩容漏配即红）、语言启发式两向、翻译服务
 * 失败回退/反向守卫/上限语义、路由批量校验 fail-closed、管线挂点在事务外、
 * UI 词典与批量按钮存在。纯平面：不出站、不连库。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BID_FIT_GROUPS,
  bidFitGroupOf,
} from "@/lib/tender-auto-analysis/bid-fit-groups";
import { needsChineseTranslation } from "@/lib/tender-auto-analysis/requirement-lang";
import {
  translateRequirementTexts,
  TRANSLATE_BATCH_SIZE,
  TRANSLATE_MAX_ITEMS,
} from "@/lib/tender-auto-analysis/requirement-translate";
import { REQUIREMENT_CATEGORIES } from "@/lib/tender-understanding/contract";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

async function main() {
  console.log("合规矩阵可用性批次探针");

  // BF-01 分组契约全覆盖：每个 category（小写）恰好落一组
  {
    const seen = new Map<string, number>();
    for (const g of BID_FIT_GROUPS) {
      for (const c of g.categories) seen.set(c, (seen.get(c) ?? 0) + 1);
    }
    const missing = REQUIREMENT_CATEGORIES.map((c) => c.toLowerCase()).filter(
      (c) => !seen.has(c),
    );
    const dupes = [...seen].filter(([, n]) => n > 1).map(([c]) => c);
    ok(
      missing.length === 0 && dupes.length === 0,
      "BF-01: REQUIREMENT_CATEGORIES 全覆盖且无重复归组（枚举扩容漏配即红）",
      { missing, dupes },
    );
  }

  // BF-02 兜底与折叠默认：未知值→other；程序组默认折叠、判断组默认展开
  ok(
    bidFitGroupOf("garbage-legacy-value") === "other" &&
      bidFitGroupOf(null) === "other" &&
      bidFitGroupOf("TECHNICAL") === "technical",
    "BF-02: 未知/空 category 兜底 other；大小写不敏感",
  );
  ok(
    BID_FIT_GROUPS.find((g) => g.key === "procedural")!.defaultCollapsed === true &&
      BID_FIT_GROUPS.filter((g) => g.key !== "procedural").every(
        (g) => !g.defaultCollapsed,
      ),
    "BF-03: 仅程序类默认折叠（判断类默认展开）",
  );

  // BF-04 语言启发式两向
  ok(
    needsChineseTranslation(
      "The bidder must provide proof of WCB coverage upon request.",
    ) &&
      !needsChineseTranslation("投标人须按要求提供 WCB 保险证明（ISO 9001）。") &&
      !needsChineseTranslation("  "),
    "BF-04: 英文→需翻；中英混排真中文→不重翻；空白→不翻",
  );

  // BF-05 翻译服务：成功路径 + 跳过统计（注入 invoker，零出站）
  {
    const invoker: LlmInvoker = async (req) => {
      const parsed = JSON.parse(req.userPrompt) as {
        items: { i: number; text: string }[];
      };
      return {
        content: JSON.stringify({
          items: parsed.items.map((it) => ({ i: it.i, zh: `中文译文：${it.text.slice(0, 20)}` })),
        }),
        model: "test-fake",
        elapsedMs: 1,
      };
    };
    const texts = ["Must submit in English.", "已是中文的条目。", "Provide two references."];
    const applied: Record<number, string> = {};
    const out = await translateRequirementTexts(texts, {
      invoker,
      apply: (idx, zh) => { applied[idx] = zh; },
    });
    ok(
      out.translated === 2 && out.skipped === 1 && out.failed === 0 &&
        applied[0]?.startsWith("中文译文") && applied[2] != null && applied[1] == null,
      "BF-05: 只翻英文条目并原位回写；中文条目零模型花费",
      out,
    );
  }

  // BF-06 反向守卫：模型照抄英文 → 该条回退不写入
  {
    const invoker: LlmInvoker = async (req) => {
      const parsed = JSON.parse(req.userPrompt) as { items: { i: number; text: string }[] };
      return {
        content: JSON.stringify({ items: parsed.items.map((it) => ({ i: it.i, zh: it.text })) }),
        model: "test-fake",
        elapsedMs: 1,
      };
    };
    let appliedCount = 0;
    const out = await translateRequirementTexts(["Still English output."], {
      invoker,
      apply: () => { appliedCount++; },
    });
    ok(
      out.translated === 0 && out.failed === 1 && appliedCount === 0,
      "BF-06（反例守卫）: 模型返回仍是英文 → 回退计 failed，绝不写入假译文",
      out,
    );
  }

  // BF-07 异常回退：invoker 抛错 → 全部 failed，不抛出
  {
    const invoker: LlmInvoker = async () => {
      throw new Error("boom");
    };
    const out = await translateRequirementTexts(["English one.", "English two."], {
      invoker,
      apply: () => {},
    });
    ok(
      out.translated === 0 && out.failed === 2,
      "BF-07: 模型异常整批回退（管线/端点不被拖垮）",
      out,
    );
  }

  // BF-08 分批与上限语义（真实 E2E 教训：200 条单批必超时/截断）
  {
    let calls = 0;
    let maxBatch = 0;
    const invoker: LlmInvoker = async (req) => {
      calls++;
      const parsed = JSON.parse(req.userPrompt) as { items: { i: number }[] };
      maxBatch = Math.max(maxBatch, parsed.items.length);
      return {
        content: JSON.stringify({ items: parsed.items.map((it) => ({ i: it.i, zh: "中文" })) }),
        model: "test-fake",
        elapsedMs: 1,
      };
    };
    const texts = Array.from({ length: TRANSLATE_MAX_ITEMS + 30 }, (_, i) => `English ${i}.`);
    const out = await translateRequirementTexts(texts, { invoker, apply: () => {} });
    ok(
      maxBatch <= TRANSLATE_BATCH_SIZE &&
        calls === Math.ceil(TRANSLATE_MAX_ITEMS / TRANSLATE_BATCH_SIZE),
      `BF-08a（反例守卫）: 分批发送 ≤${TRANSLATE_BATCH_SIZE} 条/批（单批全量写法不得回归；calls=${calls}）`,
    );
    ok(
      out.translated === TRANSLATE_MAX_ITEMS,
      `BF-08b: 超 TRANSLATE_MAX_ITEMS 部分本轮保留原文（translated=${out.translated}）`,
      out,
    );
  }

  // BF-08c 批间独立失败：第二批持续坏（穿透 callStructured 的瞬态重试）→
  // 其余批照常成功
  {
    const invoker: LlmInvoker = async (req) => {
      // 第二批（含全局下标 50 的条目）永远失败
      if (req.userPrompt.includes(`English ${TRANSLATE_BATCH_SIZE}.`)) {
        throw new Error("boom-batch-2");
      }
      const parsed = JSON.parse(req.userPrompt) as { items: { i: number }[] };
      return {
        content: JSON.stringify({ items: parsed.items.map((it) => ({ i: it.i, zh: "中文" })) }),
        model: "test-fake",
        elapsedMs: 1,
      };
    };
    const texts = Array.from({ length: TRANSLATE_BATCH_SIZE * 3 }, (_, i) => `English ${i}.`);
    const out = await translateRequirementTexts(texts, { invoker, apply: () => {} });
    ok(
      out.translated === TRANSLATE_BATCH_SIZE * 2 && out.failed === TRANSLATE_BATCH_SIZE,
      "BF-08c: 一批失败不拖累其余批（独立失败）",
      out,
    );
  }

  // BF-09 路由结构守卫：批量校验 fail-closed + 挂点在事务外
  {
    const route = code("src/app/api/projects/[id]/bid-fit/route.ts");
    ok(
      /owned !== new Set\(ids\)\.size/.test(route) && /ids\.length > 300/.test(route),
      "BF-09a: 批量标注全量归属校验（任一无效整体拒绝）+ 300 上限",
    );
    const translateRoute = code("src/app/api/projects/[id]/bid-fit/translate/route.ts");
    ok(
      /requireProjectWriteAccess/.test(translateRoute) &&
        /RATE_WINDOW_MS/.test(translateRoute) &&
        /status:\s*429/.test(translateRoute),
      "BF-09b: 补翻端点写权限门 + 60s 频控",
    );
    const resumable = code("src/lib/tender-auto-analysis/v2-resumable.ts");
    const idx = resumable.indexOf("translateRequirementTexts");
    ok(
      idx > 0 &&
        resumable.slice(idx - 900, idx).includes("ensureLease()") &&
        /try\s*\{[\s\S]{0,600}translateRequirementTexts/.test(resumable),
      "BF-09c: 管线翻译挂点在租约后组装段（事务外）且 try 包裹不阻塞终态化",
    );
  }

  // BF-10 UI 词典与批量入口存在（不测渲染，测契约面）
  {
    const ui = readFileSync(
      join(process.cwd(), "src/components/tender-analysis/bid-fit-matrix-card.tsx"),
      "utf-8",
    );
    ok(
      ui.includes('data-testid="bid-fit-mark-all-have"') &&
        ui.includes('data-testid="bid-fit-translate"') &&
        ui.includes("bidFitGroupOf") &&
        ui.includes("window.confirm"),
      "BF-10: UI 含全部设为已有（带确认）/翻译按钮/分组渲染",
    );
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
