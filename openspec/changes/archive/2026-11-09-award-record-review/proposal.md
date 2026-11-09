# Proposal：授标记录人工处理——确认 / 撤回（仅组织管理员）（P2-0d）

TASKFLOW：P2-0d。依赖 P2-0（#384，结果表单中标方）与 P2-0c（#386，去重规则）。

## Why

- 授标记录里的「线索」（AI 提取）与「疑似重复」（NEEDS_REVIEW）没有任何处理入口：`confirmAwardRecord` 写好了但没有接口和页面调用；"撤回"在状态表里有，但没有任何代码会写它。这些记录永远停在线索，不计入次数、金额与周期。
- P2-0 的结果表单让用户手填中标方；填错了没有办法更正（换名不覆盖原记录）。

## What Changes

- 服务层新增 `retractAwardRecord`：人工 user actor；原因必填（≤200 字，合并空白）；状态改为 RETRACTED，不删行、不删来源；撤回人、时间、原因与撤回前状态记在 `metadata.retraction`；已撤回再撤回幂等（不覆盖原因）。
- 新增接口 `POST /api/organizations/[orgId]/tender-awards/[awardId]/review`：
  - 仅组织管理员（`requireOrgRole(…, "org_admin")`；平台超级管理员按既有规则放行）；
  - `{ action: "confirm" }` → 复用 `confirmAwardRecord`（ACTIVE + HUMAN_CONFIRMED）；已是人工确认 → `unchanged`；
  - `{ action: "retract", reason }` → `retractAwardRecord`；
  - 状态变化与审计（`award_record_confirmed` / `award_record_retracted`）同一事务；授标情报开关关闭 → 409；不存在 → 404；已撤回再确认 → 409。
- `GET /api/org/tender-awards` 返回 `canReview`（当前用户是否组织管理员）与每条记录的 `possibleDuplicateOfId`。
- 「历史中标」页：管理员看到「处理」列——线索显示「确认属实」、疑似重复显示「不是重复，确认」并说明疑似与哪条重复；每条都可「撤回」（行内填原因）。非管理员不显示。
- 更正流程：结果回灌（P2-0 未中标中标方 / 我方中标）发现来源键对应记录已撤回时，改用确定性后继键 `{key}:after:{撤回记录 id}` 写新记录；重放幂等；再换名仍不覆盖。结果表单"已记录过中标方"的提示加上更正方法。

## Capabilities

### New Capabilities
- `tender/award-review`：授标记录的人工确认与撤回。

### Modified Capabilities
- 无（相关能力的规格在 #384 / #386 的 change 中新增，尚未归档）。

受影响的 Muse 意图：无。

## Impact

- 修改：`src/lib/tender-intel/awards.ts`、`src/lib/tender-intel/own-result-backfill.ts`、`src/app/api/org/tender-awards/route.ts`、`src/app/(main)/projects/intelligence/awards/page.tsx`、`src/components/project-detail/tabs/submission-tab.tsx`、`awards.test.ts`、测试注册脚本。
- 新增：review 路由、`award-review-db.isolated.test.ts`、`docs/acceptance/p2-0d/01–04`。
- 硬纪律：零 schema（`status` / `metadata` 既有字段）、零出站、零 LLM；授标事实只经人工动作改变，写入仍只走 `awards.ts`。

## Out of scope

- 撤回后的恢复（撤回不可逆；需要时重新录入）。
- 竞争对手 / 采购机构页上的处理按钮（只在「历史中标」页）。
- 批量处理历史疑似重复记录。
