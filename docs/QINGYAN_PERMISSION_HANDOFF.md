# 权限重设计 — 交接（HANDOFF）

> 任何新会话从这里进。先读本文件，再按"下一步"执行，不凭记忆重写。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-10-27（会话 1） |
| 主线文档 | `docs/QINGYAN_PERMISSION_TASKFLOW.md`（状态列）、`docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md`（设计与已决定） |
| 任务书 | `docs/QINGYAN_PERM-1-2_POSITIONS_DISCOUNT_TASKBRIEF.md` |
| 工作分支 | `claude/youthful-davinci-8n1we3`（每个 change 合并后从 main 重建同名分支） |
| OpenSpec CLI | 未装进依赖，用 `OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 <cmd>` |

## 当前进度

| change | 状态 | PR |
|---|---|---|
| `perm-1-positions` | 已合并 main；已 archive（specs 合入 `authorization/platform-admin-authority`、`position-binding`、`position-catalog`） | #264 ✅ |
| `perm-2-discount-by-position` | 已合并 main；已 archive（specs 合入 `identity/member-management`、`sales/discount-tiering`、`sales/quote-delivery-gate`、`sales/quote-settings-approval`） | #265 ✅ |
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
6. 顺序：PERM-3 → PERM-4a → 4b → 4c → PERM-5a；PERM-5b 只依赖 PERM-1，可与 PERM-3 并行。每个 change：`/opsx:propose <name>` → 四件套回传审核 → `/opsx:apply` → 测试 → `/opsx:verify` → PR → 合并后独立小 PR archive。

## 环境注意

- 沙箱 Node 是 22，仓库要 24：`source ~/.nvm/nvm.sh && nvm use 24`（若 nvm 不在，`node -v` 为 22 也能跑 tsx，但 `tsc` 要 `NODE_OPTIONS=--max-old-space-size=8192`）。
- 沙箱无 Postgres：带 DB 的测试在 `npm test` 里会因 MISSING_DATABASE_URL 失败，属环境性；CI 子集 `npm run test:ci` 不含它们。
- 生产库迁移是手工受控的（见 `docs/DEPLOY_VERCEL.md`）；本主线零 schema，不应再有迁移。
- 沙箱访问不到 qingyan.ca 与 Neon；线上核对由 Lucas 做。

## 已知陷阱

- `resolveEffectiveBindings` 无绑定时按 `OrganizationMember.role` 兼容回退；PERM-1 绑定后 Sunny 全员应走绑定，别再依赖回退。
- `seedOrgAuthorizationProfiles` 会把 org_owner / org_admin / 平台 sales 自动绑到系统模板；新模板加入后要确认它不会给梦馨绑 Sunny 岗位。
- 唯一 org_owner 保护在 `organizations/[orgId]/members/[memberId]/route.ts`；老板做成岗位 `owner`，不改这条保护。
