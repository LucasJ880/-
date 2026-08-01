# 青砚 P0 / P1 / P2 风险登记册

**基准：** `80c76e4`（工作区）+ 对照 `main@2255f8d`  
**日期：** 2026-07-31 | **只读** | **未修复**

严重度定义见任务说明书（P0 数据/越权/核心不可用；P1 流程中断；P2 债与非核心）。

---

## P0（必须先处理）

| ID | 摘要 | 依据 | 模块 |
|---|---|---|---|
| P0-01 | 工作区 `npm run build` 含 `prisma migrate deploy`，构建可能改库 | `package.json` L9；对照 tip 已移除 | 发布 / DB |
| P0-02 | 工作区与生产 tip 分支漂移（落后 main），在错误树上开发/审计有二次事故风险 | git merge-base / log | 工程流程 |
| P0-03 | `next build` 失败：orchestrator approvals 路由 `??`/`&&` 语法 | `.../approvals/route.ts:92` | 项目编排 / 构建 |
| P0-04 | 公开 API 前缀依赖「路由内自治」；漏鉴权即为未授权入口 | `middleware.ts` PUBLIC_PATHS | 安全 |
| P0-05 | 代码/Schema 版本不一致时核心页 500（已在发布审核队列实证过 Prisma P2022） | `withAuth` 500；Phase C 列 | 运营发布 / DB 发布纪律 |

**P0 数量：5**（结构性；其中 P0-05 在 tip+已迁库后可降级，但纪律风险仍在）

---

## P1（稳定化主战场）

| ID | 摘要 | 依据 | 模块 |
|---|---|---|---|
| P1-01 | 权限双轨 Security-1 vs rbac | `authorization/*`, `rbac/*` | 权限 |
| P1-02 | 审批三入口（PendingAction / capabilities / orchestrator） | 多 API 与页面 | AI / 审批 |
| P1-03 | 报价三模型（Sales / Project / Trade） | schema + APIs | 销售/项目/外贸 |
| P1-04 | 销售→项目主链耦合弱，流程易人工断裂 | 未见强制 convert 主链 | 业务链 A |
| P1-05 | 审核队列 status 过滤工作区过窄 vs tip | `operations/review/page.tsx` | 运营 |
| P1-06 | Org 歧义导致「按钮无响应」 | `useCurrentOrgId` + banner | 前端/租户 |
| P1-07 | 静默 catch 掩盖后端失败 | ~27 `catch {}` | 多模块 |
| P1-08 | Super admin scope=null 宽读 | `data-scope.ts` | 租户 |
| P1-09 | 无 GitHub Actions，质量门禁靠人工 | 无 `.github/workflows` | CI |
| P1-10 | Lint 59 errors，无法作为可靠门禁 | `npm run lint` | 质量 |
| P1-11 | 双 worktree 协作易改错树 | `.git/worktrees/...` | 流程 |
| P1-12 | PendingAction 执行失败与 UI 成功态不一致风险 | executor + API `ok` | AI |
| P1-13 | 大量 route 未统一 `withAuth` | 224 左右非 withAuth | 安全 |
| P1-14 | 核心链缺少 E2E | test gaps 文档 | 测试 |

**P1 数量：14**

---

## P2（技术债与非核心）

| ID | 摘要 | 模块 |
|---|---|---|
| P2-01 | 多 Agent 运行时未收敛 | AI |
| P2-02 | Route 直访 Prisma 过多 | 架构 |
| P2-03 | Prisma 状态 String 化 | 数据 |
| P2-04 | unused-vars / prefer-const 等 lint 警告债 | 质量 |
| P2-05 | placeholder 文本噪声干扰 mock 排查 | 卫生 |
| P2-06 | 文档型阶段报告繁多，缺单一「系统真相」索引（本轮开始补齐） | 文档 |
| P2-07 | `as any` / ts-ignore 少量残留 | 类型 |
| P2-08 | 性能与包体未测 | 性能 |

**P2 数量：8**（可扩展，非穷尽）

---

## 最危险模块（Top 5）

1. **发布 / 数据库迁移纪律**（build↔migrate 耦合、分支漂移）  
2. **权限与租户**（双轨 + 公开路由 + super admin）  
3. **AI 审批执行**（PendingAction / 多运行时 / 多审批面）  
4. **投标 Bid Data + Orchestrator**（复杂状态机 + 当前 build 破损点）  
5. **销售报价域**（三套报价模型 + 与项目断层）

---

## 统计

| 级别 | 数量 |
|---|---|---|
| P0 | 5 |
| P1 | 14 |
| P2 | 8 |
| **合计登记** | **27** |
