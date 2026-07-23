# 公司租户与组织 / 小组上下文 — 架构锁定（Commit C1）

> **状态**：架构锁定 / 未实施  
> **分支**：`feature/company-workspace-context`  
> **范围**：仅文档。本文件通过后进入 C2 schema + 迁移，不在本轮改业务 API / UI。  
> **隔离**：独立 Draft PR；**不**并入 Phase 3B-A PR #17。

---

## 0. 一句话结论

青砚的最高数据隔离边界是**公司租户**（DB 表名仍为 `Organization`，产品语义改称 Company Tenant）。  
`Company` 表收敛为**公司品牌资料**（名称 / slug / Logo），通过一对一关系挂在租户上。  
`Workspace` 是公司内部的**组织 / 小组**（销售组、外贸组等），不是第二套租户。  
品牌与 Logo **禁止**再从 `User.companyIdsJson[0]` 推断。

---

## 1. 产品语义 ↔ 数据库映射（锁定）

| 产品语义 | 数据库实体 | 隔离职责 | 备注 |
|---|---|---|---|
| **公司 / Company Tenant**（Sunny、梦馨） | `Organization` | **最高租户边界**；业务表 `orgId` | **不改表名**（成本过高） |
| **公司品牌 Brand Profile** | `Company` | 无租户隔离职责；仅品牌展示资源 | 一对一挂到 `Organization` |
| **组织 / 小组**（销售组、外贸组…） | `Workspace` | 公司内范围；不可跨公司 | 角色见 `WorkspaceMember.role` |
| 平台运营身份 | `User.role`（admin / super_admin 等） | 非租户边界 | 不得自动绕过公司切换门禁 |

### 命名规则（强制）

| 层 | 必须使用 | 禁止继续对外使用 |
|---|---|---|
| 产品 UI / 文档 / 新 API | 公司、公司租户、组织/小组 | 「组织切换」指代公司切换 |
| 服务层类型 | `CompanyAccessProfile`、`activeCompanyTenantId` | 新代码裸用「org 切换」语义而不映射 |
| DB / Prisma / 既有列 | `Organization`、`orgId`、`orgAccessMode`（过渡期） | 本轮全库重命名 |

过渡期字段保留：

```text
User.orgAccessMode      → 产品语义 companyAccessMode
User.canSelfSwitchOrg   → 产品语义 canSelfSwitchCompany
User.activeOrgId        → 产品语义 activeCompanyTenantId
```

映射：

```text
OrgAccessMode.FIXED      → CompanyAccessMode.FIXED
OrgAccessMode.MULTI_ORG  → CompanyAccessMode.MULTI_COMPANY
（新增）PLATFORM_SUPPORT → 仅服务层枚举预留；DB 枚举扩展另开迁移
```

---

## 2. 现状审计（2026-07-23）

### 2.1 已有能力

- `Organization` + `OrganizationMember`：正式租户 + 公司角色（`org_owner` 等）
- `Workspace` + `WorkspaceMember`：已存在；角色含 `workspace_admin | manager | editor | member | viewer`
- Security-1：`orgAccessMode` / `canSelfSwitchOrg` / `POST /api/auth/switch-org`
- 业务查询大量强制 `orgId`（销售 / 外贸 / AI Run 等）

### 2.2 关键缺口 / 反模式

| 问题 | 现状 | 目标 |
|---|---|---|
| `Organization` ↔ `Company` 无 FK | 品牌与租户断开 | `Organization.brandCompanyId` 一对一 |
| Logo 来源错误 | `CoBrand` 读 `user.companies[0]` ← `companyIdsJson` | `activeOrgId → Organization → brandCompany` |
| AI 公司背景 | `buildCompanyBlock` 读 `companyIdsJson` | 同上，跟当前公司租户 |
| 梦馨品牌缺失 | DB 仅有 `Company(slug=sunny)` | 显式创建梦馨 `Company` 并映射 |
| 无 `activeWorkspaceId` | 用户无当前小组 | `User.activeWorkspaceId` + 切换 API |
| 术语混淆 | UI「组织」既指租户又指列表页 | 公司 vs 组织/小组 分栏 |
| 切换失败体验 | FIXED 用户点「设为当前」静默回退 | Settings Banner + 明确错误码 |

