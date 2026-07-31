# Wave 1 PR1 — SWC 空值合并 / 逻辑运算混用回归防护

**分支：** `stabilization/w1-pr1-approvals-build`  
**基准：** 最新 `origin/main`（含 PR #43 merge `0188e07`）  
**日期：** 2026-07-31 / 2026-08-01 rebase  

---

## 1. 问题描述

审计时在工作区执行 `next build` 曾失败：

```
src/app/api/projects/[id]/orchestrator/workflows/[rootTaskId]/approvals/route.ts:92
Nullish coalescing operator(??) requires parens when mixing with logical operators
```

## 2. 根因与边界澄清

危险写法（`??` 与 `&&` / `||` 混用且无括号），例如：

```ts
preview.question ?? preview.contextSnapshot && (preview.contextSnapshot as { title?: string }).title ?? r.actionType
```

**定位结论：**

- 该语法失败来自审计时工作区中的**未提交 / 实验代码**（`feature/agent-runtime-2-phase1` 侧），**不是**当前 `main` tip 上已合入的审批业务代码缺陷。  
- **当前 main 未发现对应审批业务代码编译错误。**  
- 按批准纪律，**不得**将该实验树合并进 main。

因此本 PR **只加入语法回归防护**，**不**修复或重构审批业务，**不**宣称完成审批模型整合。  
**Approval Consolidation 属 Wave2，仍未批准。**

## 3. 受影响模块

| 树 | Orchestrator approvals route | tip `npm run build` |
|---|---|---|
| 当前 `main` / 稳定化基线 | **不存在该实验 route** | ✅ |
| 审计实验树未提交代码 | 曾存在且语法非法 | ❌（若纳入构建） |

## 4. 本 PR 修改

| 文件 | 变更 |
|---|---|
| `scripts/check-swc-nullish-logical.test.ts` | 扫描代码中的未加括号 `??`/`&&`/`||` 混用 + 自检 + probe |
| `scripts/test-ci-unit.sh` | CI 子集纳入本检查（保留 release-safety / #42 schema-drift / #43 public-route auth） |
| 本文档 | 根因与处置记录 |

**未修改：** 审批业务规则、Approval API、Agent Runtime、权限模型、Middleware、Cron 鉴权、`api-helpers.ts`、Prisma Schema / migration / 数据。

## 5. 扫描算法与边界

1. 遍历仓库代码文件（`.ts/.tsx/.js/.jsx/.mjs/.cjs`）。  
2. 排除 `node_modules`、`.next`、`.git`、常见构建产物、基线 JSON、Markdown、锁文件。  
3. 剥离注释与字符串后，按括号层级递归检查；同一层级再按三元 `? :` 切段，若某段同时残留 `??` 与 `&&`/`||`，判为违规并 `exit 1`。  
4. **边界：** 行级启发式，**不等同**完整 AST / TypeScript 解析；跨行拆开的混用、极端残缺括号/嵌套三元可能漏检或需后续收紧。

## 6. 测试

- `npx tsx scripts/check-swc-nullish-logical.test.ts` → PASS  
- 人工 / 内置 probe：植入 `a ?? b || c` 必须失败，删除后恢复通过  
- `npm run test:ci` → 含 release-safety、schema-drift、public-route auth、本检查  

## 7. 安全 / 数据库影响

- 无  
- 无 Schema / 迁移 / 数据写入  

## 8. 回滚方式

Revert 本 PR 即可移除扫描脚本；不影响运行时。

## 9. 剩余风险

1. 行级启发式的跨行漏检边界。  
2. 实验树内审批业务修复与 Approval Consolidation **不在本 PR / Wave1 范围**。  

## 10. P0 状态

**P0-03（tip 构建语法）：关闭（不适用 / 已由 tip 绿构建 + 回归检查防护）。**  
本 PR **不**关闭审批模型整合相关事项。  
