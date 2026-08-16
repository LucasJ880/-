# Tender V2 分片续跑 Worker（P0 生产事故修复）

**事故日期**：2026-08-15（生产 qingyan.ca / Vercel 项目 `-`）
**症状**：Sunny Home & Deco 上传新招标包后 UI 长时间「分析中」，最终分析失败。
**范围**：`SCHEMA_CHANGE = NONE`（复用既有 `TenderAnalysisRun.workerCursor` Json 列）；
仅影响 Tender 自动分析 worker 与 V2 引擎的编排层，**分析语义零改动**。

---

## 1. 事故事实（生产库只读取证）

| 事实 | 值 |
| --- | --- |
| 项目 | `08-28 Student Housing Furniture`（org `cmrtcnz1c0001sbjcy87hemyl`，workDomain=tender） |
| Run | `cmsukrehz0001kd0ahpz1exy4` |
| 终态 | `status=FAILED` / `errorCode=lease_exhausted` / `workerStep=ENSURE_PAGES` / `attemptCount=5` |
| 产出 | sections=0，facts=0 |
| 文档侧 | 3 个 PDF 全部 `parseStatus=done`（45 / 3 / 13 页，共 61 页），页级行齐全 |
| 同日同症状 | Lucas Bid 的 run `cmsuksqg90001ic0afv8w4kqx`（另一 org）——系统性，非单个文件问题 |
| cron 侧 | 事故窗口内 `AutomationRun(tender-auto-analysis)` 有约 17 条「跑一半没收尾、30 分钟后被扫描关闭」的悬挂记录 |

## 2. 根因链

1. `workerStep=ENSURE_PAGES` 记录的是**已完成**的步 → 真正死在下一步 `EXTRACT_FACTS`。
2. V2 ON 时 `EXTRACT_FACTS` 是**单体长步**：N 个窗口 LLM（并发 3）+ 逐条澄清解决检查 +
   Analyst PASS A/B（生产实测 159s + 50s）。61 页的包总时长超过 cron 函数
   `maxDuration = 300s` → 函数被平台**硬杀**。
   *悬挂的 AutomationRun 记录就是硬杀的指纹：代码抛错会被 batch catch 并正常收尾，
   只有进程被杀才留下不收尾的记录。*
3. V2 的全部产出只在末尾 `persistV2Fenced` 一次性落库 → **中途零检查点**，
   每次重试都从零开始，永远跑不完。
4. 重试额度被秒烧：`claimRun` 只在 `status=PENDING` 时写 `startedAt`，**重试不重置**；
   过了第一个 `STALE_RUN_MS`(30min) 之后，陈旧扫描对每次租约过期都立即命中，
   `attemptCount` 1→5 在几十分钟内烧光 → `lease_exhausted`。
5. **为何此前未暴露**：PR #106 的真实 E2E 是在**本地**跑 `processQueuedTenderAnalysisRuns`
   （preview cron 被 Vercel SSO 挡），本地无 300s 限制 —— 这条管线从未在真实
   serverless 时限下验证过。

## 3. 修复设计

### 3.1 引擎拆成可复用阶段（语义不变）

`analyzeTender` / `runAnalystSynthesis` 保留为**单次编排**（eval / benchmark / flag-off 路径），
但内部拆出可独立调用的阶段，生产 worker 与它们**同源**，杜绝第二套管线：

| 阶段 | 位置 | 性质 |
| --- | --- | --- |
| `runExtractionWindow` | `tender-understanding/analyzer.ts` | 每窗一次 LLM |
| `deriveGroundedState` | 同上 | 纯（证据硬门/去重/优先级/矛盾/关键事实） |
| `assembleAnalysisResult` | 同上 | 纯（风险派生/limitations/metadata/组装） |
| `planClarifications` / `resolveClarificationItem` / `assembleClarifications` | `tender-understanding/clarify.ts` | 计划纯、每条一次 LLM、组装纯 |
| `runAnalystPassA` / `runAnalystPassB` / `finalizeAnalystSynthesis` | `tender-analyst/synthesize.ts` | 两次 LLM + 纯收口 |

顺带修正一处确定性缺口：窗口结果改为**按窗口下标定位**而非并发完成顺序追加，
同一批 LLM 输出恒产出同一结果（分片续跑 parity 的前提，也让 benchmark 更可复现）。

### 3.2 分片执行器（新）

- `v2-cursor.ts`：检查点结构 + 指纹 + 阶段准入/超时裁剪（纯，可单测）。
- `v2-resumable.ts`：`WINDOWS → CLARIFY → ANALYST_A → ANALYST_B → PERSIST` 状态机。
  **每次 LLM 调用的结果立即落检查点**；预算不足则 `YIELD`，下个 cron tick 从断点继续。
- `v2-persist.ts`：`advanceAndPersistV2`（worker 入口，YIELD/PERSISTED）；
  `runV2Inference` 改为「deadline=∞ 的同一执行器」，单次与分片**同源同语义**。

检查点写入与 canonical 写走**同一把 lease fence**（`updateMany where leaseOwner`），
stale worker 既不写检查点也不写数据（`TenderV2LeaseLostError` → worker graceful yield）。

### 3.3 时间预算自洽