### 2.3 样板租户实测 ID（供 C2 显式映射，禁止模糊匹配）

| 产品公司 | Organization.id | Organization.code | 既有 Company |
|---|---|---|---|
| Sunny Home & Deco | `cmrtcnz1c0001sbjcy87hemyl` | `sunny-home-deco` | `cmrim4rk40000n18u015ze6cu`（slug=`sunny`，logo=`/logo.png`；另有资产 `/brands/sunny.png`） |
| 梦馨家纺 | `cmrv37moo0001sbskqeknr5km` | `mengxin-home-textile` | **尚无** Brand Profile 行 |

两家公司下各已有 6 个 `Workspace`（department），例如 Sunny：`Sales` / `Projects` / `Marketing`…；梦馨：`Sales` / `International Trade` / `Supply Chain`…

---

## 3. 目标数据模型（C2 最小增量）

### 3.1 一对一品牌挂载

```prisma
model Organization {
  // 既有字段保持
  brandCompanyId String?  @unique
  brandCompany   Company? @relation(fields: [brandCompanyId], references: [id], onDelete: SetNull)
}

model Company {
  // 既有字段保持：name / slug / logoUrl / isActive
  tenant Organization?
}
```

约束：

- 一个 `Company` 最多挂一个 `Organization`（`brandCompanyId` unique）
- 未映射品牌时 UI fallback：青砚 Logo + 公司名称（`Organization.name`），不报错、不串品牌

### 3.2 当前组织 / 小组

```prisma
model User {
  // 既有 activeOrgId / orgAccessMode / canSelfSwitchOrg 保留
  activeWorkspaceId String?
  activeWorkspace   Workspace? @relation(fields: [activeWorkspaceId], references: [id], onDelete: SetNull)
}
```

### 3.3 废弃授权来源

| 字段 | 过渡策略 |
|---|---|
| `User.companyIdsJson` | **历史兼容**；禁止作为当前品牌 / 授权 / Logo 来源 |
| `InviteCode.companyIdsJson` | 注册流程后续改为绑定 `Organization` membership；C2 不强制改注册 |
| 客户端 `localStorage` org | 仅 hydrate；权威仍是服务端 `User.activeOrgId` |

---

## 4. 需要迁移的数据（C2 脚本清单）

脚本要求：默认 dry-run；显式 `--apply`；幂等；**禁止** `migrate reset` / truncate 共享库；**禁止**名称模糊匹配。

| # | 动作 | 规则 |
|---|---|---|
| M1 | Sunny 映射 | `Organization(code=sunny-home-deco).brandCompanyId` → 既有 `Company(slug=sunny)`（或按上表显式 ID） |
| M2 | 梦馨品牌创建 + 映射 | 若不存在 `Company(slug=mengxin)`（或约定 slug），**显式创建**后再写 `brandCompanyId`；Logo 路径待产品提供（可先 placeholder，不得盗用 Sunny Logo） |
| M3 | 校验一对一 | 输出冲突：多 Organization 指向同一 Company / 重复 slug |
| M4 | `activeWorkspaceId` 回填 | 仅当用户在 `activeOrgId` 下**恰好 1 个** active `WorkspaceMember` 时自动填；否则保持 null |
| M5 | 跨公司异常报告 | `activeWorkspaceId` 所属 `Workspace.orgId ≠ activeOrgId` → 列出并在 apply 时清空 |
| M6 | 无法映射的 Organization | 无显式映射表条目 → **跳过并报告**，不猜测 |

输出报告建议路径：`docs/company-brand-backfill.json`（不含密钥）。

---

## 5. Logo / 品牌解析方案（锁定）

### 5.1 权威链路

```text
User.activeOrgId
  → Organization
    → brandCompany (Company?)
      → logoUrl / name / slug
```

### 5.2 显示规则

| 条件 | 左上角 |
|---|---|
| 有 `currentCompany.logoUrl` | 青砚 Logo × 公司 Logo |
| 无 Logo、有公司名 | 青砚 Logo × 公司名称 |
| 无当前公司 | 仅青砚 |

组织 / 小组切换（Workspace）**不得**改变公司 Logo。

### 5.3 前端统一 Provider（C3）

