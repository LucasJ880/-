# Proposal: fde-score-calibration

**TASKFLOW：** B-4（评分校准报表，只报不改）。状态列在 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase B 表。本分支叠在 B-1（PR #248）之上，B-4 本身只依赖 A-4。
**受影响的 Muse 意图：** 无。

## Why

`scoreOpportunity` 的六维权重来自 policy，从没和成交结果对过账：哪一维其实不预测赢单，今天没人知道。B-4 用确定性统计把"评分当时的每一维"和"后来赢没赢、报没报上价"对齐，给出每一维的命中率、分桶转化率与建议权重，只展示，不自动改 policy。

## What Changes

- 新增评分校准统计（纯函数）。范围是窗口内（默认 90 天，可选 30–180 天）首次被 FDE 评分的商机，每个商机取**首次评估**（询盘分诊时的预测）。各维度按"得分 / 当时满分"归一。
  - 对每一维输出：
    - 低 / 中 / 高三个分桶的赢单率（赢 /（赢 + 输））与报价率；
    - 命中率：该维"看好"（归一 ≥ 0.5）与是否赢单一致的比例；
    - 区分度：该维"看好"组与"不看好"组的赢单率之差（任一组为空则无法评估）。
  - 另按总分等级（hot / high / medium / low）输出赢单率。
- 建议权重：
  - 无法评估的维度保留现有权重；其余维度把剩下的权重按区分度（负值记 0）分配。结果为整数，总和恰等于现有权重之和（默认 100）。
  - 赢输已定的商机少于 30 个时，**不输出任何建议**，只显示"样本不足"与现有计数。
  - 可评估维度的区分度都 ≤ 0 时，也不输出建议。
- 新增只读接口 `GET /api/revenue/score-calibration?days=90`：组织由服务端解析（与 `/api/revenue/*` 同一访问规则），只读。
- `/revenue` 页底部新增"评分校准（只报不改）"区块：
  - 默认收起，点击才请求。
  - 展示：
    - 样本计数（含被排除的入驻测试与不合格商机）；
    - 每一维的现有权重、分桶表、命中率、区分度与建议权重；
    - 等级赢单率。
  - 提供"复制为 policy 片段"按钮：只把 `{"scoring":{"weights":{…}}}` 复制到剪贴板，由负责人经既有策略发布接口发布。区块本身不写任何数据。
- 新增测试：校准统计（纯函数，固定样本，含样本不足路径）、读模型与接口、区块渲染，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- 写 `docs/QINGYAN_ORG_COCKPIT_B-4_REPORT.md` 并更新状态列。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. **结果取商机阶段，不取 `BusinessOutcome`**：
   - `/revenue` 的全部数字用 `SalesOpportunity.stage`（及 `wonAt` / `lostAt` / `lostReason`），校准与之同口径：赢 = `won`，输 = `lost`。
   - `BusinessOutcome` 的 QUOTE_SENT 等记录 `sourceId` 带时间戳，会重复写，所以只作为"报过价"的补充证据，按商机去重：曾经报价 = 当前阶段在报价及之后，或有 QUOTE_SENT 记录。
2. **不合格（disqualified）不进样本**：商机被转成 disqualified 正是因为评分本身判定不合格（`inbound-sales.ts`）。拿它校准评分是循环论证，列出计数但不参与统计。
3. **取首次评估、按当时满分归一**：
   - 一个商机可被多次评估，取最早一次，即询盘分诊时的预测；后面的评估会混入跟进后才知道的信息。
   - 每一维的满分是打分当时的 policy 权重。`policyVersion` 恒为 v1，不能据此区分，所以按"得分 / 当时满分"归一后比较。
4. **入驻测试排除**：两条规则都排除，取并集：
   - 与 `/revenue` 的 `EXCLUDE_ONBOARDING_TEST_OPPORTUNITIES`（丢单原因）一致；
   - 也按询盘 SLA 的 `isOnboardingTestInquiry`（UTM / 客户标签 / 丢单原因）排除。
5. **"与 /revenue 既有数字口径一致"的含义**：
   - `/revenue` 现在没有胜率、转化率或等级分布，无从逐数对账；
   - 改为同一套阶段定义（赢 / 输 / 报价阶段）与同一测试排除规则，由测试锁定。
6. **policy 片段的落点**：
   - policy 存在 `OrgBusinessRule`（`revenue_spine.policy`），不在 `settingsJson`；
   - 今天**没有 policy 设置页面**，只有 `PUT /api/revenue/policy`（boss / admin，body `{ policy: … }`）。片段形状与该接口的 `policy` 字段一致，复制后可直接作为它的 `policy` 值；
   - 本 change 不调用该接口，也不新建设置页面。
7. **按需加载**：区块默认收起、点击才请求，不给 `/revenue` 首屏加请求，与 A-4 的做法一致。

## Capabilities

### New Capabilities
- `revenue-spine/score-calibration`：评分校准的样本口径（首次评估、阶段结果、排除规则）、各维统计、建议权重与样本门槛、只读接口与 `/revenue` 区块的展示和加载方式。

### Modified Capabilities
（无。）

## Impact

- 新文件：
  - `src/lib/revenue-spine/score-calibration.ts`（纯函数）；
  - `src/lib/revenue-spine/score-calibration-read-model.ts`（只读查询，依赖可注入）；
  - `src/app/api/revenue/score-calibration/route.ts`；
  - `src/components/revenue/score-calibration-panel.tsx`；
  - 3 个测试；
  - `docs/QINGYAN_ORG_COCKPIT_B-4_REPORT.md`。
- 改动：
  - `src/app/(main)/revenue/page.tsx`：底部加区块；
  - 两个测试脚本各追加 3 条。
- 不改 `scoring.ts` / `policy.ts` / policy 接口，不写任何表，不改 Prisma schema、`vercel.json`，不加 LLM 调用。

## Out of scope

- 不自动改 policy，不调用 `PUT /api/revenue/policy`，不提供"一键应用"。
- 不做模型训练、显著性检验或置信区间（确定性统计 + 样本门槛）。
- 不重新给历史商机打分，不改评分逻辑。
- 不改 `/revenue` 已有指标与队列。
