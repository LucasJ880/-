# Tasks

每条带验证方式；真实输出写进报告。

## 1. 复现与修复

- [ ] 1.1 开工前跑 `npx tsx src/lib/tender-rfq/__tests__/build.test.ts` 记基线；verify：输出 `tender-rfq: 21 passed`
- [ ] 1.2 先在 `src/lib/tender-rfq/__tests__/build.test.ts` 加用例（小写入库值、带空白与混合大小写、`mandatory_technical`、`mandatory_general`、未知与空类别、小写 `samples` 触发样品提示、全部非供应商侧 → `NO_CONFIRMED_REQUIREMENTS`、分析契约全部类别的大小写两种写法判定一致）；verify：改实现之前运行，新用例失败、原 21 项仍通过，把失败输出记进报告
- [ ] 1.3 在 `src/lib/tender-rfq/build.ts` 加类别归一（去空白、转大写、旧式代码映射表），类别判定、行项类别与「请随报价提供」清单改用归一后的值；verify：`npx tsx src/lib/tender-rfq/__tests__/build.test.ts` 全部通过

## 2. 收尾

- [ ] 2.1 门禁：tender-rfq 目录全部已注册测试、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate rfq-requirement-category-match --strict`；verify：全部通过，真实输出写进报告
- [ ] 2.2 写 `docs/QINGYAN_FIX-1_REPORT.md`（复现输出、改动、测试输出、上线后可见变化与首次使用时的核对提醒）+ 在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase F 新增 FIX-1 行并更新状态列；verify：报告存在，`grep -n 'FIX-1' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive rfq-requirement-category-match --yes`（独立小 PR）。
