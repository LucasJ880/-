# 青砚权限重设计（岗位制）— 长任务流（Taskflow v1）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-27 |
| 目标 | 把四层并行角色收成"平台管理员 + 企业岗位"两层；一人多岗取并集；设置 / 执行 / 审批分离。设计稿：`docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md` |
| 审批人 | 每个 GATE 由 Claude（chat）审（代码 diff + 测试输出 + 本文验收项），Lucas 拍板合并 |
| 纪律 | 与 `openspec/config.yaml` context 相同：零 schema；敏感 / 出站动作先建 PendingAction；禁止第三套队列；确定性优先；测试注册 |
| 状态列 | `[ ]` 未开始 / `[~]` 进行中 / `[x]` 已合并 / `[G]` 待 GATE。以 `git log --oneline --merges` 为准 |

---

## PERM-1 — 岗位模板与人员绑定（不改业务判定）

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| PERM-1 | Sunny 岗位模板 + Permission Registry 新 key + `scripts/bind-positions.ts` 绑定脚本 + 平台管理员全权解析 | #260 | change `perm-1-positions`；`config/positions/sunny.json`；`docs/QINGYAN_PERM-1_REPORT.md` | [x]（#264；archive 见 `openspec/changes/archive/2026-10-27-perm-1-positions`） |

## PERM-2 — 折扣 / 审批 / 解锁码 / 发送按岗位

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| PERM-2 | 折扣三档（销售上限 / 合价 35% / 老板互审）；折扣表修改走 PendingAction；三处发送出口拦超限未批；成员管理仅平台管理员 | PERM-1 | change `perm-2-discount-by-position`；`docs/QINGYAN_PERM-2_REPORT.md` | [x]（#265；archive 见 `openspec/changes/archive/2026-10-27-perm-2-discount-by-position`） |

## PERM-3 — 出单按品类

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| PERM-3 | 订单 / 工艺单品类归属与出单人过滤（零 schema）；库存改动限运营主管；作废走审批 | PERM-1/2、INSTALL-1 | 任务书 `docs/QINGYAN_PERM-3_FULFILLMENT_BY_CATEGORY_TASKBRIEF.md`；change `perm-3-fulfillment-by-category`；`docs/QINGYAN_PERM-3_REPORT.md` | [x]（#274；archive 见 `openspec/changes/archive/2026-10-28-perm-3-fulfillment-by-category`） |

