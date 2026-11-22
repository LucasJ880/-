# Proposal：系统生成的文件不进招标文件包（FIX-19）

TASKFLOW：FIX-19（`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`「Phase F（续）— 情报串联」表；2026-11-22 生产实测修复）

> 开工前提：
> - FIX-13（#546）已于 2026-11-22 合并，main 为 `13c7ed33`。本 change 的行号都按 `13c7ed33` 写；没被 FIX-13 改过的文件，行号与 `2ef4f9c8` 相同。
> - 开工顺序 FIX-17 → FIX-21 → FIX-19：FIX-21 合并后把 main 合入本分支再开工（见 tasks 开头）。
>
> 合并前提：
> - design「生产只读核对」第 1、2 条**还没有跑**：本会话的容器连不到生产库。2026-11-22 23:30 UTC 已把可直接执行的 `docs/acceptance/fix-19/prod-check.sql` 交给 Lucas。
> - 结果回来之前**不合并**。Lucas 把项目全权交给本会话之后，本会话的做法是：代码先写到可合并；第 1、2 条结果回来、且第 2 条为 0 之前不合并；第 2 条不为 0 就停，回 design「留给 GATE」第 2 条（见 tasks 开头「合并前提」）。

## Why

生产实测（2026-11-22，项目「12-3」）：「一键生成文档」生成的「China Supplier Sourcing Brief v1」被当成招标文件包的「主文件」纳入分析。原因是选包只看文件类型和解析状态，不看文件从哪来：生成文件、客户报价 PDF、报价导入的供应商报价只要是可分析的类型就会进包，标题不像招标文件的一律默认判成主文件。

## What Changes

- 新增一个文件来源判定（纯函数 + 常量）：招标文件包只认「用户上传」这一个来源（`source = "upload"`，只有项目文件上传接口写它），其余来源一律不是招标文件。上传接口改为写这个常量。
- 改选包：两条分析入口共用的选包逻辑先按来源过滤。被过滤掉的文件不进候选，不读它的存储内容，也不补写内容指纹。以下几处都经这一处：
  - 一键 AI 分析（workforce）
  - 分析面板的「分析投标文件」与「重新分析当前投标文件包」
  - 上传后自动入队
  - 执行摘要算当前指纹
- 改就绪判断：自动入队的「文件包已就绪」只看用户上传的文件。可分析类型（如 pdf）的外部链接没有可读内容，会永远停在待解析。从此它不再让就绪判断卡在「仍在处理」，也不再因为缺内容指纹让一键分析、分析投标文件、重新分析整次失败。
  - 自动入队对这类项目仍然不会触发，原因在文件流水线。流水线每次先挑中这份待解析的外部链接（`process-next/route.ts:105-124`），解析函数见它没有存储地址就直接返回（`parse-content.ts:98`），于是每次都返回「解析」这一步、`done` 为 false，走不到自动入队。这个既有问题不在本次（见 Out of scope）。
- 改覆盖清单「上传 N」的计数：改用共享判定，计数结果不变。
- 改 agent「标书分析」技能：
  - 文件清单里，非上传文件一律标为排除。原来只排除投标准备清单。
  - 完整性判定（相关文档数、补遗数、覆盖率、「不完整」的结论与原因）不再计入非上传文件。原来被排除的投标准备清单仍算在「相关文档」里，有这份清单的项目一律被判「不完整」。
- 改项目情报交给模型的文件：只取用户上传的文件。原来只排除投标准备清单。
- 改分析师备忘录 v2 的全文语料：只读用户上传文件的页面。原来读项目全部文件。
- 改业主回复匹配：字面量 `"upload"` 换成共享常量，语义不变。
- 改分析详情接口：旧分析的文件列表里，不是用户上传的文件不再标「主文件」，改标「不是上传的招标文件（重新分析后不再纳入）」。上传文件的标签不变。
- 新增测试：
  - 纯函数与接线断言新开一个测试文件，进 CI 子集。
  - 就绪、覆盖、输入完整性三个既有测试补用例。输入完整性补的是「上传、被解析过的生成文件、报价导入、投标准备清单同在时判为完整」。
  - 隔离库端到端新开一个文件，在只有测试、没有改动的代码上必须失败。
  - `t1b-integration.test.ts` 补上夹具缺的 `source`，并加一份生成文件，断言 workforce 清单与旧流程入队都不含它。

