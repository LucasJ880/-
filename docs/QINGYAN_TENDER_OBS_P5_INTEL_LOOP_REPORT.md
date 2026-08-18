# 观察期包5 — 外部情报自动化闭环实施报告

日期：2026-08-17 · 分支 `feature/tender-obs-p5-intel-loop` · base = main `18b1b07d`

## 1. 诊断（生产实证，2026-08-17）

用户报告：项目分析完成后，情报 tab 不自动分析，且没有手动开启按钮。诊断出三个结构性断点：

1. **外部情报（M1 授标检索 / M2 Web 检索 / M2.5 AI 分析师）只挂在 legacy 管线
   FINALIZE 步**；workforce 管线（现在的主管线）零情报步——包 3 双管线收敛后
   将彻底失去触发点。
2. **时序倒置 + 静默丢弃**：旧实现写入条件 `(auto?.ok || web?.ok) && roomBefore`
   ——调查室必须先于分析存在，而房间唯一创建入口是工作台「确认进入投标调查」
   按钮（正常流程中永远晚于分析完成）。检索真跑了、结果直接丢弃，无任何痕迹。
3. **手动按钮不在情报 tab 且不产生分析**：`startBidIntelligence` 只建房间 +
   一个全仓无 executor 的死 Task；情报 tab 空态承诺「分析完成后自动生成」
   在该时序下永不兑现。

生产库只读实证：7 个房间中仅 1 个曾获得外部情报键（08-28 Student Housing，
房间恰好先于分析存在）；08-31 SK 房间存在但零情报键；最新项目
（PROD CONTROLLED TEST）连房间都没有。**运气驱动**。
生产 env 已配 `TENDER_EXTERNAL_INTEL_ENABLED` + `TAVILY_API_KEY`（机器可用，
只是触发链断了）。

## 2. 方案与改动（SCHEMA_CHANGE = NONE）

- **新 `src/lib/tender-intel/orchestrate.ts`** — 统一编排服务
  `runExternalIntelForProject({projectId, runId?, trigger})`：
  - 三触发面共用：`legacy_finalize` / `workforce_finalize` / `manual`
  - **写入前自动创建房间**（upsert，最小字段，不伪造 investigating 状态）
  - **显式状态** `room.summaryJson.externalIntelStatus`
    （status/trigger/ranAt/runId/reason/计数）——五种静默 no-op（flag 关/
    无分析记录/查询空/检索无果/异常）全部变为可见状态
  - 失败语义不变：任何异常绝不上抛；人工确认门不变（结果仅是候选）
- **`tender-auto-analysis/worker.ts`** — FINALIZE 内联块（94 行）删除，改调服务
- **`tender-workforce/tools.ts`** — t9 两条终态化成功路径（canonical V2 +
  兼容路径）接 `workforce_finalize` 触发（try/catch fire-and-forget，
  失败不影响终态化）
- **新端点 `POST /api/projects/[id]/external-intel/run`** — 手动触发：
  项目写权限门 + flag 门 + 60s 频控（`isExternalIntelRateLimited` 纯函数）
- **`award-history/route.ts`** — GET 返回 `externalIntelStatus`；note 由状态
  驱动（移除「分析完成后自动生成」空头承诺文案）
- **`award-history-panel.tsx`**（挂在情报 tab 内）— 新增
  「立即检索外部情报」按钮（`data-testid="run-external-intel"`），调 run 端点
  产生**真分析**，完成后自动刷新候选区

## 3. 测试证据

- 纯平面 **obs-p5 14/14**（含 4 条反例守卫：roomBefore 时序倒置写法不得回归 /
  worker 内联块彻底移除 / fire-and-forget 语义 / 空头承诺文案移除）；
  websearch 10/10；CI 单测子集 PASS；tsc 全量零错；eslint 变更文件零告警
- **真实 E2E 7/7**（隔离生产快照分支 + 真实 open.canada.ca 出站，
  `scripts/obs-p5-intel-e2e.ts`）：
  - 场景 A = 生产真实受害项目形态（HealthPRO，有分析无房间）：
    编排自动建房、状态 `ran` 落库、`externalCandidates` 写入
    ——旧实现在此场景下结果 100% 被丢弃
  - 场景 B = 存量卡死态（08-28）：手动触发解救成功 + 频控窗口生效
  - TAVILY_API_KEY 本地缺失 → M2 优雅降级实测（web=0 不阻断）；
    M2.5 在候选为空时正确跳过（NO_FINDINGS）

## 4. 上线后行为

- 生产 flag 已在（`TENDER_EXTERNAL_INTEL_ENABLED` + `TAVILY_API_KEY`），
  **本 PR merge + deploy 即生效，无需新 env**：
  - 新分析（无论 legacy 还是 workforce 管线）完成 → 情报自动跟跑并落库
  - 存量项目（含 T-1085 / HealthPRO / 08-31 SK）→ 情报 tab 点
    「立即检索外部情报」即补
- 回滚 = revert PR（无 env/schema 变更）

## 5. 遗留（P1，不阻塞）

- `startBidIntelligence` 的死 Task（无 executor）仍在——建议后续 PR 移除
- 八模块与 `externalAnalysis` 的字段映射核对；调查按钮双挂情报 tab
- 情报 tab 主卡（`project.intelligence`）为 BidToGo 遗留概念，上传型项目
  恒空——是否合并入调查区块属 UX 决策

## 6. Gate

```
OBS_P5_SCHEMA_CHANGE          = NONE
OBS_P5_TRIGGER_SURFACES       = 3（legacy_finalize / workforce_finalize ×2 路径 / manual）
OBS_P5_SILENT_NOOP            = 0（五种 no-op 全部显式落 externalIntelStatus）
OBS_P5_ROOM_TIMING_FIXED      = PASS（写入前 upsert；反例守卫值守 roomBefore 不回归）
OBS_P5_MANUAL_BUTTON          = PASS（情报 tab 真实按钮 → 真实分析 + 60s 频控）
OBS_P5_PURE_SUITES            = 14/14 + websearch 10/10 + CI 子集 PASS
OBS_P5_REAL_E2E               = PASS 7/7（隔离生产快照 + 真实出站，场景=生产实证卡死态）
OBS_P5_NEW_ENV_REQUIRED       = NONE（生产 flag 已在，merge 即生效）
OBS_P5_STATUS                 = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
