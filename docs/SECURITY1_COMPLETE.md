# Phase Security-1：企业身份锁定与统一权限底座 — COMPLETE

**状态**：COMPLETE  
**合入时间**：2026-07-23  
**Merge SHA**：`55f109a183c742589a0d244c8267fd45e78f2fae`  
**PR**：[#14](https://github.com/LucasJ880/-/pull/14)（merge commit，未 squash）  
**Head（合入前）**：`b55896be0d507ec124ad4b042faddbed937a032b`

## 范围回顾

1. 企业身份锁定：`OrgAccessMode`（FIXED / MULTI_ORG / PLATFORM_SUPPORT）  
2. 左上角只读企业展示；组织切换仅在 `/settings/account`  
3. `org_owner` / `org_admin` 分离；`manager` 平台用户管理风险收敛  
4. Permission Registry + RoleProfile + DataScope + Principal 兼容授权底座  
5. 销售模块接入 `authorize` / `buildAuthorizedWhere`  
6. 终修：纠正误开自助切换；`org.status === "active"` fail closed；`trade ≠ sales_rep`；切换与 AuditLog 同事务  

## Preview UI 验收结论

| 场景 | 结果 |
|---|---|
| Sunny 销售 FIXED（只读左上角、设置无切换、客户隔离） | 通过 |
| Sunny 企业管理员（成员可管、销售 403、无 `/admin/users`） | 通过 |
| Sunny 企业负责人（组织级销售；跨梦馨拒绝） | 通过 |
| 梦馨 trade（无销售读；草稿/Workspace 不串） | 通过 |
| MULTI_ORG（仅设置页切换；AuditLog `org.switch_active`） | 通过 |
| Vercel Preview | SUCCESS |

截图：`docs/security1-screenshots/`  
交付细节：`docs/SECURITY1_AUTHORIZATION_DELIVERY.md`

## 验收账号（专用 QA，可长期保留）

| 用途 | Email | 备注 |
|---|---|---|
| Sunny 负责人 | `security1-owner@test.qingyan.ai` | FIXED + org_owner |
| Sunny 管理员 | `security1-admin@test.qingyan.ai` | FIXED + org_admin；非平台 admin |
| 销售 A | `alex@sunnyshutter.ca` | 仅新增 active Sunny membership；archived Bid Lead **未搬迁历史数据** |
| 销售 B | `security1-sales-b@test.qingyan.ai` | FIXED + sales_rep |
| 梦馨外贸 | `security1-trade@test.qingyan.ai` | FIXED；无 sales_rep |
| 双租户切换 | `security1-multi@test.qingyan.ai` | **专用** MULTI_ORG + `canSelfSwitchOrg=true`；勿给普通员工开启 |

密码（仅 QA）：见准备脚本输出 / 团队密钥库；**不要**把平台 admin 用作普通 MULTI_ORG 测试。

## 回归快照（合入前）

| 项 | 结果 |
|---|---|
| `prisma validate` / `migrate status` | 通过；库 up to date |
| Security-1 专项（org-access / authorize / sales-authz） | 全部通过 |
| Preview API 验收 | 31/31 |
| `tsc --noEmit` | 通过 |
| `next build` | 通过 |
| `./scripts/test-all.sh` | **104/107** |
| `migrate reset --force` | **N/A**（无隔离本地 PG；禁止 wipe 共享 Neon） |

### 三个既有基线失败（据实保留）

1. Image Engine FormData  
2. AI 分类 401  
3. Agent Trace 假 orgId / Reservation FK  

## 明确不做（本阶段结束后）

- **不**自动开始 Security-2  
- **不**自动开始 Phase 3B  
- **不**给普通员工开启 `canSelfSwitchOrg=true`  

## Production Smoke（合入后最小）

合入后在最新 `main` 上复跑 Security-1 专项、`tsc`、`next build`，并对 Sunny / 梦馨做最小冒烟（登录与组织边界）。详见同目录交付报告与验收脚本。
