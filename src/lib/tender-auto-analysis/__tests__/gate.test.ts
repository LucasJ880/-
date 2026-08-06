/**
 * 自动入队门闸
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/gate.test.ts
 */

import { canAutoEnqueueAnalysis } from "../gate";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("tender-auto-analysis gate");

{
  const r = canAutoEnqueueAnalysis({
    workDomain: "tender",
    hasIntelligenceRoom: false,
  });
  ok(r.ok && r.reason === "tender_domain", "workDomain=tender 允许");
}

{
  const r = canAutoEnqueueAnalysis({
    workDomain: "TENDER",
    hasIntelligenceRoom: false,
  });
  ok(r.ok && r.reason === "tender_domain", "workDomain 大小写不敏感");
}

{
  const r = canAutoEnqueueAnalysis({
    workDomain: "general",
    hasIntelligenceRoom: true,
  });
  ok(r.ok && r.reason === "intelligence_room", "存在调查室允许");
}

{
  const r = canAutoEnqueueAnalysis({
    workDomain: "delivery",
    hasIntelligenceRoom: false,
  });
  ok(!r.ok && r.reason === "gate_closed", "delivery 无 Room 拒绝");
}

{
  const r = canAutoEnqueueAnalysis({
    workDomain: "general",
    hasIntelligenceRoom: false,
  });
  ok(!r.ok && r.reason === "gate_closed", "general 无 Room 拒绝");
}

{
  const r = canAutoEnqueueAnalysis({
    workDomain: null,
    hasIntelligenceRoom: false,
  });
  ok(!r.ok, "null workDomain 无 Room 拒绝");
}

{
  // 门闸不得看文件名——本函数签名也无 filename，确保只依赖 domain/room
  const r = canAutoEnqueueAnalysis({
    workDomain: "general",
    hasIntelligenceRoom: false,
  });
  ok(
    !r.ok,
    "无 filename 参数：不得用文件名启发式（RFP/Tender）自动触发",
  );
}

{
  const r = canAutoEnqueueAnalysis({
    workDomain: "tender",
    hasIntelligenceRoom: true,
  });
  ok(r.ok && r.reason === "tender_domain", "两者皆真时优先 tender_domain");
}

console.log(`\ngate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
