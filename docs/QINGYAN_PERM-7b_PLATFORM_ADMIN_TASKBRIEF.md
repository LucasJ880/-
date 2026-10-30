# PERM-7b 平台 admin 收尾 — 任务书

TASKFLOW：PERM-7b（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）。前置：PERM-7 已合并（#305）；**PERM-6b（#307）合并后再合并本 change**（见"上线顺序"）。
依据：
- 设计稿 `docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md` §2.1：平台层只有 `platform_admin`（即 super_admin）/ `user`，其余人一律 `user`，业务能力全部由岗位决定；
- PERM-7 拍板 4："AI 工具策略的平台 `admin` 档另立 PERM-7b（连同企业列表 / 新建企业等仍认平台 admin 的入口）"；
- PERM-7 报告 §1："`requirePlatformAdmin` 不改：还有 10 个文件在用，归 7b"。

## Why

4a–7 已经把销售、运营、平台用户管理、外贸、营收、成员管理、岗位绑定逐个收到"岗位键或 super_admin"。但平台 `admin` 这个值本身仍然等于平台管理员，而且范围比 PERM-7 时看到的大。

**1. 三个共用判定把 `admin` 当成最高权限**
- `isSuperAdmin` / `isAdmin`（`src/lib/rbac/roles.ts`）、`isPlatformAdmin`（`src/lib/rbac/platform-admin.ts`）都是 `admin || super_admin`；
- 客户端 `src/lib/permissions-client.ts`、`useCurrentUser().isPlatformAdmin` 同口径；
- 61 个文件调用它们。

**2. 由此平台 `admin` 今天还能跨企业**（不是本企业成员也行）：
- `requireOrgRole` 对 `isSuperAdmin` 直接放行，并当作 `org_admin`（`guards.ts`）；
- 企业列表（`GET /api/organizations`）列出全部企业，企业详情 / 项目列表 / 归档；
- 项目访问与可见性（`src/lib/projects/access.ts`、`visibility.ts`，92 个路由经此判定）；
- 显式 orgId 解析（`resolve-request-org.ts` 的 `isAdmin`）；
- 入驻控制台 6 个路由、能力运行记录 3 个路由、项目诊断（`requirePlatformAdmin`）；
- 新建企业（`POST /api/organizations`）、平台公司与邀请码（`requireSuperAdmin`，它其实等于 `requirePlatformAdmin`）。

**3. 约 20 处手写 `role === "admin" || role === "super_admin"`**，同样把 admin 当平台管理员：
- 企业知识库、项目规则、智能体追踪（组织级 / 本人）、消息网关、执行器、工具注册表、运营看板、入驻规则、折扣统计卡等。

**4. AI 一侧**
- 派生角色把 `admin` 列为保留角色原样透传（`effective-platform-role.ts`）；
- AI 工具注册表里 `admin` 档能调全部工具（未声明 `allowRoles` 的工具默认只给 `admin`）；
- Muse 销售管理层名单 `SALES_MANAGER_PLATFORM_ROLES` 含 `admin`。

**5. 自我扩散**：邀请码可以签发平台 `admin` 角色（`/api/admin/invite-codes` 的 `validRoles`）；而创建邀请码的守卫同样放行 admin。

结果：任何平台 `admin` 账号都是事实上的跨企业管理员，绕开了 4a–7 的岗位收口。设计稿里平台管理员只有 Lucas 一人。

## What（推荐方案 A，拍板后写 proposal）

**PERM-7b `perm-7b-retire-platform-admin`：平台 `admin` 退役（一个 change）**

规则只有一条：**只有 `super_admin` 带平台特权；`admin` 在代码里等同 `user`，能力全看岗位**。

- **共用判定**：
  - `isSuperAdmin` / `isAdmin` / `isPlatformAdmin` / 客户端同名函数改为只认 `super_admin`；
  - 61 个调用方随之收口，不逐个改调用方。
- **守卫**：
  - `requirePlatformAdmin` 改为只认 `super_admin`（与 `requirePlatformSuperAdmin` 同义，后者保留为别名）；
  - `requireSuperAdmin` 不再是"admin 也行"；`requireRole` 的"admin 始终通过"改为只有 super_admin。
- **手写判断**：约 20 处 `role === "admin" || role === "super_admin"` 改调共用判定。
- **AI 一侧**：
  - 派生角色不再保留 `admin`：岗位模式按键派生（老板岗 → boss，销售键 → sales，运营键 → operations，外贸键 → trade，否则 user）；
  - 工具注册表只有 `super_admin` 映射到 `admin` 档，原始 `admin` 按 `user`；
  - Muse 名单去掉 `admin`。
- **不再签发**：邀请码 `validRoles` 去掉 `admin`；已有的 admin 邀请码注册时按 `user` 落。
- **压扁范围加 `admin`**（`scripts/collapse-platform-roles.ts`）：
  - `admin → user`；
  - 需要该账号在其所有企业都有 active 岗位绑定，否则阻断（与 4c3 / 6c 同口径）。
- 零 schema；无新权限键。

