# 权限重设计 — 交接（HANDOFF）

> 任何新会话从这里进。先读本文件，再按"下一步"执行，不凭记忆重写。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-10-28（会话 2） |
| 主线文档 | `docs/QINGYAN_PERMISSION_TASKFLOW.md`（状态列）、`docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md`（设计与已决定） |
| 任务书 | `docs/QINGYAN_PERM-1-2_POSITIONS_DISCOUNT_TASKBRIEF.md` |
| 工作分支 | 会话 1：`claude/youthful-davinci-8n1we3`；会话 2：`claude/amazing-goldberg-s89rlq`（每个 change 合并后从 main 重建同名分支） |
| OpenSpec CLI | 未装进依赖，用 `OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 <cmd>` |

## 当前进度

| change | 状态 | PR |
|---|---|---|
| `perm-1-positions` | 已合并 main；已 archive（specs 合入 `authorization/platform-admin-authority`、`position-binding`、`position-catalog`） | #264 ✅ |
| `perm-2-discount-by-position` | 已合并 main；已 archive（specs 合入 `identity/member-management`、`sales/discount-tiering`、`sales/quote-delivery-gate`、`sales/quote-settings-approval`） | #265 ✅ |
| `perm-3-fulfillment-by-category` | 8/8 tasks；代码完成（品类键 / 出单岗模板 / `src/lib/fulfillment` / 工艺单与库存路由 / 作废审批 / 导航 requiredPermissions / 详情页只读态）；typecheck / eslint / lint:baseline / test:ci / registry 全绿；报告 `docs/QINGYAN_PERM-3_REPORT.md`；TASKFLOW `[x]`；合并 main 时与 sunny-process 整合（报告 §5b / design D8） | #274 ✅；已 archive（specs 合入 `fulfillment/order-category-access`、`fulfillment/order-cancellation-approval`、`inventory/fabric-stock-access`，`authorization/position-catalog` 与 `sunny/process-order-autogen` 增量） |
| `perm-4a-sales-authorize` | 四件套已审（2026-10-28）；apply 进行中——进度以 `openspec/changes/perm-4a-sales-authorize/tasks.md` 勾选为准；本地分支 `perm-4a-propose`（基于 #276），#276 合并后改到 `claude/amazing-goldberg-s89rlq` 开 PR | 未开 PR |
| `install-1-installer-position` | 9/9 tasks；代码完成（权限键 / 岗位 / `src/lib/install` / 6 个 API / 文件代理前缀 / transition 校验 / `/install` 两页 / 底栏侧栏入口 / 工艺单详情安排安装 + 收口标签）；typecheck / eslint / lint:baseline / test:ci / registry 全绿；报告 `docs/QINGYAN_INSTALL-1_REPORT.md`；TASKFLOW `[G]` | #268 ✅；已 archive（specs 合入 `installation/install-tasks`、`installation/window-closeout`，`authorization/position-catalog` 增量） |

## 交叉测试结果（会话 1，2026-10-27）

- 全量 `npm test`：422/435，13 个失败与 `docs/QINGYAN_SDD-0_REPORT.md` §3 用例 4 的环境性基线完全一致（10 项 MISSING_DATABASE_URL、T4 需 DATABASE_URL、Gmail OAuth、PDF 页脚），无新增失败；TypeScript 检查通过。
- `npm run build`：见 `docs/QINGYAN_PERM-1-2_REPORT.md`（待写）。

## 下一步（按顺序）

1. ~~PERM-2 PR~~ 已合并（#265）。
2. ~~archive 小 PR~~ 已合并（#267）：7 个新能力已在 `openspec/specs/**`。
3. ~~INSTALL-1~~ 已合并（#268）并 archive（本 PR）。
4. 生产动作（Lucas 本机）：对 Sunny 跑 `seedOrgAuthorizationProfiles` 落地模板（含 installer）；补 `config/positions/sunny.json` 邮箱（含 `TODO:安装工`）；`--dry-run` 后执行绑定脚本（命令见 `docs/QINGYAN_PERM-1_REPORT.md` §4）；查 `User.role='admin'` 账号（PERM-2 报告 §4-1）。
5. ~~PERM-3 / PERM-4 / PERM-5 任务书~~ 已写：`docs/QINGYAN_PERM-3_FULFILLMENT_BY_CATEGORY_TASKBRIEF.md`、`docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md`、`docs/QINGYAN_PERM-5_ACCOUNTING_DIGITAL_EMPLOYEE_TASKBRIEF.md`。每份末尾有「判断点」，**先让 Lucas 拍板再 propose**。
6. ~~PERM-3~~ 已合并（#274）并 archive（本 PR）。**生产动作**：对 Sunny 重跑 `seedOrgAuthorizationProfiles`（出单模板变了），并确认工厂人员已绑定对应 `fulfillment_*` 岗位——自动生成工艺单的草稿核对（改参数 / 挪行 / 确认）现在要求本单全部品类键（报告 §5b）。
7. PERM-4a 判断点已拍板（任务书末尾"拍板结果"）：签约单改金额纳入 4a；报价行级出单编辑移出；owner 补销售改权；4c 先压 Sunny、梦馨不动；Sunny 无人用 `manager`。续做用 `/opsx:apply perm-4a-sales-authorize`，按 tasks.md 未勾选项继续。
8. 顺序：PERM-4a → 4b → 4c → PERM-5a；PERM-5b 只依赖 PERM-1，可随时并行。每个 change：`/opsx:propose <name>` → 四件套回传审核 → `/opsx:apply` → 测试 → `/opsx:verify` → PR → 合并后独立小 PR archive。

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
- 唯一 org_owner 保护在 `organizations/[orgId]/members/[memberId]/route.ts`；老板做成岗位 `owner`，不改这条保护。
