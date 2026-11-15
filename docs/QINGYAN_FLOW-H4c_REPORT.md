# FLOW-H4c 报告：提交记录接进可投标判定

| 项 | 值 |
|---|---|
| change | `tender-readiness-submission-record` |
| TASKFLOW | FLOW-H4c（Phase F 续，依赖 FLOW-H4a） |
| 来源 | 交接文档 §0.5d 第 1 项；§0.5c「提交环节」调查要点第 5 条。Lucas 2026-11-15「454已经合并，继续按照你推荐的做」 |
| 分支 | `claude/flow-h4c-readiness`（从 main 开） |
| 性质 | 缺陷修复 + 一处判定的补充。零 schema、零模型调用、没有新开关（只在投标工作区里可见，沿用 `TENDER_BID_WORKSPACE_ENABLED`，默认关） |

## 1. 问题

投标工作区的可投标判定第一项是截标窗口：截标之后看提交记录，有回执编号算已提交，没有就是「已过截标」的阻断项（TI-1 定下的「只有带平台回执的才算数」）。但工作区从来不把提交记录传给判定，所以截标一过永远是「已过截标，且没有带回执的提交记录」、不可投标——交完标、在 FLOW-H4a 的「提交记录」里记了回执的项目也一样。

## 2. 做了什么

- **带上提交记录**：工作区读取（`GET …/bid-workspace`）与成本核算表（`POST …/bid-workspace/cost-sheet`）的判定，带上与项目当前提交时间对得上的那条提交记录。取法与提交记录卡片相同（抽成纯函数 `effectiveRecordOf`，两边共用）：从新到旧找，取最新的、记的就是项目当前提交时间的那一条。
- **有回执编号**：截标之后判定为第三种结果「**已交标（仅供复盘）**」，阻断项照列，带既有的「已有带回执的提交记录；本判定仅供复盘」提示。面板上的徽标用中性色。
- **有提交时间、没有回执编号**：仍是「已过截标」的阻断项（TI-1 的规则不变）。提交记录对这个组织开着时，文字写明「在『提交』页签的『提交记录』里补上回执编号」；没开时只说「项目有提交时间，但没有回执编号（只有带回执的提交才算已交标）」。
- **没有提交时间**：文字与原来相同。截标之前：不受影响，也不查。
- 给判定的取数放在只读文件 `src/lib/tender-submission/read.ts`，只依赖数据库与提交记录的规则。

## 3. 交付清单

| 位置 | 改动 |
|---|---|
| `src/lib/tender-submission/contract.ts` | 新增 `effectiveRecordOf` |
| `src/lib/tender-submission/read.ts`（新） | `loadSubmissionForReadiness`：只返回提交时间与回执编号 |
| `src/lib/tender-submission/service.ts` | 提交记录卡片改用 `effectiveRecordOf`；条数常量与 `read.ts` 共用 |
| `src/lib/tender-bid-readiness/readiness.ts` | 第三种判定 `REVIEW_ONLY`；「已过截标」按有没有提交时间、提交记录开没开分三种文字 |
| `src/lib/tender-bid-workspace/store.ts` | 上下文带上提交记录（截标之后才查）与提交记录开关 |
| `src/lib/tender-bid-workspace/workspace-view.ts` | 判定用上面两项 |
| `src/components/tender/bid-workspace-panel.tsx` | 第三种判定的徽标用中性色 |
| `src/lib/tender-bid-workspace/__tests__/readiness-submission-db.isolated.test.ts`（新） | 隔离库 + 真实路由，24 项 |
| `readiness.test.ts`、`submission-record.test.ts` | 补到 31 项、81 项 |
| `scripts/test-all.sh`、`scripts/test-ci-unit.sh` | 注册新测试（无库时跳过） |

## 4. 证据

**新测试**（本机隔离库）

| 测试 | 项数 | 改动前（main） |
|---|---|---|
| `readiness-submission-db.isolated.test.ts` | 24 | 第一版 19 项在 main 上 9 通过 / **10 失败**（记了回执仍报「已过截标」、成本核算表同样、开关关了、更正之后、没有回执、只有提交时间、别的项目与组织的记录、那个项目自己）。第一项失败只因为 main 上没有新的文字常量 |
| `readiness.test.ts` | 31（+11） | 新加的文字与第三种判定在 main 上不存在 |
| `submission-record.test.ts` | 81（+1，另换掉一条源码断言） | `effectiveRecordOf` 在 main 上不存在 |

隔离库测试覆盖：没有提交时间；记了回执（工作区与成本核算表两处、响应里不出现回执编号与备注、提交记录开关关了之后仍算数）；更正之后；记了但没有回执编号（提交记录开着 / 关着两种文字）；只有对话里推进写下的提交时间；更晚写下但时间对不上的记录；最新一条时间对不上、往回找到有回执的那条；同一时间两条按后写的；别的组织名下、别的项目的记录；同一项目 25 条别的动作的审计行；截标之前。

