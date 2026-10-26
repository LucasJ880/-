# Tasks

## 1. 岗位注册表

- [ ] 1.1 新建 `src/lib/cockpit/posts.ts`：`PostKey` / `PostDefinition` / `PostKpiSpec` 类型、按展示顺序的七岗位常量表（归属按 design D3，KPI 与跳转按 design Context 表）、按岗位键 / 自动化键 / 动作类型 / 工作域 / runType 反查的纯函数（未命中返回 `null`）、对 `AutomationKey` / `PendingActionType` / `WorkDomain` 的类型层穷举断言；文件内只有 `import type`。verify：`npm run typecheck` 退出 0；临时删掉一个自动化键后 `npm run typecheck` 报错且错误信息含该键，恢复后再退出 0。

## 2. 穷举测试与注册

- [ ] 2.1 新建 `src/lib/cockpit/__tests__/posts.test.ts`，覆盖 spec 每条 Requirement：七岗位键与顺序；28 个自动化键 / 源码读出的 14 个 PendingAction 类型（断言 ≥ 14）/ 4 个工作域各恰好一个岗位；runType 规则（含 `workforce_job` 不归属）；KPI 模块与导出存在、指标路径段出现在源码、敏感词正则不命中、`service` / `content` 为未接入；跳转页面 `page.tsx` 存在；`posts.ts` 只有 `import type` 且不含 `process.env` / `settingsJson` / `@/lib/db`。同一 task 内注册进 `scripts/test-all.sh` 第一组（SDD-0 段之后、注册校验之前，中文名"组织驾驶舱 岗位注册表（A-1）"）。verify：`npx tsx src/lib/cockpit/__tests__/posts.test.ts` 退出 0；临时在测试里注入未归属键 / 重复归属各一次，测试退出 1 并打印该键，恢复后退出 0；`bash scripts/check-test-registry.sh` 的未注册列表不含 `src/lib/cockpit/__tests__/posts.test.ts`。

## 3. 门禁

- [ ] 3.1 跑全量门禁。verify：`npm run lint:baseline` 退出 0；`npm test` 中"组织驾驶舱 岗位注册表（A-1）"为 PASS，其余失败项与本 change 之前的基线逐条一致（记入报告）；`git diff --stat origin/main -- prisma/ vercel.json` 为空；`openspec validate org-cockpit-posts` 通过。

## 4. 收尾

- [ ] 4.1 写 `docs/QINGYAN_ORG_COCKPIT_A-1_REPORT.md`（做了什么 / 怎么验 / 与任务书的偏差 / 已知限制）+ 更新 TASKFLOW 状态列（`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase A 表 A-1 → `[G]`）。verify：报告文件存在；`grep -n "^| A-1 " docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` 的状态列为 `[G]`。

## Workflow follow-up

- 四件套与实现回传 Claude 做 GATE 审；Evan 合并 PR 后再 `/opsx:archive org-cockpit-posts --yes`（独立小 PR），确认 `openspec list --specs` 列出 `cockpit/post-registry`，并把 A-1 状态列改为 `[x]`。
