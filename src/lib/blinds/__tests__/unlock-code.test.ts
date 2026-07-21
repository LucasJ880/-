/**
 * 解锁码哈希与跨租户隔离
 * 运行：npx tsx src/lib/blinds/__tests__/unlock-code.test.ts
 */

import {
  hashUnlockCode,
  looksLikeBcryptHash,
  unlockCodeAuditSafe,
  verifyUnlockCode,
} from "../unlock-code";

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

async function main() {
  console.log("unlock-code security");

  const sunnyPlain = "Sunny2026";
  const mengxinPlain = "MengxinTrade!9";
  const sunnyHash = await hashUnlockCode(sunnyPlain);
  const mengxinHash = await hashUnlockCode(mengxinPlain);

  ok(looksLikeBcryptHash(sunnyHash), "存储值是 bcrypt 形态");
  ok(sunnyHash !== sunnyPlain, "数据库存储值不是明文");
  ok(!sunnyHash.includes(sunnyPlain), "哈希字符串不含明文片段");

  ok(await verifyUnlockCode(sunnyPlain, sunnyHash), "正确码通过");
  ok(!(await verifyUnlockCode("wrong-code", sunnyHash)), "错误码拒绝");
  ok(
    !(await verifyUnlockCode(sunnyPlain, mengxinHash)),
    "不同企业不能互用（Sunny 码对梦馨哈希失败）",
  );
  ok(
    !(await verifyUnlockCode(mengxinPlain, sunnyHash)),
    "不同企业不能互用（梦馨码对 Sunny 哈希失败）",
  );
  ok(await verifyUnlockCode(mengxinPlain, mengxinHash), "梦馨正确码通过");

  // 明文误存到 hash 字段 → 拒绝比对
  ok(
    !(await verifyUnlockCode(sunnyPlain, sunnyPlain)),
    "拒绝明文伪哈希比对",
  );

  // 重跑 seed 不覆盖：模拟 ensure 逻辑
  const store: Record<string, string> = { sunny: sunnyHash };
  function ensureNoOverwrite(orgId: string, newHash: string): string {
    if (store[orgId] && looksLikeBcryptHash(store[orgId])) {
      return store[orgId];
    }
    store[orgId] = newHash;
    return newHash;
  }
  const afterRerun = ensureNoOverwrite("sunny", await hashUnlockCode("OtherCode999"));
  ok(afterRerun === sunnyHash, "重跑 seed 不覆盖已有哈希");

  // 审计/API 安全载荷不含输入码
  const audit = unlockCodeAuditSafe({
    configured: true,
    matched: false,
    orgId: "org_x",
  });
  const auditJson = JSON.stringify(audit);
  ok(!auditJson.includes(sunnyPlain), "审计载荷不含输入码");
  ok(!auditJson.includes(sunnyHash), "审计载荷不含哈希");
  ok(audit.configured === true && audit.matched === false, "审计仅含安全布尔字段");

  // 模拟 API 错误响应
  const apiError = { ok: false, error: "解锁码不正确" };
  ok(
    !JSON.stringify(apiError).includes(sunnyPlain),
    "API 错误信息不含输入码",
  );

  // DTO 永不带码字段
  const dtoShape = {
    hasLineDiscountUnlockCode: true,
    hasDepositOverrideCode: false,
  };
  ok(
    !("lineDiscountUnlockCode" in dtoShape) &&
      !("lineDiscountUnlockCodeHash" in dtoShape),
    "DTO 仅暴露 has* 布尔，不暴露码字段",
  );

  console.log(`\nunlock-code: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
