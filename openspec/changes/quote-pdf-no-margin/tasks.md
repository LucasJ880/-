# Tasks：报价单 PDF 永远不印利润率（FIX-26a）

不依赖任何在审 change；GATE 已定（协调会话 2026-11-23：④ 不出内部版 PDF，⑤ PDF 单独成 change）。

## 1. 测试先行

- [x] 1.1 新增 `src/lib/quote/__tests__/export-customer-pdf.test.ts`（design D2：Node 里生成真的 PDF、抽页面文字；有利润率与利润率为空两份；源码断言），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；在改动前的 `export-pdf.ts` 上跑一次（verify：`npx tsx src/lib/quote/__tests__/export-customer-pdf.test.ts` 退出码非 0，失败的只有「没有 Margin / 利润率数值」与源码断言几条，失败条数写进报告；`bash scripts/check-test-registry.sh` 通过）

## 2. 删去利润率

- [ ] 2.1 `src/lib/quote/export-pdf.ts` 删去合计里的「Profit Margin」一行（verify：`npx tsx src/lib/quote/__tests__/export-customer-pdf.test.ts` 退出码 0、全部通过；`git diff origin/main --stat -- src/` 只有 `export-pdf.ts` 与新测试）

## 3. 门禁

- [ ] 3.1 全量与各项门禁（verify：`npm test` 失败清单与 main 基线 10 项逐条相同；`npm run test:ci` PASS；`npm run typecheck` 退出码 0；`npm run lint:baseline` PASS；`bash scripts/check-test-registry.sh` 通过且 `ci/test-registry-baseline.txt` 不变；`bash scripts/test-runtime-architecture.sh` 通过；`npx openspec validate quote-pdf-no-margin --strict` valid；`git diff origin/main -- prisma/ vercel.json package.json package-lock.json` 为空）

## 4. 报告与 TASKFLOW

- [ ] 4.1 写 `docs/QINGYAN_FIX-26a_REPORT.md` + 更新 TASKFLOW：在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 「FIX-21 后续 8」那一行之后加 FIX-26a 一行（状态 `[~]`）。报告写明：合并后谁会发现什么变了、没有开关合并即生效、PDF 删掉与核对过的字段、改前 / 改后测试数字、门禁数字、没验证到的（`isInternal` 行、中文字体）、回退办法、**已发出去的 PDF 系统里查不到，要不要通知客户由人定**；「多维审查」一节留空（verify：`grep -n "^| FIX-26a |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有且只有一行、状态列 `[~]`；`ls docs/QINGYAN_FIX-26a_REPORT.md` 存在）
