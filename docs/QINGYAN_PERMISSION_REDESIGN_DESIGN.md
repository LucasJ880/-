# 青砚权限重设计 — 岗位制（Design v1）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-27 |
| 决策人 | Lucas（平台管理员 / Sunny 老板） |
| 适用企业 | Sunny（本稿）；梦馨沿用同一框架，岗位另定 |
| 目标 | 把现在并行的四层角色收成"平台管理员 + 企业岗位"两层；一人多岗取并集；设置权 / 执行权 / 审批权分开 |
| 纪律 | 零 schema（岗位与绑定复用 Security-1 已有的 RoleProfile / PrincipalRoleBinding，不加表不加字段）；出站与敏感操作先审批（复用 PendingAction）；确定性优先 |

---

## 1. 现状：四层角色并行（为什么要重设计）

| 层 | 字段 | 现在决定什么 | 问题 |
|---|---|---|---|
| 平台角色 | `User.role`（super_admin / admin / boss / manager / operations / sales / trade / user） | 导航可见、默认工作区、谁能管账号、admin 免折扣审批 | 本意是导航分流，却渗入业务判定："sales" 出现在 84 个文件，"admin" 129 个 |
| 企业角色 | `OrganizationMember.role`（org_owner / org_admin / org_member / org_viewer） | 成员与配置、折扣设置页、管理工作区 | 只允许一个 org_owner，Sunny 有 4 个老板；org_admin 在旧模块里等于全部业务数据 |
| 岗位（Security-1） | `RoleProfile` + `PrincipalRoleBinding` | 销售数据范围、运营、招投标交接 | 已建表、已有 8 个系统模板，但只接入 2 处（报价详情、销售上下文），绑定基本没启用 |
| 项目角色 | `ProjectMember.role` | 单项目预算 / 费用 / 审核 / 付款 | 本身合理，保留 |

判定入口不统一：673 个 API 路由里 303 个用 `withAuth` 自判，22 个平台管理员守卫，11 个走企业角色权限表，Security-1 `authorize` 仅 2 处。同一人在不同接口可能得到不同答案（见 `docs/QINGYAN_PERMISSION_AND_TENANCY_AUDIT.md` PERM-003）。

---

## 2. 目标模型

### 2.1 两层主体

| 层 | 值 | 说明 |
|---|---|---|
| 平台 | `platform_admin`（即 super_admin）/ `user` | 平台管理员跨企业全权，所有动作审计标记"平台管理员操作"；敏感操作可直批但记"自批"。其余人一律 `user`，业务能力全部由岗位决定 |
| 企业岗位 | RoleProfile（下表） | 一人可绑多个岗位，权限取并集；数据范围取最宽者 |

`OrganizationMember.role` 退化为成员资格标记（active / inactive），`org_owner` 只保留一条给兜底账号，不再承载业务权限。

### 2.2 数据范围三档

| 档 | 含义 | 适用 |
|---|---|---|
| PRINCIPAL | 本人创建 / 分配 | 销售 |
| ORG | 全企业 | 老板、合价、会计、运营、招投标 |
| CATEGORY | 按产品品类（订单 / 工艺单） | 出单岗位（第三阶段实现，需订单行品类归属） |

### 2.3 设置 / 执行 / 审批分离

| 能力 | 谁 |
|---|---|
| 改折扣表、费用、税率、解锁码 | 老板岗（走审批） |
| 给折扣 ≤ 销售上限（promoMaxPct） | 销售、合价 |
| 给折扣 ≤ 合价上限 35% | 合价（不需审批，留痕） |
| 给折扣 > 35% | 合价或老板提交，**另一位老板**批准 |
| 审批 | 老板岗；平台管理员可直批 |

---

## 3. Sunny 岗位 × 职责矩阵

