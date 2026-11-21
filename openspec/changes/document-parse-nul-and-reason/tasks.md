# Tasks：解析出的文字带 U+0000 也能入库，解析失败显示原因（FIX-13）

## 1. 测试先行

- [x] 1.1 隔离库测试 `src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts`（测试里拼最小 PDF：勾选框式 U+0000 夹在「check the box.」与「The Bidder declare」之间的一页 + 整页 U+0000 的一页；本地文件存储；真实的 `parseDocumentPagesAndStore` 与 `parseAndStoreContent`），同一步注册进 `scripts/test-all.sh`；verify：在改动前的代码上运行失败（两条路径 `failed`，`parseError` 含 `22021` 或 `0x00`），输出贴进报告；`bash scripts/check-test-registry.sh` 输出 OK

## 2. 实现

- [x] 2.1 新文件 `src/lib/files/extracted-text.ts`（`toStorableText` / `hasUnstorableChars`）+ 纯函数测试 `src/lib/files/__tests__/extracted-text.test.ts`，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/files/__tests__/extracted-text.test.ts` 全过（U+0000 → 空格、落单高 / 低位代理 → U+FFFD、成对代理 / 中文 / 制表 / 换行不变、截断劈开代理对后再清理）
- [x] 2.2 `page-parse.ts`（PDF 逐页在判断近乎空白之前、整份文字截断之后、非 PDF 单元）与 `parse-content.ts`（截断之后）写库前调用 `toStorableText`；verify：1.1 的隔离库测试全过（连跑 2 次），`page-parse.test.ts` 照旧通过
- [x] 2.3 `package-coverage.ts` 排除明细加 `parseError`（只对解析失败有值，取数多选 `parseError`）；存进综合解读的快照显式只取六项（`package-coverage.ts` 的纯函数，`v2-persist.ts` 的 `loadCoverageForRun` 调它）；投标简报用的清单去掉原文；`package-coverage.test.ts` 补用例；verify：`npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 全过，`analyst-synthesis.test.ts` 照旧通过
- [x] 2.4 界面：`analysis-panel.tsx` 逐文件明细「未纳入：文件解析失败（原因：…）」并把「文件名 → 原文」交给 `analyst-synthesis-view.tsx` 的展开列表；`project-file-manager.tsx` 行下方显示全文；verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0；真实应用截图存 `docs/acceptance/fix-13/`

- [x] 2.5 多维审查后补的三项：纯文本 / CSV 按实际编码读（`decodeTextFile`，读不了的写明原因）；失败原因写入收口（≤ 500 字 + 清理）；文案收进 `exclusion-text.ts`（面板的下一步提示、展开列表的「上次分析时的记录」、文件列表的「原因：系统未记录原因」）；第二轮复核后再补：没有字节序标记的中文 UTF-16 与 UTF-32、失败原因收口的纯函数、三处取数的接线断言、不用数据库的页面抽取断言（`page-parse.test.ts` 进 CI 子集）；verify：四个测试文件全过（隔离库 33、纯函数 34、覆盖清单 50、`page-parse.test.ts` 21），`npm run typecheck` 退出码 0

## 3. 验收

- [ ] 3.1 全部门禁；verify：`npm test` 与既有失败清单（`docs/QINGYAN_CHAIN-3_REPORT.md` §4）对照无新增失败；CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`；`npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` PASS；`openspec validate document-parse-nul-and-reason --strict` valid；`git diff origin/main -- prisma/ vercel.json package.json package-lock.json` 为空
- [x] 3.2 写 `docs/QINGYAN_FIX-13_REPORT.md`（原因与复现、改前 / 改后测试输出、上线后操作、多维审查结论）+ 更新 TASKFLOW 状态列（新增 FIX-13 一行，`[~]`）；verify：报告存在，`grep -n "FIX-13" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent（正确性与回归、安全 / 隐私与硬纪律、规格—代码—测试一致性、使用流畅与文案），逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- Draft PR 合并后 `/opsx:archive document-parse-nul-and-reason --yes`（独立小 PR，至少一个子 agent 核对主规格与 delta、TASKFLOW 状态）。
