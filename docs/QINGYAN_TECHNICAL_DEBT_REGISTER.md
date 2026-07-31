# 青砚技术债登记册

**基准：** `80c76e4` | **日期：** 2026-07-31 | **只读**

---

## TD-001 | 工作区分支严重落后生产 tip

- **类型：** 流程 / 配置漂移  
- **证据：** `HEAD=80c76e4`；`main=2255f8d`；merge-base=工作区 HEAD  
- **影响：** 审计/修复打在错误树上；本地 `build` 脚本仍含 migrate  
- **分级：** P0  

## TD-002 | `npm run build` 绑定 `prisma migrate deploy`

- **证据：** 工作区 `package.json` scripts.build  
- **对照：** main tip 已拆出；事故文档在 tip：`INCIDENT_BUILD_TRIGGERED_DATABASE_MIGRATION.md`  
- **影响：** 构建即可能改库  
- **分级：** P0  

## TD-003 | 多 Agent 运行时并存未收敛

- **证据：** `agent` / `agent-core` / `agent-runtime` / `agent-runtime-v2` / `agent-supervisor`  
- **影响：** 重复实现、行为分叉、排障成本  
- **分级：** P2（架构）但可升级为 P1 若继续并行加功能  

## TD-004 | 权限双轨（Security-1 + rbac）

- **证据：** `src/lib/authorization/*` + `src/lib/rbac/*`  
- **分级：** P1  

## TD-005 | 报价三套模型

- **证据：** `SalesQuote`, `ProjectQuote`, Trade quotes  
- **分级：** P1（产品+技术）  

## TD-006 | 审批三套入口

- **证据：** PendingAction / capabilities approvals / orchestrator approvals  
- **分级：** P1  

## TD-007 | Prisma 状态大量用 String

- **证据：** Bid/Pending/Publish 等  
- **影响：** 枚举漂移只能靠测试与约定  
- **分级：** P2  

## TD-008 | API 面过大（500+ routes）且无 GitHub CI

- **证据：** route 计数；无 `.github/workflows`  
- **分级：** P1（质量门禁缺失）  

## TD-009 | Route 层直接打 Prisma

- **证据：** ~98 files 模式计数  
- **分级：** P2  

## TD-010 | 静默 catch

- **证据：** ~27× `catch {}`  
- **分级：** P1/P2 视路径  

## TD-011 | Lint 债务（59 errors）

- **证据：** `npm run lint`  
- **分级：** P2（若升为 CI gate 则变 P1）  

## TD-012 | Build 语法错误（orchestrator approvals）

- **证据：** next build parse error L92  
- **分级：** P0  

## TD-013 | Server Actions 缺失但非债

- **说明：** 全 API 风格一致，反而是可维护性优点；不记为债。  

## TD-014 | 文档与代码双工作树

- **证据：** `青砚` + `青砚-visualizer-templates` worktree  
- **影响：** 易改错目录  
- **分级：** P1 流程债  

## TD-015 | placeholder 字样噪声高

- **证据：** ~549 命中（含 input placeholder）  
- **分级：** P2；需清洗后再评估真实 mock  