| 岗位 key | 名称 | 人 | 能做 | 范围 | 不能做 |
|---|---|---|---|---|---|
| `owner` | 老板 | Bob, Bill, Miki, Lucas | 看全部业务与审计；审批超限折扣与敏感操作；改折扣表 / 费用 / 解锁码（提交后由另一老板批）；看运营过程与结果 | ORG | 加人删人换岗（只有平台管理员）；敏感操作自批 |
| `sales_rep` | 销售 | Alex, Lynn | 建客户、建报价、建订单；折扣到销售上限；发报价给客户；在单据上输入定金解锁码 | PRINCIPAL | 看同事客户与报价；超上限折扣；改订单出单细节 |
| `pricing_lead` | 销售合价 | Miki | 看全部报价；关合价；给折扣到 35%；超 35% 提交审批；发报价给客户 | ORG（报价、客户只读） | 改折扣表；自批 |
| `ops_lead` | 运营主管 | Marty | 运营任务、品牌内容、营销计划、矩阵账号、内容发布；面料库存增减与盘点 | ORG（运营） | 销售报价与客户 |
| `ops_staff` | 运营 | Maggie | 运营任务执行、内容起草 | ORG（运营，编辑） | 库存改动；发布审批 |
| `accounting` | 会计 | Miki | 看成交金额、提成、报价全过程；项目费用审核与付款记录；项目单独结算 | ORG 只读 + 项目财务 | 改报价、改折扣 |
| `bids` | 招投标 | Bill, Lucas, 蒋晨 | 投标项目全流程；中标交接到执行 | 招投标工作区 | 销售区 |
| `fulfillment_vinyl` | 出单·Vinyl | Bill | 该品类订单与工艺单修改、状态推进 | CATEGORY=vinyl | 其他品类 |
| `fulfillment_drapery` | 出单·布帘 | 蒋晨（中国）, Bob（加拿大） | 同上 | CATEGORY=drapery（+ 产地） | 其他品类 |
| `fulfillment_shades` | 出单·Roller/Zebra/Roman | 小叶 | 同上 | CATEGORY=roller, zebra, roman_shade | 其他品类 |
| `installer` | 安装工 | （待定） | 看分配给自己的安装任务与日历；开始 / 完成安装；按工艺单逐窗拍照收口 | ASSIGNED（只有分配给本人的任务） | 销售、报价、客户列表；他人任务；安排 / 改派安装 |
| （平台）`platform_admin` | 平台管理员 | Lucas | 两家企业账号、模块、运维；成员管理与岗位分配；跨企业全权 | 跨企业 | — |

一人多岗实际绑定：Miki = owner + pricing_lead + accounting；Bill = owner + bids + fulfillment_vinyl；Bob = owner + fulfillment_drapery；Lucas = platform_admin（平台）+ owner + bids。

---

## 4. 已决定（2026-10-27，Lucas）

1. **管理面**：加人、删人、换岗位只有平台管理员（Lucas）。老板岗不带管理面；Sunny 不设"企业管理员"岗。
2. **老板**：全看全改，但敏感操作走审批留痕。敏感操作清单：改折扣表 / 费用 / 税率 / 解锁码、给 > 35% 折扣、改已成交订单金额、作废订单、删除客户。提交人与审批人必须是不同的老板。
3. **平台管理员**：在客户企业里全权，不需另绑岗位；审计标记；敏感操作可直批并记"自批"。与 Security-1 原则"平台身份不带业务授权"相反，改造时删该限制。
4. **报价发送**：销售本人和合价人可发；超限折扣未批之前不能发（mark-sent / send-email / share 一律拦）。
5. **定金解锁码**：老板岗设置（走审批）；销售在单据上输入使用。
6. **合价上限**：Miki 不经审批最多 35%；再高走老板审批。
7. **订单与出单**：订单由销售建立；每个品类由出单人负责修改；面料库存由运营主管定。
8. **会计**：看成交金额、提成、报价全过程；招投标中会计只是参与方，知道价格即可；项目单独结算，与销售分开。
9. **运营**：运营维护，老板只看过程和结果，不逐次审批。
10. **AI**：助手模式权限完全等于操作者；数字员工是独立主体，绑定岗位（销售数字员工→sales_rep、营销→ops_staff、投标→bids、数据分析→accounting 只读），永不审批、不改设置、不给折扣，对外动作必须该岗位的人审批，审计标"数字员工 X 代 岗位 Y"。

