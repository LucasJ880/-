# 观察期包2+包3 — 单管线与完成通知 实施报告

日期：2026-08-19 · 分支 `feature/tender-obs-p2p3-single-pipeline` · base = main（含 #129/#130）
两包联动实现（任务书明示：先做包3，包2 的通知去重天然解决），一个 PR 交付
「单管线 + 单通知」完整故事。

## 1. 包3 · 双管线收敛（每单省一半模型钱）

**改动**（`enqueue-package.ts` 的 `enqueueTenderPackageIfReady`——auto 路径唯一漏斗，
手动 reanalyze 不经此处、禁令天然满足）：
- **改派**：org 命中 workforce flag → `startTenderWorkforceAnalysis`
  （复用其三层幂等：requestId 重放 / advisory lock / 活跃集 reuse；
  稳定 requestId=`auto-enqueue:{projectId}`；**restart:false**=自动路径绝不
  取代已有分析）。改派失败（flag 内层/配额/异常）→ **回落 legacy**（仅 fallback，
  legacy queue 不 retire）。
- **(c) 幂等兜底**：即使 flag 中途关闭，存在活跃 workforce 域分析
  （AGENT_ANALYZING）→ 拒起 legacy（`reason=workforce_active`）——双倍花费的
  两个口子全部封死。
- 返回值 additive：`pipeline?: "workforce"`；process-next 诊断日志自动携带。

## 2. 包2 · Workforce 完成通知

**复用 `alerts.ts`（b5eee8d4）而非新建**——workforce 域 run 本就是
`tenderAnalysisRun` 行，两个通知函数状态门/事实源/幂等全部同构可用：
- 成功：两条终态化路径（`finalizeWorkforceTenderCanonicalV2Run` +
  V1 兼容 `finalizeWorkforceTenderAnalysisRun`）成功后调
  `notifyTenderRunSucceeded`（门=REVIEW_REQUIRED；事实读 analystSynthesis；
  sourceKey `tender-run-succeeded:{runId}:{userId}` 唯一去重 = DUPLICATE=0 机制）
- 失败：`failWorkforceTenderAnalysisRun` 后调 `notifyTenderRunFailed`；
  **`cancelled`（用户重新分析）不通知**；alerts 失败门扩到
  `AGENT_FAILED`（workforce 刻意区别于 legacy FAILED 的终态）
- 文案适配：attemptCount=0（workforce 重试在 Job 层）不显示误导性「已尝试 0 次」
- 三处接线全部 try/catch best-effort——**通知失败绝不回滚 canonical**

## 3. 证据

- **真实 E2E 7/7**（隔离生产快照干净分支一次通过，`scripts/obs-p2p3-e2e.ts`）：
  ① flags 命中 → 真实创建 workforce Job、**零 legacy run**；② 重放幂等零新建；
  ③ flag 关闭但 workforce 活跃 → 兜底拒起 legacy；④ 终态化 → 完成通知恰 1 条；
  ⑤ 重复终态化被拒 + 通知重放零增量（DUPLICATE=0 实证）；⑥ AGENT_FAILED →
  失败通知恰 1 条；⑦ cancelled → 零通知
- 验收指定回归全绿：phase2a-lease 16/16（隔离库）/ seg2 44/44 / seg2.5 30/30 /
  seg3 40/40 / t5-p11 44/44；alerts 套件扩展后 30/30；新探针 10/10
  （含反例守卫：legacy 不 retire / restart:false / cancelled 不扰 / sourceKey 去重回归钉）；
  CI 子集 PASS；tsc 零错；eslint 零新告警

## 4. 上线后行为（零新 env）

- 新上传包 ready → **只产生一条 workforce 分析**（此前 legacy 并行跑 =
  双倍模型钱）；花费减半可在包0 监控量到（生产 flags 已全在）
- workforce 分析完成（待确认）/ 失败 → 负责人+发起人**恰一条**站内通知；
  用户重新分析产生的取消不打扰
- 回滚 = revert（零 schema 零 env）；应急旁路 = 关
  `TENDER_WORKFORCE_ANALYSIS_ENABLED` 即回落 legacy auto 分析

## 5. Gate

```
P2P3_SCHEMA_CHANGE               = NONE
P3_SINGLE_PIPELINE               = PASS（改派 + 幂等兜底双层，E2E 零 legacy run 实证）
P3_LEGACY_RETIRED                = NO（fallback 保留，反例守卫值守）
P3_AUTO_NEVER_RESTARTS           = PASS（restart:false，探针值守）
P2_DUPLICATE_SUCCESS_NOTIFICATION = 0（sourceKey 幂等，E2E 重放实证）
P2_FAILURE_NOTIFY                = 恰 1 条；cancelled = 0 条
P2_NOTIFY_NEVER_BLOCKS_CANONICAL = PASS（三处 try/catch，探针值守）
P2P3_REAL_E2E                    = PASS 7/7（隔离快照干净分支）
P2P3_ACCEPTANCE_REGRESSIONS      = phase2a-lease/seg2/seg2.5/seg3/t5-p11 全绿
P2P3_NEW_ENV_REQUIRED            = NONE
P2P3_STATUS                      = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
