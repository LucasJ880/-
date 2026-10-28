# Proposal

TASKFLOW：PERM-7（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）。
任务书：`docs/QINGYAN_PERM-7_POSITION_BINDING_UI_TASKBRIEF.md`，拍板见文末"拍板结果 · PERM-7"（按推荐：方案 A、数字员工同页、成员增删改只认 super_admin、AI 平台 admin 档另立 7b）。

## Why

岗位绑定只有一个写入口：`scripts/bind-positions.ts`。

- **每次调岗、新人入职都要 Lucas 在本机连生产库跑脚本**：改绑定文件 → `--dry-run` → 执行。岗位模式企业（Sunny）无绑定 = 无权限（4c3 起），绑定慢一步就是新人当天用不了。
- **看不到谁是什么岗位**：企业详情页只显示企业角色，岗位绑定只在库里。
- **成员增删改与 spec 不一致**：spec `identity/member-management` 要求只认平台 super_admin；代码用 `requirePlatformAdmin`，实际等于平台 `admin` 或 `super_admin`（`rbac/platform-admin.ts`）。

本次给平台 super_admin 一个岗位绑定界面，与脚本共用同一套校验、差异与审计；同时把成员增删改修正为只认 super_admin。设计稿 §4-1"加人、删人、换岗位只有平台管理员"不变。

## What Changes

- **共用绑定服务**（新 `src/lib/authorization/position-binding-service.ts`）：
  - 连库执行"读模板与现有绑定 → 校验 → 差异 → 写入 → 审计"；
  - 脚本与界面都调它，校验复用 `validateBindings` / `validateDigitalEmployeeBindings` / `planBindingDiff`；
  - 审计动作不变（`authorization.position.bind` / `.unbind`），`via` 区分来源（脚本 / 界面）。
  - 脚本改调服务，输出与退出码不变。
- **绑定接口**（新 `/api/organizations/[orgId]/positions`，只认平台 super_admin）：
  - GET：岗位模式标志、本企业可绑岗位（active RoleProfile，按行业包岗位 / 系统模板分组）、每位 active 成员的 active 绑定、本企业 active Agent 的数字员工绑定（含 sponsor）。
  - PUT：设置一个主体（人或数字员工）的完整岗位集合。
    - `dryRun=true` 只返回差异（新增 / 保留 / 停用）；
    - 否则写入并返回结果；
    - 校验失败 400 并列出全部原因。
- **护栏**：岗位模式企业中，变更后若没有任何 active 的人类 `owner` 绑定 → 409 `LAST_OWNER_BINDING`，不写入。
- **界面**：企业详情页（`/organizations/[orgId]`）新增"岗位"一节，只对平台 super_admin 显示。
  - 成员表列出岗位；编辑弹窗多选岗位，保存前先显示差异，确认后写入；
  - "数字员工岗位"子节只列 5b 允许的四个岗位，显示 sponsor。
- **成员增删改只认 super_admin**：`POST /members`、`PATCH` / `DELETE /members/[memberId]` 改为只认平台 super_admin（与 spec 一致）。唯一 `org_owner` 保护不变，成员列表读取不变。
- **新守卫** `requirePlatformSuperAdmin`（`src/lib/auth/guards.ts`）：403 码沿用 `PLATFORM_ADMIN_REQUIRED`。

## Capabilities

### New Capabilities
- `authorization/position-binding-console`：岗位绑定界面与接口（super_admin 专用、与脚本同一校验 / 差异 / 审计、完整集合语义、最后一个 owner 护栏、数字员工一节）

### Modified Capabilities
- `identity/member-management`："成员增删改仅平台管理员"补上平台 `admin`（非 super_admin）被拒的情形

## Out of scope

- PERM-7b：AI 工具策略的平台 `admin` 档；企业列表 / 新建企业等仍认平台 `admin` 的入口。
- 方案 B / C（老板自助绑岗位、审批）；岗位模板增删改；邀请邮件；6b 梦馨岗位。
- `authorization/position-binding` 的 Purpose 仍写"唯一写入口"：Purpose 只能在能力创建时写入。新能力的 Purpose 说明自己是与脚本并列的第二个入口，脚本侧要求不变。

## Impact

- 新增：
  - `src/lib/authorization/position-binding-service.ts`；
  - `src/app/api/organizations/[orgId]/positions/route.ts`；
  - 企业详情页岗位一节（`src/app/(main)/organizations/[orgId]/positions-section.tsx`）；
  - 测试 `position-binding-console.test.ts`（纯）与 `position-binding-console-db.isolated.test.ts`（隔离库）。
- 修改：
  - `scripts/bind-positions.ts`（改调服务）；
  - `src/lib/auth/guards.ts`；
  - `src/app/api/organizations/[orgId]/members/**`；
  - `src/app/(main)/organizations/[orgId]/page.tsx`。
- 零 schema；无新权限键；无新队列。
- **BREAKING**：平台 `admin`（非 super_admin）不能再增删改企业成员（生产：梦馨老板等平台 admin 账号；需要时由 Lucas 操作或改为 super_admin）。