## Capabilities

### New Capabilities

- `tender/analysis-package-inputs`：规定招标文件包由哪些文件组成，即只纳入用户上传的文件。同时规定：
  - 就绪判断与内容指纹只算这些文件；
  - 读招标全文的其它地方用同一口径：项目情报、分析师备忘录、agent 标书分析技能，包括这个技能的完整性判定；
  - 旧分析里不该纳入的文件怎样标明。

### Modified Capabilities

无。理由：
- 已归档的主规格里没有招标文件包组成的要求。
- FIX-13 新增的 `tender/analysis-package-coverage` 规定覆盖清单的排除明细，本次不改它的要求，覆盖计数的口径也保持不变。
- `tender/web-next-step`、`tender/bid-workspace` 里「有没有招标文件」的口径本次不改（见 Out of scope）。

## Impact

- 代码：
  - 新增 `src/lib/files/document-source.ts`。
  - `src/app/api/projects/[id]/files/route.ts`：写入来源改用常量。
  - `src/lib/tender-auto-analysis/package.ts`：选包按来源过滤，放在补写指纹之前。
  - `src/lib/tender-auto-analysis/package-ready.ts`：就绪行带来源。
  - `src/lib/tender-auto-analysis/package-coverage.ts`：计数改用共享判定。
  - `src/lib/tender-understanding/package-input.ts`：清单的排除判定，以及完整性判定的相关文档数与补遗数（`:644-723`）。
  - `src/lib/files/intelligence-extractor.ts`。
  - `src/lib/tender-analyst-memo/v2/pipeline.ts`。
  - `src/lib/tender-auto-analysis/reply-resolution.ts`：常量替换字面量。
  - `src/lib/tender-auto-analysis/display-labels.ts` 与 `src/app/api/projects/[id]/tender-analysis/runs/[runId]/route.ts`：旧分析的角色标签。
- 测试：
  - 新增 `src/lib/files/__tests__/document-source.test.ts`，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - 新增 `src/lib/tender-auto-analysis/__tests__/package-source-db.isolated.test.ts`，注册进 `scripts/test-all.sh`，没有隔离库时跳过。
  - 扩以下四个既有测试：
    - `package-ready.test.ts`
    - `package-coverage.test.ts`
    - `src/lib/tender-understanding/__tests__/input-completeness.test.ts`
    - `src/lib/tender-workforce/__tests__/t1b-integration.test.ts`
- 零 schema；无新开关、无新队列、无新模型调用。没有开关，合并即在生产生效。已经纳入生成文件的旧分析不会自动改写，要人重新分析：部署后跑 `docs/acceptance/fix-19/prod-check.sql` 第 3 条拿名单，旧流程组织点面板「重新分析当前投标文件包」，一键分析组织点卡片的「重新分析」（见 design D6）。
- 相邻 change：
  - 顺序定为 FIX-13（已合并）→ FIX-17 → FIX-21 → FIX-19 → FIX-18 → FIX-22。FIX-21 合并后把 main 合入本分支再开工。
  - FIX-19 先合并时，FIX-18、FIX-22 与并行会话 BIDPAGE 新写的隔离库夹具必须写 `source: "upload"`，否则它们建的文件不会进文件包（见 design「相邻改动与合并顺序」）。

## 受影响的 Muse 意图

不改 `src/lib/muse-bridge/**`。以下意图读的是最新分析，受影响的项目重新分析之后跟着变；重新分析之前，旧分析里从生成文件抽出的内容仍在：
- `ask`：读最新可用分析的摘要与要求（`router.ts:367`，`chat-context.ts:144-217`）。
- `rfq`：经 `src/lib/tender-rfq/service.ts` 取最新可用分析里已确认的要求（`router.ts:417`）。
- `next_step`：读最新分析（`router.ts:580`）。

`status` 只读最新分析的状态值（`router.ts:267`）。`compare`、`chase`、`price_scenario` 不读文件包。

## Out of scope

下面写「另开」的各条，在 tasks 7.1 逐条登记成 TASKFLOW 的后续任务（编号待定）。

