# Design

## Context

- `User.role`（平台角色）是**全局一列**，跨企业共用。Sunny 成员若同时在梦馨，压扁会连带改变他在梦馨的菜单与权限（梦馨仍按平台角色，4c2 拍板 2）。
- `resolveEffectiveBindings`（`src/lib/authorization/resolve-effective-permissions.ts`）的判定顺序：
  - 平台 super_admin → 全部键；
  - 有 active 岗位绑定 → 绑定；
  - 否则兼容回退 `compatProfileKeyForMembership`：`org_owner` / `org_admin` / `org_viewer` → 同名系统模板，`org_member` + 平台 `sales` → `sales_rep`。
- `seedOrgAuthorizationProfiles` 已把 `org_owner` / `org_admin` / 平台 `sales` 成员**真实绑定**到系统模板。所以对已跑过 seed 的企业，兼容回退只兜底"seed 之后新加入、尚未绑定"的人。
- 既有绑定脚本 `scripts/bind-positions.ts` 的约定：
  - `ALLOW_*=true` + super_admin 双闸，`--dry-run`；
  - 退出码 0 / 1 拒绝 / 2 输入错误；
  - 纯函数规划放 `src/lib/authorization/*`；
  - 审计走 `logAuthorizationChange`。
- **propose 前盘点**：导航之外约 25 处运行时逻辑读平台角色，压扁后行为会变（D6）。

## Goals / Non-Goals

**Goals**：
- 可审计、可还原、可 dry-run 的压扁工具；
- 岗位模式企业关闭兼容回退；
- 在残留读点收口前，代码层面挡住真正写入；
- 残留清单落成文档，不丢。

**Non-Goals**：
- 改任何残留读点（D6 列出，归属后续 change）；
- 外贸 / `trade`（PERM-6）；
- 梦馨；
- 改 `User.role` 列或枚举；
- 在生产执行脚本。

## Decisions

### D1 写库闸门是代码常量，不是命令行开关
`PLATFORM_ROLE_COLLAPSE_READY = false` 放在 `platform-role-collapse.ts`。为 false 时，写入一律退出 1，只放行 `--dry-run` / `--restore`。由最后一个残留收口 change 改为 true，并在该 change 的测试里断言。
- 否决：命令行 `--force` / `--ack-residual`——人在压力下会加开关绕过；闸门应随代码状态走，合并记录可查。
- 否决：等残留收口完再做本 change——脚本、前置校验、还原和兼容回退收口都与残留读点无关，先合并可让 dry-run 尽早在生产核对名单。

### D2 跨企业成员整批拒绝
待改的人只要是任一旧模式企业（无岗位模板）的 active 成员，就整批拒绝并列出。岗位模式企业之间不冲突，因为它们都按岗位键判定。
- 否决：跳过这些人、只改其余——压扁不完整，Sunny 菜单会因人而异，且容易漏看名单。

### D3 每个待改的人至少一条 active 人类岗位绑定
没有绑定的人压扁后连兼容回退都没有（D5），有效权限为空。系统模板绑定（seed 自动绑的 `org_owner` / `org_admin` / `sales_rep`）也算绑定。
- 否决：要求必须有行业包岗位（如 `owner`）——seed 绑的系统模板已是合法岗位；是否要换成窗饰岗位由 `bind-positions` 负责，不在压扁时混判。

### D4 前后角色存 AuditLog，还原读 AuditLog
零 schema。
- 压扁：每人一条 `authorization.platform_role.collapse`，`after` 含 `{ email, fromRole, toRole: "user", via }`。
- `--restore`：取本企业该动作的记录，每个用户取最新一条；当前仍为 `user` 才改回 `fromRole`，写 `authorization.platform_role.restore`；否则跳过并列出。
- `--restore` 不受闸门限制（D1），用于出问题时快速回退。
- JWT 里的 `role` 要用户重新登录后才更新（`middleware` 读 JWT，接口读库）。脚本输出提醒"相关成员需重新登录"。

### D5 兼容回退收口按"岗位模式"判定，合并即生效
`resolveEffectiveBindings` 走到兼容回退前，查企业 `industryPackId`；若 `hasPositionTemplates` 为真则返回空。抽纯函数 `compatFallbackAllowed(industryPackId)` 供单测。
- 与 4c2 的 `positionMode` 同口径：一家企业要么全按岗位，要么全按旧规则。
- 否决：等脚本执行时再关——兼容回退与平台角色无关的那部分（`org_owner` / `org_admin` / `org_viewer`）同样会漏放；且 seed 已经把这些人真实绑定，合并即关风险很小。上线前用 `bind-positions --dry-run` 核对。

### D6 残留平台角色读点（不在本 change 改；落成文档）
按 Sunny 成员 `boss / manager / operations / sales → user` 的影响分组。下方是摘要；文档 `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` 逐条写 file:line、压扁前后差异与建议改法。

**A. AI / 智能体（销售日常工作，必须先收口）**
- `agent-core/tool-registry.ts` 按平台角色过滤工具（+ `tools/_policy.ts`）。销售压扁后失去全部 `sales_*` / `secretary_*` / `project_*` 工具，覆盖网页、微信、@提及三条入口。老板 / 运营 / manager 已被归一成 `user`，不变。
- `secretary/briefing.ts`：销售晨报变空。
- `muse-bridge/sales-pure.ts` `resolveSalesScope`（决定 B）：
  - 销售 → 拒绝；
  - 老板若不是 `org_owner` / `org_admin` → 拒绝（失去全组织范围与金额）。
