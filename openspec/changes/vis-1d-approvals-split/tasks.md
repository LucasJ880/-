# Tasks

每条带验证；真实输出写进 `docs/QINGYAN_VIS-1d_REPORT.md`。

受影响测试基线（2026-11-11，origin/main e4c51284）：

| 测试 | 通过数 |
|---|---|
| phase3a3-approvals-rbac | 34 |
| posts-read-model | 162 |
| waiting | 80 |
| fact-proposals | 37 |
| research-plan | 通过 |
| b2-approval-cas-static | 18 |
| repo-conformance | 9 |
| approval-resume | 10 |
| draft-feedback | 95 |
| workload | 94 |
| audit-labels | 11 |
| platform-admin-scope | 43 |
| route-gate | 141 |

另有 `phase3a3-approvals-smoke`、`b2-approval-cas.isolated`、`durable-followup-m1.isolated` 与三份 workforce DB 测试要数据库，无库时跳过或失败（与 origin/main 相同）；本机隔离库起好后一并跑一次记基线。

## 1. 可见集合纯函数与判定输入

- [ ] 1.1 按 design D1–D5 新增可见集合：
  - 新增 `src/lib/approval/audience.ts`（纯模块）：
    - `APPROVAL_FAMILIES`；
    - `approvalFamilyOf`、`visibleFamilies`、`isApprovalVisible`、`pendingActionAudienceWhere`。
  - 新增 `src/lib/approval/audience-server.ts` 的 `loadApprovalViewer(userId, orgId)`：平台角色按 `userId` 读库；成员角色、工作区、本企业内本人负责或任 project_admin 的项目各查一次。
  - `context-server.ts`：`RouteGateLoader` 加 `loadContextForOrg(user, orgId)`，复用 `(userId, orgId)` 的 30 秒缓存与请求合并。
  - 先写 `src/lib/approval/__tests__/audience.test.ts`，覆盖：
    - 对照表覆盖目录里每个有业务归属的类型；
    - 按身份的可见类型：spec 的每个场景（Sunny 老板 / 会计 / 合价 / 运营 / 招投标 / 销售、梦馨 Cathy、不持岗位的 org_admin、旧模式 org_admin、super_admin）；
    - 本人提交 / 指定审批人 / 项目负责人 / 工作区成员路径；
    - 小求值器断言 `pendingActionAudienceWhere` 与 `isApprovalVisible` 在样例行上逐行一致；
    - `audience.ts` 不导入数据库与 `next/*`。
  - 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：新测试全过；`route-gate.test.ts`（141）不变；`bash scripts/check-test-registry.sh` 通过。

## 2. 审批中心

- [ ] 2.1 按 design D6 接入审批中心：
  - `query.ts`：
    - 列表与详情加可选参数 `viewer`，缺省时由 `loadApprovalViewer` 取；
    - PendingAction 的查询条件加 `pendingActionAudienceWhere`；ApprovalRequest 与产品内容投影前判 `isApprovalVisible`；
    - 删旧的非管理员过滤块；
    - 详情不可见抛 404。
  - 调用方（审批中心列表 / 详情路由、概览、首页岗位总览的「待我审批」加载器）不改调用形状。
  - 改测试：
    - `phase3a3-approvals-rbac.test.ts` 按新规则更新「管理员看全量」类断言；
    - `posts-read-model.test.ts` 若注入了列表加载器则补 `viewer`。
  - verify：
    - `phase3a3-approvals-rbac`、`posts-read-model`（162）、`waiting`（80）全过；
    - 源码断言：`decision.ts` 仍经 `getCapabilityApproval` 加载，`query.ts` 不再有 `isOrgAdminRole(access.orgRole)` 的整段放行。

## 3. 待我确认、红点、运营看板与收件箱