新增单一 Context（名候选：`CompanyContextProvider` / `TenantBrandProvider`），Header / Sidebar / 移动顶栏只读：

```text
currentCompany.logoUrl
currentCompany.name
currentWorkspace.name
```

**禁止**组件各自读取：`companyIdsJson`、localStorage 公司列表、`companies[0]`、过期 active-org cache。

### 5.4 切换公司后缓存清理（C3）

公司切换成功后必须（推荐整页 reload）：

1. 终止 SSE  
2. 清空 React Query / SWR（若有）  
3. 清空上一公司 Assistant Thread / PendingAction / Run 选择与缓存  
4. 清空项目 / 客户 / 报价当前选择与未提交草稿  
5. 重置或重解析 `activeWorkspace`  
6. 重新拉取权限、模块、`GET /api/auth/company-context`

只换 Logo、保留旧公司页面数据 = **不合格**。

---

## 6. 公司与组织切换决策表

### 6.1 公司访问模式

| `companyAccessMode`（语义） | DB 过渡字段 | `canSelfSwitchCompany` | 用户能否自助切公司 |
|---|---|---|---|
| `FIXED` | `FIXED` | false（忽略 true） | 否 |
| `MULTI_COMPANY` | `MULTI_ORG` | true | 是（仍须 membership） |
| `PLATFORM_SUPPORT` | （C2+ 枚举扩展） | 策略另定 | 支持场景专用；**本轮不实现切换旁路** |

正交规则（锁定）：

```text
org_owner / org_admin / 平台角色
  ≠ 自动获得跨公司切换权
```

### 6.2 公司切换（`POST /api/auth/switch-company`）

| 检查 | 失败码（建议） |
|---|---|
| `MULTI_COMPANY && canSelfSwitchCompany` | `ORG_SWITCH_NOT_ALLOWED` / `COMPANY_SWITCH_NOT_ALLOWED` |
| 目标 `Organization.status === active` | `ORG_INACTIVE` |
| 存在 active `OrganizationMember` | `ORG_MEMBERSHIP_REQUIRED` |
| 审计写入成功（与 activeOrgId 同事务） | `ORG_SWITCH_AUDIT_FAILED` |

事务顺序（锁定）：

1. 验证 company switch policy  
2. 验证 OrganizationMember  
3. 更新 `User.activeOrgId`  
4. 若 `activeWorkspaceId` 不属于新公司 → **清空**  
5. 若新公司仅 1 个有效 Workspace membership → 可自动选中  
6. 写 AuditLog：`action=company.switch_active`，`targetType=company_tenant`  
7. 返回当前公司品牌 + 当前组织  

兼容：`POST /api/auth/switch-org` 第一阶段保留，**内部调用同一服务**，标记 deprecated。

### 6.3 组织 / 小组切换（`POST /api/auth/switch-workspace`）

| 检查 | 结果 |
|---|---|
| 服务端 `User.activeOrgId` 非空 | 否则拒绝 |
| `Workspace.orgId === activeOrgId` | 否则拒绝（防跨公司） |
| `Workspace.status === active` | 否则拒绝 |
| active `WorkspaceMember` | 否则拒绝 |

事务：

1. 读服务端 `activeOrgId`（不信任 body 公司）  
2. 校验 Workspace + Member  
3. 更新 `User.activeWorkspaceId`  
4. AuditLog：`workspace.switch_active` / `targetType=workspace`  

**禁止**组织切换修改：`activeOrgId`、公司品牌、Company / Organization membership。

### 6.4 统一 Context API（C2）

`GET /api/auth/company-context` 返回形状见产品规格（companyAccess / currentCompany / availableCompanies / currentWorkspace / availableWorkspaces）。  

客户端传入的 `companyId` / `orgId` / `logoUrl` / `companyName` **一律不可信**。

### 6.5 查询边界（不变式）

```text
所有公司级业务：orgId = User.activeOrgId          （强制）
组织范围功能可选：workspaceId = User.activeWorkspaceId
禁止：用 activeWorkspaceId 替代 orgId 做租户隔离
无 Workspace 绑定的公司级数据：按公司权限仍可访问
```

---

## 7. Settings / 导航信息架构（C3–C4，本轮不编码）

