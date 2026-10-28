# 权限重设计 — 交接（HANDOFF）

> 任何新会话从这里进。先读本文件，再按"下一步"执行，不凭记忆重写。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-10-28（会话 2，PERM-4a archive 后） |
| 主线文档 | `docs/QINGYAN_PERMISSION_TASKFLOW.md`（状态列）、`docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md`（设计与已决定） |
| 任务书 | `docs/QINGYAN_PERM-1-2_POSITIONS_DISCOUNT_TASKBRIEF.md` |
| 工作分支 | 会话 1：`claude/youthful-davinci-8n1we3`；会话 2：`claude/amazing-goldberg-s89rlq`（每个 change 合并后从 main 重建同名分支） |
| OpenSpec CLI | 未装进依赖，用 `OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 <cmd>` |

## 当前进度

| change | 状态 | PR |
|---|---|---|
| `perm-1-positions` | 已合并 main；已 archive（specs 合入 `authorization/platform-admin-authority`、`position-binding`、`position-catalog`） | #264 ✅ |
| `perm-2-discount-by-position` | 已合并 main；已 archive（specs 合入 `identity/member-management`、`sales/discount-tiering`、`sales/quote-delivery-gate`、`sales/quote-settings-approval`） | #265 ✅ |
| `perm-3-fulfillment-by-category` | 已合并 main；已 archive（specs 新增 `fulfillment/order-category-access`、`fulfillment/order-cancellation-approval`、`inventory/fabric-stock-access`，`authorization/position-catalog`、`sunny/process-order-autogen` 增量）；合并 main 时与 sunny-process 整合（报告 §5b / design D8） | #274 ✅；archive #276 ✅ |
| `perm-4a-sales-authorize` | 已合并 main；已 archive（specs 新增 `sales/record-access`、`sales/signed-quote-amount-approval`，`authorization/position-catalog` 增量）；报告 `docs/QINGYAN_PERM-4a_REPORT.md` | #279 ✅ |
| `perm-4b-ops-authorize` | 已合并 main（新键 `operations.content.draft / approve`；运营配置 12 路由、Playbook 12 路由、发布任务 3 路由按岗位；增长中心写 `operations.manage`；平台用户管理仅 super_admin；`/ops` 入口按岗位、ops API 注入权限键）；typecheck / lint:baseline / test:ci / registry 全绿；隔离库 e2e 32/32；全量 `npm test` 450/463（13 条为既有环境性失败，与基线一致）；报告 `docs/QINGYAN_PERM-4b_REPORT.md`；已 archive（specs 新增 `operations/config-access`、`operations/content-approval`、`marketing/growth-center-access`） | #283 ✅；archive 本 PR |
| `perm-5b-digital-employee-positions` | 8/8 tasks；代码完成（数字员工主体解析 / 自身绑定无回退 / sponsor 范围 / 禁区元数据；`canInvokeTool` 主体 + `requiredPermission`；数字员工审批归属与审批人 = sponsor；审计 `actorDisplay`；绑定脚本 `--principal-type DIGITAL_EMPLOYEE`）；typecheck / lint:baseline / test:ci / registry / 架构守卫全绿；authorize 120、纯测试 50/50、隔离库 e2e 34/34；报告 `docs/QINGYAN_PERM-5b_REPORT.md`；TASKFLOW `[G]` | PR 待开 |
| `install-1-installer-position` | 9/9 tasks；代码完成（权限键 / 岗位 / `src/lib/install` / 6 个 API / 文件代理前缀 / transition 校验 / `/install` 两页 / 底栏侧栏入口 / 工艺单详情安排安装 + 收口标签）；typecheck / eslint / lint:baseline / test:ci / registry 全绿；报告 `docs/QINGYAN_INSTALL-1_REPORT.md`；TASKFLOW `[G]` | #268 ✅；已 archive（specs 合入 `installation/install-tasks`、`installation/window-closeout`，`authorization/position-catalog` 增量） |

