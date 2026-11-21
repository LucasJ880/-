# Tasks：招标分析的降级结果用白话说清楚（FIX-17）

> 开工前提：#540（FIX-12）已合并；Evan 重测后确认了本 change 的范围。

## 1. 测试先行

- [ ] 1.1 新测试 `src/lib/tender-auto-analysis/__tests__/degradation-notice.test.ts`（降级记录的计算、四种降级的句子、没有内部用语、旧数据为空），同一步注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：在改动前的代码上运行失败，输出贴进报告；`bash scripts/check-test-registry.sh` 输出 OK

## 2. 实现

- [ ] 2.1 新文件 `src/lib/tender-auto-analysis/degradation.ts`（纯函数：算降级记录、生成面板 / 通知 / Muse 的句子）；`analyzer.ts` 的局限说明改成白话；`v2-map.ts` 把降级记录放进分析摘要；verify：1.1 全过，`v2-map.test.ts` 通过数不变
- [ ] 2.2 运行详情接口返回降级记录；`analysis-panel.tsx` 顶部显示降级说明与覆盖说明；`package-coverage.ts` 修正「文件文件」；verify：`package-coverage.test.ts` 全过，`npm run typecheck` 退出码 0
- [ ] 2.3 复核没跑完记为「没跑完」并换横幅（`synthesize.ts`、`analyst-synthesis-view.tsx`）；澄清问题带注明；verify：1.1 里对应场景通过，`analyst-synthesis.test.ts` 通过数不变
- [ ] 2.4 `alerts.ts` 与 `muse-bridge/events-pure.ts`：有降级时的文案与优先级；verify：`alerts.test.ts` 与 muse-bridge 事件测试全过（含「没有降级时文字与以前相同」）
- [ ] 2.5 真实应用截图三张存 `docs/acceptance/fix-17/`（隔离库造一份有降级的分析）；verify：三张图里能读到规格写的句子

## 3. 验收

- [ ] 3.1 全部门禁；verify：`npm test` 与既有失败清单对照无新增失败；CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`；`npm run lint:baseline` PASS；`openspec validate tender-degraded-result-notice --strict` valid；`git diff origin/main -- prisma/ vercel.json` 为空
- [ ] 3.2 写 `docs/QINGYAN_FIX-17_REPORT.md`（每种降级改前 / 改后的样子、怎样查出旧的受影响分析、多维审查结论）+ 更新 TASKFLOW 状态列（新增 FIX-17 一行，`[~]`）；verify：报告存在，`grep -n "FIX-17" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent（正确性与回归、安全 / 隐私与硬纪律、规格—代码—测试一致性、使用流畅与文案），逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- 合并后 `/opsx:archive tender-degraded-result-notice --yes`（独立小 PR）。
