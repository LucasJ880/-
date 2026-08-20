/**
 * 情报阶段1+2 — 七槽位接投影 + 我方结果回灌（纯平面，零 DB / 零出站）
 *
 * P1（接水管）：情报 tab 七槽位消费 /api/org/tender-awards 的七域确定性投影，
 * 静态「建设中」占位退役；证据分级徽标 + 诚实空态。
 * P2（第一桶金）：markProjectTenderResult（human 动作）回灌 canonical——
 * won → 我方 AwardRecord（幂等 sourceKey）；买家 → T3 Buyer（幂等匹配）。
 *
 * SLOT-*  UI 接线探针
 * BF-*    回灌服务契约（含「绝不上抛」的真实调用验证）
 * 反例守卫：AI 自动写硬禁（回灌唯一调用方 = 人工结果标记路径）。
 *
 * 运行：npx tsx src/lib/tender-intel/__tests__/intel-slots-p1p2.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { backfillOwnResultCanonical } from "../own-result-backfill";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

console.log("情报阶段1+2 — 七槽位接投影 + 我方结果回灌");

async function main() {
  // ── P1：UI 接线 ──────────────────────────────────────────
  const tab = read("src/components/project-detail/tabs/intel-tab.tsx");
  ok(
    tab.includes("OrgAwardIntelSlots") && !tab.includes("INTEL_FUTURE_SLOTS"),
    "SLOT-01: 情报 tab 静态占位退役，改挂投影组件",
  );
  const slots = read("src/components/tender-intel/org-award-intel-slots.tsx");
  const SEVEN = [
    "historical_awards", "buyer_history", "comparable_prices", "competitors",
    "procurement_cycle", "supply_chain", "bid_strategy",
  ];
  ok(
    SEVEN.every((k) => slots.includes(`slotKey="${k}"`)),
    "SLOT-02: 七个槽位键全部保留（data-intel-slot 兼容）",
  );
  ok(
    slots.includes("/api/org/tender-awards") &&
      ["CONFIRMED", "SUPPORTED", "INFERRED", "UNKNOWN"].every((s) => slots.includes(s)),
    "SLOT-03: 消费 T4 投影 API + 四级证据徽标",
  );
  ok(
    !code("src/components/tender-intel/org-award-intel-slots.tsx").match(
      /median|toLocaleString\(\).*\+|reduce\(/,
    ) || !/reduce\(|\bsum\b/.test(code("src/components/tender-intel/org-award-intel-slots.tsx")),
    "SLOT-04（反例守卫）: 组件零二次统计（数字只来自投影层，铁律不在 UI 复算）",
  );
  ok(
    slots.includes("绝不输出假周期") && slots.includes("样本不足时如实显示暂无"),
    "SLOT-05: 诚实空态文案（为什么没数据、怎么让它有）",
  );

  // ── P2：回灌服务契约 ─────────────────────────────────────
  const bf = code("src/lib/tender-intel/own-result-backfill.ts");
  ok(
    bf.includes("own-result:") &&
      bf.includes('"USER_ENTRY"') &&
      bf.includes('"HUMAN_CONFIRMED"'),
    "BF-01: 幂等 sourceKey（own-result:{projectId}）+ USER_ENTRY + HUMAN_CONFIRMED",
  );
  ok(
    bf.includes('input.result !== "won"') && bf.includes("isT4AwardSchemaReady"),
    "BF-02: 仅 won 写 award 事实；T4 schema 门 fail-closed",
  );
  ok(
    bf.includes("createBuyer") && bf.includes("no_client_organization"),
    "BF-03: 买家经同一 human 动作沉淀 T3 Buyer（幂等匹配内置，无买家名显式跳过）",
  );
  const tr = code("src/lib/projects/tender-result.ts");
  ok(
    tr.includes("backfillOwnResultCanonical") &&
      /try \{[\s\S]*backfillOwnResultCanonical[\s\S]*\} catch \{/.test(tr),
    "BF-04: 结果标记内 fire-and-forget 挂钩（回灌失败绝不影响结果标记）",
  );

  // 真实调用验证「绝不上抛」：无 DB 环境下调用必须温和返回而不是炸
  const gate = await backfillOwnResultCanonical({
    projectId: "bf-no-db-project",
    result: "won",
    actorUserId: "bf-no-db-user",
  });
  ok(
    gate.award === "skipped" && gate.buyer === "skipped" && !!gate.awardReason,
    "BF-05: 无 DB/项目不存在 → 温和 skipped + 显式原因（绝不上抛）",
    gate,
  );

  // ── 反例守卫：AI 自动写硬禁 ──────────────────────────────
  const callers = execSync(
    "grep -rl backfillOwnResultCanonical src --include='*.ts' --include='*.tsx' | grep -v __tests__ | grep -v own-result-backfill.ts",
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  ok(
    callers.length === 1 && callers[0] === "src/lib/projects/tender-result.ts",
    "BF-06（反例守卫）: 回灌唯一调用方 = 人工结果标记服务（AI 自动写 canonical 硬禁不被触碰）",
    callers,
  );

  // ── 组织级语境（2026-08-19 用户报告：解析中就出现且看不出是组织库存） ──
ok(
  slots.includes("组织级 · 跨项目累积") &&
    slots.includes("买家未知") &&
    slots.includes("组织授标库另有"),
  "SLOT-07: 组织级标注 + 逐条买家兜底 + 非相关记录折叠为库存",
);
ok(
  slots.includes("已确认") && slots.includes("系统核验") && slots.includes("normBuyer"),
  "SLOT-08: 逐条信任徽标 + 相关性分层（同买家优先）",
);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

void main();
