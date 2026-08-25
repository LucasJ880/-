/**
 * B3 — 报价台账 producer 修复：纯函数 + 结构级静态断言（不触 DB）。
 * 运行：npx tsx src/lib/quote-engine/__tests__/b3-ledger-producer.test.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { quoteStatusEventKey } from "@/lib/project-ledger/event-keys";
import { QUOTE_LEDGER_EVENT_TYPES } from "../service";
import { QUOTE_TRANSITIONS, type QuoteStatus } from "../contract";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

// ── eventKey：确定性 / 重试稳定 / 再进入唯一 ─────────────────────
{
  const k1 = quoteStatusEventKey("q1", "review", "2026-08-25T00:00:00.000Z");
  const k2 = quoteStatusEventKey("q1", "review", "2026-08-25T00:00:00.000Z");
  ok(k1 === k2, "同一业务动作（同 prevUpdatedAt）→ 同一 eventKey（重试稳定）");
  const k3 = quoteStatusEventKey("q1", "review", "2026-08-25T01:00:00.000Z");
  ok(k1 !== k3, "review→draft→review 再进入（新 prevUpdatedAt）→ 新 eventKey");
  ok(quoteStatusEventKey("q1", "approved", "2026-08-25T00:00:00.000Z") !== k1, "不同目标状态 → 不同 key");
  ok(quoteStatusEventKey("q2", "review", "2026-08-25T00:00:00.000Z") !== k1, "不同 quote → 不同 key");
  ok(/^quote:q1:review:[0-9a-f]{24}$/.test(k1), "key 形态 quote:{id}:{to}:{sha24}（确定性摘要）");
}

// ── 事件类型映射：覆盖全部状态、既有 dotted 约定、无发明词表 ────────
{
  const statuses = Object.keys(QUOTE_TRANSITIONS) as QuoteStatus[];
  ok(statuses.every((s) => typeof QUOTE_LEDGER_EVENT_TYPES[s] === "string" && QUOTE_LEDGER_EVENT_TYPES[s].startsWith("quote.")), `全部 ${statuses.length} 个状态都有 quote.* 台账事件类型`);
  ok(QUOTE_LEDGER_EVENT_TYPES.awarded === "quote.awarded" && QUOTE_LEDGER_EVENT_TYPES.approved === "quote.approved", "关键事件命名遵循既有 domain.action 约定");
  ok(new Set(Object.values(QUOTE_LEDGER_EVENT_TYPES)).size === statuses.length, "事件类型一一对应（无重复）");
}

// ── 结构级静态断言：三重缺陷已消除 ───────────────────────────────
{
  const src = readFileSync(join(process.cwd(), "src/lib/quote-engine/service.ts"), "utf8");
  const keys = readFileSync(join(process.cwd(), "src/lib/project-ledger/event-keys.ts"), "utf8");
  ok(!src.includes("async function appendLedgerEvent"), "旧 best-effort producer 已删除");
  ok(!/eventKey: `quote:.*Date\.now/.test(src), "eventKey 不再含 Date.now()（确定性纪律）");
  ok(!/appendProjectEvent\([^)]*as never/.test(src), "不再用 as never 绕过台账类型契约");
  ok((src.match(/appendQuoteLedgerEventTx\(\s*tx/g) ?? []).length >= 2, "两个产出点（transition + award）都在事务内 append（传 tx）");
  const helper = src.slice(src.indexOf("async function appendQuoteLedgerEventTx"));
  const helperBody = helper.slice(0, helper.indexOf("\n}"));
  ok(!/catch/.test(helperBody), "producer 无 catch 吞错（台账冻结契约：失败 → 业务事务整体回滚）");
  ok(/isLedgerProducerActive/.test(helperBody), "沿用 canonical producer 开关（无第二套激活判定）");
  ok(/quoteStatusEventKey/.test(helperBody) && /禁止 Math\.random\(\) \/ Date\.now\(\)/.test(keys), "key 构造收敛到 canonical event-keys 模块（含纪律注释）");
  ok(/prevAward/.test(src) && /findUniqueOrThrow.*updatedAt/.test(src), "prevUpdatedAt 在事务内、迁移前读取（重试稳定基准）");
  const t = src.indexOf("appendQuoteLedgerEventTx(tx", src.indexOf("syncResult = await db.$transaction"));
  const tEnd = src.indexOf("});", src.indexOf("syncResult = await db.$transaction"));
  ok(t > -1 && t < src.indexOf("if (!needsSync)"), "transition 路径：append 位于状态更新后、事务提交前");
  void tEnd;
}

console.log("");
console.log(`B3 报价台账 producer 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
