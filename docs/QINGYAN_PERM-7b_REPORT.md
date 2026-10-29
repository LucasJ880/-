# PERM-7b 报告：平台 admin 退役，平台特权只认 super_admin

- change：`openspec/changes/perm-7b-retire-platform-admin/`（proposal / specs ×3 / design / tasks 8/8）
- 任务书：`docs/QINGYAN_PERM-7b_PLATFORM_ADMIN_TASKBRIEF.md`（"拍板结果 · PERM-7b"）
- 拍板：用户 2026-10-28 "按推荐方法去实施7B"：
  - 方案 A（`admin` 退役）；
  - 派生角色一并取消保留 `trade`；
  - 压扁纳入 `admin`；
  - 旧模式不开例外。
- 零 schema；无新权限键。
- **合并前提**：6b（#307）已合并（归档 #314）；Lucas 已改 super_admin 并确认其余平台 `admin` 账号已绑岗位（§4）。

## 1. 做了什么

| 项 | 改动 |
|---|---|
| 共用判定（D1） | 只认 `super_admin`：<br>• 服务端 `roles.ts` 的 `isSuperAdmin` / `isAdmin` / `isPlatformSuperAdmin`，`platform-admin.ts` 的 `isPlatformAdmin`；<br>• 客户端 `permissions-client.ts` 同名函数与 `canViewAdminPages`，`useCurrentUser().isPlatformAdmin`。<br>函数名保留，61 个调用方随之收口。守卫 `requirePlatformAdmin` / `requireSuperAdmin` / `requireOrgRole` 旁路等随之只认 super_admin |
| 平台档归一（D2） | 新 `platformTier`：`super_admin` → `admin` 档，`admin` → `user`，其余原样。<br>接入 `requireRole`、`canAccessModule`、AI 工具注册表、AI 能力矩阵、微信推送默认域。<br>旧模式导航与操作员提示词角色说明用 `normalizeRetiredPlatformRole`（只把 `admin` 换成 `user`） |
| 手写判断（D3） | 约 25 处 `role === "admin" \|\| role === "super_admin"` 改调共用判定；另：发布漂移通知改发 super_admin、风险扫描保持原扫描范围、提示词 / 晨报 `case "admin"` 去掉、旧模式导航名单去掉 `admin`。见 §3 |
| AI 一侧（D4） | 派生角色保留名单只剩 `super_admin`（`admin`、`trade` 在岗位模式按键派生）；Muse 销售管理层名单去掉 `admin` |
| 不再签发（D5） | 邀请码与平台用户修改的 `validRoles` 去掉 `admin`（传入 400）；历史 `admin` 邀请码注册按 `user` 落；平台用户页 / 邀请码页去掉"平台管理员"选项 |
| 压扁（D6） | `COLLAPSIBLE_PLATFORM_ROLES` 加 `admin`，前置校验不变 |

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS；改动文件 eslint 0 error（1 条既有 `<img>` warning） |
| `npm run test:ci` | PASS（含新 `platform-admin-scope.test`） |
| `bash scripts/check-test-registry.sh` | OK（475，含 main 上新合入的测试） |
| `openspec validate perm-7b-retire-platform-admin --strict` | valid |
| `platform-admin-scope.test`（新，纯） | **46 / 46** |
| `platform-admin-scope-db.isolated.test`（新，本地 Postgres 16，真实路由） | **23 / 23** |
| 全量登记测试（起隔离库逐个运行） | 见 §2a |

`platform-admin-scope.test` 覆盖：
- 9 个判定函数（服务端 / 客户端）只认 super_admin；操作员提示词平台 admin 的角色说明与 user 相同、super_admin 不变；`platformTier` 两份实现；`canAccessModule` 平台 admin = user；
- AI 能力矩阵平台 admin = user；工具注册表：平台 admin 的可用工具与 user 相同，super_admin 进 `admin` 档；
- 派生角色：平台 admin + owner → boss、+ trade_rep → trade、+ sales_rep → sales、无绑定 → user；平台 trade 按键；super_admin 保留；旧模式原样；
- Muse 名单与范围；旧模式导航平台 admin = user、super_admin 仍多平台入口；
- 压扁范围与计划（有绑定进计划、无绑定阻断）；
- 源码断言：`validRoles` 无 admin、注册映射、两个页面无选项、发布漂移收件人、`useCurrentUser`、`requireRole`、D3 清单文件无手写判断。

