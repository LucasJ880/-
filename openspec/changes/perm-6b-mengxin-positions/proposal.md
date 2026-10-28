# Proposal

TASKFLOW：PERM-6b（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）。
任务书：`docs/QINGYAN_PERM-6_TRADE_TASKBRIEF.md`（6b 段）。人员：用户 2026-10-28 提供"梦馨现在只有 cathy Li，邮箱 cathy@hlmbedding.com"。

## Why

梦馨（`home_textile_trade_v1`）是最后一个旧模式企业：行业包没有岗位模板，权限靠"平台角色 + 企业角色兼容回退"。

- 生产成员只有两位（`docs/QINGYAN_MENGXIN_FDE_V1_PRODUCTION_VALIDATION.md`）：
  - Lucas：`org_owner`，平台 `admin`；
  - Cathy Li（`cathy@hlmbedding.com`）：`org_member`，平台 `trade`，默认询盘负责人。
- 6a / 6c 已让外贸、营收、外贸提醒按岗位键判定，并让压扁可以处理 `trade`。但梦馨不是岗位模式：
  - 兼容回退还开着；
  - 导航 / 落地 / 管理层仍看平台角色；
  - 平台角色不能压扁（压扁脚本只处理岗位模式企业）。

本次给家纺外贸行业包落岗位模板，让梦馨进入岗位模式。这样两家企业的权限都只看岗位，平台角色最终只剩 `super_admin / user`。

## What Changes

- **家纺外贸岗位模板**（`home_textile_trade_v1`）：
  - 新行业包岗位 `owner`（老板）：管理层信号 `organization.dashboard.read`、外贸三键，以及系统模板 `org_owner` 的读权限与招投标交接键。
  - 外贸业务员复用 6a 的系统岗位 `trade_rep`（读写外贸，范围全企业）。
  - 不预建外贸主管 / 内容岗位，加人时再加。
- **梦馨进入岗位模式**：行业包有了岗位模板，4c2–6c 的岗位模式规则自动生效，不改判定代码：
  - 导航与管理层按键；
  - 兼容回退关闭；
  - 派生角色按键；
  - 压扁可执行。
  - Cathy 的默认落地前后都是 `/tasks`，外贸布局按派生角色 `trade`，与今天一致。
- **绑定文件** `config/positions/mengxin.json`：`cathy@hlmbedding.com` → `trade_rep`，`lucas@sunnyshutter.ca` → `owner`。
- **上线顺序**：合并即进入岗位模式，没有岗位绑定的成员会立刻失去权限。
  - 合并前必须先对梦馨跑一次 `seedOrgAuthorizationProfiles`（6a 代码已在线），让 Cathy 自动绑上 `trade_rep`；
  - 由 Lucas 确认后再合并；
  - 合并后再跑一次 seed 落 `owner` 模板，并给 Lucas 绑 `owner`。
  - 步骤写进报告与验收清单。
- **入驻 / 交接 / 邀请注册后落岗位**（实施中补充，见 design D5）：
  - 新入驻的家纺外贸工厂同样是岗位模式，所以入驻、交接负责人与企业邀请码注册之后，要立即落岗位模板、按既有规则自动绑；
  - 入驻 / 交接时给指定负责人绑 `owner`。
- **数据范围**：维持全企业（梦馨只有一名业务员，按负责人收窄没有意义）。以后加业务员时另做。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `authorization/position-binding`：新增"入驻与邀请注册后的默认岗位"
- `authorization/position-catalog`：
  - 新增"家纺外贸企业岗位模板集"；
  - "窗饰企业岗位模板集"的"非窗饰企业不落地"情形，改为"不出现窗饰岗位"（家纺外贸企业会有自己的 `owner`）。

## Out of scope

- 按负责人收窄外贸数据（等梦馨加人）。
- 外贸主管 / 内容 / 数字员工岗位。
- 对梦馨执行压扁：合并并绑定后，Lucas 可按需执行；不是本 change 的代码改动。
- PERM-7（岗位绑定界面）、PERM-7b（AI 平台 admin 档）。

## Impact

- 修改：
  - `src/lib/authorization/role-defaults.ts`（新行业包岗位集与登记）；
  - `src/lib/organizations/onboarding.ts`、`src/app/api/auth/register/route.ts`（调 `ensureDefaultPositions`）；
  - 测试断言（岗位目录、`authorize`、`position-nav`、`platform-role-collapse` 中"梦馨是旧模式"的用例）。
- 新增：
  - `config/positions/mengxin.json`、`src/lib/authorization/onboarding-positions.ts`；
  - 测试 `src/lib/authorization/__tests__/mengxin-positions.test.ts`（纯）与 `mengxin-positions-db.isolated.test.ts`（隔离库）。
- 零 schema；无新权限键。
- **BREAKING（合并即生效，梦馨）**：
  - 梦馨关闭兼容回退，没有岗位绑定的成员无权限；
  - 不是 super_admin 的 Lucas 在梦馨只按 `owner` / `org_owner` 绑定判定；
  - 必须按"上线顺序"操作。