---

## 5. 现有代码必须改的冲突

| # | 冲突 | 位置 | 处理 |
|---|---|---|---|
| C1 | 只允许一个 org_owner | `src/app/api/organizations/[orgId]/members/[memberId]/route.ts` 唯一 owner 保护 | 老板做成岗位 `owner`；org_owner 只留兜底 |
| C2 | 折扣设置只认 org_owner | `src/lib/blinds/discount-permissions.ts` | 改为岗位 `owner` + 走审批 |
| C3 | 平台 admin 绕过折扣审批 | `src/app/api/sales/quotes/route.ts` 231-242、288；`[quoteId]/route.ts` 209、434 | 删除 `isAdmin` 直批；平台管理员直批走审批记录"自批" |
| C4 | org_admin 在旧模块等于全权 | `src/lib/marketing/access-policy.ts`、`src/lib/quote-engine/access.ts`、`src/lib/agent-scope/resolve.ts` | 改岗位判定 |
| C5 | boss 捆绑运营配置接口 | `canManageUsers` 在 `src/app/api/operations/**`（内容计划、品牌档案、矩阵账号、postiz、视频资产） | 转 `ops_lead` |
| C6 | 出单按品类无机制 | 订单 / 工艺单无品类归属与出单人 | 第三阶段：订单行品类归属（settingsJson / 现有字段推导，零 schema） |
| C7 | 成员管理 org_admin 可做 | `requireOrgRole(request, orgId, "org_admin")` | 改为仅平台管理员 |
| C8 | 数字员工 fail-closed | `src/lib/authorization/resolve-effective-permissions.ts`（`principal.type !== "HUMAN"` 直接返回空） | 读 DIGITAL_EMPLOYEE 的岗位绑定 |
| C9 | AI 工具授权按企业角色 / 工作区角色 | `src/lib/tenancy/tool-auth.ts` | 改走 `authorize` |

---

## 6. 分阶段

| 阶段 | 内容 | 代码量 | 任务书 |
|---|---|---|---|
| PERM-1 | Sunny 岗位模板 + 人员绑定脚本（仅平台管理员可跑）；销售"只看本人"启用 | 小（模板常量 + 脚本） | `QINGYAN_PERM-1-2_POSITIONS_DISCOUNT_TASKBRIEF.md` |
| PERM-2 | 折扣表 / 超限审批 / 解锁码 / 报价发送按岗位；删 admin 直批；加合价上限 35%；成员管理仅平台管理员 | 中（1 个 change） | 同上 |
| PERM-3 | 出单按品类：订单与工艺单品类归属与出单人过滤；库存改动限运营主管；作废走审批 | 中 | `QINGYAN_PERM-3_FULFILLMENT_BY_CATEGORY_TASKBRIEF.md` |
| PERM-4 | 收口平台角色：导航 / 默认工作区 / 各模块角色字符串判定逐模块换 `authorize`（顺序：销售 → 运营 → 招投标）；平台角色压扁为 user（数据脚本） | 大，分 3 个 change | `QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md` |
| PERM-5 | 会计视图（成交、提成、项目结算与销售分开）；数字员工岗位绑定与工具授权 | 中，分 2 个 change | `QINGYAN_PERM-5_ACCOUNTING_DIGITAL_EMPLOYEE_TASKBRIEF.md` |
| INSTALL-1 | 安装工岗位；安装任务只看自己的 + 日历；逐窗拍照收口（Appointment + AuditLog + 私有 Blob，零 schema） | 中 | `QINGYAN_INSTALL-1_INSTALLER_TASKBRIEF.md` |

决定（2026-10-27 追加，Lucas）：11. 新增岗位"安装工"，只看分配给自己的安装任务，日历显示安装时间，按工艺单逐窗拍照上传用于收口。12. 可以安排安装（指定安装工与时间）的人由运营和会计决定：`install.task.assign` 给运营主管、会计（老板保留）；出单岗与基础运营不能安排安装。

每阶段一个 change（`/opsx:propose`），GATE 审核项含 `openspec validate` 与 specs 增量覆盖全部对外行为变化。