`platform-admin-scope-db.isolated.test` 覆盖（平台 admin 只在企业 A 绑 `owner`，企业 B 不是成员）：
- 企业列表只有 A；B 详情 / 项目列表 403；A 详情 200；
- 入驻控制台 403 `PLATFORM_ADMIN_REQUIRED`、能力运行记录 403、新建企业 403 且未落库、智能体追踪 403、创建邀请码 403；
- 在 A 派生 boss（管理层）；
- super_admin 对照：企业列表含 A / B、B 详情 / 项目 200、入驻控制台 200、能力运行记录不被门禁拦；
- super_admin 创建 `admin` 邀请码 400、`user` 邀请码成功；历史 `admin` 邀请码注册得到 `user`；
- 压扁 dry-run：有绑定的平台 admin `admin → user` 无阻断；无绑定的阻断；不写库。

### 2a. 全量回归

`scripts/test-all.sh` 登记的全部 **479** 条测试命令，起本地隔离库逐个运行：**470 过、9 败**。9 个失败在 6b 基线（本分支的父提交）上逐个复跑，**同样失败**，与本次无关：
- `capabilities/phase3a3-approvals-smoke`、`phase3a4-acceptance`、`phase3a4-governance-smoke`、`phase3a5-overview-acceptance`：本地库缺双租户种子；
- `sunny-process/autogen-db.isolated`：main 上即失败（NO_BINDING），已提任务卡；
- `mention-gateway/m2a-identity-db.isolated`：测试自身夹具违反 `weChatGateway (orgId, channel)` 唯一约束；
- `tender-intel/awards-db`：前置快照（库内无调查室行）；
- `scripts/quotation-pdf-layout-e2e.ts`：需要浏览器 / 服务端环境；
- `scripts/test-api-integration.ts`：登记的文件不存在。

首轮共 17 个失败：除上面 9 个，其余 8 个都是既有测试按旧口径构造或断言，按 D7 处理后全部通过（§3）。

## 3. 判断与实施中的变更

- **D3 清单之外的发现**（实施前 `grep` 复核时补上，design D2 / D3 已同步）：
  - AI 能力矩阵 `getCapabilities` 把原始 `admin` 映射到全域、全组织；
  - 微信推送默认域 `ROLE_DEFAULT_DOMAINS` 给 `admin` 全部域；
  - 操作员提示词告诉模型"管理员可以查询公司全局数据"；
  - 发布漂移通知只发给平台 `admin`（漏了 super_admin），改为只发 super_admin；
  - 平台用户页"不能删 admin / 客户权限开关"判断。
- **旧模式导航不能只删名单**：
  - 只把 `admin` 从 `NAV_ROLES_EXEC` 删掉后，平台 admin 在旧模式看到的比 `user` 还少（含 `user` 的条目也看不到）；
  - 改为在 `isNavItemVisible` 入口把 `admin` 归一为 `user`，验证两者完全相同。
- **风险扫描技能**原来传 `"admin"` 给扫描器取全量项目再按 `ctx.projectId` 过滤；改为传 `"super_admin"`，保持原扫描范围（该技能只给 `admin` 档，即 super_admin）。
- **保留**：入驻向导"平台管理员不能被指定为工厂老板"（`factoryOwnerRoleProblem`）是限制，`admin` 继续拦。
- **既有测试（D7）**：按"断言平台 admin 有平台特权 → 构造换 super_admin；断言 spec 已改的行为 → 按新 spec 场景改断言；其他 → 停下回报"处理，被测行为未改。逐个列出：