## 交叉测试结果

### 会话 2（2026-10-28，PERM-4a 合并前）
- 全量 `npm test`（无 DB）：446/459，13 个失败与会话 1 同一批环境性失败（清单见 `docs/QINGYAN_PERM-4a_REPORT.md` §5），无新增。
- 隔离库（本地 Postgres 16 + pgvector）：`autogen-db.isolated` 41/41（PERM-3 × sunny-process 整合后）、`signed-quote-amount-db.isolated` 20/20、`sales-record-access-db.isolated` 15/15。

### 会话 1（2026-10-27）

- 全量 `npm test`：422/435，13 个失败与 `docs/QINGYAN_SDD-0_REPORT.md` §3 用例 4 的环境性基线完全一致（10 项 MISSING_DATABASE_URL、T4 需 DATABASE_URL、Gmail OAuth、PDF 页脚），无新增失败；TypeScript 检查通过。
- `npm run build`：见 `docs/QINGYAN_PERM-1-2_REPORT.md`（待写）。

## 下一步（按顺序）

1. ~~PERM-2 PR~~ 已合并（#265）。
2. ~~archive 小 PR~~ 已合并（#267）：7 个新能力已在 `openspec/specs/**`。
3. ~~INSTALL-1~~ 已合并（#268）并 archive（本 PR）。
4. 生产动作（Lucas 本机）：对 Sunny 跑 `seedOrgAuthorizationProfiles` 落地模板（含 installer）；补 `config/positions/sunny.json` 邮箱（含 `TODO:安装工`）；`--dry-run` 后执行绑定脚本（命令见 `docs/QINGYAN_PERM-1_REPORT.md` §4）；查 `User.role='admin'` 账号（PERM-2 报告 §4-1）。
5. ~~PERM-3 / PERM-4 / PERM-5 任务书~~ 已写：`docs/QINGYAN_PERM-3_FULFILLMENT_BY_CATEGORY_TASKBRIEF.md`、`docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md`、`docs/QINGYAN_PERM-5_ACCOUNTING_DIGITAL_EMPLOYEE_TASKBRIEF.md`。每份末尾有「判断点」，**先让 Lucas 拍板再 propose**。
6. ~~PERM-3~~ 已合并（#274）并 archive（#276）。**生产动作**：对 Sunny 重跑 `seedOrgAuthorizationProfiles`（出单模板变了），并确认工厂人员已绑定对应 `fulfillment_*` 岗位——自动生成工艺单的草稿核对（改参数 / 挪行 / 确认）现在要求本单全部品类键（报告 §5b）。
7. ~~PERM-4a~~ 已合并（#279）并 archive（本 PR）。**生产动作**：合并前应已查平台 `admin` 账号补岗位（平台 admin 在销售区不再有隐含权限）——若未做，尽快补；对 Sunny 重跑 `seedOrgAuthorizationProfiles`（owner +5 键）。Sunny 若只有一位老板，签约单改总价会 409 `NO_APPROVER`，只能 Lucas 直接改。
8. ~~PERM-4b~~ 已合并（#283）并 archive（本 PR）。**生产动作**：对 Sunny 重跑 `seedOrgAuthorizationProfiles`（ops_staff / ops_lead / owner 模板变了），确认 Marty（`ops_lead`）/ Maggie（`ops_staff`）绑定生效，否则 Maggie 进不了运营中心。老板改不了运营配置 / 增长中心（只看 + 批内容）。
9. 进行中：PERM-5（用户 2026-10-28："5a 和 5b 都按推荐做"，拍板见任务书末尾"拍板结果 · PERM-5"）。顺序：5b 先（只依赖 PERM-1），5a 后（自带 `project.finance.read` 一个键，不等 4c）。4c 排在 5 之后。
   - PERM-5b 代码完成待 PR。**生产动作**：无（没有数字员工绑定 = 和今天一样全拒）。启用某个数字员工：填 `config/positions/sunny-digital-employees.json` 的 Agent id（sponsor = Agent 创建人），`--principal-type DIGITAL_EMPLOYEE --dry-run` 后执行。已知：今天没有运行时以数字员工为主体执行；现有工具都没声明 `requiredPermission`，数字员工调用会 `permission_required`（报告 §4）。