**既有测试**（本机，不变地通过）：`submission-record-db.isolated` 62、`bid-workspace-db.isolated` 49、`schedule-prefill-db.isolated` 40、`web-next-step-db.isolated` 103、`web-next-step` 141、`web-progress` 51、`workspace-view` 28、`workspace-contract` 32、`line-entry` 41、`panel-helpers` 41、`schedule-prefill` 106、`certification-and-staleness` 24、`evidence-status` 18、`stage-policy` 25。

**门禁**

| 门禁 | 结果 |
|---|---|
| `npm run test:ci` | `CI unit subset PASS`（本机，CI 的环境变量；修复前后各跑一次）。中间有一次在 04:59 UTC 失败于 `notifications/__tests__/delivery-gate.test.ts`「静默时段 medium 不投」：那条测试用真实时钟、静默时段写成 00:00–23:59（多伦多时间，结束不含），每天多伦多 23:59 那一分钟必然失败——与本次无关，过了那一分钟重跑通过。建议另开一个小改动让它传固定的时间 |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint） |
| `bash scripts/check-test-registry.sh` | OK（已注册 620 个） |
| `bash scripts/test-runtime-architecture.sh` | PASS |
| `npx tsx scripts/check-swc-nullish-logical.test.ts` | PASS |
| `openspec validate tender-readiness-submission-record --strict` | valid（两条要求的正文都在 500 字以内，归档后主规格不会超长） |

## 5. 独立审查

开 PR 前请了一个不带结论的独立审查（只给分支与四件套，它在自己的工作区里跑测试与 18 处变异）。没有高等级问题。处理：

| 编号 | 发现 | 处理 |
|---|---|---|
| M1 | 新文字「去『提交记录』里补」只看有没有提交时间；工作区与提交记录是两个开关，工作区开着、提交记录关着时，那张卡片根本不显示 | 修。上下文带上提交记录开关；没开时只说缺回执编号（D3b）。spec 加场景，隔离库测试覆盖 |
| M2 | 接上提交记录之后，「截标已过 + 有回执」第一次在生产上可能出现：交完标、成本齐全的项目会得到绿色的「可提交 Owner 决定」 | 修。第三种判定「已交标（仅供复盘）」，不论有没有阻断项；面板中性色（D5）。spec 加 `tender/bid-readiness` 的 MODIFIED |
| L1 | 「按对得上的那条，不按最新的」在判定这条路上只有源码断言；「只看最新一条」「只取 1 条」两处变异存活 | 修。隔离库测试加三种：更晚写下但时间对不上的、最新一条时间对不上要往回找、同一时间两条按后写的 |
| L2 | 取数时按动作过滤没有测试 | 修。同一项目 25 条别的动作的审计行之后，真正的记录还在 |
| L3 | 每次读取都多一次查询，而且排在其它查询之后；截标之前根本用不到 | 修。截标之前不查（D6） |
| L4 | 投标工作区经由提交记录的 `service.ts` 把写入路径（阶段推进、通知、回调，含对外请求的模块）都带了进来，可达模块 14 → 50 | 修。取数挪到只依赖数据库与规则的 `read.ts`；测试断言它的导入只有这两个、工作区不再导入 `service.ts` |
| L5 | tasks 没打勾、没有报告与 TASKFLOW 行；「已提交」在关键日期 / 进度区与工作区意思不同 | 补齐；后者是本次之前就有的分歧，写进 Risks |

## 6. 变异核对

修复之后 20 处变异：**17 处被测试发现，3 处等价**。

- 等价：取数去掉 `projectId` 过滤（`targetId` 同样是项目 id，写入时两者总相同）；没有提交时间时返回空字符串而不是 null（判定把空字符串当作没有）；截标之前也查（结果相同，只是多一次查询）。
- 判定这条路上选哪条记录的三处（只看最新一条、只取 1 条、从旧到新）先是被纯函数测试的源码断言发现；补了上面 L1 的三种之后，单跑隔离库测试也能发现。

脚本：`/tmp/claude-0/-home-user--/a7528e60-5f86-55e5-b1cc-747fa9fb90f5/scratchpad/h4c/mut.py`（会话临时目录，不入库）。

## 7. 已知限制

- **没有回执编号的提交仍然「不可投标」**：交了标、但门户没给编号（或人没填）的项目，工作区会一直这样说。
- **项目已归档或已放弃时**，提交记录卡片不让记录，但「去『提交记录』里补」的文字只看开关、不看项目状态。
- **「已提交」在不同地方意思不同**：关键日期与项目进度区把有提交时间就当已提交，工作区只认带回执的（本次之前就有）。
- **截标之后工作区读取（含「下一步」卡片）多一次查询**：最多 20 条审计行，只在项目有提交时间时查。

## 8. 没做的

- 改「只有带回执的才算已提交」（TI-1）。
- 改「下一步」卡片、提交记录的写入与接口。
- 回执文件上传。

## 9. 上线

合并后照常 `vercel --prod`。零 schema，无回填、无新开关；投标工作区的开关默认关，线上无变化。回滚 = 回滚代码。
