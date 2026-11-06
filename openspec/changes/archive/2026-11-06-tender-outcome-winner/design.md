# Design：结果表单中标方 + 竞争对手域排除我方（P2-0）

## Context

- 结果标记唯一入口：`POST /api/projects/[id]/tender-result` → `markProjectTenderResult` → `maybeCreateReviewDraft` → `backfillOwnResultCanonical`（won → 我方 AwardRecord，`own-result:{projectId}`；买家 → T3 Buyer）。
- 授标事实唯一写路径：`awards.ts` 的 `materializeWinnerConfirmation`（T4 开关闸 + `createOrObserveAwardRecord`，按 `(orgId, sourceType, sourceKey)` 幂等）。
- 投影 `deriveAwardIntelligence` 按 `winnerNameNormalized` 聚合竞争对手，不知道哪个是我方。

## Decisions

### D1 只在 lost 采集，校验放在两层
`parseOutcomeWinner`（纯）在路由层校验类型、长度、结果类型；`isOwnOrgWinner` 在 `markProjectTenderResult` 里用组织名 + `normalizeVendorName` 比较——在写项目之前抛错，被拒时项目状态不变。

### D2 写入复用既有人工确认路径
lost + 中标方 → `materializeWinnerConfirmation`（`USER_ENTRY` / `HUMAN_CONFIRMED` / `confidence=MEDIUM`，因为没有公开文书编号），与我方中标同一路径同一开关。幂等键 `tender-result-winner:{projectId}`：每项目一条。`ALREADY_OBSERVED` 且规范化名字不同 → 不覆盖、原因 `winner_already_recorded`。弱重复 → 记录为 `NEEDS_REVIEW`（既有逻辑），原因 `needs_review`。
否决：把名字拼进幂等键——换名会留下两条"已确认"的中标方，错误事实无法撤回。

### D3 备注兜底
无论开关，都在项目描述追加 `[中标方 日期] 名称`，开关关闭（`t4_schema_not_ready`）时信息不丢，日后可人工补录。

### D4 投影排除我方
`deriveAwardIntelligence(rows, { ownWinnerNames })`：规范化后放进集合，竞争对手已确认与线索两处都跳过；`ownAwardCount` = 被排除的记录数（含线索）。不传时行为与改动前完全一致（测试锁定）。只改竞争对手域：历史授标与买家中标方列表语义是"中标方"，保留我方。
否决：在 UI 过滤我方名——两个页面各写一遍、口径易漂；投影层一处改。

## Risks / Trade-offs

- 组织改名后，旧的我方中标记录（用旧名写入）不会被排除：属于少见情况，可在后续加别名表。
- 没有撤回界面：换名只提示、不覆盖；更正需另行设计（Out of scope）。

## Migration Plan

无 schema / 数据迁移；纯代码，随部署生效；回滚 = 还原文件。已写入的 AwardRecord 与普通人工确认记录同构，回滚后仍可读。
