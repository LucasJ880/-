# Tasks：系统生成的文件不进招标文件包（FIX-19）

开工前提（缺一不开工）：
- 本分支已合入 main `13c7ed33`（含 FIX-13 #546）。
- design「生产只读核对」第 1、2 条已由有生产只读权限的人跑过，结果写进报告草稿。第 2 条不为 0 时不开工，回 GATE 第 2 条。
- 开工前先跑一遍将要触碰模块的已注册测试，记下基线通过数：`package-ready`、`package-coverage`、`package-fingerprint`、`obs-p4-page-limit`、`input-completeness`、`memo-v2`。

## 1. 测试先行

- [ ] 1.1 先写测试，再改代码。
  - 新建 `src/lib/files/__tests__/document-source.test.ts`：内容为 design D8 的真值表、标签、写入端与读取端接线断言。同一步注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - 新建 `src/lib/tender-auto-analysis/__tests__/package-source-db.isolated.test.ts`，夹具按 D8 的表：
    - 上传「RFP Window Coverings.pdf」「Pricing Form.pdf」
    - 有指纹的生成简报
    - 含「我方报价：」的内部项目分析
    - 报价导入、外部链接 PDF、投标准备清单
    - 无指纹、存储里真有文件的生成文件
  - 隔离库测试注册进 `scripts/test-all.sh`，写法同 `requirement-batch-confirm-db.isolated.test.ts`，没有隔离库时跳过。本地存储目录指到本测试独有的临时目录，结束时删掉。
  - `package-ready.test.ts`、`package-coverage.test.ts`、`input-completeness.test.ts` 补 D8 列的用例。`input-completeness` 的三组是：
    - 系统文件标 `SYSTEM_GENERATED`
    - 上传与系统文件同在时判完整、相关文档数 1
    - 像补遗的生成文件不算补遗、只有系统文件时判完整
  - verify：在只有这些测试、没有改动的代码上运行，以下用例都失败，输出贴进报告：
    - 隔离库测试：生成文件与报价导入进了包；无指纹的生成文件被补写了指纹；带「缺指纹即失败」时外部链接抛「缺少内容指纹」；就绪为 `DOCUMENT_PROCESSING`；有分类歧义提示。
    - `document-source.test.ts`：模块不存在，或接线断言失败。
    - 三个既有测试的新用例。其中 `input-completeness` 的「同在时判完整」一组失败。
  - verify：`bash scripts/check-test-registry.sh` 输出 OK。

## 2. 共享判定与选包

- [ ] 2.1 新建 `src/lib/files/document-source.ts`，导出 `USER_UPLOAD_SOURCE` 与 `isUserUploadedSource`（D2）。
  - `src/app/api/projects/[id]/files/route.ts:172` 改写常量。
  - `src/lib/tender-auto-analysis/package.ts` 的查询多选 `source`，循环里第一步按来源 `continue`，放在补写指纹之前（D3）。
  - `src/lib/tender-auto-analysis/package-ready.ts`：`ReadinessRow` 加必填的 `source`，取数时带上，候选先按来源过滤。
  - verify：以下测试全过：
    - `package-ready.test.ts`、`package-fingerprint.test.ts`
    - `obs-p4-page-limit.test.ts`（源码探针 `:101-109` 照旧匹配）
  - verify：`npx tsx src/lib/files/__tests__/document-source.test.ts` 里判定、写入端、选包、就绪的断言全过。这时只允许以下断言失败，3.1、4.1 做完后才过：
    - 覆盖、agent 技能、项目情报、备忘录、业主回复引用共享判定或常量
    - 没有 `SYSTEM_SOURCES`、没有 `not: "ai_checklist"`
    - `src` 非测试代码里没有 `source: "upload"` 字面量
    - 标签函数与分析详情接口

## 3. 统一其它读取处

- [ ] 3.1 改五处读取（D4、D5）：
  - `package-coverage.ts:76-77`：改为 `isUserUploadedSource(r.source ?? USER_UPLOAD_SOURCE)`。
  - `src/lib/tender-understanding/package-input.ts`：
    - 去掉 `SYSTEM_SOURCES`（`:276`），非上传一律排除，原因沿用 `SYSTEM_GENERATED`（`:530-532`）。
    - 完整性判定的相关文档（`:650`）与补遗（`:654-659`）都去掉排除原因为 `SYSTEM_GENERATED` 的项；总文件数与排除数不变。
  - `src/lib/files/intelligence-extractor.ts:174`：改为 `source: USER_UPLOAD_SOURCE`。
  - `src/lib/tender-analyst-memo/v2/pipeline.ts:37`：查询加 `source: USER_UPLOAD_SOURCE`。
  - `src/lib/tender-auto-analysis/reply-resolution.ts:97`：改用常量。
  - verify：以下测试全过：
    - `package-coverage.test.ts`（含 FIX-13 的全部用例）
    - `input-completeness.test.ts`（含 1.1 新加的三组）
    - `memo-v2.test.ts`
    - `document-source.test.ts` 的读取端接线断言

