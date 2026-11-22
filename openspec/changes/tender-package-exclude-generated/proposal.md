# Proposal：系统生成的文件不进招标文件包（FIX-19）

TASKFLOW：FIX-19（Phase F（续）— 生产实测修复，2026-11-22）

## Why

生产实测（2026-11-22，项目「12-3」）：「一键生成文档」生成的「China Supplier Sourcing Brief v1」被当成招标文件包的「主文件」纳入分析。原因是选包只看文件类型和解析状态，不看文件从哪来：生成文件、客户报价 PDF、报价导入的供应商报价只要是可分析的类型就会进包，标题不像招标文件的一律默认判成主文件。

## What Changes

- 新增一个文件来源判定（纯函数 + 常量）：招标文件包只认「用户上传」这一个来源（`source = "upload"`，只有项目文件上传接口写它），其余来源一律不是招标文件。上传接口改为写这个常量。
- 改选包：两条分析入口共用的选包逻辑先按来源过滤。被过滤掉的文件不进候选，不读它的存储内容，也不补写内容指纹。一键 AI 分析（workforce）、分析面板的「分析投标文件」与「重新分析当前投标文件包」、上传后自动入队、执行摘要算的当前指纹，都经这一处。
- 改就绪判断：自动入队的「文件包已就绪」只看用户上传的文件。可分析类型（如 pdf）的外部链接文件没有可读内容、永远停在待解析，从此不再卡住就绪判断，也不再因为缺内容指纹让整次入队失败。
- 统一现有三处口径不同的来源判定，都改用上面那个判定：覆盖清单「上传 N」的计数（结果不变）；agent 技能「标书分析」的文件清单（原来只排除投标准备清单）；项目情报的输入文档（原来只排除投标准备清单）。另外两处读招标全文的地方也改用同一判定：分析师备忘录 v2 的全文语料原来读项目全部文件，业主回复匹配原来写的是字面量 `"upload"`、语义不变。
- 改分析详情接口：旧分析的文件列表里，不是用户上传的文件不再标「主文件」，改标「不是上传的招标文件（重新分析后不再纳入）」。上传文件的标签不变。
- 新增测试：
  - 纯函数与接线断言新开一个测试文件，进 CI 子集。
  - 就绪、覆盖、输入完整性三个既有测试补用例。
  - 隔离库端到端新开一个文件，在只有测试、没有改动的代码上必须失败。
  - `t1b-integration.test.ts` 补上夹具缺的 `source`，并加一份生成文件，断言 workforce 清单里没有它。

## Capabilities

### New Capabilities

- `tender/analysis-package-inputs`：招标文件包由哪些文件组成，即只纳入用户上传的文件。同时规定：就绪判断与内容指纹只算这些文件；读招标全文的其它地方（项目情报、分析师备忘录、agent 标书分析技能）用同一口径；旧分析里不该纳入的文件怎样标明。

### Modified Capabilities

（无。已归档的主规格里没有招标文件包组成的要求。FIX-13 新增的 `tender/analysis-package-coverage` 规定覆盖清单的排除明细，本次不改它的要求，覆盖计数的口径也保持不变。）

## Impact

- 代码：
  - 新增 `src/lib/files/document-source.ts`。
  - `src/app/api/projects/[id]/files/route.ts`：写入来源改用常量。
  - `src/lib/tender-auto-analysis/package.ts`：选包按来源过滤，放在补写指纹之前。
  - `src/lib/tender-auto-analysis/package-ready.ts`：就绪行带来源。
  - `src/lib/tender-auto-analysis/package-coverage.ts`：计数改用共享判定。
  - `src/lib/tender-understanding/package-input.ts`。
  - `src/lib/files/intelligence-extractor.ts`。
  - `src/lib/tender-analyst-memo/v2/pipeline.ts`。
  - `src/lib/tender-auto-analysis/reply-resolution.ts`：常量替换字面量。
  - `src/lib/tender-auto-analysis/display-labels.ts` 与 `src/app/api/projects/[id]/tender-analysis/runs/[runId]/route.ts`：旧分析的角色标签。
- 测试：
  - 新增 `src/lib/files/__tests__/document-source.test.ts`，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - 新增 `src/lib/tender-auto-analysis/__tests__/package-source-db.isolated.test.ts`，注册进 `scripts/test-all.sh`，没有隔离库时跳过。
  - 扩 `package-ready.test.ts`、`package-coverage.test.ts`、`input-completeness.test.ts`、`src/lib/tender-workforce/__tests__/t1b-integration.test.ts`。
- 零 schema；无新开关、无新队列、无新模型调用。合并即生效。已经纳入生成文件的旧分析不会自动改写，要重新分析（见 design D6）。
- Muse：不改 `src/lib/muse-bridge/**`。`ask` 意图读的是最新分析的摘要，重新分析之后间接受益。其它意图不读文件包。

## Out of scope

- 不删、不改任何已有的 `ProjectDocument` 行：生成文件照旧出现在项目文件列表和「一键生成文档」卡片里。已经被页级解析过的生成文件，页面行和 `contentText` 保留。
- 不改文件抽屉的分组：生成文件仍归在「外部链接」下、带外链图标（`src/components/project-files/project-file-manager.tsx:373-376,642,660`）。理由：只是显示问题，不影响分析；FIX-13 正在改同一个组件。另开小改动，按来源分「上传 / 系统生成 / 报价导入 / 外部链接」。
- 不改文件处理流水线（`src/app/api/projects/[id]/files/process-next/route.ts`）。它的第 2 步会给有正文的非上传文件做 AI 摘要；`src/lib/projects/apply-document-metadata.ts` 会读这些摘要补项目字段，只补空的。理由：本次之后，新生成的文件不会再进分析、不会被页级解析，也就没有正文，第 2 步碰不到它们；受影响的只剩已被解析过的少数旧行（如 12-3），而且项目情报已经不读它们（见 What 第 4 条）。另开任务时一并处理报价导入文件被摘要的问题。
- 不改项目 AI 上下文（`src/lib/projects/project-ai-context.ts:60-75,158-175`、`src/lib/ai/context.ts:268`）：它把全部文件列在「【已上传文件】」下。这是所有项目对话共用的上下文，不是招标证据；改它影响面大，另开任务。
- 不改外部 API 建项（`src/app/api/v1/projects/route.ts:211-221`）写入的外部链接行。不修外部链接文件让文件流水线反复空转的既有问题：可分析类型的外部链接停在待解析，`parse-content.ts:90` 没有存储地址就直接返回，`project-file-manager.tsx:168` 的循环就一直不结束。另开任务。
- 不改 `enqueue-package.ts`：入队、幂等、取代的逻辑都不动（与 FIX-18 的分工见 design「相邻改动」）。
- 不补救已有分析：不自动改写旧分析的文档清单与结果，不自动重跑；上线后由人在受影响的项目里重新分析（design D6）。
