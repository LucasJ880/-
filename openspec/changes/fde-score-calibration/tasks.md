# Tasks

## 1. 校准统计（纯函数）

- [x] 1.1 新建 `src/lib/revenue-spine/score-calibration.ts`，包含：
  - 维度顺序与标签、窗口解析（30–180，默认 90）；
  - 结局与报价判定（引用 `opportunity-stage.ts` 的阶段常量）；
  - 归一与分桶、命中率、区分度、等级表；
  - 建议权重（最大余数法）、样本门槛、policy 片段。
  - 新建 `src/lib/revenue-spine/__tests__/score-calibration.test.ts`（固定 32 个商机样本），同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：测试退出 0，覆盖以下 spec 的全部 scenario：「结果口径与 /revenue 一致」「各维度统计」「按评分等级的赢单率」「建议权重与样本门槛」「policy 片段只供复制」（片段可合并）。

## 2. 读模型与接口

- [ ] 2.1 新建 `src/lib/revenue-spine/score-calibration-read-model.ts`，包含：
  - where 构造函数；
  - 行拼装：取首评、剔除窗口前、合并阶段 / 测试 / 报价；
  - 依赖可注入的 `getScoreCalibration(orgId, days, deps)`，评估 5000 行上限并标记截断，IN 分批。
  - 新建 `src/app/api/revenue/score-calibration/route.ts`：`resolveRevenueAccess` + `force-dynamic`。
  - 新建 `src/lib/revenue-spine/__tests__/score-calibration-read-model.test.ts` 并注册。
  - verify：测试退出 0，覆盖以下 spec 的全部 scenario：「样本取窗口内首次评估的商机」「只读校准接口」「不输出个人信息与金额」「policy 片段只供复制」（只读源码断言）。

## 3. /revenue 区块

- [ ] 3.1 新建 `src/components/revenue/score-calibration-panel.tsx`（容器 + 无 hook 视图），并在 `src/app/(main)/revenue/page.tsx` 的队列网格之后挂载。
  - 新建 `src/components/revenue/__tests__/score-calibration-panel.test.tsx` 并注册。
  - verify：测试退出 0，覆盖 spec「/revenue 评分校准区块」：
    - 收起态无统计、页面首屏不请求；
    - 加载中、错误重试；
    - 样本不足"已定 29 / 30"、无信号、正常态（六维 + 建议 + 复制按钮）、截断提示、空比率"—"。
  - 另用 scratchpad 的 Playwright 截图在 375 / 768 / 1280 宽检查：无页面横向滚动。

## 4. 门禁与交付

- [ ] 4.1 跑全部门禁并做独立交叉审查：
  - 门禁：`npm test` 与基线比较新增失败为 0；`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh` 通过；`openspec validate fde-score-calibration --strict` 通过；`git diff --stat` 无 `prisma/` 与 `vercel.json`。
  - 交叉审查：独立审查代理审查实现，处理其阻塞与应修项。
  - verify：上述命令输出与审查结论写进报告。
- [ ] 4.2 写 `docs/QINGYAN_ORG_COCKPIT_B-4_REPORT.md`，并把 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` B-4 状态列改为 `[G]`，同步 `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md` 进度表。
  - verify：三个文件已提交，报告包含门禁结果与 GATE 待确认项。

## Workflow follow-up

- PR 合并后另开小 PR 跑 `/opsx:archive fde-score-calibration --yes`，并同步状态列。
