# P2-0d 报告：授标记录人工处理——确认 / 撤回（仅组织管理员）

| 项 | 值 |
|---|---|
| TASKFLOW | P2-0d |
| OpenSpec change | `openspec/changes/award-record-review/` |
| 决定 | 只给组织管理员（Lucas 2026-11-06） |
| 分支 | `claude/award-record-review`（基于 #384 分支，并合入 #386 分支；两者合并前本 PR 的差异包含它们） |
| 截图 | `docs/acceptance/p2-0d/01–04`（虚构数据，隔离库） |

## 1. 为什么

- 「线索」（AI 提取）和「疑似重复」记录没有任何处理入口：`confirmAwardRecord` 没有接口和页面调用；"撤回"状态没有任何代码写。它们永远只算线索，不计入次数、金额与周期。
- #384 让用户手填未中标时的中标方；填错了没有更正办法。

## 2. 改了什么

- **服务** `retractAwardRecord`：人工 user actor；原因必填（≤200 字）；RETRACTED，不删行、不删来源；撤回人 / 时间 / 原因 / 撤回前状态记在 `metadata.retraction`；再撤回幂等。
- **接口** `POST /api/organizations/[orgId]/tender-awards/[awardId]/review`：仅组织管理员；`confirm` / `retract`；状态与审计（`award_record_confirmed` / `award_record_retracted`）同一事务；开关关闭 409、不存在 404、已撤回再确认 409、非法 action 400；幂等返回 `unchanged` 不写审计。
- **读接口** `/api/org/tender-awards` 加 `canReview` 与 `possibleDuplicateOfId`。
- **页面**「历史中标」：管理员看到"处理"列——线索「确认属实」、疑似重复「不是重复，确认」（并写明疑似与哪条重复）、每条「撤回」（行内填原因）；非管理员不显示。
- **更正**：结果回灌遇到已撤回记录 → 用后继键 `{key}:after:{撤回记录 id}` 写新记录（未中标中标方与我方中标两条路径）；重放幂等，再换名仍不覆盖。结果表单"已记录过中标方"的提示加了更正方法。

零 schema、零出站、零 LLM；授标事实只经人工动作改变，写入仍只走 `awards.ts`。

## 3. 测试与门禁（实际运行）

| 检查 | 结果 |
|---|---|
| `awards.test.ts`（+T4-11a–h 撤回） | 32 passed |
| `award-review-db.isolated.test.ts`（新增，隔离库 + 真实路由 + 真实会话） | 20 passed；无库跳过 |
| `outcome-winner-db.isolated` / `award-dedupe-db.isolated`（回灌改动回归） | 18 / 6 passed |
| `award-semantics` / `intel-slots-p1p2` / `intel-auto-flow` / `tender-result` | 16 / 13 / 16 / 17 passed |
| `check-test-registry.sh` | OK，已注册 538 |
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npm run lint:baseline` / `test-runtime-architecture.sh` | PASS / PASS |
| `openspec validate award-record-review --strict` | valid |
| 界面 | 隔离库 + `next dev`：管理员看到处理列、撤回表单、确认后统计更新；成员视图处理列为 0 |

DB 测试第一次跑有 5 项失败，原因是测试数据：两条"疑似重复"用了相同日期和金额，被既有强匹配规则并成一条（规则正确）。改成不同日期后全过。截图时浏览器控制台有一条"script tag"提示，来自根布局的主题脚本（`src/app/layout.tsx`），与本改动无关。

以上全部是测试数据，不是真实业务证据。

## 4. 已知局限

- 撤回不可逆；误撤回只能重新录入（项目重新标记结果即可恢复对应记录）。
- 处理按钮只在「历史中标」页；竞争对手 / 采购机构页（#385）不放。
- 不做批量处理。

## 5. 上线

无迁移、无新 env；沿用 `T4_AWARD_INTELLIGENCE_SCHEMA_READY`。合并顺序：#384、#386 先合，再合本 PR。回滚 = 还原文件。
