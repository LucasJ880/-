# 青砚稳定化方案（Stabilization Plan）

**角色：** Acting CTO  
**阶段：** 只读审计完成 → **暂停，待批准后进入修复**  
**日期：** 2026-07-31  

---

## 1. 总原则

1. **先统一基准树，再改代码。** 禁止在落后的 `feature/agent-runtime-2-phase1@80c76e4` 上直接堆修复。  
2. **先止血发布纪律，再修功能。**  
3. **先收敛概念（审批/报价/权限），再加功能。**  
4. **每个修复 PR 必须可回滚、带测试、不碰未批准的 Schema。**  
5. **生产 migrate 继续受控**（confirm env）；禁止 build 触发 migrate。

---

## 2. 是否适合继续开发新功能？

**结论：不适合。**  

理由：工作区不可可靠构建；与生产 tip 漂移；P0 发布/安全纪律未闭合；核心链缺 E2E；概念重复会让新功能继续分叉。

**允许的例外（需产品批准）：** 生产热修（仅 tip）、文档、测试门禁、明确的 P0 语法修复。

---

## 3. 推荐修复顺序

### Wave 0 — 基准与门禁（1–2 天）

1. 选定 **唯一开发基准**：`main@2255f8d`（或更新 tip）。  
2. 冻结/归档落后 feature 分支策略（合并或废弃 — **产品+工程批准**）。  
3. 确认工作区与 worktree 使用规范（只在一个树改代码）。  
4. 加入最小 CI（即使先本地脚本）：`prisma validate` + `tsc` + `next build`（无 migrate）+ 关键单测。  
5. 确认 tip 上 `build` 已无 migrate；扫描所有环境变量与 Vercel build 命令。

### Wave 1 — P0 止血（2–4 天）

| PR | 内容 | 验收 |
|---|---|---|
| PR-S1 | 修复 orchestrator approvals 语法使 `next build` 通过 | build green |
| PR-S2 | 公开路由鉴权审计清单 + 缺省 fail-closed 补丁（逐条） | 清单签字；关键 cron/webhook 单测 |
| PR-S3 | 发布纪律复核：Vercel/package 无自动 migrate；文档 runbook 置顶 | 安全检查脚本 PASS |
| PR-S4 | 分支对齐：工作区快进/rebase 到 tip 或切换工作区 | `git merge-base` = tip |

### Wave 2 — P1 流程稳定（1–2 周）

| PR | 内容 |
|---|---|
| PR-S5 | 审批入口收敛方案（产品批准后）：Inbox PendingAction 为唯一用户确认主路径；其它入口只读或深链 |
| PR-S6 | 权限读取路径统一：新 API 强制 Security-1；标注 rbac 遗留 |
| PR-S7 | 销售→项目「最小闭环」：定义官方转换动作（或明确不做并改产品文案） |
| PR-S8 | 消除高危静默 catch（签约/分享/pending 路径） |
| PR-S9 | 审核队列与 PublishJob 状态枚举前后端单一来源 |
| PR-S10 | Org 歧义 UX：禁用 CTA + 明确文案（避免「按钮坏了」） |

### Wave 3 — 结构性收敛（2–4 周，可并行调研）

1. 报价对象收敛设计（Sales vs Project vs Trade）— **必须产品批准**  
2. Agent 运行时收敛设计（保留 v2 + 明确 supervisor 边界）  
3. E2E 烟雾：链 A/B/C/D 各 1 条  
4. Lint 清零或基线冻结  

### Wave 4 — 再开新功能门禁

满足：

- [ ] tip 构建绿  
- [ ] P0 清零或接受残留并签字  
- [ ] 链 B lock / 链 C approve / 链 D switch-org 有自动化保护  
- [ ] 产品批准报价/审批收敛方向  

---

## 4. 第一批建议建立的修复 PR

> 未经批准不得开做；以下为建议切片。

1. **`fix(build): parenthesize orchestrator approvals nullish coalescing`**  
2. **`fix(release): ensure build never runs migrate deploy on all branches`**  
3. **`chore(repo): align workspace to main tip / document worktree policy`**  
4. **`security(audit): cron/webhook/v1 auth contract tests`**  
5. **`fix(ops-review): unify publish job status filter with server enums`**（在 tip 上）  
6. **`refactor(errors): remove silent catch on quote sign / pending paths`**  

---

## 5. 必须由产品负责人批准的决策

1. **开发基准分支**与落后 feature 分支去留。  
2. **是否暂停一切新功能**至 Wave 1 完成（CTO 建议：是）。  
3. **报价唯一真相**：SalesQuote vs ProjectQuote vs Trade。  
4. **用户确认唯一入口**：PendingAction vs Capabilities vs Orchestrator。  
5. **销售签约后是否自动建项目**（链 A 产品定义）。  
6. **Super admin 跨组织**是否保持；审计要求。  
7. **生产 migrate / 密码轮换**任何进一步动作。  
8. **公开分享链接**（报价/visualizer）的安全与品牌风险接受度。  

---

## 6. 明确不做（本阶段）

- 不改业务代码（至批准）  
- 不改 Schema / 不建迁移  
- 不进 Phase D / 不扩运营矩阵功能  
- 不为让检查通过而加 `any` / `ts-ignore` / mock  

---

## 7. 成功指标（稳定化完成定义）

| 指标 | 目标 |
|---|---|
| `next build`（无 migrate） | 绿 |
| P0 开放项 | 0（或签字接受） |
| 核心链 E2E | A/B/C/D 各 ≥1 条常青 |
| 审批入口 | 产品文档定义的单一主路径 |
| 分支 | 单一活跃开发 tip |
| CI | 至少 PR 级 build+单测 |

---

## 8. 暂停声明

**审计阶段结束。等待你明确批准后，方可进入修复阶段。**
