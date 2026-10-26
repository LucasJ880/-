# Tasks

## 1. policy 开关与判定（纯函数）

- [x] 1.1 `src/lib/revenue-spine/policy.ts` 加 `autonomy.autoStale`（默认 `false`、只认布尔值），并新建 `src/lib/revenue-spine/autonomy.ts`，包含：
  - 候选查询条件、在途审批查询条件；
  - `decideAutoStale` 判定（含跳过原因）；
  - 依赖可注入的执行器 `runAutoStale`（流转、汇总通知、上限 200、预算、失败隔离）。
  - 新建 `src/lib/revenue-spine/__tests__/autonomy.test.ts`，同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：测试退出 0，覆盖以下 spec 的全部 scenario：「自动搁置默认关闭」「自动搁置的范围」「自动搁置看最后活动与买家来信」「有在途审批的商机不搁置」「自动搁置的最低天数」「通知负责人」「上限与幂等」。

## 2. 接入

- [x] 2.1 接入三处，并在 `autonomy.test.ts` 补静态断言：
  - `transition.ts`：可选 `policyKey` 写进审计；
  - `fde/inbound-sales.ts`：decline 判不合格时透传 `policyKey`；
  - `api/cron/revenue-spine/route.ts`：开关保护的自动搁置步骤放在 next action 之前，并修正头注释。
  - verify：测试退出 0，覆盖以下 spec 的全部 scenario：「流转方式与审计」「不产生外部动作」「不合格自动关闭带 policy 键名」「配额命中对管理层可见」；`npm run typecheck` 退出 0。

## 3. dogfood 脚本

- [x] 3.1 新建 `scripts/seed-revenue-autonomy.ts`（默认只打印计划、`--write` 才发布、缺省 `sunny-home-deco`），计划函数放在 `autonomy.ts` 并在 `autonomy.test.ts` 覆盖。
  - verify：覆盖 spec「dogfood 开启脚本」两个 scenario；`npx tsx scripts/seed-revenue-autonomy.ts --help` 退出 0。

## 4. 门禁与交付

- [ ] 4.1 跑全部门禁并做独立交叉审查：
  - 门禁：`npm test` 与基线比较新增失败为 0；`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline` 通过；`bash scripts/check-test-registry.sh` 无新增未注册；`openspec validate fde-internal-autonomy --strict` 通过；`git diff --stat` 无 `prisma/`、`vercel.json`、`opportunity-stage.ts`。
  - 交叉审查：独立审查代理审查实现，处理其阻塞与应修项。
  - verify：上述命令输出与审查结论写进报告。
- [ ] 4.2 写 `docs/QINGYAN_ORG_COCKPIT_B-5_REPORT.md`，并把 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` B-5 状态列改为 `[G]`，同步 `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`。
  - verify：三个文件已提交，报告包含门禁结果与 GATE 待确认项。

## Workflow follow-up

- PR 合并后另开小 PR 跑 `/opsx:archive fde-internal-autonomy --yes`，并同步状态列。
- staging：对 sunny-home-deco 跑 seed 脚本开启 dogfood（报告列为 GATE-B3 待验项）。
