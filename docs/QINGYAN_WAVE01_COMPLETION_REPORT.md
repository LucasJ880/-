# 青砚稳定化 Wave 0 / Wave 1 最终完成报告

**报告日期：** 2026-08-01  
**当前正式基准：** `origin/main` @ `e80242c449dc087752497ac88f21b5020a59adfe`  
**本 PR：** #45（document-only 收口，不属于新功能实现）  
**状态：** **暂停** — Wave0/Wave1 已完成；Wave2 **尚未批准**

---

## 1. 实际合并清单

| 阶段 | PR | Merge commit |
|---|---:|---|
| Wave0 基线 | #39 | `c278ac0dd6cfb2617bf0dce1a50ac42242e93a26` |
| Build/Migration 分离 | #41 | `dd9662bf307c0c71dd3faa4c0bd3888cd4d69c90` |
| Prisma Schema Drift 可观测性 | #42 | `f5d84bb01da498ec4486700c349fd9ea0537dd16` |
| 公开路由鉴权契约 | #43 | `0188e079af82fecf298b6c0283f67db8f0fc8225` |
| SWC 语法回归防护 | #40 | `67463d6ffc3b556d06779b9512e3c0044fde88d6` |
| 实验分支漂移处置 | #44 | `e80242c449dc087752497ac88f21b5020a59adfe` |
| Wave0/1 完成报告（本文档） | #45 | （待产品负责人批准后合并） |

合并顺序事实：#39 → #41 → #42 → #43 → #40 → #44；#45 为最后文档收口。

---

## 2. P0 最终状态

### P0-01 — Build 与 Migration 绑定

**状态：关闭。**

证据：

- 正常 `npm run build` = `prisma generate && next build`，不执行 migrate  
- CI migration guard + `scripts/check-release-safety.test.ts`  
- 生产迁移仍须独立人工批准（`safe-migrate-deploy` / 显式确认），本波未执行生产 migration  

### P0-02 — Agent Runtime 实验分支漂移

**状态：关闭为「流程处置完成」。**

证据（见 `docs/QINGYAN_W1_PR5_AGENT_RUNTIME_BRANCH_DRIFT.md`）：

- feature tip：`80c76e4488eb7b490fe9bd2245c203786803992a`  
- 相对合并 #44 前 main：ahead **0** / behind **75**  
- feature tip 是 main 的祖先；**无**独立远程提交  
- 禁止整体 merge；禁止以该分支为开发基准  
- 历史本地 dirty/untracked 与 GitHub 远程分支明确区分（远程不可见）  

### P0-03 — SWC 空值合并语法失败

**状态：关闭于当前 tip。**

证据：

- 当前 main typecheck / build 通过  
- 新增 `scripts/check-swc-nullish-logical.test.ts` 回归扫描  
- **未**修改审批业务逻辑  
- Approval Consolidation **不在** Wave1 范围，仍属未批准事项  

### P0-04 — 公开路由自治鉴权

**状态：部分关闭。**

已完成：

- 公开路由鉴权契约测试（静态 + helper/middleware 最小动态）  
- `/api/trade/cron` 列入 middleware `PUBLIC_PATHS`（不要求浏览器 Session）  
- 路由内 `requireTradeCronSecret` fail-closed  
- `CRON_SECRET` 未配置 → **503**  
- 无/错 Authorization → **401**  
- 正确 `Authorization: Bearer <secret>` 才进入业务  
- SHA-256 摘要 + `timingSafeEqual` 常量时间比较  
- 不接受 query / cookie / body 中的 secret  

仍未完成（接受为剩余风险，不在本波继续扩大）：

- 完整 `runDailyCron` 集成测试  
- 全量动态 fuzz  
- 所有 `/api/cron/*` 统一常量时间比较  
- 完整限流与审计覆盖  

**不得将 P0-04 视为完全关闭。**

### P0-05 — Prisma 代码/数据库漂移

**状态：历史根因已确认，当前已缓解。**

证据：

