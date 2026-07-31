# Wave 1 PR3 — 代码 / Prisma Client / 数据库版本一致性诊断

**分支：** `stabilization/w1-pr3-version-consistency`  
**基准：** `stabilization/qingyan-wave0` ← `main@2255f8d`  
**探测时间：** 2026-07-31  
**方式：** 只读 SQL / Prisma select；**未** migrate、**未** 改数据、**未** 打印密钥  

---

## 1. 问题描述

核心 API（发布审核队列）曾返回「服务器内部错误」。审计归因怀疑 Schema/Client/DB 不一致（Prisma `P2022`）。

## 2. 调查范围

| 层 | 检查项 |
|---|---|
| 部署代码 tip | `main@2255f8d` schema 含 Phase B/C 字段 |
| Generated Client | `node_modules/.prisma/client` 是否含 `hookText` / `MatrixAccount.groupId` |
| 数据库（production-like host `ep-super-field-*`） | `information_schema` 列 / `to_regclass` 表 / `_prisma_migrations` |
| 运行时查询 | 复现 review API 形状的 `publishJob.findMany` select |

## 3. 探测结果（脱敏）

| 检查 | 结果 |
|---|---|
| DB host class | PRODUCTION_LIKE（`ep-super-field-…`） |
| 最近 migration | 含 `20260729120000_matrix_account_playbook`、`20260729180000_phase_c_publish_job_pipeline` |
| PublishJob Phase C 列 | `hookText`, `contextSnapshotJson`, `riskAssessmentJson`, `idempotencyKey`, `playbookEnforcementMode` **均存在** |
| Phase B/C 表 | `MatrixAccountPlaybook` / `PublishJobStatusEvent` / `MatrixAccountGroup` **存在** |
| Prisma review 形状查询 | **OK** |
| Generated client `hookText` | **true** |
| Generated client `groupId` | **true** |

## 4. 根因（历史 vs 当前）

### 历史根因（已证实于审计会话）

1. 生产 **代码** 已含 Phase B/C Prisma 字段访问。  
2. 当时生产 **数据库** 尚未应用对应 migration → Prisma `P2022`。  
3. `withAuth` 将异常统一映射为 `{ error: "服务器内部错误" }`（500），掩盖真实原因。  

**分类：** 部署时序问题（代码先于 DB），不是业务逻辑 bug，也不是 Generated Client 单独损坏。

### 当前状态（本诊断）

**代码 tip ≈ Generated Client ≈ 生产库结构：一致。**  
复现查询已通过。**不需要** 为绕过错误添加 optional chaining，也 **不需要** 本 PR 执行生产迁移。

## 5. 排除项

| 假说 | 结论 |
|---|---|
| Schema 文件缺失字段 | ❌ tip schema 含字段 |
| Client 未 generate | ❌ 当前 client 含字段 |
| 部署缓存旧 client | NEEDS_VERIFICATION（Vercel 构建日志）；当前本地 generate 正常 |
| DB 缺列（当前） | ❌ 已存在 |
| 静默吞错导致假成功 | 非本问题主因；500 有返回但信息不足 |

## 6. 最小修复（本 PR）

在不改变业务规则的前提下：

- 当捕获 Prisma `P2021`（表不存在）/ `P2022`（列不存在）时，返回 **503** + 明确 `code` + `requestId`，避免误判为普通 500。  
- **不** 降级查询字段、**不** optional chain 绕过、**不** 自动 migrate。

若未来再次出现 P2021/P2022：**暂停**，提交 Migration Plan，等待人工批准后再迁库。

## 7. 未修改范围

- 无 Schema / migration SQL  
- 无生产数据  
- 无审批/报价/权限业务规则  

## 8. 回滚

Revert `api-helpers` 映射即可。

## 9. 剩余风险

- Vercel 若未 `prisma generate` 即用旧 client — 由 build 脚本 `prisma generate && next build` 防护  
- 审计分支 `build` 仍绑定 migrate — 禁止合并（PR2/PR5）  
- 平台 Build Command 被人工改写 — NEEDS_VERIFICATION  

## 10. P0 状态

**P0-05：**  
- 历史事件：确认根因 = 代码/库时序  
- 当前生产 tip：**一致，可关闭为“已缓解”**  
- 本 PR 增加可观测性，降低再次发生时的误诊成本  