- [ ] 3.1 按 design D7 收口四处团队审批范围：
  - `marketing/team.ts` 新增 `teamApprovalScopeWhere(userId, access)`（行为不变）。
  - 新增 `src/lib/approval/pending-mine.ts`：`listMyPendingActions` / `countMyPendingActions(user, orgId, opts)` = 处理人范围 ∩ 可见集合 ∩ 当前企业（另含本人个人草稿）。
  - 四处改用同一个函数或同一组条件：
    - `api/ai/pending-actions/route.ts` 与 `count/route.ts` 调它（红点改为只数当前企业）；
    - `operations/dashboard/build-dashboard.ts` 用同一组条件；
    - `approval/port.ts` 的 `listApprovalInbox(userId, { orgId })` 用同一组条件，`/api/agent/approvals` 与 `muse-bridge/router.ts` 传企业。
  - 批准 / 驳回入口先判可见：`api/ai/pending-actions/[id]` 不可见返回 404；`approveApprovalItem` / `rejectApprovalItem` 不可见返回 `ok: false`，不执行。
  - 改测试：`fact-proposals`、`research-plan`、`draft-feedback`、`b2-approval-cas-static`、`approval-resume` 若断言收件箱或端口的调用形状则同步更新。
  - verify：
    - 上述测试不降；
    - `audience.test.ts` 补源码断言：四处都用同一个条件函数，`[id]` 路由与端口的可见校验在 `canDecideTeamApproval` / 执行之前。

## 4. 隔离库测试

- [ ] 4.1 按 design D8 写并实跑隔离库测试：
  - 本机起临时 Postgres 16，`prisma migrate deploy` 建表。
  - 新增 `src/lib/approval/__tests__/audience-db.isolated.test.ts`。种子按 design D8，断言：
    - 审批中心列表、详情 404、批准 404 且状态不变（不持岗位的 org_admin 对他人询价卡）；
    - Sunny 老板「待我审批」有让利审批且能批；
    - 「待我确认」列表与红点数一致且只数当前企业；
    - 经 AI 助手批准看不见的卡被拒、未执行；
    - 收件箱（Muse 所用）不含看不见的卡；
    - 梦馨 Cathy 看得到营收类审批。
  - 注册进 `scripts/test-all.sh`（无库跳过）。
  - 用同一个库补跑 `phase3a3-approvals-smoke`、`b2-approval-cas.isolated`、`durable-followup-m1.isolated`，记录结果（与 main 同库对照）。
  - verify：隔离库测试在本机库上全过，输出写进报告；无库时跳过、退出码 0。

## 5. 门禁与独立审查

- [ ] 5.1 跑门禁并做独立代码审查：
  - 跑下列门禁：
    - `npm run test:ci`；
    - `npm test`，与 origin/main 对比环境类失败；
    - `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`；
    - `npm run lint:baseline`；
    - `bash scripts/check-test-registry.sh`；
    - `npx next build --webpack`；
    - `openspec validate vis-1d-approvals-split --strict`。
  - 起独立审查子代理：只给 diff 与 spec 增量，不给 design。修掉 Major 及以上，处理写进报告。
  - verify：门禁全过（或失败与 origin/main 相同）；审查发现逐条有处理记录。

## 6. 报告与 TASKFLOW

- [ ] 6.1 写 `docs/QINGYAN_VIS-1d_REPORT.md` 并同步 TASKFLOW：
  - 报告包含：
    - 改动清单；
    - 审批类型目录（生产方、指定审批人、可见岗位）；
    - 按身份的可见类型表（Sunny 老板、不持岗位的 org_admin、会计、合价、运营、招投标、销售、梦馨 Cathy、梦馨外贸、旧模式 org_admin、super_admin）；
    - 测试数（对照基线）、隔离库测试输出、门禁输出、审查处理；
    - 上线后生产核对清单；
    - 实现前核对发现的执行器问题（design Q11）及建议的后续 change。
  - `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：VIS-1d 状态改为 `[~]`（开 PR 时），合并并归档后改为 `[x]`。
  - verify：报告里每个数字都来自本次真实输出；TASKFLOW 状态与 `git log --oneline --merges` 一致。