- P2021/P2022 以 `PrismaClientKnownRequestError` + 稳定 code 识别（非 message 模糊匹配）  
- 客户端：`503` + 稳定文案 + `code` + `requestId`  
- 不泄露表名、列名、SQL、Prisma stack 或连接串  
- 当前代码、Generated Client 与已检查数据库结构一致（历史只读证据）  
- 本波**未**执行生产 migration / `db push`  

---

## 3. CI 与质量门禁最终状态

### 3.1 Raw ESLint（历史债务，可见）

- 仍显示历史债务：**53 errors / 111 warnings**  
- 原始 lint 日志在 CI 中保持可见  
- raw lint 命令仍可 `exit 1`  
- 本波**未**批量修复旧 lint  

**不得**把「raw lint 有债务」写成「CI 失败」。

### 3.2 ESLint Baseline Gate

- **PASS**  
- **24** fingerprints（相对 `main@2255f8d` 冻结基线）  
- 不允许新增 fingerprint  
- 不允许既有 fingerprint count 上升  

### 3.3 当前 `test:ci`

| 套件 | 结果 |
|---|---|
| release-safety | **27** passed |
| Prisma schema-drift（#42） | **22** passed |
| public-route authentication（#43） | **97** passed |
| SWC nullish/logical（#40） | **PASS**（自检 + probe + 仓库扫描） |

**汇总：`146 assertions passed + SWC repository scan passed`。**

### 3.4 其他门禁

| 项 | 状态 |
|---|---|
| Prisma validate | PASS |
| Typecheck | PASS |
| Next.js build | PASS |
| Build 无 migrate / 无 `db push` / 无 Applying migration | PASS |
| GitHub Actions（各 Wave1 PR） | PASS（合并前均绿） |
| Vercel Preview | Ready（各 PR Preview 曾就绪） |

---

## 4. 公开路由与 Schema Drift 要点（定稿）

| 主题 | 定稿事实 |
|---|---|
| middleware public | 只表示跳过浏览器 Session，**≠** 匿名开放 |
| `/api/trade/cron` | public bypass + 路由内常量时间 CRON_SECRET |
| 其他 cron / v1 / worker / webhook / share | 各自凭据；契约测试覆盖 |
| Schema drift | P2021/P2022 → 503 + code + requestId |

---

## 5. 分支漂移定稿引用

权威文档：`docs/QINGYAN_W1_PR5_AGENT_RUNTIME_BRANCH_DRIFT.md`  

（旧草稿名 `docs/QINGYAN_BRANCH_DRIFT_DISPOSITION.md` 已由 #44 替换，勿再引用。）

---

## 6. 保留的技术债（本波不处理）

1. raw ESLint 历史债务（53/111）  
2. npm audit vulnerabilities  
3. Next/Turbopack NFT tracing warnings  
4. Prisma 7 配置迁移提示  
5. GitHub Actions Node 24 迁移提示  
6. SWC 启发式扫描的跨行边界  
7. 完整 cron handler 集成测试  
8. 其他 cron secret 常量时间统一  
9. 公开路由限流、审计、动态 fuzz  
10. Approval Consolidation  
11. Orchestrator / Bid Data 若恢复，必须从最新 main 重做  

#45 **不**处理上述任一债务。

---

## 7. Wave2 决策（明确）

| 项 | 结论 |
|---|---|
| Wave0 | **完成** |
| Wave1 | **完成** |
| P0-04 | **部分关闭**，接受为剩余风险 |
| Wave2 | **尚未批准** |
| 本报告 | **不构成** Wave2 批准 |

未经产品负责人下一条明确指令：

- 不处理 P1  
- 不进入 Wave2/3  
- 不恢复实验 Agent Runtime  
- 不执行生产迁移  
- 不轮换 Secret  
- 不进行审批、报价或权限模型大重构  

---

## 8. #45 范围声明

- 仅新增/更新本 Markdown  
- 无源代码、测试脚本、Schema、migration、环境变量、Secret、Vercel 配置变更  
- 合并后即完成 Wave0/Wave1 文档收口；之后默认暂停  

---

## 9. 暂停声明

Wave 0 / Wave 1 交付完成并暂停。  

等待产品负责人批准合并 #45；合并后仍保持 Wave2 未批准状态，直至收到新的明确指令。  
