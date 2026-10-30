# PERM-7 岗位绑定界面 — 任务书

TASKFLOW：PERM-7（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）。前置：PERM-6a / 6c 已合并。
依据：
- PERM-5b 报告 §4"数字员工绑定只由平台管理员跑脚本；owner 界面绑定留 PERM-6"；
- PERM-6 拍板 5"owner 界面绑岗位另立 PERM-7"；
- 设计稿 `docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md` §4 第 1 条"加人、删人、换岗位只有平台管理员（Lucas）。老板岗不带管理面"。

## Why

岗位绑定现在只有一个写入口：`scripts/bind-positions.ts`（spec `authorization/position-binding`："唯一写入口"）。由此带来三个问题：

- **每次调岗都要 Lucas 在本机连生产库跑脚本**：
  - 先改 `config/positions/*.json`，再 `ALLOW_POSITION_BINDING=true … --dry-run`，再执行；
  - 验收清单 B 里的"确认 Marty = ops_lead、补 Miki 邮箱"等都卡在这一步；
  - 岗位模式企业（Sunny）无绑定 = 无权限（4c3 起），新人入职当天就要绑。
- **看不到谁是什么岗位**：成员页只显示企业角色（`org_owner / org_admin / org_member`），岗位绑定只在库里。
- **成员管理口子**：
  - 成员增删改接口用 `requirePlatformAdmin`，它等于平台 `admin` 或 `super_admin`（`rbac/platform-admin.ts`）；
  - 4b 起平台用户管理只认 super_admin，6a / 6c 起外贸 / 营收也不再认平台 admin，唯独成员管理仍对平台 admin 开放。

## What（推荐方案 A，拍板后写 proposal）

**PERM-7 `perm-7-position-binding-ui`：岗位绑定界面（一个 change）**

- **绑定接口**（新）：`/api/organizations/[orgId]/positions`。
  - GET：本企业岗位模板列表 + 每位成员 / 数字员工的 active 绑定；
  - PUT：设置某个主体的岗位集合。
  - 校验与差异计算复用脚本的纯函数（`validateBindings` / `planBindingDiff` / `validateDigitalEmployeeBindings`）：
    - 只能选本企业已落地的岗位模板；只能绑 active 成员；
    - 数字员工只能绑 `sales_rep / ops_staff / bids / accounting`。
  - 审计与脚本相同（`authorization.position.bind` / `.unbind`），另记来源"界面"。
- **界面**：企业详情页（`/organizations/[orgId]`）成员表加"岗位"列与编辑弹窗（多选岗位模板），另加"数字员工岗位"一节（显示 sponsor）。
- **护栏**：
  - 岗位模式企业不能停用最后一个 `owner` 绑定（否则无人有管理层信号）；
  - 每次保存前显示差异（新增 / 停用），确认后写入。
- **成员管理收紧**：成员增删改（含企业角色）从 `requirePlatformAdmin`（admin | super_admin）收紧为只认 super_admin，与 4b 一致。唯一 `org_owner` 保护不变。
- **脚本保留**为批量入口。spec 由"唯一写入口"改为"脚本与界面两个入口，同一校验与审计"。

## 判断点（请拍板）

1. **谁能在界面上绑岗位**：
   - **A（推荐）**：只有平台 super_admin（Lucas）。把脚本搬到界面，设计稿 §4-1 不变，最快解决"每次都要跑脚本"。
   - **B**：企业老板（窗饰 `owner` / 系统 `org_owner`）也能绑本企业岗位。要改设计稿 §4-1，并给老板岗位加 `identity.role.manage`。
   - **C**：老板可以提交绑定变更，经另一位老板（或平台管理员）审批后生效。走既有审批（PendingAction），符合设计稿 §4-2"敏感操作另一老板审批"，但工作量约为 A 的两倍。
   - 推荐先做 A；Sunny 老板确实要自助调岗时，再在 A 上加 C。
2. **数字员工绑定是否同一界面**：推荐同一页、单独一节（规则沿用 5b：4 个岗位、sponsor = Agent 创建人）。
3. **成员管理收紧为只认 super_admin**：推荐收紧，与 4b / 6a 一致。生产上平台 `admin` 账号（梦馨老板等）不再能增删成员。若他们需要，改为 super_admin，或由 Lucas 代办。
4. **AI 工具策略里的平台 `admin` 档**：
   - 现状：派生角色把平台 `admin` 原样透传，AI 工具策略里 `admin` 能用全部域工具。
   - 这是 4c4 起一直保留的口子，跨销售 / 外贸 / 项目所有域。
   - **推荐另立小 change（PERM-7b）**，不并入 PERM-7。它需要先定"旧模式企业里平台 admin + `org_owner` 的老板在 AI 里算什么"（梦馨老板就是这种）。

## Out of scope

- 6b 梦馨岗位（等人员与邮箱）。
- 岗位模板本身的增删改（仍由代码与 seed 维护）。
- 邀请邮件、自助注册。
- 方案 B / C（若拍板选 A）。

## Impact（方案 A）

- 新增：
  - `src/app/api/organizations/[orgId]/positions/route.ts`；
  - `src/lib/authorization/position-binding-service.ts`（连库执行：校验 → 差异 → 写入 → 审计，脚本与接口共用）；
  - 企业详情页岗位列与编辑弹窗。
- 修改：
  - `scripts/bind-positions.ts` 改调共用服务（行为不变）；
  - `src/app/api/organizations/[orgId]/members/**` 改为只认 super_admin。
- 测试：
  - 纯：差异 / 护栏 / 接口源码断言；
  - 隔离库：super_admin 绑 / 解绑 200 + 审计，平台 admin / 老板 403，最后一个 owner 不能停，数字员工岗位限制，脚本回归。
- 零 schema。
- **BREAKING**：平台 `admin`（非 super_admin）不能再增删改企业成员。

## 验收

- Lucas 在企业详情页给 Sunny 某成员勾选 `ops_staff` 并保存：
  - 该成员下次请求即有运营权限；
  - 审计里有 `authorization.position.bind`（来源"界面"）。
- 停用 Sunny 最后一个 `owner` 绑定被拒，并有提示。
- 平台 `admin` 账号调成员增删改接口返回 403。
- 脚本 `bind-positions --dry-run` 输出与改动前一致。

### 拍板结果 · PERM-7（2026-10-28："结束后开始做perm-7 的proposal"）
用户未逐条回复判断点，proposal 按推荐写；审四件套后用户确认（2026-10-28："Perm-7可以。按照这个去做吧"）：
1. **方案 A**：只有平台 super_admin 在界面上绑岗位；设计稿 §4-1 不变。
2. **数字员工**：同一页单独一节，规则沿用 5b。
3. **成员增删改收紧为只认 super_admin**：现有 spec `identity/member-management` 本来就写的是 super_admin，代码用的 `requirePlatformAdmin` 等于 admin | super_admin，属于代码与 spec 不一致，本次一并修正。
4. **AI 工具策略的平台 `admin` 档**另立 PERM-7b（连同企业列表 / 新建企业等仍认平台 admin 的入口）。
