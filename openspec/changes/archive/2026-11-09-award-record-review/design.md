# Design：授标记录人工处理（P2-0d）

## Decisions

### D1 权限：只给组织管理员
Lucas 2026-11-06 决定。用既有 `requireOrgRole(request, orgId, "org_admin")`（org_owner 也满足；平台超级管理员按既有规则放行）。路径放在 `/api/organizations/[orgId]/…`，与其它组织管理接口一致。读接口只返回 `canReview` 决定是否显示按钮，真正的校验在写接口。

### D2 撤回 = 改状态 + 留痕，不删除
AwardRecord 已有 `RETRACTED` 状态与 `metadata` 字段；读路径与去重都已排除 RETRACTED。撤回只改状态，原因等写进 `metadata.retraction`，来源行保留（证据链不断）。撤回不可逆：已撤回不能再确认（沿用 `confirmAwardRecord` 的 RETRACTED_IMMUTABLE）。
否决：物理删除（丢证据、破坏幂等键）。

### D3 审计与状态同一事务
用 `writeAuditLog(tx, …)`，不用 fire-and-forget 的 `logAudit`。幂等返回（unchanged）不写审计。

### D4 撤回后的更正：确定性后继键
结果回灌的来源键是每项目固定的（`tender-result-winner:{projectId}` / `own-result:{projectId}`），撤回后重放会拿回已撤回记录。回灌遇到已撤回记录时改用 `{key}:after:{撤回记录 id}`：
- 确定：同一次更正重放得到同一个键 → 幂等；
- 不复活：撤回记录保持 RETRACTED；
- 链式：再撤回再更正继续往后（上限 10 跳，超过视为数据异常并报错）。
否决：把中标方名字放进键（换名会产生两条有效中标方）；撤回时删来源行（丢证据）。

## Risks / Trade-offs

- 管理员误撤回无法恢复，只能重新录入（项目结果标记重放即可恢复我方 / 对手中标）。
- 非项目来源（外部检索确认）的记录撤回后，同一来源再次摄取会拿回已撤回记录（不复活）——这是期望行为。

## Migration Plan

无 schema / 数据迁移；纯代码，随部署生效；回滚 = 还原文件。已撤回的记录在回滚后仍为 RETRACTED（读路径照常排除）。
