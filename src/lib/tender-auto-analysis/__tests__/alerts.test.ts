/**
 * Tender 失败告警文案与收件人（ALERT-01..08）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts
 *
 * 2026-08-15 事故：run 13:18 就 FAILED，十小时无人知晓，靠用户主动问才发现。
 */

import { readFileSync } from "node:fs";
import {
  resolveFailureRecipients,
  tenderFailureSourceKey,
  tenderFailureSummary,
  tenderSuccessSourceKey,
  tenderSuccessSummary,
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

/* ---------------- 完成通知 ---------------- */
{
  const full = tenderSuccessSummary({
    projectName: "08-28 Student Housing Furniture",
    analyzedFiles: 12,
    uploadedFiles: 12,
    keyRequirements: 8,
    risks: 6,
    clarifications: 5,
    needsHumanReview: false,
  });
  ok(full.includes("已分析全部 12 个文件"), "ALERT-09 全覆盖时说：全部");
  ok(
    full.includes("关键要求 8 条") && full.includes("风险 6 项"),
    "ALERT-09 给出可核对的数量",
  );
  ok(full.includes("可以开始确认招标要求"), "ALERT-09 给出下一步");

  const partial = tenderSuccessSummary({
    projectName: "P",
    analyzedFiles: 3,
    uploadedFiles: 12,
    keyRequirements: 8,
    risks: 6,
    clarifications: 5,
    needsHumanReview: true,
  });
  ok(
    partial.includes("已分析 3/12 个文件"),
    "ALERT-10 未全覆盖必须报真实分母（禁止只报好消息）",
  );
  ok(
    partial.includes("需要人工复核"),
    "ALERT-10 QA 标记需人工复核时必须点出来",
  );
  ok(!partial.includes("可以开始确认"), "ALERT-10 需复核时不给「可以开始」的错觉");

  const sparse = tenderSuccessSummary({
    projectName: null,
    analyzedFiles: null,
    uploadedFiles: null,
    keyRequirements: null,
    risks: null,
    clarifications: null,
    needsHumanReview: false,
  });
  ok(sparse.includes("招标项目"), "ALERT-11 缺数据时仍是完整句子");
  ok(!sparse.includes("null") && !sparse.includes("undefined"), "ALERT-11 不泄漏空值");

  ok(
    tenderSuccessSourceKey("r1") !== tenderFailureSourceKey("r1"),
    "ALERT-12 成功与失败通知的幂等键互不冲突",
  );
  ok(
    tenderSuccessSourceKey("r1") === tenderSuccessSourceKey("r1"),
    "ALERT-12 成功通知幂等键稳定",
  );
}


/* ---------------- 包2：workforce 域适配 ---------------- */
{
  // attemptCount=0（workforce 域 run：重试在 Job 层）→ 不显示误导性次数
  const s0 = tenderFailureSummary({
    projectName: "P",
    errorCode: "worker_failed",
    attemptCount: 0,
  });
  ok(!s0.includes("已尝试"), "ALERT-P2-01: attemptCount=0 不显示尝试次数");
  ok(s0.includes("重新发起分析"), "ALERT-P2-02: 仍给明确下一步");
  const s1 = tenderFailureSummary({
    projectName: "P",
    errorCode: "worker_failed",
    attemptCount: 3,
  });
  ok(s1.includes("已尝试 3 次"), "ALERT-P2-03: attemptCount>0 照旧显示次数");
}
{
  // 失败态门接受 AGENT_FAILED（workforce 刻意区别于 legacy FAILED）——源码探针
  const src = readFileSync("src/lib/tender-auto-analysis/alerts.ts", "utf8");
  ok(
    src.includes('run.status !== "FAILED" && run.status !== "AGENT_FAILED"'),
    "ALERT-P2-04: 失败通知门接受 FAILED 与 AGENT_FAILED 两种终态",
  );
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