- `navigation/__tests__/nav-active-matcher.test.ts`：上下文"平台管理员"构造 admin → super_admin
- `navigation/__tests__/navigation-ia.test.ts`：管理员可见今日询盘 / 团队销售分析 / 重复 href / 平台运营入口 4 处构造 admin → super_admin；"同一可见范围"名单加 super_admin（admin 保留，验证两入口同口径）
- `mention-gateway/__tests__/m1-tool-policy.test.ts`：3 处"admin 视角"工具列举 `role: "admin"` → `super_admin`（生产代码传的是真实用户角色）
- `mention-gateway/__tests__/m2c-tool-policy.test.ts`：2 处同上
- `muse-bridge/__tests__/sales-pure.test.ts`："平台 admin → 全组织"改为"平台 admin + org_member → 拒绝（同 user）"（spec：Muse 名单去掉 admin）
- `rbac/__tests__/effective-platform-role.test.ts`："保留角色 admin / trade 原样"改为只保留 super_admin、admin / trade 按岗位派生；"岗位模式：平台 admin 仍全组织"改为"无绑定 → 拒绝"+"super_admin 仍全组织"（spec：派生角色规则）
- `authorization/__tests__/platform-role-collapse.test.ts`：压扁范围加 admin；计划 6 人、汇总"待压扁 6，跳过 3"；幂等 / "不在范围不参与前置校验"两例的 admin 换成 super_admin（spec：压扁范围）
- `trade/__tests__/trade-access.test.ts`："平台 trade 仍原样"改为按键派生（spec：派生角色规则）
- `trade/__tests__/trade-recipients.test.ts`："压扁范围不含 admin"改为不含 super_admin / user（spec：压扁范围）
- `authorization/__tests__/mengxin-positions-db.isolated.test.ts`（6b）：Lucas（平台 admin）派生角色由"原样 admin"改为"绑 owner → boss"；"Lucas 不在压扁范围"改为"Lucas（已绑岗位）进压扁计划 admin → user"（spec：派生角色规则、压扁范围）
- `agent-runtime/__tests__/b5-supervisor-cancel.isolated.test.ts`："平台管理员可取消"的构造 admin → super_admin（2 处）
- `organizations/__tests__/onboarding-db.isolated.test.ts`：入驻操作人"平台管理员"构造 admin → super_admin（建用户、会话、审批上下文 2 处）；越界邀请码（admin / org_member）注册被拒的断言保持不变
- `projects/handoff/__tests__/handoff-domain.test.ts`："管理层可预览 / 可 override"构造 admin → super_admin（spec `projects/handoff-access` 本来就不含平台 admin）
- `rbac/__tests__/home-redirect.test.ts`、`rbac/__tests__/workspace-policy.test.ts`："平台管理员"构造 admin → super_admin（3 处）
- `rbac/__tests__/platform-admin-diagnostics-gate.test.ts`："admin 是平台管理员"两条改为断言"admin 不是、super_admin 是"（spec 已改）；导航上下文与第 12 条构造 admin → super_admin
- `assistant/__tests__/durable-followup-m1.isolated.test.ts`：审批人上下文 admin → super_admin（3 处）。审批人批准他人客户的邮件草稿时，看他人客户靠的是平台管理员身份；改前 T13 在 Gmail 未连接处失败，改后在 `canSeeResource` 处更早失败

## 4. 上线顺序（BREAKING：合并即生效）

合并后所有平台 `admin` 账号失去：
- 跨企业访问（企业列表 / 详情 / 项目、企业级角色旁路）；
- 入驻控制台、能力运行记录、项目诊断、新建企业、平台公司与邀请码；
- AI 全部工具与全组织数据范围、智能体追踪、调试视图。

1. **合并前（Lucas，Neon SQL Editor：项目「青砚-AI工作助手」→ 分支 `production` → `neondb`）**：
   - 查平台 `admin` 账号及其所在企业与岗位（只读）：
     ```sql
     SELECT u.email, u.status, o.code AS 企业编码, m.role AS 企业角色,
            COALESCE(string_agg(rp.key, ', ' ORDER BY rp.key) FILTER (WHERE b.status = 'active'), '（无绑定）') AS 当前岗位
     FROM "User" u
     LEFT JOIN "OrganizationMember" m ON m."userId" = u.id AND m.status = 'active'
     LEFT JOIN "Organization" o ON o.id = m."orgId"
     LEFT JOIN "PrincipalRoleBinding" b ON b."orgId" = o.id AND b."principalId" = u.id AND b."principalType" = 'HUMAN'
     LEFT JOIN "RoleProfile" rp ON rp.id = b."roleProfileId"
     WHERE u.role = 'admin'
     GROUP BY u.email, u.status, o.code, m.role
     ORDER BY u.email, o.code;
     ```
   - 平台运维账号改 super_admin（重新登录生效）：
     ```sql
     UPDATE "User" SET role = 'super_admin' WHERE lower(email) = 'lucas@sunnyshutter.ca';
     ```
   - 名单里其余是业务人员的，确认"当前岗位"不是"（无绑定）"；无绑定的在企业详情页"岗位"一节补绑（super_admin 可见）。
2. ~~6b（#307）先合并~~：已合并（2026-10-29），归档 #314。
3. Lucas 确认后我再合并 7b PR。
4. **合并后（可选）**：压扁 `admin → user`（需本地仓库跑 `collapse-platform-roles --dry-run`；不压扁也不影响功能——`admin` 已等同 `user`）。
5. **漏了第 1 步**：Lucas 自己会失去企业列表与入驻控制台。执行上面的 `UPDATE` 即恢复，不需要回滚代码。

## 5. 合并后

- `/opsx:archive perm-7b-retire-platform-admin --yes`，独立小 PR；TASKFLOW PERM-7b → `[x]`。
- PERM 系列到此收尾：平台层只剩 `super_admin` 与（压扁后的）`user`。
- 后续可另立：
  - 平台角色枚举清理；
  - 设计稿 §2.1 的"平台管理员操作"审计标记。
