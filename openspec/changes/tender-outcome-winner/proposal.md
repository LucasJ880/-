# Proposal：结果表单补「中标方（选填）」+ 竞争对手域排除我方（P2-0）

TASKFLOW：P2-0（Phase 2 标讯雷达的前置数据修补；来源 `docs/QINGYAN_TENDER_INTEL_SLOTS_P1P2_REPORT.md` §5 遗留两条）。

## Why

- 标记"未中标"时没地方填谁中了标，所以输掉的标不会留下任何竞争对手事实；"竞争对手"情报只能靠另一条外部情报人工确认线慢慢积累。
- 我方中标会回灌成授标事实，投影按中标方聚合，结果我方自己的公司名出现在"竞争对手"里。
- 下一步要做的招标雷达和"上一次谁供货"都依赖干净的中标方数据。

## What Changes

- 结果表单：选"未中标"时出现"中标方（选填）"输入框；提交后告诉用户中标方是否已进入竞争对手情报（或为什么没有）。
- 接口 `POST /api/projects/[id]/tender-result` 接受可选 `winnerName`：只在 `result=lost` 时接受（其他结果填了返回 400）；去首尾与多余空白，≤ 200 字；与我方组织名相同（按授标记录同一规范化）返回 400，且不改项目状态。
- 未中标且填了中标方：
  - 结果备注追加一行 `[中标方 YYYY-MM-DD] 名称`（授标情报关闭时也不会丢）。
  - 授标情报开启时，经既有人工确认写路径（`materializeWinnerConfirmation`）写入 AwardRecord：`HUMAN_CONFIRMED` / `USER_ENTRY` / 幂等键 `tender-result-winner:{projectId}`，带买家、招标编号、中标价与币种。
  - 每个项目只记一次：同名（大小写 / 标点不同）再标记幂等；换了名字不覆盖原记录，返回原因 `winner_already_recorded`。
- 投影 `deriveAwardIntelligence` 新增可选 `ownWinnerNames`：这些中标方不进"竞争对手"域（已确认与线索都排除），新增 `ownAwardCount`；历史授标与买家中标方列表不变。`/api/org/tender-awards` 传入组织名；"历史中标"页显示"已排除我方自己的中标记录 N 条"。
- 响应新增 `winner: { name, recorded, reason }`；审计 afterData 记 `winnerName`。

## Capabilities

### New Capabilities
- `tender/result-marking`：招标结果标记的中标方采集与沉淀。
- `tender/award-intelligence`：授标情报投影的竞争对手域口径（排除我方）。

### Modified Capabilities
- 无（两块此前没有规格）。

受影响的 Muse 意图：无。

## Impact

- 修改：`src/lib/projects/tender-result.ts`、`src/app/api/projects/[id]/tender-result/route.ts`、`src/lib/tender-intel/own-result-backfill.ts`、`src/lib/tender-intel/award-intelligence.ts`、`src/app/api/org/tender-awards/route.ts`、`src/components/project-detail/tabs/submission-tab.tsx`、`src/app/(main)/projects/intelligence/awards/page.tsx`、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 新增：`src/lib/tender-intel/__tests__/outcome-winner-db.isolated.test.ts`；`tender-result.test.ts`、`award-semantics.test.ts` 加用例。
- 硬纪律：零 schema（复用 AwardRecord / AwardRecordSource 与项目描述字段）、零出站、零 LLM、无新队列；授标事实只经人工动作写入（不触碰"AI 自动写 canonical 硬禁"）。

## Out of scope

- 不提供更正 / 撤回已记录中标方的界面（现有写路径没有撤回接口；换名不覆盖并提示）。
- 不从招标公告或合同披露自动推断中标方。
- "竞争对手 / 采购机构 / 周期采购"三个占位页不在本次处理。
