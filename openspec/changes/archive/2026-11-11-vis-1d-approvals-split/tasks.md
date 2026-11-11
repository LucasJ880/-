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

要数据库的既有测试（无库时跳过或失败，与 origin/main 相同）在本机隔离库起好后，先在 origin/main 上跑一次记基线：
- `phase3a3-approvals-smoke`、`b2-approval-cas.isolated`、`durable-followup-m1.isolated`；
- `booth-cards-db`、`website-inquiry-async-db`、`revenue-spine-db`、`onboarding-db`、`owner-today-db`；
- workforce 的 `phase2c1-pause-resume` / `phase2c1-expiry-races` / `p0-execution-alignment`；
- `install/warranty-db`、`repair-visit-email-db`、`tender-rfq/followup-auto-db`、`messaging/wechat-binding-confirm-db`。

## 1. 可见集合纯函数与判定输入

- [x] 1.1 按 design D1–D5 新增可见集合：
  - 新增 `src/lib/approval/audience.ts`（纯模块）：
    - `APPROVAL_FAMILIES`；
    - `approvalFamilyOf`、`visibleFamilies`、`isApprovalVisible`、`legacyListVisible`、`pendingActionAudienceWhere`；
    - 旧模式：`isApprovalVisible` 为 true、`pendingActionAudienceWhere` 为 `{}`；
    - `portCardVisible(card, ctx)`：按 design D5 的 6 步顺序。
  - 新增 `src/lib/approval/audience-server.ts` 的 `loadApprovalViewer(userId, orgId)`：平台角色按 `userId` 读库；企业所有者、成员角色、工作区、本企业内本人负责或任 project_admin 的项目各查一次。
  - `route-gate.ts` 的 `RouteGateLoader` 类型与 `context-server.ts` 的加载器加 `loadContextForOrg(user, orgId)`，复用 `(userId, orgId)` 的 30 秒缓存与请求合并；route-gate 测试的假加载器补这一方法。
  - 先写 `src/lib/approval/__tests__/audience.test.ts`，覆盖：
    - 对照表覆盖目录里每个有业务归属的类型；
    - 按身份的可见类型：spec 的每个场景（Sunny 老板 / 会计 / 合价 / 运营 / 招投标 / 销售、梦馨 Cathy、不持岗位的 org_admin、旧模式 org_admin、super_admin）；
    - 本人提交 / 指定审批人 / 项目负责人 / 工作区成员路径；
    - 无业务归属草稿：企业所有者与成员角色 `org_admin` 可见，成员角色 `org_owner` 但非企业所有者不可见；
    - 小求值器断言 `pendingActionAudienceWhere` 与 `isApprovalVisible` 在样例行上逐行一致；
    - `portCardVisible` 的每一步（super_admin、个人草稿、跨企业、旧模式、非成员、其余）；
    - `audience.ts` 不导入数据库与 `next/*`。
  - 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：新测试全过；`route-gate.test.ts`（141）不变；`bash scripts/check-test-registry.sh` 通过。

## 2. 审批中心

- [x] 2.1 按 design D6 接入审批中心：
  - `query.ts`：
    - 列表与详情加可选参数 `viewer`，缺省时由 `loadApprovalViewer` 取；
    - PendingAction 的查询条件加 `pendingActionAudienceWhere`；ApprovalRequest 与产品内容投影前判 `isApprovalVisible`；
    - 旧模式列表沿用原过滤（改调 `legacyListVisible`），岗位模式删掉这段；
    - 详情不可见抛 404。
  - `decision.ts`：
    - 只取一次 `viewer`，传给 6 处 `getCapabilityApproval` 与端口；
    - 幂等缓存的读取挪到第一次 `getCapabilityApproval` 之后、过期与能力检查之前，只在 `approvalKey` 与 `action` 都相同时命中。
  - `web-entry-approval.ts`：一个项目只取一次 `viewer`。
  - 调用方（审批中心列表 / 详情路由、概览、首页岗位总览的「待我审批」加载器）不改调用形状。
  - 改测试：
    - `audience.test.ts` 补源码断言：`decision.ts` 的幂等读取在第一次 `getCapabilityApproval` 之后、过期判断之前，且比对 `approvalKey` 与 `action`；
    - `phase3a3-approvals-rbac.test.ts` 按新规则更新「管理员看全量」类断言；
    - `posts-read-model.test.ts` 若注入了列表加载器则补 `viewer`。
  - verify：
    - `phase3a3-approvals-rbac`、`posts-read-model`（162）、`waiting`（80）全过；
    - 源码断言：`decision.ts` 仍经 `getCapabilityApproval` 加载，`query.ts` 不再有 `isOrgAdminRole(access.orgRole)` 的整段放行。

## 3. 待我确认、红点、运营看板与收件箱

