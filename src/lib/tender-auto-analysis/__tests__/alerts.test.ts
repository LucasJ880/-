/**
 * Tender 失败告警文案与收件人（ALERT-01..08）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts
 *
 * 2026-08-15 事故：run 13:18 就 FAILED，十小时无人知晓，靠用户主动问才发现。
 */

import {
  resolveFailureRecipients,
  tenderFailureSourceKey,
  tenderFailureSummary,
} from "../alerts";

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

/* ---------------- 文案 ---------------- */
{
  const s = tenderFailureSummary({
    projectName: "08-28 Student Housing Furniture",
    errorCode: "lease_exhausted",
    attemptCount: 5,
  });
  ok(s.includes("08-28 Student Housing Furniture"), "ALERT-01 点名项目");
  ok(s.includes("多次尝试后仍未完成"), "ALERT-01 用中文说人话");
  ok(!s.includes("lease_exhausted"), "ALERT-02 不把内部 errorCode 抛给用户");
  ok(s.includes("5"), "ALERT-02 给出尝试次数（可判断严重性）");
  ok(s.includes("重新发起分析"), "ALERT-03 给出下一步动作，不是死胡同");
}
{
  const s = tenderFailureSummary({
    projectName: null,
    errorCode: "some_unknown_code",
    attemptCount: 1,
  });
  ok(s.includes("该招标项目"), "ALERT-04 无项目名时有兜底称呼");
  ok(!s.includes("some_unknown_code"), "ALERT-04 未知 code 不泄漏原文");
  ok(s.includes("分析未能完成"), "ALERT-04 未知 code 用兜底文案");
}
{
  const stale = tenderFailureSummary({
    projectName: "P",
    errorCode: "stale_run",
    attemptCount: 3,
  });
  ok(stale.includes("长时间没有进展"), "ALERT-05 stale_run 有专属措辞");
}

/* ---------------- 收件人 ---------------- */
{
  ok(
    resolveFailureRecipients({ ownerId: "u1", createdById: "u2" }).sort().join(",") ===
      "u1,u2",
    "ALERT-06 负责人 + 发起人都通知",
  );
  ok(
    resolveFailureRecipients({ ownerId: "u1", createdById: "u1" }).length === 1,
    "ALERT-06 同一人只通知一次",
  );
  ok(
    resolveFailureRecipients({ ownerId: "u1", createdById: null }).join(",") === "u1",
    "ALERT-07 发起人为空时仍通知负责人（系统自动触发的 run）",
  );
  ok(
    resolveFailureRecipients({ ownerId: null, createdById: undefined }).length === 0,
    "ALERT-07 无人可通知时返回空（调用方据此跳过）",
  );
}

/* ---------------- 幂等键 ---------------- */
{
  ok(
    tenderFailureSourceKey("run_1") === tenderFailureSourceKey("run_1"),
    "ALERT-08 同一 run 幂等键稳定（扫描重复执行不刷屏）",
  );
  ok(
    tenderFailureSourceKey("run_1") !== tenderFailureSourceKey("run_2"),
    "ALERT-08 不同 run 各自提醒",
  );
  ok(
    tenderFailureSourceKey("run_1").startsWith("tender-run-failed:"),
    "ALERT-08 幂等键带命名空间前缀",
  );
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