## 环境注意

- 沙箱 Node 是 22，仓库要 24：`source ~/.nvm/nvm.sh && nvm use 24`（若 nvm 不在，`node -v` 为 22 也能跑 tsx，但 `tsc` 要 `NODE_OPTIONS=--max-old-space-size=8192`）。
- 沙箱无 Postgres 服务，但装有 Postgres 16：`apt-get install -y postgresql-16-pgvector` 后以 postgres 用户 `initdb` + `pg_ctl`（数据目录放 postgres 可写处，如 `/var/tmp/qy-pg`），`prisma migrate deploy` 后可用 `DATABASE_ENVIRONMENT=isolated NODE_ENV=test` 跑 `*.isolated.test.ts`。未起库时带 DB 的测试在 `npm test` 里因 MISSING_DATABASE_URL 失败，属环境性；CI 子集 `npm run test:ci` 不含它们。
- `openspec validate --specs --strict` 在 PERM-3 archive 后有 3 条 WARNING（`authorization/position-catalog`、`sunny/process-order-autogen` 需求文本 >500 字；`inventory/fabric-stock-access` Purpose 过短）。规格只从 change 归档进来，下次碰这些能力的 change 顺手拆分。
- 生产库迁移是手工受控的（见 `docs/DEPLOY_VERCEL.md`）；本主线零 schema，不应再有迁移。
- 沙箱访问不到 qingyan.ca 与 Neon；线上核对由 Lucas 做。

## 已知陷阱

- `resolveEffectiveBindings` 无绑定时按 `OrganizationMember.role` 兼容回退；PERM-1 绑定后 Sunny 全员应走绑定，别再依赖回退。
- `seedOrgAuthorizationProfiles` 会把 org_owner / org_admin / 平台 sales 自动绑到系统模板；新模板加入后要确认它不会给梦馨绑 Sunny 岗位。
- 工艺单读写判定只有一处：`src/lib/fulfillment/service.ts` `resolveOrderAccess`（`canViewBlindsOrder` / `blindsOrderAccess` 都委托它）；品类含 sunny 参数行（`specCategories`）。新增工艺单写接口必须判 `access.edit.allowed`。
- 报价保存只有一处实现：`src/lib/sales/quote-update.ts`（PUT 与签约改价执行器共用）；超限折扣审批收口写在 `src/lib/pending-actions/quote-promotion-settle.ts`。改报价保存逻辑改这两处，不要在路由里再写一份。
- drafts 层（`requestApproval`）按幂等键去重**不看状态**：新审批的幂等键要能区分"被拒后再提交"，否则会拿回已终结的审批（PERM-4a 用"该报价已有审批条数"）。
- 隔离库 e2e 本地跑法：容器重启后 Postgres 会停，`su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/qy-pg/data -o '-p 5433 -k /var/tmp/qy-pg' -l /var/tmp/qy-pg/log start"`；若数据目录没了按"环境注意"重建（`initdb` → `create database qy_test` → `prisma migrate deploy`）。
- 运营 / 增长中心权限判定只有一处：`src/lib/operations/access.ts`（`requireOpsPermission` / `selfApprovalBlocked`）；Playbook 权限函数是异步的，**漏 await 会把 Promise 当真值放行**（`ops-access.test` 有源码断言兜底）。
- 工作区上下文的权限键用 `src/lib/rbac/permission-keys.ts` `loadPermissionKeys`；新写的 `/api/ops/*` 之类按工作区放行的 API 必须注入，否则按岗位放行的人会被拦。
- 唯一 org_owner 保护在 `organizations/[orgId]/members/[memberId]/route.ts`；老板做成岗位 `owner`，不改这条保护。
