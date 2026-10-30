# Tasks

## 1. 岗位注册表

- [x] 1.1 新建 `src/lib/cockpit/posts.ts`：`PostKey` / `PostDefinition` / `PostKpiSpec`（含 `source` / `window` / 三个 `{path, label, format}`）类型；按展示顺序的七岗位常量表（归属按 design D3，KPI 与跳转按 design Context 表）；通用动作类型清单与不归属 runType 清单；反查纯函数（岗位键 / 自动化键 / 固定动作类型 / 工作域 / runType，未命中返回 `null`）与通用动作按行上下文归属的纯函数；`pickKpiMetrics`；类型层断言（`AutomationKey` / `WorkDomain` 全覆盖，`PendingActionType` 恰好一种归属方式，KPI 路径解析到标量）；文件内只有 `import type` 与类型位置的 `typeof import()`。verify：`npm run typecheck` 退出 0；临时删掉一个自动化键、一个动作类型、把一个 KPI 路径改成 `sections.total`，局部 `tsc` 分别报 TS2344 且错误信息含对应字面量，恢复后 `cmp` 逐字节一致。

## 2. 穷举测试与注册

- [x] 2.1 新建 `src/lib/cockpit/__tests__/posts.test.ts`，覆盖 spec 每条 Requirement：七岗位键、顺序与含汉字的中文名；28 个自动化键 / 源码（去注释、无残留）读出的 14 个 PendingAction 类型 / 4 个工作域的归属；源码扫出的 runType 全集逐个归属或不归属、两份清单无过期项；通用动作上下文规则 5 个场景；KPI 模块与导出存在、类型映射路径与声明一致、格式在白名单、敏感词不命中、`pickKpiMetrics` 只取声明路径、`service` / `content` 为未接入；跳转页面 `page.tsx` 存在；`posts.ts` 零运行时依赖。同一 task 内注册进 `scripts/test-all.sh` 第一组（SDD-0 段之后、注册校验之前，中文名"组织驾驶舱 岗位注册表（A-1）"）与 `scripts/test-ci-unit.sh`（架构守卫之前）。verify：`npx tsx src/lib/cockpit/__tests__/posts.test.ts` 退出 0；临时注入未归属键 / 重复归属各一次，测试退出 1 并打印该键，恢复后退出 0；`bash scripts/check-test-registry.sh` 的未注册列表不含本测试；`grep -c "src/lib/cockpit/__tests__/posts.test.ts" scripts/test-ci-unit.sh` 输出 1。

## 3. 门禁

- [x] 3.1 跑全量门禁。verify：`npm run lint:baseline` 退出 0；`npm test` 中"组织驾驶舱 岗位注册表（A-1）"为 PASS，其余失败项与 `origin/main` 基线逐条一致（记入报告）；`git diff --stat origin/main -- prisma/ vercel.json` 为空；`openspec validate org-cockpit-posts --strict` 通过。

## 4. 收尾

- [x] 4.1 写 `docs/QINGYAN_ORG_COCKPIT_A-1_REPORT.md`（做了什么 / 怎么验 / 与任务书的偏差 / 交叉审查发现与处理 / 已知限制）+ 更新 TASKFLOW 状态列（`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase A 表 A-1 → `[G]`）。verify：报告文件存在；`grep -n "^| A-1 " docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` 的状态列为 `[G]`。

## Workflow follow-up

- 四件套与实现回传 Claude 做 GATE 审；Evan 合并 PR 后再 `/opsx:archive org-cockpit-posts --yes`（独立小 PR，分支 `claude/archive-org-cockpit-posts`），确认 `openspec list --specs` 列出 `cockpit/post-registry`，并把 A-1 状态列改为 `[x]`。
