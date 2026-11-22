# Tasks：系统生成的文件不进招标文件包（FIX-19）

开工前提（缺一不开工）：
- 开工顺序 FIX-17 → FIX-21 → FIX-19。FIX-21 合并后把 main 合入本分支再开工（合入后含 FIX-13 #546、FIX-17、FIX-21）。
  - 本文行号按 `13c7ed33` 写。FIX-17 改过 `files/process-next/route.ts`，开工时先对合入后的代码核对本文引用的行号。
- 开工前先跑一遍将要触碰模块的已注册测试，记下基线通过数：`package-ready`、`package-coverage`、`package-fingerprint`、`obs-p4-page-limit`、`input-completeness`、`memo-v2`。

合并前提（缺一不合并）：
- design「生产只读核对」第 1、2 条**还没有跑**（本会话的容器连不到生产库）。可直接执行的 `docs/acceptance/fix-19/prod-check.sql` 已于 2026-11-22 23:30 UTC 交给 Lucas。
- 规则（Lucas 把项目全权交给本会话之后，本会话的做法）：
  - 代码先写到可合并，不等结果；
  - 第 1、2 条结果回来、且第 2 条为 0 之前，不合并，PR 保持草稿；
  - 第 2 条不为 0 就停，回 design「留给 GATE」第 2 条（已定 A：先看清是哪些行再定）。
- 结果回来后原样写进报告。

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
  - verify：FIX-17 的 `src/lib/projects/__tests__/files-route-guard.test.ts` 与 FIX-21 的 `src/lib/projects/__tests__/project-routes-guard.test.ts` 通过（本 change 改的 `files/route.ts`、`runs/[runId]/route.ts` 都在它们的范围里）。

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
  - `docs/acceptance/fix-19/prod-check.sql` 第 1、2、4 条的结果已回来、写进报告，且第 2 条为 0。没回来时这一条不打勾，PR 保持草稿、不合并（见开头「合并前提」）。

## 7. 报告与 TASKFLOW