- 不删、不改任何已有的 `ProjectDocument` 行：生成文件照旧出现在项目文件列表和「一键生成文档」卡片里。已经被页级解析过的生成文件，页面行和 `contentText` 保留。
- 不改文件抽屉的分组：生成文件仍归在「外部链接」下、带外链图标（`src/components/project-files/project-file-manager.tsx:374-377,643,663`）。
  - 理由：只是显示问题，不影响分析。
  - 另开小改动，按来源分「上传 / 系统生成 / 报价导入 / 外部链接」。
- 不改文件处理流水线（`src/app/api/projects/[id]/files/process-next/route.ts`）。它的第 2 步会给有正文的非上传文件做 AI 摘要；`src/lib/projects/apply-document-metadata.ts` 会读这些摘要补项目字段，只补空的。
  - 理由：本次之后，新生成的文件不会再进分析、不会被页级解析，也就没有正文，第 2 步碰不到它们。受影响的只剩已被解析过的少数旧行（如 12-3），而且项目情报已经不读它们。
  - 另开任务时一并处理报价导入文件被摘要的问题。
- 不改项目 AI 上下文（`src/lib/projects/project-ai-context.ts:60-75,158-175`、`src/lib/ai/context.ts:268`）。它把全部文件列在「【已上传文件】」下。
  - 理由：这是所有项目对话共用的上下文，不是招标证据，改它影响面大。
  - 同一类的还有三处，读的都是不分来源的文件标题、摘要或正文：
    - `src/lib/bid-workflow/start-intelligence.ts:82-86`（开始投标调查）
    - `src/lib/agent/skills/supply-chain-analysis.ts:88-92`（供应链分析技能）
    - `src/lib/agent-core/tools/enterprise-readonly.ts:397,455,666`（agent 查项目文件的只读工具）
  - 一并另开任务。
- 不改项目结构化摘要卡（`src/lib/projects/structured-summary.ts:38-60`）。项目情报生成之后会调它（`intelligence-extractor.ts:381-385`），它读 8 份不分来源的文件，按关键词判项目类型标签。
  - 理由：它不调模型，也不是招标证据。改它会改变所有项目的类型标签。另开任务。
- 不改网页「下一步」与投标工作区判断「有没有招标文件 / 文件是否正在解析」的计数：
  - 网页「下一步」按项目全部文件计数（`src/lib/tender-next-step/service.ts:78-79`），由 `src/lib/tender-next-step/web-next-step.ts:248-263` 给出「还没上传招标文件」「招标文件正在解析」「已上传 N 个文件，还没有发起分析」。
  - 投标工作区按全部文件数判「有招标文件」（`src/lib/tender-bid-workspace/store.ts:30`、`workspace-view.ts:78`）。
  - 本次之后这两处仍会出现的现象：
    - 只有生成文件的项目，「下一步」照旧说「已上传 N 个文件，去分析」，分析入口却返回「没有可分析的投标文件」；
    - 项目里有一份待解析的外部链接 PDF 时，「下一步」一直说「招标文件正在解析」。
  - 理由：两处各有自己的主规格，口径都写成「项目有文件 → 有招标文件」（`openspec/specs/tender/web-next-step/spec.md:38`、`openspec/specs/tender/bid-workspace/spec.md:72`）。改它们要对两个能力写 MODIFIED、改各自的隔离库测试，而且只影响提示文字，不影响分析读什么。
  - 另开任务，改用本次的共享判定。
- 不改外部 API 建项（`src/app/api/v1/projects/route.ts:211-221`）写入的外部链接行。不修外部链接让文件流水线反复空转的既有问题：可分析类型的外部链接停在待解析，`parse-content.ts:98` 没有存储地址就直接返回，`project-file-manager.tsx:169` 的循环就一直不结束。另开任务。
- 不改 `enqueue-package.ts`、`enqueue.ts`、`trigger-service.ts`：入队、幂等、取代的逻辑都不动，这三个文件由 FIX-18 改。
  - 不修旧流程幂等键的既有缺陷。之前有同指纹的分析时，不强制新建的入队会撞唯一键，详见 design D6。写进报告「没做的」，另开任务。
- 不补救已有分析：不自动改写旧分析的文档清单与结果，不自动重跑。上线后由人在受影响的项目里重新分析（design D6）。
