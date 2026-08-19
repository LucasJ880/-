/**
 * 观察期包2+包3 — 单管线与完成通知（纯平面，零 DB）
 *
 * 包3：auto-enqueue 命中 workforce flag → 改派 workforce（legacy 仅 fallback）
 *      + 活跃 workforce run 幂等兜底（双倍模型花费的根源）。
 * 包2：workforce 终态化接完成/失败通知（复用 alerts.ts；sourceKey 幂等；
 *      cancelled 不打扰；通知失败绝不回滚 canonical）。
 *
 * 反例守卫：legacy queue 不得 retire；auto 路径绝不 restart 取代已有分析；
 * cancelled 不通知；成功通知门=REVIEW_REQUIRED（createNotification sourceKey 去重）。
 *
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/obs-p2p3-single-pipeline.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

console.log("观察期包2+包3 — 单管线与完成通知");

const enq = code("src/lib/tender-auto-analysis/enqueue-package.ts");
ok(
  enq.includes("isTenderWorkforceAnalysisEnabled") &&
    enq.includes("startTenderWorkforceAnalysis") &&
    enq.includes('pipeline: "workforce"'),
  "P3-01: auto-enqueue 命中 workforce flag 改派 workforce",
);
ok(
  enq.includes("restart: false"),
  "P3-02（反例守卫）: 自动路径绝不 restart 取代已有分析",
);
ok(
  enq.includes('reason: "workforce_active"') &&
    enq.includes("TENDER_WORKFORCE_ANALYSIS_VERSION"),
  "P3-03: 活跃 workforce run 幂等兜底（flag 中途关闭/竞态不再起 legacy）",
);
ok(
  enq.includes("回落 legacy") &&
    (enq.match(/enqueueTenderPackageAnalysis\(\{/g) ?? []).length >= 1,
  "P3-04（反例守卫）: legacy 队列仍是 fallback（不 retire）",
);
ok(
  enq.includes('requestId: `auto-enqueue:'),
  "P3-05: 稳定 requestId（双上传/重放收敛为 at-most-one Job）",
);

const svc = code("src/lib/tender-workforce/analysis-run-service.ts");
ok(
  (svc.match(/notifyTenderRunSucceeded\(input\.analysisRunId\)/g) ?? []).length === 2,
  "P2-01: 两条终态化路径（canonical V2 + V1 兼容）均接完成通知",
);
ok(
  svc.includes("notifyTenderRunFailed") &&
    svc.includes('input.errorCode !== "cancelled"'),
  "P2-02: 失败通知接线且 cancelled（用户重新分析）不打扰",
);
ok(
  (svc.match(/try \{[\s\S]{0,700}?notifyTenderRun(Succeeded|Failed)/g) ?? []).length === 3 &&
    !/await notifyTenderRun(Succeeded|Failed)\([^)]*\);\s*return \{ ok: false/.test(svc),
  "P2-03（反例守卫）: 三处接线全部包 try/catch（通知失败绝不回滚 canonical）",
);

const alerts = code("src/lib/tender-auto-analysis/alerts.ts");
ok(
  alerts.includes('run.status !== "REVIEW_REQUIRED"') &&
    alerts.includes("tenderSuccessSourceKey"),
  "P2-04: 成功通知门=REVIEW_REQUIRED + sourceKey 幂等（DUPLICATE=0 机制）",
);
const notif = code("src/lib/notifications/create.ts");
ok(
  notif.includes("findUnique({ where: { sourceKey } })"),
  "P2-05（回归钉）: createNotification sourceKey 唯一去重机制原样",
);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
