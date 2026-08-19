/**
 * 情报自动流（包6）— 七槽位自动化（纯平面，零 DB / 零出站 / 零真实模型）
 *
 * 用户指令（2026-08-17）：槽位自动点亮，人工确认从「门」降级为「可选升级」。
 * 实现边界（不动摇）：
 * - 自动入库仅限**带 reference number 的政府公开数据** → SYSTEM_VERIFIED
 *   （awards.ts 白名单铁律明文允许），actor=system；ai/agent 写门照旧拒绝。
 * - Web 候选无权威 reference，不自动观察（人工确认线保留）。
 * - 策略草案 AI_INFERRED 标签、人审语义、无 GO/NO-GO。
 *
 * AF-OBS-*   自动观察层
 * AF-STR-*   策略合成
 * AF-UI-*    槽位渲染
 * 反例守卫：自动路径绝不产生 HUMAN_CONFIRMED；actor 绝不为 ai。
 *
 * 运行：npx tsx src/lib/tender-intel/__tests__/intel-auto-flow.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bidStrategyAutoSchema } from "../strategy";
import { isAutoObserveRelevant } from "../orchestrate";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

console.log("情报自动流（包6）— 七槽位自动化");

const orch = code("src/lib/tender-intel/orchestrate.ts");

// ── 自动观察层 ───────────────────────────────────────────
ok(
  orch.includes("createOrObserveAwardRecord") &&
    orch.includes('"SYSTEM_VERIFIED"') &&
    orch.includes("canadabuys:${ref}"),
  "AF-OBS-01: M1 权威候选自动观察入 canonical（SYSTEM_VERIFIED + canadabuys 幂等键）",
);
ok(
  orch.includes("if (!ref) continue"),
  "AF-OBS-02: 无 reference number 的候选不自动入库（白名单铁律前置）",
);
ok(
  orch.includes('actorType: "system"'),
  "AF-OBS-03: 观察 actor = system（确定性代码观察公开数据）",
);
ok(
  !orch.includes('"HUMAN_CONFIRMED"'),
  "AF-OBS-03b（反例守卫）: 自动路径绝不产生 HUMAN_CONFIRMED（升级只能人工）",
);
ok(
  !/actorType:\s*"ai/.test(orch) && !orch.includes('sourceKey: `web:'),
  "AF-OBS-04（反例守卫）: 无 ai actor；Web 候选不自动观察（仍走人工确认线）",
);
ok(
  orch.includes("isT4AwardSchemaReady()") && orch.includes("autoObserved"),
  "AF-OBS-05: T4 schema 门 fail-closed + 观察计数落显式状态",
);
const awards = code("src/lib/tender-intel/awards.ts");
ok(
  awards.includes("AWARD_AI_WRITE_DISABLED"),
  "AF-OBS-06（回归钉）: awards 写门 ai/agent 拒绝铁律原样",
);

// ── 相关性门（2026-08-19 生产复盘：真实 ≠ 相关） ──────────
ok(
  isAutoObserveRelevant({ candidateBuyer: "Regional Municipality of Durham", projectBuyer: "regional municipality of durham", hitQueryCount: 1 }) &&
    !isAutoObserveRelevant({ candidateBuyer: "City of Toronto", projectBuyer: "Regional Municipality of Durham", hitQueryCount: 1 }) &&
    isAutoObserveRelevant({ candidateBuyer: "City of Toronto", projectBuyer: "Regional Municipality of Durham", hitQueryCount: 2 }) &&
    !isAutoObserveRelevant({ candidateBuyer: null, projectBuyer: null, hitQueryCount: 1 }),
  "AF-OBS-07: 相关性门=买家归一匹配 或 交叉命中≥2（缺信息 fail-closed）",
);
ok(
  orch.includes("isAutoObserveRelevant({") &&
    /if \(!ref\) continue;[\s\S]{0,600}?isAutoObserveRelevant/.test(orch),
  "AF-OBS-08: 观察循环内逐候选过相关性门（无门直入的旧形状不存在）",
);

// ── 策略合成 ─────────────────────────────────────────────
const strat = read("src/lib/tender-intel/strategy.ts");
ok(
  strat.includes('label: "AI_INFERRED"') && strat.includes("No GO/NO-GO verdicts"),
  "AF-STR-01: 策略草案 AI_INFERRED 标签 + 禁 GO/NO-GO（人审语义）",
);
ok(
  strat.includes("Never invent history") && strat.includes("dataGapsZh"),
  "AF-STR-02: 证据纪律（不发明事实）+ UNKNOWN 域显式列为数据缺口",
);
const sample = bidStrategyAutoSchema.safeParse({
  strategyZh: "基于历史授标建议控制报价区间",
  keyPoints: [{ pointZh: "同买家历史中标价偏低", basedOn: "pricing" }],
  dataGapsZh: "竞争对手域暂无权威数据",
});
ok(sample.success, "AF-STR-03: 策略 schema 真实校验通过（样例）");
ok(
  orch.includes("synthesizeBidStrategyAuto") && orch.includes("bidStrategyAuto"),
  "AF-STR-04: 编排在检索后自动合成并落 room.summaryJson.bidStrategyAuto",
);

// ── 槽位渲染 ─────────────────────────────────────────────
const slots = read("src/components/tender-intel/org-award-intel-slots.tsx");
ok(
  slots.includes("bidStrategyAuto") &&
    slots.includes("不构成 GO/NO-GO 决定") &&
    slots.includes('status={strategy ? "INFERRED" : null}'),
  "AF-UI-01: 第 7 槽渲染策略草案（AI 推断徽标 + 人审免责）",
);
ok(
  slots.includes("自动入库") && slots.includes("升级为「已确认」"),
  "AF-UI-02: 文案改为自动流语义（确认=升级，不再是可见性的门）",
);
const route = read("src/app/api/projects/[id]/external-intel/award-history/route.ts");
ok(route.includes("bidStrategyAuto"), "AF-UI-03: award-history GET 返回策略草案");

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
