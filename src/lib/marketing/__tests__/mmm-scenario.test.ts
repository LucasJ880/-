/**
 * MMM 情景状态机与分配解析
 * 运行：npx tsx src/lib/marketing/__tests__/mmm-scenario.test.ts
 */

import {
  formatAllocations,
  validateScenarioTransition,
} from "../mmm-scenario";

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`✓ ${name}`);
  else {
    failed += 1;
    console.error(`✗ ${name}`);
  }
}

check(
  "draft→pending_approval 合法",
  validateScenarioTransition("draft", "pending_approval") === null,
);
check(
  "pending_approval→approved 合法",
  validateScenarioTransition("pending_approval", "approved") === null,
);
check(
  "pending_approval→rejected 合法",
  validateScenarioTransition("pending_approval", "rejected") === null,
);
check(
  "draft→approved 非法",
  validateScenarioTransition("draft", "approved") !== null,
);
check(
  "approved→rejected 非法",
  validateScenarioTransition("approved", "rejected") !== null,
);
check("同状态合法", validateScenarioTransition("draft", "draft") === null);

const fromObject = formatAllocations({ google_ads: 1000, meta: 500 });
check(
  "对象分配解析",
  fromObject.length === 2 &&
    fromObject.find((r) => r.channel === "google_ads")?.amount === 1000,
);

const fromArray = formatAllocations([
  { channel: "google_ads", amount: 800 },
  { name: "meta", budget: 200 },
]);
check(
  "数组分配解析",
  fromArray.length === 2 && fromArray[1]?.channel === "meta" && fromArray[1]?.amount === 200,
);

console.log(failed === 0 ? "\nmmm-scenario 检查通过" : `\n失败 ${failed}`);
if (failed > 0) process.exit(1);
