# Tasks

## 1. 就绪度计算与读模型

- [x] 1.1 新建 `src/lib/revenue-spine/v2-readiness.ts`（纯函数）：
  - 四条条件的判定与依据文案、结论（只由可度量条件决定）；
  - 提案按状态与字段计数（过期 = 待审批且过有效期）、来源（写入审计条数）；
  - 首封草稿占比（只看首封；MOQ / 周期待确认的固定文案与 `reply-draft.ts` 一致）；
  - V2 其余数据源（认证、成本基础、样品政策、最低毛利是否配置、历史报价条数、类目数）。
  - 新建 `src/lib/revenue-spine/__tests__/v2-readiness.test.ts`，同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：测试退出 0，覆盖 spec「四条启动条件与结论」「事实提案计数」「首封草稿占比」「其余数据源与读取上限」「不输出商务值与个人信息」的全部 scenario。
- [x] 1.2 新建 `src/lib/revenue-spine/v2-readiness-read-model.ts`（where 构造函数 + 依赖可注入的 `getV2Readiness(orgId, deps)`，提案 2000 / 审计 2000 / 快照 300 上限并标记）与 `src/app/api/revenue/v2-readiness/route.ts`（`resolveRevenueAccess` + `force-dynamic`）。
  - 测试补到 `v2-readiness.test.ts`：假依赖端到端、查询条件限定组织与窗口、读模型与接口只读（源码静态断言）。
  - verify：测试退出 0，覆盖 spec「只读就绪度接口」scenario；`npm run typecheck` 退出 0。

## 2. /revenue 区块

- [x] 2.1 新建 `src/components/revenue/v2-readiness-panel.tsx`（容器 + 无 hook 视图），在 `src/app/(main)/revenue/page.tsx` 的评分校准区块下方挂载。
  - 新建 `src/components/revenue/__tests__/v2-readiness-panel.test.tsx`，同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：测试退出 0，覆盖 spec「/revenue 启动条件区块」：收起态无内容区；加载中；错误重试；就绪态的结论、四条条件状态文字、条件 4 说明与依据计数；空占比显示"—"。

## 3. 门禁与交付

- [x] 3.1 跑全部门禁并做独立交叉审查：
  - 门禁：`npm test` 与基线比较新增失败为 0；`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline` 通过；`bash scripts/check-test-registry.sh` 无新增未注册；`openspec validate fde-v2-readiness --strict` 通过；`git diff --stat` 无 `prisma/`、`vercel.json`。
  - 交叉审查：独立审查代理审查实现，处理其阻塞与应修项。
  - verify：上述命令输出与审查结论写进报告。
- [x] 3.2 写 `docs/QINGYAN_ORG_COCKPIT_B-6_REPORT.md`，把 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` B-6 状态列改为 `[~]`（指标已交，V2 启动待条件满足后由 Evan 决定），同步 `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`。
  - verify：三个文件已提交，报告包含门禁结果、staging 验证步骤与 GATE 待确认项。

## Workflow follow-up

- 归档：新增独立能力 `revenue-spine/fde-v2-readiness`；B-2 归档后再归档本 change，独立小 PR。
- staging：见 design「验证方式」最后一行。