- [x] 3.1 按 design D7 收口四处团队审批范围：
  - `marketing/team.ts` 新增 `teamApprovalScopeWhere(userId, access)`（行为不变）。
  - 新增 `src/lib/approval/pending-mine.ts`：`pendingMineWhere`、`listMyPendingActions` / `countMyPendingActions(user, orgId, opts)` = 处理人范围 ∩ 可见集合 ∩ 当前企业（另含本人个人草稿）；红点另加未过期，解析不出企业时只数个人草稿（200）。
  - 四处改用同一个函数或同一组条件：
    - `api/ai/pending-actions/route.ts` 与 `count/route.ts` 调它（红点改为只数当前企业）；
    - `operations/dashboard/build-dashboard.ts` 用同一组条件；
    - `approval/port.ts` 的 `listApprovalInbox(userId, { orgId })` 用同一组条件；`getPendingApprovals` 加企业与可见过滤；`/api/agent/approvals` 用 `resolveAssistantOrgId`（解析不出只给个人草稿），`muse-bridge/router.ts` 传 `identity.orgId`；
    - 运营看板沿用自己的企业范围（含该企业项目上的无企业卡）再取交集。
  - 批准 / 驳回入口先判可见：
    - `api/ai/pending-actions/[id]` 不可见返回与不存在相同的 404 响应；
    - `approveApprovalItem` / `rejectApprovalItem` 一进来就按 `portCardVisible` 判（在已终态重复分支之前），PendingAction 与项目智能体审批都判；不可见返回与 id 不存在时完全相同的对象，不执行、不收敛；
    - `muse-bridge/router.ts` 的 `approve` 先判可见，再判网页预览。
  - 改测试：`fact-proposals`、`research-plan`、`draft-feedback`、`b2-approval-cas-static`、`approval-resume` 若断言收件箱或端口的调用形状则同步更新。
  - verify：
    - 上述测试不降；
    - `audience.test.ts` 补源码断言：四处都用同一个条件函数；`[id]` 路由的可见校验在 `canDecideTeamApproval` 之前；端口的可见校验在已终态分支之前；Muse `approve` 的可见校验在网页预览之前。

## 4. 隔离库测试

- [x] 4.1 按 design D8 写并实跑隔离库测试：
  - 本机起临时 Postgres 16，`prisma migrate deploy` 建表。
  - 新增 `src/lib/approval/__tests__/audience-db.isolated.test.ts`。种子按 design D8（先绑岗位再取 viewer），断言：
    - 审批中心列表、详情 404、批准 404 且状态不变（不持岗位的 org_admin 对他人询价卡）；
    - Sunny 老板「待我审批」有让利审批且 `canApprove` 为 true；
    - 「待我确认」列表与红点数一致且只数当前企业；
    - 经 AI 助手批准看不见的卡被拒、未执行；
    - 收件箱（Muse 所用）不含看不见的卡，也不含另一企业的；
    - 端口对看不见的卡（含已执行的）与随机 id 返回完全相同的结果；AI 助手对看不见的卡与不存在的 id 返回相同响应；以看不见的批准人批催单卡留作待批；
    - Muse：经 `handleMuseCommand` 的 `approve` 处理看不见的卡，答复与不存在的 id 相同（不是网页预览答复）；
    - 幂等：为看不见的卡预置幂等记录，带该键批准返回 404；以可见的审批 id 带别人的幂等键，不返回别人的缓存结果；
    - 梦馨 Cathy 看得到营收类审批；
    - 旧模式企业：管理员列表看全企业；项目负责人的「待我确认」照旧含他人的 `tender.send_rfq`；非处理人调 AI 助手与端口得到「无权操作该草稿」（执行器拒绝，证明可见校验已放行）；两家旧模式企业的管理员红点只数当前企业；
  - 测试不真的执行任何审批（询价、邮件类执行会出站）：放行路径只断言 `canApprove` / 可见校验结果，真正调端口的只有被拒绝的路径（在执行器之前返回）。
  - 注册进 `scripts/test-all.sh`（无库跳过）。
  - 用同一个库补跑开头列出的既有隔离库测试，与 origin/main 的基线对照。
  - verify：隔离库测试在本机库上全过，输出写进报告；无库时跳过、退出码 0。

## 5. 门禁与独立审查

- [x] 5.1 跑门禁并做独立代码审查：
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

- [x] 6.1 写 `docs/QINGYAN_VIS-1d_REPORT.md` 并同步 TASKFLOW：
  - 报告包含：
    - 改动清单；
    - 审批类型目录（生产方、指定审批人、可见岗位）；
    - 按身份的可见类型表（Sunny 老板、不持岗位的 org_admin、会计、合价、运营、招投标、销售、梦馨 Cathy、梦馨外贸、旧模式 org_admin、super_admin）；
    - 测试数（对照基线）、隔离库测试输出、门禁输出、审查处理；
    - 上线后生产核对清单；
    - 实现前核对发现的执行器问题（design Q11）及建议的后续 change。
  - `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：VIS-1d 状态改为 `[~]`（开 PR 时），合并并归档后改为 `[x]`。
  - verify：报告里每个数字都来自本次真实输出；TASKFLOW 状态与 `git log --oneline --merges` 一致。