| 常量 | 值 | 约束 |
| --- | --- | --- |
| cron `maxDuration` | 300s | 平台硬限 |
| `INVOCATION_BUDGET_MS` | 240s | ≤ maxDuration − 45s（留足收尾） |
| `LEASE_MS` | 300s（原 90s） | ≥ 单次调用预算，长阶段跑到一半租约不得过期 |
| `V2_PHASE_MIN_MS.ANALYST_A` | 180s | + 安全余量 ≤ 单 tick 预算（否则永远开不了工） |
| `MIN_RUN_SLICE_MS` | 45s | 同批第二个 run 的起步门槛 |

这些不变量由 `worker-budget-guards.test.ts` 直接从 cron route 源码解析 `maxDuration` 断言，
以后谁改坏了预算关系，CI 立刻红。

### 3.4 顺带修掉的放大器与质量洞

1. **陈旧判定改看检查点进展**（`isRunStale`）：`startedAt` 永不重置，不能当"有没有进展"用。
   现在只要还在推进检查点就不算陈旧；真正卡死 30 分钟仍会失败。
2. **窗口失败可重试**（`MAX_WINDOW_ATTEMPTS=3`，跨 tick）：以前单窗口一次失败即永久丢内容，
   只在 limitations 里留一行；现在先重试，耗尽才记 limitation。
3. **Analyst 单遍可重试**（`MAX_ANALYST_ATTEMPTS=2`）：一次抖动不再让中文综合层整体消失。
4. **ENSURE_PAGES 可续跑**：已按当前 `PARSE_VERSION` 且内容哈希一致的文档直接跳过，
   大包解析被打断后不重复下载/解析。
5. **单次调用内多 run 共享同一条截止线**，并对被预算挡下的候选 `log`（不静默截断）。

## 4. 验证

### 4.1 纯逻辑（无 DB、无 LLM，已注册 test-all / test-ci-unit）

`src/lib/tender-auto-analysis/__tests__/v2-resumable.test.ts` — 42/42 PASS
- RESUME-01 满预算一 tick 跑完，调用数 = 窗口 + 澄清 + Analyst 2
- RESUME-02 小预算多 tick，**零重复调用**
- **RESUME-03 PARITY：同一批 LLM 输出，分片跑与单次跑的 mapped 结果 `deepStrictEqual` 完全一致**
- RESUME-04 模拟进程硬杀 → 从最后检查点恢复，只重跑未落盘的那一批
- RESUME-05/06 窗口重试成功 / 重试耗尽记 limitation 且次数有界
- RESUME-07 检查点 fence 失败 → `TenderV2LeaseLostError` 且立即停手
- RESUME-08/09 Analyst 抖动重试 / QA 全失败仍落库并标 `needsHumanReview`
- CURSOR-01..04、BUDGET-01..03 游标作废与预算准入

`src/lib/tender-auto-analysis/__tests__/worker-budget-guards.test.ts` — 12/12 PASS
（预算自洽 5 项 + 陈旧判定 7 项）

### 4.2 隔离库集成（真实 Postgres，脚本化 invoker，无外呼）

`scripts/tender-v2-resumable-isolated-e2e.ts` — **18/18 PASS**
（临时 Neon 分支 `preview-v2-resumable-p0`，跑完已删除）

- A1–A3 真实 DB 上跨 4 个 tick 续跑；canonical facts/requirements/sections 落库；
  jsonb 检查点往返后仍可解析，三个窗口结果都在检查点里
- A4 Analyst 中文综合层落 `summaryJson`
- **A5 重入零 LLM 调用**（检查点已在 PERSIST → 重试不再从零烧钱）
- A6 租约被接管 → 真实 SQL fence 生效，零写
- **B1 有检查点进展的 run 不再被陈旧扫描误杀；B2 真正无进展的仍被判陈旧**
- C1–C3 V2 flag OFF 的 legacy 全流程在真实 DB 上仍走到 `REVIEW_REQUIRED`

### 4.3 回归

- 36 个 tender 相关纯套件全部 PASS（tender-auto-analysis / tender-understanding /
  tender-analyst / tender / tender-workforce）
- `tsc --noEmit` 0 error；`check-eslint-baseline` PASS（较基线 −2 error，改动文件 0 lint）
- `next build` 成功

## 5. 未做 / 债

| 编号 | 内容 |
| --- | --- |
| D1 | 检查点体积：窗口抽取结果全量存 jsonb，200 页大包可达 MB 级，每次检查点整行重写。已加 >4MB 告警日志；若后续成为热点，再考虑分表或压缩。 |
| D2 | ENSURE_PAGES 阶段尚无检查点（靠"已解析即跳过"实现续跑），陈旧判定在该阶段仍回落 `startedAt`。 |
| D3 | FINALIZE 内的外部情报（M1/M2）仍是长尾 best-effort，未纳入分片；被硬杀时 run 已是 `REVIEW_REQUIRED`，用户结果不受影响。 |
| D4 | 本轮未做真实模型链的生产验证（需真实 LLM 额度与生产包）；上线后以首个真实包的 `[tender-v2-resumable]` 日志与 run 终态作为验收。 |

## 6. 上线与回滚

- **无迁移、无 flag 变更**：合并部署即生效（V2 flag 仍由既有 `TENDER_ANALYSIS_V2_ENABLED`
  + org allowlist 控制）。
- 观测点：cron 日志 `[tender-v2-resumable] run=… yield phase=… tick=…`（正常的分片推进）、
  `[tender-worker] deferred=… reason=invocation_budget`（同批候选被预算推迟）。
- **回滚**：revert 本 PR 即可（无数据结构变更；旧代码会忽略 `workerCursor` 中的检查点，
  最坏退回到"从零重跑"的既有行为）。