## PERM-4 — 收口平台角色

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| PERM-4a | 销售模块：`isAdmin` 短路 → `authorize`；签约单改金额走审批（报价行级出单编辑 2026-10-28 拍板移出） | PERM-3 | 任务书 `docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md`；change `perm-4a-sales-authorize`；`docs/QINGYAN_PERM-4a_REPORT.md` | [x]（#279；archive 见 `openspec/changes/archive/2026-10-28-perm-4a-sales-authorize`） |
| PERM-4b | 运营模块：`canManageUsers` → `operations.read / manage`；内容起草 / 批准键（不得自批）；增长中心写 `operations.manage`；平台用户管理仅 super_admin；`/ops` 入口按岗位 | PERM-4a | 同上；change `perm-4b-ops-authorize`；`docs/QINGYAN_PERM-4b_REPORT.md` | [x]（#283；archive 见 `openspec/changes/archive/2026-10-28-perm-4b-ops-authorize`） |
| PERM-4c1 | 项目财务 / 报价引擎按岗位（`project.finance.manage`，`org_admin` 特权 → 岗位键）；会计（`project.finance.read` ORG）进单项目财务页只读；删除 `canManageUsers` | PERM-4b、PERM-5a | 任务书 PERM-4c 段（拍板见"拍板结果 · PERM-4c"）；change `perm-4c1-project-finance`；`docs/QINGYAN_PERM-4c1_REPORT.md` | [x]（#290；archive 见 `openspec/changes/archive/2026-10-28-perm-4c1-project-finance`） |
| PERM-4c2 | 导航 `requiredPermissions` 铺开、`requiredPlatformRoles / NAV_ROLES_*` 只留外贸；默认工作区 / 底栏按岗位（窗饰企业）；管理层 = 老板岗位 | PERM-4c1 | change `perm-4c2-nav-by-position`；`docs/QINGYAN_PERM-4c2_REPORT.md` | [x]（#292；archive 见 `openspec/changes/archive/2026-10-28-perm-4c2-nav-by-position`） |
| PERM-4c3 | 平台角色压扁脚本（数据，先 Sunny，`trade` 不动；写库闸门 `PLATFORM_ROLE_COLLAPSE_READY=false`）；窗饰企业关闭成员角色兼容回退；残留平台角色读点清单 | PERM-4c2 | change `perm-4c3-collapse-platform-roles`；`docs/QINGYAN_PERM-4c3_REPORT.md`；`docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` | [x]（#294；archive 见 `openspec/changes/archive/2026-10-28-perm-4c3-collapse-platform-roles`；写库闸门仍关闭） |
| PERM-4c4 | 残留读点 A 组：AI 工具域 / 能力矩阵 / 晨报 / Muse 范围（决定 B 管理层 = `organization.dashboard.read`）/ AI 上下文客户 / 营销放行按岗位（岗位模式） | PERM-4c3 | 拍板见任务书"拍板结果 · PERM-4c3"；清单 `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` A 组；change `perm-4c4-ai-tools-by-position`；`docs/QINGYAN_PERM-4c4_REPORT.md` | [x]（#296；archive 见 `openspec/changes/archive/2026-10-28-perm-4c4-ai-tools-by-position`） |
| PERM-4c5 | 残留读点 B / C / D1 / D5 + A 组余项（中间件 / 工作台按钮 / dataScope / 开关白名单复核）：任务 / 运营项目 / 招投标交接 / 审批执行 / 管理总览 / 微信推送域按岗位；最后合并者把写库闸门改 true，之后生产执行压扁 | PERM-4c3 | 清单 B / C / D 组；change `perm-4c5-management-reads-by-position`；`docs/QINGYAN_PERM-4c5_REPORT.md`（含视觉方案跨企业泄露修复；写库闸门已打开）（外贸收件人 / revenue-spine 留 PERM-6） | [x]（#298；archive 见 `openspec/changes/archive/2026-10-28-perm-4c5-management-reads-by-position`） |

## INSTALL-1 — 安装工岗位 + 安装任务 + 逐窗拍照收口

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| INSTALL-1 | `installer` 岗位与 5 个 `install.*` 权限键；`/install` 安装任务（只看分配给自己的）与日历；逐窗拍照收口（AuditLog + 私有 Blob）；完成收口推进工艺单 `installed` | PERM-1 | 任务书 `docs/QINGYAN_INSTALL-1_INSTALLER_TASKBRIEF.md`；change `install-1-installer-position`；`docs/QINGYAN_INSTALL-1_REPORT.md` | [x]（#268；archive 见 `openspec/changes/archive/2026-10-27-install-1-installer-position`） |

## INSTALL-2 — 安装结果二分：完工收尾款 + 质保邮件 / 返修单 + 二次安装

方案（2026-10-28 已拍板：质保以报价单为准）：`docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md`；交接 `docs/QINGYAN_INSTALL-2_HANDOFF.md`；邮件模板 `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md`。

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| INSTALL-2a | 收口单元覆盖 ProcessSpec 各段（修零窗单收不了口）；零单元明确 409；收口记录写失败不再假成功 | INSTALL-1 | change `install-2a-closeout-all-lines`；`docs/QINGYAN_INSTALL-2a_REPORT.md` | [G] |
| INSTALL-2b | `install.balance.confirm`；会计「待收尾款」页签；确认尾款 → `completed`；质保邮件 PendingAction + 执行器；`sunnyWarranty` 设置；完工 / 收款 / 发信通知 | INSTALL-2a | change `install-2b-balance-warranty` | [ ] |
| INSTALL-2c | 逐单元完成 / 有问题；维修单（数字化纸质模板 + 打印版）；问题类型查表；返修目标日（默认 +7 天）；`installStage` 推导；出单按品类 / 运营 / 会计 / 销售通知；`/install/repairs` | INSTALL-2a | change `install-2c-repair-form` | [ ] |
| INSTALL-2d | 出单「已出单 + 预计备好日」；安排返修（新预约）；二次安装只收口维修行；按访次聚合 + 照片代理任一访次；关闭后 `installed` 接回 2b；逾期提醒挂既有 cron | INSTALL-2b、2c | change `install-2d-repair-dispatch` | [ ] |

