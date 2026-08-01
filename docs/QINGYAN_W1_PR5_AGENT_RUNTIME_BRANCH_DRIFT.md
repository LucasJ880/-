# Wave 1 PR5 — Agent Runtime 实验分支漂移处置

**PR 分支：** `stabilization/w1-pr5-branch-drift`  
**性质：** document-only（本 PR 只新增本文件）  
**纪律：** 不 merge / 不 rebase / 不 cherry-pick `feature/agent-runtime-2-phase1`；不恢复实验树代码  

---

## 0. 结论先行（本次复核）

| 项 | 本次复核状态（2026-08-01） |
|---|---|
| 最新 `origin/main` | `67463d6ffc3b556d06779b9512e3c0044fde88d6`（含 PR #40 merge） |
| `feature/agent-runtime-2-phase1` tip | `80c76e4488eb7b490fe9bd2245c203786803992a` |
| tip 是否为 main 的祖先 | **是** |
| tip 相对 main ahead | **0** |
| tip 相对 main behind | **75** |
| tip 相对 main 的独立提交 | **无**（`git rev-list origin/main..origin/feature/agent-runtime-2-phase1` 为空） |
| 远程是否包含当时本地 dirty/untracked | **远程不可见** — GitHub 分支只承载已推送 commit；不能把历史本机工作区状态当作远程正式内容 |
| 是否允许整体 merge feature → main | **禁止** |
| 推荐开发基准 | **仅** 最新 `origin/main` / 已批准的 `stabilization/*` |

**含义：** 远程实验分支本身没有可合并的新提交；整体合并既无必要，也可能使团队误用过时基准。主要风险来自**审计当时本地未提交 / untracked 工作区**，不是 GitHub 上的独立 commit。

---

## 1. 必须区分的四层事实

| 层 | 说明 | 证据边界 |
|---|---|---|
| A. GitHub 远程已有提交 | `origin/feature/agent-runtime-2-phase1` @ `80c76e4` | 可用 `git fetch` + `rev-list` 证明 |
| B. 审计当时本地 dirty / untracked | 当时工作区中的修改与未跟踪实验树 | **仅历史本地观察**；远程不可见；不得写成“远程分支正式内容” |
| C. 当前 main 已有正式功能 | Phase5 发布安全、公开路由契约、schema-drift 503、SWC 语法防护等 | 以最新 main 为准 |
| D. 尚未进入 main 的实验设计 | Orchestrator / Bid Data 等设想与草稿 | 不因分支名含 “Agent Runtime” 就认定仍有价值 |

本报告**不宣称**实验分支已经“安全合并”或“完成整理”。

---

## 2. 分支关系复核

### 2.1 本次复核状态（2026-08-01）

```text
origin/main                              = 67463d6
origin/feature/agent-runtime-2-phase1    = 80c76e4
merge-base(main, feature)                = 80c76e4  (= feature tip)
feature ahead of main                    = 0
feature behind main                      = 75
feature is ancestor of main              = yes
commits unique to feature                = none
```

### 2.2 审计当时状态（2026-07-31，历史数字，勿冒充当前）

| 项 | 审计当时记录 |
|---|---|
| 对比基准 main | `2255f8d` |
| feature tip | `80c76e4`（与本次相同 tip） |
| feature 独有 commit | 0（已是当时 main 的祖先） |
| main 相对 feature 超前 | **61** commits（历史数字） |
| 主风险描述 | 大量**本地未提交修改 + 未跟踪实验树**（非已推送 commit） |

> 审计当时 behind=61；本次复核 behind=75。差异来自此后合入 main 的稳定化 PR（含 Wave0/#41/#42/#43/#40 等），不是 feature 新增了提交。

---

## 3. 处置结论（强制）

1. **禁止**整体 merge `feature/agent-runtime-2-phase1`。  
2. **禁止**以该分支为新功能开发基准。  
3. **禁止**从该分支复制 `package.json`、migration 或构建配置到 tip。  
4. 需要恢复的产品需求，必须从**最新 main** 重新设计和实现。  
5. 每项恢复内容都必须有独立需求、范围、测试和 PR。  
6. **不得**因分支名称包含 Agent Runtime 就认定全部内容仍有价值。  
7. **不得**宣称实验分支已“安全合并”或“完成整理”。  
8. **不得**把历史本机 dirty/untracked 文件当作远程分支可合并资产。

---

## 4. 审计当时观察到的本地风险面（历史；远程不可见）

以下条目来自 **2026-07-31 审计当时** 对本机工作区的观察，**不是** GitHub `feature/agent-runtime-2-phase1` tip 的正式 tree 内容。

### 4.1 危险配置（类别：数据/发布风险）

| 路径（历史本地） | 说明 | 处置 |
|---|---|---|
| feature 工作区 `package.json` `build` | 曾见 `prisma migrate deploy` 绑在 build | **禁止移植**；以当前 main 的 build/migrate 分离为准 |

### 4.2 已安全带入稳定化流程的审计文档（类别：已完成）

Wave0 已将批准的 `docs/QINGYAN_*.md` 审计报告带入稳定化基线。勿再从实验工作区复制其它 docs。

### 4.3 Project Orchestrator / Bid Data 实验树（类别：继续隔离）

审计当时未跟踪示例（远程不可见）：

- `src/lib/project-orchestrator/**`
- `src/lib/project-bid-data/**`
- `src/app/api/projects/[id]/orchestrator/**`（曾含非法 `??`/`&&` 混用）
- `src/app/api/projects/[id]/bid-data/**`
- 对应 migration 草稿与大量 gate 文档

**与当前 main：** tip 不以该实验树为正式产品面；相关能力若要恢复，必须从最新 main 重做（属未批准的 Wave2 / 独立需求），禁止 merge feature。

### 4.4 其它历史本地脏文件（类别：隔离 / 人工决定）

如当时所见的脏 `prisma/schema.prisma`、`vercel.json`、局部 pending-actions 修改等——一律不得整包覆盖 tip；若有价值，只能在批准后从 main 开独立 PR 重做或选择性评估。

---

## 5. 分类汇总（处置动作）

| 类别 | 内容 | 动作 |
|---|---|---|
| 远程无独立提交 | feature tip 已是 main 祖先 | 无需 / 不应 merge |
| main 已有 | 稳定化、发布安全、契约测试等 | 以 tip 继续开发 |
| 历史本地实验树 | Orchestrator / Bid Data 等 | 继续隔离；要则 main 上重做 |
| 危险配置 / 脏 schema / 旧 migration | 历史本地观察 | **禁止进入 tip** |
| 名称含 Agent Runtime | 不等于仍有产品价值 | 逐项需求评估，禁止整包假设 |

---

## 6. 明确禁止的操作

1. `git merge feature/agent-runtime-2-phase1` → main  
2. 以 feature 为 rebase / 开发起点  
3. 从 feature 复制 `package.json`、migration、构建配置  
4. 将历史未跟踪 `project-orchestrator` / `project-bid-data` 一次性提交进 tip  
5. 宣称实验分支已整理完毕或可安全合并  

---

## 7. P0 状态

**P0-02（分支漂移）：关闭为「已处置（流程）」** — 基准切换到最新 main；实验树继续隔离；禁止整体合并已记录。  

本 PR **不**恢复实验代码，**不**进入 Wave2，**不**完成 Approval Consolidation。

---

## 8. 证据保留

- 远程分支 tip `80c76e4` 可继续保留作历史指针；本报告**未**对其执行 reset/delete。  
- 历史本机审计工作区若仍存在，仅作证据，不得当作合入来源。  
- 本文件是 Wave1 对漂移处置的权威 document-only 记录。  