- 「账号与企业」→ **「公司与组织」**  
- 分区：**当前公司** | **当前组织**  
- 顶部：青砚 × 公司品牌（只读）；「当前组织：销售组」单独展示  
- 公司切换入口：**仅** Settings → 公司与组织  
- 组织切换：顶部选择器 **或** Settings；列表仅当前公司 Workspace  

切换按钮：`min-height ≥ 44px`；明确 loading；失败保留当前公司；页面内 Banner（禁止仅 `alert()`）。

---

## 8. 与 PR #17（Phase 3B-A）的依赖关系

| 项 | 关系 |
|---|---|
| PR #17 | Draft；AI 任务闭环（Thread.orgId / Dispatch / Run / Retry）。**本系列不改其代码、不合入其中** |
| 共享约束 | 3B-A 已强制 `AiThread.orgId`、Run / PA 按公司隔离 — 与本架构「公司=租户」一致，应保留 |
| 耦合风险 | 3B-A Preview 依赖「当前公司 = Sunny」；公司切换修好前，FIXED 账号无法自助切到 Sunny（已知） |
| 建议顺序 | #17 完成 Preview / 合入决策 **独立进行**；本 PR 按 C1→C5 推进。合入 main 时避免同一 PR 混改 AI 与租户语义 |
| 后续衔接 | C3 公司切换后必须清空 Assistant Thread / PA / Run 缓存，与 3B-A 前端状态兼容 |

**本轮（C1）明确不做**：DB migration、Prisma generate 业务改动、UI、API 实现、改 #17。

---

## 9. 开发顺序（锁定）

| Commit | 标题 | 内容 |
|---|---|---|
| **C1** | `docs(tenant): lock company and workspace context model` | 本文档 |
| C2 | `feat(tenant): link company branding to tenant organizations` | schema + 迁移脚本 + Context API |
| C3 | `feat(tenant): add controlled company switching` | Settings 公司区、门禁、Logo Provider、缓存清理 |
| C4 | `feat(tenant): add scoped workspace switching` | `activeWorkspace`、Workspace API、组织选择器 |
| C5 | `test(tenant): verify company branding and workspace isolation` | 安全回归 + Preview + 交付记录 |

---

## 10. 测试矩阵（C5 验收提纲）

### 公司

- FIXED 不可切公司  
- MULTI_COMPANY + canSelfSwitch 可切  
- org_owner **不**自动跨公司  
- 非成员 / inactive 拒绝  
- 切换后 workspace 清理或重解析  

### 品牌

- Sunny → Sunny Logo；切梦馨 → 梦馨 Logo  
- 刷新 / 重登保持正确 Logo  
- Workspace 切换不改 Logo；品牌缺失安全 fallback  

### 组织

- 仅见当前公司 Workspace；仅 active membership 可切  
- 不可切他司 Workspace；不改 `activeOrgId`  

### 安全

- body `companyId` / `workspaceId` 不可越权  
- Sunny ↔ 梦馨数据互不可见  
- 公司切换清空 AI Thread / PA / Run 前端缓存  

---

## 11. 决策记录

1. **保留表名 `Organization`**：`orgId` 已渗透业务表；语义层改称公司租户。  
2. **`Company` = 品牌资料**：一对一挂租户；不是第二租户。  
3. **`Workspace` = 组织/小组**：公司内协作边界。  
4. **切换权与角色正交**：沿用并强化 Security-1。  
5. **显式映射 Sunny / 梦馨**：禁止名称模糊匹配。  
6. **独立 Draft PR**：与 #17 解耦交付。

---

## 12. 参考代码位点（现状，C2+ 将替换）

| 位点 | 现状问题 |
|---|---|
| `src/components/co-brand.tsx` | `user?.companies?.[0]` |
| `src/lib/ai/company-context.ts` | `companyIdsJson` |
| `src/app/api/auth/me/route.ts` | 返回 companies 列表供前端取 [0] |
| `src/lib/organizations/org-access.ts` | 正确门禁；语义需包装为 CompanyAccess |
| `src/app/api/auth/switch-org/route.ts` | 兼容入口，C3 委托新服务 |
| `src/lib/org-selection.ts` | 客户端记忆；权威仍在服务端 |

---

**C1 完成定义**：本文档合入独立 Draft PR；评审确认映射与决策表后，方可启动 C2。
