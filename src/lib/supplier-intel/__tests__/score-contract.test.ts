/**
 * T10 — supplier-score-v1 冻结契约（B6）
 * 断言：权重冻结且和=1；同输入同输出（确定性）；同步纯函数（零 IO/LLM）；
 * 模块级纯度守卫：score-contract.ts 不 import 任何东西、无 fetch/db/时钟/随机。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SUPPLIER_SCORE_V1,
  computeSupplierScore,
  scoreWeightSum,
} from "../score-contract";

async function main() {
  console.log("权重冻结：40/25/20/15，和恒为 1");
  assert.equal(SUPPLIER_SCORE_V1.version, "supplier-score-v1");
  assert.equal(SUPPLIER_SCORE_V1.weights.technical, 0.4);
  assert.equal(SUPPLIER_SCORE_V1.weights.commercial, 0.25);
  assert.equal(SUPPLIER_SCORE_V1.weights.reliability, 0.2);
  assert.equal(SUPPLIER_SCORE_V1.weights.importRisk, 0.15);
  assert.equal(scoreWeightSum(), 1);

  console.log("确定性：同输入两次调用结果深相等");
  const input = { technical: 80, commercial: 60, reliability: 90, importRisk: 70 };
  const a = computeSupplierScore(input);
  const b = computeSupplierScore({ ...input });
  assert.deepEqual(a, b);
  assert.equal(a.totalScore, 80 * 0.4 + 60 * 0.25 + 90 * 0.2 + 70 * 0.15);

  console.log("同步纯函数：返回值不是 Promise（评分路径结构上无法 await LLM）");
  assert.equal(typeof (a as unknown as { then?: unknown }).then, "undefined");

  console.log("clamp：越界输入收敛到 0–100，不产生越界分");
  const clamped = computeSupplierScore({ technical: 250, commercial: -10, reliability: 50, importRisk: 50 });
  assert.equal(clamped.components.technical.score, 100);
  assert.equal(clamped.components.commercial.score, 0);

  console.log("UNKNOWN 折算：null 维显式标注 + 按已知权重归一；全 UNKNOWN → total null");
  const partial = computeSupplierScore({ technical: 80, commercial: null, reliability: null, importRisk: null });
  assert.deepEqual(partial.unknownComponents, ["commercial", "reliability", "importRisk"]);
  assert.equal(partial.knownWeightShare, 0.4);
  assert.equal(partial.totalScore, 80);
  const allUnknown = computeSupplierScore({ technical: null, commercial: null, reliability: null, importRisk: null });
  assert.equal(allUnknown.totalScore, null);
  assert.equal(allUnknown.knownWeightShare, 0);

  console.log("版本随 breakdown 落行：breakdown.version = supplier-score-v1");
  assert.equal(a.version, "supplier-score-v1");

  console.log("模块纯度守卫：零 import / 零 IO / 零 LLM / 零时钟随机（LLM_NUMERIC_SCORE_CALLS = 0）");
  const source = readFileSync(
    join(process.cwd(), "src/lib/supplier-intel/score-contract.ts"),
    "utf8",
  );
  assert.ok(!/^\s*import\s/m.test(source), "score-contract.ts 不得 import 任何模块");
  for (const forbidden of ["fetch(", "@/lib/db", "@/lib/ai", "createCompletion", "Date.now", "Math.random", "new Date("]) {
    assert.ok(!source.includes(forbidden), `score-contract.ts 不得包含 ${forbidden}`);
  }

  console.log("\nscore-contract T10 全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
