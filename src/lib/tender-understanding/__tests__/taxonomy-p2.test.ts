/**
 * 批次二 — 抽取分类学扩容（纯平面，零模型）
 *
 * HRM-2026-0395 实测盲区：现任供应商与授标评分标准两类关键事实无槽位可落。
 * P2T-*   taxonomy 扩容与双源同步；DOC_STATED 情报直通
 * 反例守卫：prompt factType 行与 enum 永远同步（解析比对，防再漂移）。
 *
 * 运行：npx tsx src/lib/tender-understanding/__tests__/taxonomy-p2.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CRITICAL_FACT_TYPES, factTypeSchema } from "../contract";
import { PROMPT_EXTRACT } from "../prompts";
import { buildExecutiveBrief } from "@/lib/tender-auto-analysis/executive-brief";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

console.log("批次二 — 抽取分类学扩容");

ok(
  (CRITICAL_FACT_TYPES as readonly string[]).includes("incumbent_supplier") &&
    (CRITICAL_FACT_TYPES as readonly string[]).includes("evaluation_criteria"),
  "P2T-01: enum 新增 incumbent_supplier + evaluation_criteria",
);
ok(
  factTypeSchema.safeParse("evaluation_criteria").success &&
    factTypeSchema.safeParse("incumbent_supplier").success,
  "P2T-02: zod schema 同步接受新类型",
);
ok(
  PROMPT_EXTRACT.version === "tender-understanding-v2-extract@5",
  "P2T-03: 抽取 prompt 升 @5（带 changelog）",
);

// 反例守卫：prompt 的 factType 枚举行与 enum 永远同步（解析比对）
const prompts = read("src/lib/tender-understanding/prompts.ts");
const m = prompts.match(/"factType": "([a-z_|]+)"/);
ok(!!m, "P2T-04a: prompt 中存在 factType 枚举行");
if (m) {
  const promptTypes = new Set(m[1].split("|"));
  const enumTypes = new Set([...CRITICAL_FACT_TYPES, "other"]);
  const missing = [...enumTypes].filter((t) => !promptTypes.has(t));
  const extra = [...promptTypes].filter((t) => !enumTypes.has(t));
  ok(
    missing.length === 0 && extra.length === 0,
    "P2T-04（反例守卫）: prompt factType 行 ≡ enum+other（双源零漂移）",
    { missing, extra },
  );
}
ok(
  prompts.includes("COMPETITIVE LANDSCAPE") &&
    prompts.includes("AWARD/EVALUATION CRITERIA") &&
    prompts.includes("numbers/formula verbatim"),
  "P2T-05: 覆盖指引 d/e（现任供应商可未具名也抽取；评分数字逐字入 rawValue）",
);

// DOC_STATED：文档自述现任供应商 → 情报 previousWinner 直通（优先级低于人工/AI）
const brief = buildExecutiveBrief({
  run: { status: "REVIEW_REQUIRED", fingerprint: "f", source: { oneLiner: null, buyer: null, product: null, recommendation: null, nextActions: [], blockers: [], unresolvedConflictCount: 0 } as never },
  currentFingerprint: "f",
  projectType: null,
  externalConfirmed: null,
  externalAnalysis: null,
  docStatedIncumbent: "现有供应商自 2021-11 提供服务，合同 2026-11-01 到期（未具名）",
});
ok(
  brief.external.previousWinner.state === "DOC_STATED" &&
    (brief.external.previousWinner.value ?? "").includes("2021-11"),
  "P2T-06: DOC_STATED 态生效（『明明有供应商却显示没有』根治）",
  brief.external.previousWinner,
);
const brief2 = buildExecutiveBrief({
  run: { status: "REVIEW_REQUIRED", fingerprint: "f", source: { oneLiner: null, buyer: null, product: null, recommendation: null, nextActions: [], blockers: [], unresolvedConflictCount: 0 } as never },
  currentFingerprint: "f",
  projectType: null,
  externalConfirmed: { previousWinner: "Meltwater News Canada Inc." },
  externalAnalysis: null,
  docStatedIncumbent: "现有供应商（未具名）",
});
ok(
  brief2.external.previousWinner.state === "READY",
  "P2T-07: 人工确认仍最高优先（DOC_STATED 不越权）",
);
ok(
  read("src/components/bid-workflow/project-intel-sections.tsx").includes("文档载明 · 名称待核"),
  "P2T-08: UI 状态词典含 DOC_STATED",
);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
