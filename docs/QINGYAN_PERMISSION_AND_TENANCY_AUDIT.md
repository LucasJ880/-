# 青砚权限与多租户审计

**基准：** `80c76e4` | **日期：** 2026-07-31 | **只读**

---

## 1. 控制面组成

| 层 | 文件 | 职责 |
|---|---|---|
| Edge | `src/middleware.ts` | 仅验证 JWT；公开路径白名单 |
| API Auth | `withAuth` / `getCurrentUser` | 登录与 active 状态 |
| Org Context | `active-org`, sales/assistant/operations resolvers | 选定 `orgId` |
| Security-1 | `src/lib/authorization/*` | permission keys + authorize + where 编译 |
| Legacy RBAC | `src/lib/rbac/*` | role → dataScope / capabilities |
| 域内守卫 | bid-data `access.ts`, marketing `team.ts`, trade `access.ts` 等 | 细粒度 |

---

## 2. 做得好的部分（有代码依据）

1. **销售 API org 收紧：** `orgBoundaryClause` 不再容忍 `orgId: null`（`data-scope.ts` 注释 A2-3）。  
2. **PendingAction 跨组织 fail-closed：** `executor.ts` 比较 `action.orgId` / `metadata.orgId` / `ctx.orgId`；API `canConfirmPendingActionInActiveOrg`。  
3. **Security-1 销售授权测试存在且通过：** `security1-sales-authz.test.ts`。  
4. **Bid lock 权限：** `resolveBidDataAccess` → `canLock`。  
5. **授权单元测试：** `authorize.test.ts`（DIGITAL_EMPLOYEE fail-closed）。

---

## 3. 风险发现

### PERM-001 | Middleware 公开前缀依赖路由内自治（P0/P1）

`PUBLIC_PATHS` 含：

- `/api/cron`
- `/api/v1`
- `/api/operations/worker`
- `/api/trade/webhook`
- `/api/webhooks/*`
- `/api/messaging/wecom/callback`
- share/token 类

**风险：** 任一子路由若忘记校验 `CRON_SECRET` / Bearer / 签名，即成未授权入口。  
**分级：** 对每个公开路由应单独审计；整体模式标 **P0 关注**，单点未证实漏洞标 **NEEDS_VERIFICATION**。

### PERM-002 | Super Admin 跨组织 scope=null（P1）

`salesCreatedScope` / `salesAssignableScope`：`isPlatformSuperAdmin` → `null`（不加 org 过滤）。  
若调用方漏传其它约束，可致跨租户读取。  
依据：`src/lib/rbac/data-scope.ts`。

### PERM-003 | 权限双轨不一致（P1）

- 新：`sales.customer.read` 等 registry（`permissions.ts`）  
- 旧：role 字符串 + `canSeeResource`（executor）  

同一用户在销售 API 与 PendingAction 执行路径可能得到不同结论。

### PERM-004 | 大量 Route 未使用 `withAuth`（P1）

约 526 routes 中 ~302 使用 `withAuth`。其余包含：

- 合法：share token、cron、webhook、auth login  
- 可疑：部分 `organizations/*`, `audit-logs/*`, `suppliers/*`, `capabilities/*` 使用自建鉴权  

**需逐文件确认** — 批量标 **NEEDS_VERIFICATION**，不臆测已越权。

### PERM-005 | Audit 覆盖非强制（P1/P2）

`writeAuditLog` 存在，但并非所有 mutation 强制调用。  
PendingAction / Bid lock 有审计；销售部分路径 **NEEDS_VERIFICATION** 覆盖率。

### PERM-006 | 工作区 vs 生产 tip 权限代码漂移（P0 流程风险）

生产 tip 含 Phase B/C playbook 强制策略；工作区落后。在错误分支上做权限修复会误判。

---

## 4. 组织隔离检查清单（抽样）

| 模块 | orgId 过滤 | 证据 |
|---|---|---|
| Sales customers | 有 | `where: { id, orgId: orgRes.orgId }` |
| Sales opportunities | 有 | `resolveSalesAuthorizedWhere` |
| PendingAction confirm | 有 | thread-org + membership |
| Bid Data | 经 project membership / access | `resolveBidDataAccess`；revision 以 projectId 为界（org 经 project） |
| Publish jobs | orgId（tip） | 工作区实现可能旧 |
| Platform super admin | 故意跨 org | data-scope |

---

## 5. 结论

- **存在权限/组织隔离风险：是（结构性）。**  
- **未在本轮证明具体可利用的 IDOR 漏洞**（未做动态攻击测试）→ 具体 CVE 式结论标 NEEDS_VERIFICATION。  
- 最大现实风险：公开路由漏鉴权 + 双轨权限 + super admin 宽 scope + 分支漂移。
