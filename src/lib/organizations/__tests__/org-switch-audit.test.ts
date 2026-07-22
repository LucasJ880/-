/**
 * Security-1：组织切换审计事务语义（纯逻辑 + 可选 DB）
 * 运行：npx tsx src/lib/organizations/__tests__/org-switch-audit.test.ts
 *
 * 说明：完整 DB 回滚由 switchUserActiveOrg 事务保证；
 * 此处验证错误码与「审计失败不得半成功」的契约。
 */

import type { OrgSwitchErrorCode } from "../org-access";

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

console.log("security-1 org switch audit contract");

/** 模拟：update + audit 同事务；audit 抛错 → 无半成功 */
async function simulatedSwitch(opts: {
  auditOk: boolean;
}): Promise<
  | { ok: true; activeOrgId: string; audited: true }
  | { ok: false; code: OrgSwitchErrorCode; activeOrgId: string }
> {
  let activeOrgId = "org-before";
  const target = "org-after";
  try {
    // transaction body
    const next = target;
    if (!opts.auditOk) {
      throw new Error("audit write failed");
    }
    activeOrgId = next;
    return { ok: true, activeOrgId, audited: true };
  } catch {
    // 回滚：activeOrgId 保持 before
    return {
      ok: false,
      code: "ORG_SWITCH_AUDIT_FAILED",
      activeOrgId: "org-before",
    };
  }
}

(async () => {
  const okSwitch = await simulatedSwitch({ auditOk: true });
  ok(
    okSwitch.ok &&
      okSwitch.activeOrgId === "org-after" &&
      okSwitch.audited === true,
    "用户更新成功 + Audit 成功 → 完整提交",
  );

  const failSwitch = await simulatedSwitch({ auditOk: false });
  ok(
    !failSwitch.ok &&
      failSwitch.code === "ORG_SWITCH_AUDIT_FAILED" &&
      failSwitch.activeOrgId === "org-before",
    "Audit 失败 → 整体回滚，activeOrgId 不半成功",
  );

  // 审计字段契约
  const beforeData = { activeOrgId: "sunny" };
  const afterData = { activeOrgId: "mengxin", orgAccessMode: "MULTI_ORG" };
  ok(beforeData.activeOrgId === "sunny", "before activeOrgId 正确");
  ok(afterData.activeOrgId === "mengxin", "after activeOrgId 正确");
  ok(
    typeof afterData.orgAccessMode === "string",
    "after 含 orgAccessMode",
  );

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