## 4. 旧分析的标签

- [ ] 4.1 `route.ts:122-140` 的角色标签挪进 `src/lib/tender-auto-analysis/display-labels.ts`，成为入参为（角色、来源）的纯函数（D7）。
  - `src/app/api/projects/[id]/tender-analysis/runs/[runId]/route.ts`：文档查询（`:57-63`）多选 `document.source`，响应的 `documents`（`:182-188`）只换标签值，不加 `source` 键。
  - verify：`document-source.test.ts` 全过。标签部分包括：非上传文件 →「不是上传的招标文件（重新分析后不再纳入）」；上传文件 7 种角色的标签不变；响应映射里没有 `source:`。
  - verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0。

## 5. 隔离库端到端

- [ ] 5.1 改 `src/lib/tender-workforce/__tests__/t1b-integration.test.ts`：
  - 夹具 `:97-120` 的两份文件补 `source: "upload"`。
  - 在同一个建项辅助函数里再加一份 `source: "generated"`、有指纹、有页面的「China Supplier Sourcing Brief v1」。
  - 断言：
    - workforce 分析清单的 `documents.length` 为 2，清单里没有它；
    - `:830-842` 的旧流程入队结果文件数为 2。
  - 不加分类歧义的断言（D8）。
  - verify：隔离库上 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/tender-workforce/__tests__/t1b-integration.test.ts` 全过。
  - verify：`package-source-db.isolated.test.ts` 全过。
  - verify：本机手工复现（上传两份 PDF → 生成国内供应商简报 → 发起分析），分析面板为「上传 2 · 纳入分析 2」、文件列表只有两份，截图进报告。

## 6. 验收

- [ ] 6.1 全部门禁。verify：
  - `npm test` 与既有失败清单对照，无新增失败。
  - CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`。
  - `npm run lint:baseline` PASS。
  - `bash scripts/test-runtime-architecture.sh` PASS。
  - `bash scripts/check-test-registry.sh` OK。
  - `openspec validate tender-package-exclude-generated --strict` valid。
  - `git diff origin/main -- prisma/ vercel.json` 为空。
  - 「生产只读核对」第 4 条的结果已由有生产只读权限的人跑过，写进报告。

## 7. 报告与 TASKFLOW

- [ ] 7.1 写 `docs/QINGYAN_FIX-19_REPORT.md`，内容包括：
  - 起因与选包链路（文件:行号）
  - 六个写入入口与来源值表
  - 白名单的理由与生产 SQL 第 1、2、4 条结果
  - 改前与改后的测试输出，包括 agent 技能完整性判定前后对照
  - 受影响项目的恢复步骤：
    - 12-3 与第 3 条 SQL 名单
    - 一键分析组织点卡片「重新分析」，旧流程组织点「重新分析当前投标文件包」
    - 旧分析的标注不带过去
  - 「没做的」与另开任务：
    - 旧流程不强制新建的入队在指纹回到旧值时撞唯一键（D6 第 3 条）：另开任务修 `enqueue-package.ts` 的查重
    - 网页「下一步」与投标工作区「有没有招标文件」的计数
    - 外部链接让文件流水线空转，自动入队因此不触发
    - 文件流水线给非上传文件做摘要
    - 项目 AI 上下文的「已上传文件」及同类三处读取
    - 项目结构化摘要卡
    - 文件抽屉分组
  - 「生成文件不要再上传」的使用提示
  - 多维审查结论

  同时更新 TASKFLOW 状态列：在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`「Phase F（续）— 情报串联」表里，按编号接在已有的 FIX 各行之后新增 FIX-19 一行，状态 `[~]`。
  - verify：报告存在。
  - verify：`grep -n "FIX-19" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行。

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent，每个只管一个维度：
  - 正确性与回归
  - 安全 / 隐私与硬纪律（尤其规格里「我方报价与估值」那条敏感项）
  - 规格—代码—测试一致性
  - 使用流畅与文案
  - 数据迁移与历史数据（来源值、受影响的旧分析）
- 每条意见逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- PR 合并后 `/opsx:archive tender-package-exclude-generated --yes`，走独立小 PR，至少派一个子 agent 核对主规格与 delta、TASKFLOW 状态。