## 判断点（请拍板）

1. **平台 `admin` 怎么处理**：
   - **A（推荐）**：退役——`admin` 不带任何平台特权，等同 `user`。符合设计稿 §2.1，一条规则覆盖全部 61 + 20 处，不留例外。
   - **B**：保留 `admin` 为"本企业内全权"档，只收跨企业的入口（企业列表、入驻、诊断、`requireOrgRole` 旁路）。要逐个改约 30 处，口径比 A 多一档，而且"本企业全权"会绕开岗位（4a–6c 刚收掉的）。
2. **派生角色里 `trade` 是否也取消保留**：
   - **推荐一并取消**：6b 合并后两家企业都是岗位模式，平台 `trade` 的人（Cathy）本来就绑 `trade_rep`，按键派生同样得到 `trade`，行为不变；保留名单只剩 `super_admin`。
   - 不取消也可以，只是多一个例外。
3. **压扁是否纳入 `admin`**：
   - **推荐纳入**：代码上 `admin` 已等同 `user`，压扁只是把数据收干净（导航标签、平台用户页不再显示"平台管理员"）。
   - 不纳入：数据里留着 `admin` 字样，但不带任何权限。
4. **旧模式企业**（行业包没有岗位模板，生产上 6b 后已没有）：平台 `admin` 在这类企业也按 `user` + 企业角色兼容回退处理。推荐不为旧模式另开例外。

## 上线顺序（BREAKING）

合并即生效：所有平台 `admin` 账号失去跨企业访问、入驻控制台、能力运行记录、诊断视图、新建企业、邀请码、AI 全部工具。

1. **合并前（Lucas）**：
   - 查生产 `User.role='admin'` 的名单；
   - 平台运维账号（`lucas@sunnyshutter.ca`）执行 super_admin SQL；
   - 其余是业务人员的，先确认在所属企业有岗位绑定（企业详情页"岗位"一节）。
2. 6b（#307）先合并。
3. Lucas 确认后合并 7b。
4. 合并后（可选）：对两家企业跑压扁 `--dry-run`，`admin → user` 无阻断后执行，通知相关人重新登录。
5. 漏了第 1 步：Lucas 自己会失去企业列表与入驻控制台。用另一个 super_admin 账号或 SQL 补救即恢复，不需要回滚代码。

## Impact（方案 A）

- 修改：
  - `src/lib/rbac/roles.ts`、`platform-admin.ts`、`permissions-client.ts`、`src/lib/hooks/use-current-user.ts`；
  - `src/lib/auth/guards.ts`（`requirePlatformAdmin` / `requireSuperAdmin` / `requireRole`）；
  - 约 20 处手写判断（见 Why 第 3 条）；
  - `src/lib/rbac/effective-platform-role.ts`、`src/lib/agent-core/tool-registry.ts`、`src/lib/muse-bridge/sales-pure.ts`；
  - `src/app/api/admin/invite-codes/route.ts`、`src/app/api/auth/register/route.ts`；
  - `src/lib/authorization/platform-role-collapse*`（压扁范围加 `admin`）。
- 测试：
  - 纯：判定只认 super_admin；派生角色 admin 按键；工具档；邀请码不签发 admin；源码断言无手写 `role === "admin"`；
  - 隔离库：平台 admin 非成员访问别企业 403、企业列表只见自己的、入驻 / 能力运行 / 诊断 403、绑了老板岗的 admin 在本企业照常；super_admin 全部照旧；压扁 `admin → user` 计划与阻断。
  - 现有约 65 个测试文件用 `role: "admin"` 构造"有权限的人"，其中断言平台特权的改成 `super_admin`（不改被测行为）。
- 零 schema。
- **BREAKING**：见"上线顺序"。

## Out of scope

- 删除平台角色值 `boss / manager / operations / sales / trade`（压扁已在处理，枚举清理另做）。
- 平台审计"平台管理员操作"标记、敏感操作自批记录（设计稿 §2.1，另立）。
- super_admin 的跨企业范围本身不变。

## 验收

- 平台 `admin` 账号（非 super_admin、只在 Sunny 绑了 `owner`）：
  - 打开梦馨的企业详情 / 项目 / 外贸，返回 403；
  - 企业列表只有 Sunny；
  - 入驻控制台、能力运行记录、诊断视图 403；
  - 在 Sunny 照常是老板（管理总览、团队任务、AI 老板工具）。
- super_admin（Lucas）以上全部照旧。
- 用邀请码不能再注册出平台 `admin`。
- `grep` 业务代码无手写 `role === "admin"` 平台判断。
- 压扁 `--dry-run`：有绑定的 admin 进计划，无绑定的阻断。

### 拍板结果 · PERM-7b（2026-10-28："按推荐方法去实施7B"）
1. **方案 A**：平台 `admin` 退役，只有 `super_admin` 带平台特权，`admin` 等同 `user`。
2. 派生角色一并取消保留 `trade`，保留名单只剩 `super_admin`。
3. 压扁纳入 `admin → user`（须有岗位绑定）。
4. 旧模式企业不开例外。
