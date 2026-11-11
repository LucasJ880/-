# Tasks：招标分析保留数量与单位，价格表从分析带入（FIX-2）

## 1. 保留与转换

- [x] 1.1 新增 `src/lib/tender-bid-workspace/schedule-prefill.ts`（纯函数）：从分析结果收集数量线索（类别、说法不一致的、出处）、读存下的线索（认版本与旧数据）、数量的取法、单位对照、生成粘贴文本与「没带入」清单、面板的判断；verify：`npx tsx src/lib/tender-bid-workspace/__tests__/schedule-prefill.test.ts` 全部通过
- [x] 1.2 `src/lib/tender-auto-analysis/v2-map.ts`：「价格与评标」一节的 `structuredJson` 带上数量线索；verify：`schedule-prefill.test.ts` 里经 `mapV2Result` 的用例通过；`grep -rln "v2-map" src --include=*.test.ts` 列出的既有测试不改断言全部通过

## 2. 接口与界面

- [x] 2.1 读取函数与路由 `GET /api/projects/[id]/bid-workspace/schedule-candidates`（项目读权限；功能开关关闭 404；取当前有效的分析；已驳回的要求与事实对应的线索不返回；不写库）；verify：`npx tsx src/lib/tender-bid-workspace/__tests__/schedule-prefill-db.isolated.test.ts` 全部通过（本地隔离库）
- [x] 2.2 `bid-workspace-panel.tsx`：粘贴导入区加「从招标分析带入」、原文对照与「没带入」清单、已有内容时先确认；verify：`docs/acceptance/fix-2/prefill-filled.png`、`prefill-confirm.png`、`prefill-saved.png`；`schedule-prefill.test.ts` 里的接线断言通过

## 3. 测试注册与验收

- [x] 3.1 两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [x] 3.2 开 PR 前请一个不带结论的独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate analysis-quantity-unit-prefill --strict` valid
- [x] 3.3 写 `docs/QINGYAN_FIX-2_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FIX-2 一行，状态 `[G]`