## PERM-5 — 会计视图与数字员工

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| PERM-5a | 会计视图：成交、提成、项目结算与销售分开 | PERM-4a | 任务书 `docs/QINGYAN_PERM-5_ACCOUNTING_DIGITAL_EMPLOYEE_TASKBRIEF.md`；change `perm-5a-accounting-view`；`docs/QINGYAN_PERM-5a_REPORT.md` | [x]（#287；archive 见 `openspec/changes/archive/2026-10-28-perm-5a-accounting-view`） |
| PERM-5b | 数字员工岗位绑定 + 工具授权走 `authorize` | PERM-1 | 任务书 `docs/QINGYAN_PERM-5_ACCOUNTING_DIGITAL_EMPLOYEE_TASKBRIEF.md`；change `perm-5b-digital-employee-positions`；`docs/QINGYAN_PERM-5b_REPORT.md` | [x]（#285；archive 见 `openspec/changes/archive/2026-10-28-perm-5b-digital-employee-positions`） |

## PERM-6 — 外贸按岗位

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| PERM-6a | 外贸三键（`trade.read` / `trade.manage` / `trade.settings.manage`）+ `trade_rep` 模板；`src/app/api/trade/**` 110 处 `requireRole` → `requireTradePermission`（范围仍 `ORG`）；平台 admin 不再隐含外贸（企业解析显式 orgId 只给 super_admin）；消息通道管理按设置键；派生角色 `trade` 档、岗位模式外贸入口认 `trade.read` | PERM-4c5 | 任务书 `docs/QINGYAN_PERM-6_TRADE_TASKBRIEF.md`（拍板见"拍板结果 · PERM-6"）；change `perm-6a-trade-keys`；`docs/QINGYAN_PERM-6a_REPORT.md` | [x]（#300；archive 见 `openspec/changes/archive/2026-10-28-perm-6a-trade-keys`） |
| PERM-6b | 梦馨落岗位：按分工细分外贸岗位与数据范围（按负责人收窄）；绑定文件 | PERM-6a；梦馨人员与邮箱 | change `perm-6b-mengxin-positions` | [ ] |
| PERM-6c | 营收中心按外贸键（平台 sales 不再进）；外贸收件人 / 默认询盘负责人按岗位（`src/lib/trade/recipients.ts`，残留清单 D2–D4）；压扁范围加 `trade`（侧栏外贸布局 / 入职清单补齐，残留清单 F 组） | PERM-6a | 拍板见任务书"拍板结果 · PERM-6c"；change `perm-6c-revenue-and-trade-recipients`；`docs/QINGYAN_PERM-6c_REPORT.md` | [x]（#302；archive 见 `openspec/changes/archive/2026-10-28-perm-6c-revenue-and-trade-recipients`） |

## PERM-7 — owner 在界面上绑岗位

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| PERM-7 | 岗位绑定界面（平台 super_admin 在企业详情页看 / 改成员与数字员工岗位，与脚本共用校验 / 差异 / 审计；最后一个 owner 护栏）；成员增删改只认 super_admin（修正与 spec 不一致） | PERM-6a | 任务书 `docs/QINGYAN_PERM-7_POSITION_BINDING_UI_TASKBRIEF.md`（拍板见"拍板结果 · PERM-7"）；change `perm-7-position-binding-ui`；`docs/QINGYAN_PERM-7_REPORT.md` | [x]（#305；archive 见 `openspec/changes/archive/2026-10-28-perm-7-position-binding-ui`） |
| PERM-7b | AI 工具策略的平台 `admin` 档（派生角色原样透传 admin）；企业列表 / 新建企业等仍认平台 admin 的入口（`requirePlatformAdmin` 其余 10 个文件） | PERM-7 | 待写任务书 | [ ] |

---

## 已决定（2026-10-27，Lucas）

见设计稿 §4（10 条）。摘要：成员与岗位管理只有平台管理员；老板全看全改但敏感操作另一老板审批；平台管理员跨企业全权且审计标记；合价上限 35%；超限未批不能发报价；解锁码老板设、销售用；数字员工绑岗位、永不审批。