- 放宽类：
  - `agent-scope/resolve.ts:89`：销售可把全企业客户挂进 AI 上下文；
  - `marketing/access.ts:40` / `route-access.ts:22`：销售可用营销数字员工、进 `/marketing`。
- 仅提示词：`ai/prompts/common.ts`、`agent-core/prompts/operator-system.ts`。
- 环境变量白名单按角色：`*_ROLE_ALLOWLIST`（如 `DIGITAL_EMPLOYEE_ROLE_ALLOWLIST=admin,sales`），需核对生产值。

**B. 接口授权（老板管理功能）**
- `api/tasks`、`api/tasks/[id]`：团队视图、指派、改他人任务。wsCtx 无权限键，老板若非 `org_owner` / `org_admin` 就失去。
- `api/ops/projects`（列表 / 创建，wsCtx 无权限键）。
- `projects/handoff/access.ts`（交接，wsCtx 无权限键；`bids.handoff.*` 键已有但够不到）。
- `pending-actions/executor.ts` `canSeeResource`：老板审批执行销售的商机 / 报价 / 客户动作被拒。
- `market-intelligence/access.ts`、`employee-ai/access.ts` `canReviewTeamLearning`：manager（Sunny 无人用）。
- `visualizer/access.ts`：老板 dataScope `all` → `own`。另：该处 `all` 不按企业过滤，是**既有跨企业泄露**，已单独提任务修。
- `revenue-spine/access.ts` `requireRole`（13 个 `/api/revenue/*`）与 `api/revenue/policy`：外贸通道，归 PERM-6；需核对 Sunny 是否在用。

**C. 仅界面**
- `components/dashboard/management-dashboard-client.tsx`：管理总览的销售 / 外贸模块与每日简报按 `boss` 显示，压扁后老板首页这几块消失。

**D. 通知 / 收件人 / 路由**
- `trade/booth-summary.ts` `managementOf`（老板询盘晨报、SLA 升级、展会汇总）、`trade/inquiry-sla.ts:216`、`trade/website-inquiry.ts:1002`：老板 / manager 收不到。
- `revenue-spine/inquiry-intake.ts:147`：默认询盘负责人不再选到销售。
- `messaging/binding.ts`：新绑定 / 重绑的微信对前销售不推销售消息。

**E. 数据**
- `seed-org-profiles.ts:156`：平台 `sales` 自动绑 `sales_rep` 在压扁后不再生效（已绑定的不受影响）。

**拆分（2026-10-28 已拍板，见任务书"拍板结果 · PERM-4c3"）**，按 ≤ 8 tasks / change：
- `perm-4c4-ai-tools-by-position`：A 组，按岗位键给工具域与 Muse 范围，决定 B 的"管理层"改为 `organization.dashboard.read`；
- `perm-4c5-management-reads-by-position`：B / C / D 组，wsCtx 注入 `permissionKeys` / `positionMode`、审批执行与通知收件人按岗位；最后一个合并的 change 把 `PLATFORM_ROLE_COLLAPSE_READY` 改为 true。

外贸相关（`revenue-spine`、`trade/*` 收件人、默认询盘负责人）：Sunny 暂不需要外贸 → 留 PERM-6，不阻挡闸门。招投标相关（交接、`/api/ops/projects`）：Sunny 需要 → 4c5 必须覆盖。

## 与八条硬纪律的关系

1. **零 schema**：触碰。前后角色存既有 AuditLog；不加字段，不写 migration。
2. **出站先审批**：不涉及。脚本是平台管理员手动运维，不对外发送。
3. **第三套队列**：不涉及。
4. **脱敏**：不涉及。脚本输出只含邮箱与角色名，不含密码哈希 / token / 连接串。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：触碰。规划与校验是纯函数查表，无 LLM。
8. **测试注册**：触碰。纯测试注册 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，隔离库测试注册 `scripts/test-all.sh`。

## Risks / Trade-offs

- **BREAKING（Sunny，合并即生效）**：兼容回退关闭后，没有任何 active 绑定的 Sunny 成员失去权限。上线前 `bind-positions --dry-run` 核对；seed 自动绑定的系统模板算绑定。
- 闸门常量让"代码合并"与"可以执行"分离。代价是需要后续 change 记得改常量；清单文档与 HANDOFF 都写明。
- `--restore` 只还原"当前仍为 `user`"的人，避免覆盖压扁后的人工调整。

## 验证方式

- `npx tsx src/lib/authorization/__tests__/platform-role-collapse.test.ts`（新，纯）。覆盖：
  - 范围（四种旧角色 / 其余不动 / 非 active 不动）；
  - 前置校验（非岗位模式、缺绑定、跨旧模式企业，三类整批拒绝并列名）；
  - 幂等；
  - 还原计划（取最新一条、当前非 `user` 跳过）；
  - `compatFallbackAllowed`；
  - 闸门常量为 false；
  - 脚本源码断言：双闸、闸门、`--restore` 不受闸门限制。
- `platform-role-collapse-db.isolated.test.ts`（新，隔离库）。覆盖：
  - dry-run 不写库；
  - 闸门关闭时写入退出 1、无人被改；
  - 闸门打开（测试内覆盖）时压扁、审计、再跑无变化、`--restore` 还原；
  - 岗位模式企业无绑定 `org_owner` 被拒、旧模式企业照旧回退。
- 回归：`authorize`、`finance-access`、`position-nav`、`ops-access`、`accounting` 原样通过。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate perm-4c3-collapse-platform-roles --strict`。