- [ ] 7.1 写 `docs/QINGYAN_FIX-19_REPORT.md`，内容包括：
  - 起因与选包链路（文件:行号）
  - 六个写入入口与来源值表
  - 白名单的理由与生产 SQL 第 1、2、4 条结果（`docs/acceptance/fix-19/prod-check.sql`，原样贴回）
  - 改前与改后的测试输出，包括 agent 技能完整性判定前后对照
  - 「没有开关，合并即在生产生效」：零 schema、不加开关，部署后所有入口立刻只认上传文件；要撤回只能 revert。
  - 「合并后要人做的事」：
    - 部署后跑 `docs/acceptance/fix-19/prod-check.sql` 第 3 条（只读），拿到受影响项目名单。跑的人要有生产只读权限（第 1、2 条同样交给了 Lucas）。12-3 应在名单里；不在时按 design D6 恢复步骤第 1 条单独查它较早那份待审分析。
    - 按 D6 逐个点「重新分析」：一键分析组织点「AI 数字员工 · 投标分析」卡片上的「重新分析」；旧流程组织点分析面板的「重新分析当前投标文件包」；不等自动入队（会撞唯一键，见下面第 4 条遗留）。点的人要能进该项目、有发起分析的权限，每个项目谁点由 Lucas 定。
    - 12-3 先在「项目文件」抽屉重新解析附录 B（FIX-13），再重新分析。
    - 点完在分析面板核对「上传 N · 纳入分析 N」、文件列表里没有生成文件。旧分析上的要求确认、矩阵标注不带过去：合规记忆里有的经 FIX-22「采纳全部历史建议」带入，其余重新标注。
  - 「没做的」：下面登记的 8 条后续任务，各一句
  - 「生成文件不要再上传」的使用提示
  - 多维审查结论

  同时更新 TASKFLOW 状态列：在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`「Phase F（续）— 情报串联」表里，按编号接在已有的 FIX 各行之后新增 FIX-19 一行，状态 `[~]`。同时登记 8 条后续任务，各一行，编号写「待定」，状态 `[ ]`：
    1. 只有生成文件时，网页「下一步」与分析入口说法互相矛盾：「下一步」按项目全部文件计数（`src/lib/tender-next-step/service.ts:78-79`、`web-next-step.ts:248-263`），照旧说「已上传 N 个文件，还没有发起分析」，分析入口却返回「没有可分析的投标文件」；项目里有一份待解析的外部链接 PDF 时，它一直说「招标文件正在解析」。改用 FIX-19 的共享判定，要对 `tender/web-next-step` 写 MODIFIED。
    2. 投标工作区按项目全部文件数判「有招标文件」（`src/lib/tender-bid-workspace/store.ts:30`、`workspace-view.ts:78`），只有生成文件的项目也算有。改用共享判定，要对 `tender/bid-workspace` 写 MODIFIED。
    3. 文件抽屉把生成文件归在「外部链接」、带外链图标（`src/components/project-files/project-file-manager.tsx:374-377,643,663`），改成按来源分「上传 / 系统生成 / 报价导入 / 外部链接」。
    4. 指纹回到旧值时旧流程自动入队撞唯一键、建不出那一轮：查重只看进行中的状态（`src/lib/tender-auto-analysis/enqueue-package.ts:62-84`），查不到已被替代或已批准的同指纹分析，新建撞唯一键（`prisma/schema.prisma:2328`），并发兜底原样抛错（`:285-303`），文件流水线把错误吞掉（`process-next/route.ts:50-58`）。修 `enqueue-package.ts` 的查重，排在 FIX-18 之后。
    5. 外部链接让文件流水线反复空转：可分析类型的外部链接停在待解析，流水线每次先挑中它（`src/app/api/projects/[id]/files/process-next/route.ts:105-124`），`src/lib/files/parse-content.ts:98` 没有存储地址就直接返回，`project-file-manager.tsx:169` 的循环不结束，这类项目的自动入队也因此不触发。
    6. 文件流水线第 2 步给有正文的非上传文件做 AI 摘要（`process-next/route.ts`、`src/lib/files/ai-summary.ts`），`src/lib/projects/apply-document-metadata.ts` 拿这些摘要补项目空字段；已被解析过的生成文件和报价导入文件都会被摘要。
    7. 项目 AI 上下文把全部文件列在「【已上传文件】」下（`src/lib/projects/project-ai-context.ts:60-75,158-175`、`src/lib/ai/context.ts:268`）；同类的开始投标调查（`src/lib/bid-workflow/start-intelligence.ts:82-86`）、供应链分析技能（`src/lib/agent/skills/supply-chain-analysis.ts:88-92`）、agent 查项目文件的只读工具（`src/lib/agent-core/tools/enterprise-readonly.ts:397,455,666`）也读不分来源的文件标题、摘要或正文。
    8. 项目结构化摘要卡读 8 份不分来源的文件、按关键词判项目类型标签（`src/lib/projects/structured-summary.ts:38-60`，项目情报生成之后由 `intelligence-extractor.ts:381-385` 调用）。
  - verify：报告存在，含「没有开关，合并即在生产生效」与「合并后要人做的事」两节。
  - verify：`grep -n "^| FIX-19 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行。
  - verify：`grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 不少于「写之前的条数 + 8」（2026-11-22 main `01e444b9` 上为 0；先合并的 change 登记过的，以合入后的条数为准）。

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent，每个只管一个维度：
  - 正确性与回归
  - 安全 / 隐私与硬纪律（尤其规格里「我方报价与估值」那条敏感项）
  - 规格—代码—测试一致性
  - 使用流畅与文案
  - 数据迁移与历史数据（来源值、受影响的旧分析）
- 每条意见逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- PR 合并后 `/opsx:archive tender-package-exclude-generated --yes`，走独立小 PR，至少派一个子 agent 核对主规格与 delta、TASKFLOW 状态。
