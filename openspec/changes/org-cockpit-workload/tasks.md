# Tasks

## 1. 工作量汇总（纯函数）

- [x] 1.1 新建 `src/lib/cockpit/workload.ts`：
  - 内容：阈值默认值与逐项校验；本地日序列与分桶；待审批结局规则表；AI 运行 / 用量 / 待审批 / 询盘的归属；按岗位 × 天汇总与近 7 天合计；四条规则与原因文案；"未接入 / 不适用 / 未入账"标记。
  - 新建 `src/lib/cockpit/__tests__/workload.test.ts`，同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：`npx tsx src/lib/cockpit/__tests__/workload.test.ts` 退出 0，含 ≥ 15 个表驱动用例。用例须覆盖 spec「待审批动作的结局判定」「按组织本地日分桶」「疑似无用功规则」「阈值可按组织覆盖」「询盘销售口径与 SLA 指标一致」「AI 用量与成本归属」「未接入的指标明示」的全部 scenario。

## 2. 读模型与接口

- [x] 2.1 新建 `src/lib/cockpit/workload-read-model.ts`（依赖可注入、查询条件为导出纯函数、每类来源行数上限）与 `src/app/api/cockpit/workload/route.ts`（`withAuth` → `resolveCockpitViewer` → 参数校验 → 读模型），并新建 `src/lib/cockpit/__tests__/workload-read-model.test.ts` 且注册。
  - verify：测试退出 0，覆盖以下 scenario：
    - 「工作量接口只读且与岗位总览同一套访问规则」全部；
    - 「AI 运行与平台自动化运行」：同一批运行，工作量近 7 天与岗位总览的 `actions7d.agentRuns` 相等；
    - 「数据量上限」；
    - 「不输出业务内容与敏感字段」。
  - 另需 `npx eslint` 新文件无报错。

## 3. 首页工作量区块

- [ ] 3.1 新建 `src/components/cockpit/org-cockpit-workload.tsx`（客户端容器：收起 / 加载中 / 失败 / 就绪，点击才请求；无 hooks 的 `WorkloadPanel`：表格 + 14 天走势 SVG + 规则原因 + 说明），`OrgCockpitView` 增加 `workloadSlot`，`OrgCockpitHome` 传入区块；新建 `src/components/cockpit/__tests__/org-cockpit-workload.test.tsx` 并注册。
  - 实施前加载 `dataviz` 技能核对走势小图的配色与可读性。
  - verify：渲染测试退出 0，覆盖 spec「首页工作量区块」全部 scenario。A-3 渲染测试 `org-cockpit-view.test.tsx` 仍全部通过。`npm run typecheck` 退出 0。

## 4. 视觉核对

- [ ] 4.1 用 A-3 的离线渲染流程（真实主题样式 + 模拟 240px 侧栏）渲染区块的就绪态，覆盖含规则命中、未入账、展会行三种情况，截 1280 / 820 / 390。
  - verify：截图生成于 scratch 目录，无横向滚动、最小点击高度 44px，人工核对后在报告中描述。

## 5. 门禁

- [ ] 5.1 跑全量门禁。verify：
  - `npm run lint:baseline` 退出 0；
  - `npm run test:ci` 输出 `CI unit subset PASS`；
  - `npm test` 中驾驶舱各测试全部 PASS，其余失败项与 `origin/main` 基线逐条一致；
  - `npm run typecheck` 退出 0；
  - `git diff --stat origin/main -- prisma/ vercel.json` 为空；
  - `openspec validate org-cockpit-workload --strict` 通过。

## 6. 收尾

- [ ] 6.1 写 `docs/QINGYAN_ORG_COCKPIT_A-4_REPORT.md`（做了什么 / 怎么验 / 截图说明 / 与任务书的偏差 / 交叉审查发现与处理 / staging 待验项），并在 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase A 表把 A-4 状态列更新为 `[G]`。
  - verify：报告文件存在；`grep -n "^| A-4 " docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` 的状态列为 `[G]`。

## Workflow follow-up

- GATE-A2 在 staging：
  - 以 `seed:org:sunny-home-deco` 管理员展开工作量区块，近 7 天 AI 运行与岗位卡片"7 天 AI x 次"一致，并与 `AgentRun` 直接计数对账；
  - 至少复现一个标红信号并解释原因；
  - 对待审批动作、AI 运行、用量记账三条查询跑 `EXPLAIN ANALYZE`。
- PR（base = `claude/org-cockpit-home`）合并后，再 `/opsx:archive org-cockpit-workload --yes`（独立小 PR）；A-4 状态列改为 `[x]`。
- 后续 change 候选：
  - FDE / 定时任务的 AI 调用带组织入账（让成本可归属）；
  - 规则结果按需带进岗位卡片；
  - B-1 之后接入"改过再批"。
