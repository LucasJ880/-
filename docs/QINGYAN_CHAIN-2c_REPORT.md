# CHAIN-2c 报告 — 限制谁能更换项目负责人（`project-owner-change-guard`）

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-2c（Phase F（续）— 情报串联的后续） |
| 起因 | CHAIN-2b #532 留给 GATE 的第 ② 条：能编辑项目的人可以把负责人改成自己，从而按负责人拿到财务查看权 |
| 拍板 | Lucas 2026-11-20 GATE：「可以」（另立 change） |
| OpenSpec change | `openspec/changes/project-owner-change-guard/`（新能力 `projects/owner-change`，8 条要求） |
| 基线 | origin/main `91d928e4` |
| 开关 | 没有开关，合并即生效 |

> 报告初稿：多维审查、全量门禁与最终数字待补。

## 1. 做了什么

- **换给别人**：平台超级管理员、持组织范围 `project.finance.manage` 的人、当前负责人、管理者（组织项目 = 本组织 `org_admin` 以上；执行项目接口 = 原来就要求的能管理执行项目的人）；其他人 403 `OWNER_CHANGE_FORBIDDEN`。
- **换给自己**：只有平台超级管理员与持组织范围 `project.finance.manage` 的人（`resolveFinancePrivilege(user, orgId, null).privileged`）；其他人 403 `OWNER_SELF_ASSIGN_FORBIDDEN`。
- **新负责人**：在用的用户，有组织时还要是本组织有效成员，否则 400 `OWNER_INVALID`（加成员接口沿用原来的检查与说法）；权限先判。
- **同时更换**：带条件写入，负责人已被改过 → 409 `OWNER_CONFLICT`，整个请求回滚。
- **四个入口**：`PATCH /api/projects/{项目}`、`POST /api/projects/{项目}/members`（`duty: "owner"`）、`PATCH /api/projects/{项目}/members/{成员}`（`duty: "owner"`）、`PATCH /api/ops/projects/{项目}`；被拒时整个请求不写。
- **审计**：项目 `PATCH` 换负责人时前后带 `ownerId`；执行项目接口换负责人时新写一条审计。
- **项目团队卡片**：成员接口返回 `ownerChange: { canChange, canSelfAssign }`；两个身份下拉按标记给「主负责人」；不能换（或不能换给自己）时写一句说明。

## 2. 测试（初稿）

| 测试 | 结果 |
|---|---|
| `src/lib/projects/__tests__/owner-change.test.ts`（新） | 20 通过 |
| 隔离库 `owner-change-db.isolated.test.ts`（新，库 `qingyan_iso_c2c`） | 23 通过 |
| 相关既有单测（工作台 / 详情页 / 预览 / 运营权限 / 残留读点 / 下一步 / 协作接线 / 报价引擎 / 账本等 14 个） | 全过，不改期望 |
| 相关既有隔离库（`residual-reads-db`、`p1-ledger-db`、`finance-access-db`、`ops-authorize-db`） | 13 / 60 / 18 / 32 全过 |

## 3. 门禁（初稿）

| 项 | 结果 |
|---|---|
| `npm run test:ci`（不带数据库） | PASS（已注册 681 个，历史欠账 66 条） |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS |
| `openspec validate project-owner-change-guard --strict` | valid |
| `git diff origin/main -- prisma/ vercel.json` | 空 |
| `npm test`（全量） | 待会话统一跑 |

## 4. 留给 GATE

1. 谁能更换负责人（D1 / D2 的取法）。
2. 中标后转执行（`src/lib/projects/handoff/execute.ts`）：操作人可以把自己选为新执行项目的负责人。

## 5. 多维审查

待补。
