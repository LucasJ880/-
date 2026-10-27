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
| PERM-1 | Sunny 岗位模板 + Permission Registry 新 key + `scripts/bind-positions.ts` 绑定脚本 + 平台管理员全权解析 | #260 | change `perm-1-positions`；`config/positions/sunny.json`；`docs/QINGYAN_PERM-1_REPORT.md` | [x]（#264，待 archive） |

## PERM-2 — 折扣 / 审批 / 解锁码 / 发送按岗位

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| PERM-2 | 折扣三档（销售上限 / 合价 35% / 老板互审）；折扣表修改走 PendingAction；三处发送出口拦超限未批；成员管理仅平台管理员 | PERM-1 | change `perm-2-discount-by-position`；`docs/QINGYAN_PERM-2_REPORT.md` | [G] |

## PERM-3 — 出单按品类

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| PERM-3 | 订单 / 工艺单品类归属与出单人过滤（零 schema）；库存改动限运营主管 | PERM-1 | 待写任务书 | [ ] |

## PERM-4 — 收口平台角色

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| PERM-4a | 销售模块：`withAuth` 角色字符串判定 → `authorize` | PERM-2 | 待写 | [ ] |
| PERM-4b | 运营模块：同上，`canManageUsers` 捆绑的运营配置接口转 `ops_lead` | PERM-4a | 待写 | [ ] |
| PERM-4c | 招投标模块 + 导航 / 默认工作区按岗位 | PERM-4b | 待写 | [ ] |

## INSTALL-1 — 安装工岗位 + 安装任务 + 逐窗拍照收口

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| INSTALL-1 | `installer` 岗位与 5 个 `install.*` 权限键；`/install` 安装任务（只看分配给自己的）与日历；逐窗拍照收口（AuditLog + 私有 Blob）；完成收口推进工艺单 `installed` | PERM-1 | 任务书 `docs/QINGYAN_INSTALL-1_INSTALLER_TASKBRIEF.md`；change `install-1-installer-position` | [ ] |

## PERM-5 — 会计视图与数字员工

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| PERM-5a | 会计视图：成交、提成、项目结算与销售分开 | PERM-4a | 待写 | [ ] |
| PERM-5b | 数字员工岗位绑定 + 工具授权走 `authorize` | PERM-4c | 待写 | [ ] |

---

## 已决定（2026-10-27，Lucas）

见设计稿 §4（10 条）。摘要：成员与岗位管理只有平台管理员；老板全看全改但敏感操作另一老板审批；平台管理员跨企业全权且审计标记；合价上限 35%；超限未批不能发报价；解锁码老板设、销售用；数字员工绑岗位、永不审批。
