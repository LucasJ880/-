# 青砚测试覆盖缺口

**基准：** `80c76e4` | **日期：** 2026-07-31 | **只读**

---

## 1. 本轮执行的静态验证

| 命令 | 结果 | 错误数 | 阻塞生产？ | 模块 |
|---|---|---|---|---|
| `npx prisma validate` | PASS | 0 | 否 | Prisma |
| `npm run lint` | FAIL | **59 errors**, 111 warnings | 视门禁策略；当前无 CI 强制 | 全仓，含 trade prefer-const 等 |
| `npx tsc --noEmit` | src **0**；若含 `.next/types` ~95 | `.next` 路由类型噪声 | 否（src 干净） | Next 生成类型 |
| `npx prisma generate && npx next build`（**故意不含 migrate**） | FAIL | 1 parse error | **是（本分支不可构建）** | orchestrator approvals route |
| `npm run build`（工作区脚本） | **未执行** | — | 脚本含 `migrate deploy`，禁止在审计中对不明库执行 | 发布安全 |
| 关键单测抽样 6 项 | PASS 6/6 | 0 | 否 | authz/org/pending/bid/sales |
| 全量 `npm test` / `test-all.sh` | **未完整跑完**（耗时；抽样代替） | — | NEEDS_VERIFICATION 全量现状 | — |
| E2E Playwright | 未跑 | — | 无默认 CI | — |
| GitHub Actions | 不存在 | — | 无自动门禁 | CI |

### Build 关键错误

```
src/app/api/projects/[id]/orchestrator/workflows/[rootTaskId]/approvals/route.ts:92
Nullish coalescing operator(??) requires parens when mixing with logical operators
```

### Lint 关键错误（示例）

- `src/lib/trade/intelligence-service.ts` — `prefer-const` error  
- `src/lib/trade/research-service.ts` — `prefer-const` error  
- 大量 unused-vars warnings  

---

## 2. 现有测试资产

- 约 **146** 个 `*.test.ts` / 相关脚本（src+scripts 计数）  
- 入口：`scripts/test-all.sh`（逻辑测试 + 可选 `--api`）  
- 强项：agent-runtime-v2、assistant policy、bid-data phase4、security-1 单测、messaging crypto  
- 弱项：浏览器 E2E、跨模块业务链、API 集成默认不跑（需 COOKIE/BASE_URL）

---

## 3. 核心链覆盖矩阵

| 业务链 | 单测 | API 集成 | E2E | 能否保护核心流程 |
|---|---|---|---|---|
| A 销售→项目→任务→文件 | 部分（authz/org） | 弱 | 无 | **否** |
| B Bid Data | 较强（phase4a*） | 弱 | 无 | **部分**（状态机/锁） |
| C PendingAction | 中（bridge/gmail/org） | 脚本 verify | 无 | **部分** |
| D 登录/组织/审计 | 中（authorize/org） | 弱 | 无 | **部分** |
| 发布审核 | tip 有 staging 脚本；工作区弱 | 弱 | 无 | **否**（分支漂移） |

**总判：** 当前测试 **不能** 充分保护端到端核心流程；可保护若干纯逻辑与权限单元。

---

## 4. 优先级缺口（建议建立的测试，修复阶段再做）

### P0 级保护
1. Build 门禁：`next build` 无 migrate；PR 必过  
2. 公开路由鉴权契约测试（cron/webhook/v1）  
3. PendingAction 跨 org 拒绝 + 重复 approve  

### P1 级保护
4. Sales：创建客户→商机→报价 最小 API 流  
5. Bid：submit→approve tech/fin→lock 冲突用例  
6. 审核队列 status 过滤与 schema 列存在性烟雾  

### P2 级保护
7. Playwright 烟雾（login+选组织+打开销售/项目）  
8. 全量 test-all 纳入 CI  

---

## 5. 与生产 tip 差异对测试的影响

工作区落后 `main`：即使本地 test 全绿，也 **不能** 代表生产 tip（Phase B/C、safe-migrate）的质量。稳定化前应先统一审计/开发基准分支。
