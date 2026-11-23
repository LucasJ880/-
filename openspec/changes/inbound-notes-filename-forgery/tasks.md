# Tasks：供应商的附件文件名与证据不能在报价备注里冒充回读字段（FIX-24）

> 开工前提：
> 1. FIX-14（`extracted-text-nul-other-paths`，PR #569）合并后，把 main 合入本分支（`git merge origin/main`）再开工。
>    - 四件套按 main `2a0eb964` 写行号，FIX-14 合并后的行号见 design「相邻改动」。合入后逐处复核 `inbound-apply.ts`、`inbound-parse.ts`、`notes-parse.ts` 与两个测试脚本，对不上先改四件套、跑 `openspec validate inbound-notes-filename-forgery --strict`，再动代码。
>    - 复核 FIX-14 附件提示句的最终原文（design 里引的是 `e2b4cd83` 上的「…多半是勾选框；请打开原件核对勾选项和价格」），3.2 的 SQL 照原文排除。
> 2. design「留给 GATE」三条等 GATE 结论；下面各条按推荐（1 = A、2 = B、3 = A）写。结论不同时先改四件套。
> 3. 开工前跑一遍将要触碰模块的已注册测试，记下通过数（main 上：`notes-parse.test.ts` 17、`inbound-apply.test.ts` 72、`inbound-parse.test.ts` 38、`chase-pure.test.ts` 55、`compare.test.ts` 47、`tracker-pure.test.tsx` 89；FIX-14 的 `src/lib/files/__tests__/extracted-text-other-paths.test.ts` 合入后记），写进报告草稿。

## 1. 测试先行

- [ ] 1.1 写 `src/lib/tender-rfq/__tests__/notes-forgery.test.ts`（不连库、不调模型，用例名用中文），按 design D7 分五节，每条用例对应规格 `tender/rfq-inbound-notes` 的一个 Scenario。
  - 第 5 节普通回信的期望串取自 main 的实际输出，写死在测试里。
  - 注册：`scripts/test-all.sh` 放在 `notes-parse.test.ts` 那一条之后，标签「招标询价 报价备注自动段防冒充（文件名 / 证据 / 币种，FIX-24）」；`scripts/test-ci-unit.sh` 放在 P1-6G 一段之后，加一行注释 `# FIX-24：…（纯逻辑，无 DB / 无 AI）`。
  - verify：在改动前的代码上 `npx tsx src/lib/tender-rfq/__tests__/notes-forgery.test.ts` 退出码非 0，失败的是第 1–4 节、第 5 节全部通过；失败清单存进报告。`bash scripts/check-test-registry.sh` 输出 OK。

## 2. 实现

- [ ] 2.1 `src/lib/tender-rfq/inbound-apply.ts`（design D1、D2、D5）。
  - 加一个不导出的中和函数：控制字符（U+0000–U+001F、U+007F–U+009F）与 U+2028、U+2029 → 空格，「；」→「;」。
  - 用在附件一栏的文件名、两处币种事实、「不一致」里的本次币种与已录币种。
  - `q()` 先换控制字符与 U+2028 / U+2029，再做原有的空白归一，最后「"）」→「")」。
  - 附件说明按「文件名：」前缀对上，同名后一条覆盖前一条。
  - 保留 FIX-14 的提示句与整段 `toStorableText`。
  - verify：`notes-forgery.test.ts` 第 1、5 节通过；`notes-parse.test.ts`、`inbound-apply.test.ts` 通过数与开工前相同；`git diff origin/main -- src/lib/tender-rfq/inbound-apply.ts | grep -E '^[-+]export'` 无输出。
- [ ] 2.2 `src/lib/tender-rfq/inbound-parse.ts`：币种核对先看转大写后是否是三个 A–Z 字母，不是就判「原文里没有」，不拼正则（design D3）。不改提示、证据文本与附件抽取。
  - verify：`notes-forgery.test.ts` 第 2 节通过（含「(((」不抛错、作废清单有币种）；`inbound-parse.test.ts` 通过数与开工前相同；`git diff origin/main -- src/lib/tender-rfq/inbound-parse.ts | grep -E '^[-+]export'` 无输出。
- [ ] 2.3 `src/lib/tender-rfq/notes-parse.ts`：读取三条规则（design D4）。
  - R1：行内 `\r`、U+2028、U+2029 先换空格；行头严格为写入时刻格式、消息编号只含字母、数字、`-`、`_`。
  - R2：读到以「附件：」开头的一块即停。
  - R3：附件一栏之前占位后仍含「"）」的，整段不认。
  - 更新文件头注释里的规则说明；导出签名与 `ParsedAutoNotes` 形状不变。
  - verify：`notes-forgery.test.ts` 退出码 0（五节全过）；`notes-parse.test.ts`、`chase-pure.test.ts`、`compare.test.ts`、`tracker-pure.test.tsx`、`src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过数与开工前相同；`git diff origin/main -- src/lib/tender-rfq/notes-parse.ts | grep -E '^[-+]export'` 无输出。

## 3. 验收

- [ ] 3.1 全部门禁。
  - verify：`npm test` 对照既有失败清单无新增；`npm run test:ci` PASS（含新测试）；`npm run typecheck` 退出码 0；`npm run lint:baseline` PASS；`bash scripts/check-test-registry.sh` OK；`OPENSPEC_TELEMETRY=0 openspec validate inbound-notes-filename-forgery --strict` valid；开工前提第 3 条记下的通过数不减。
- [ ] 3.2 写 `docs/acceptance/fix-24/prod-check.sql`（design Migration Plan 的 A–D 四段；`BEGIN READ ONLY` 开头、`ROLLBACK` 结尾，中间只有 SELECT / WITH）。
  - 在隔离库上用一次性种子（不进仓库）跑一遍：
    - 一个真实条目：一行带审计的正常段 + 一行文件名带「；」的段 + 一行证据跳出引号的段；
    - 一个伪造条目：一行 2099 年的伪造行 + 一行时间在过去、没有审计的伪造行；
    - 一条文件名带「；」的审计；
    - 一个币种为「.*.」的条目。
  - verify：A 段正好列出两行伪造行，B 段正好列出两行，C 段正好一条，D 段正好一条；输出存进报告；`grep -vE '^\s*(--|$)' docs/acceptance/fix-24/prod-check.sql` 里除 `BEGIN READ ONLY;` / `ROLLBACK;` 外没有 INSERT / UPDATE / DELETE / ALTER / CREATE。
- [ ] 3.3 写 `docs/QINGYAN_FIX-24_REPORT.md` + 更新 TASKFLOW 状态列。
  - 报告：
    - 开工前复核（合入 FIX-14 后的行号）；
    - design Context 向量表逐条的改动前 / 改动后；
    - 测试改动前 / 改动后输出、门禁结果、多维审查结论；
    - 「留给 GATE」三条的结论；
    - 「Gmail 是否原样交出文件名里的换行」仍未核实；
    - **没有开关，合并即在生产生效**，回滚只能 revert 这一个 PR；三个询价自动化开关打开之前必须已部署；
    - **合并后要人做的事**：有生产只读权限的人跑 `docs/acceptance/fix-24/prod-check.sql`、结果原样贴回；A 段不为 0 时按 GATE 3 另开 change。
  - `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：在「Phase F（续）— 情报串联」表 FIX-14 一行及它登记的后续各行之后加 FIX-24 一行（若 FIX-14 已为此登记一行则改写那一行），依赖 FIX-14，状态 `[~]`；CHAIN-0 一行的开关前提改成「CHAIN-4b 合并且 FIX-14、FIX-24 部署之后」。
  - `docs/QINGYAN_CHAIN-0_ENV_CHECK.md`：填写顺序与第 7 项的前提同样加上 FIX-24。
  - 登记后续任务（各一行，编号「待定」，状态 `[ ]`）：
    - 原样读报价备注的三处模型调用（proposal Out of scope 第 3 条）；
    - 询价明细只能整段覆盖报价备注（第 4 条）；
    - prod-check A 段不为 0 时的一次性修复（GATE 3 A）。
  - verify：报告存在，含「开工前复核」「没有开关，合并即在生产生效」「合并后要人做的事」三节；`grep -n "^| FIX-24 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 正好一行、状态 `[~]`；`grep -n "FIX-24 部署之后" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md docs/QINGYAN_CHAIN-0_ENV_CHECK.md` 两个文件都有命中。

## Workflow follow-up

- `/opsx:verify inbound-notes-filename-forgery`。
- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent，逐条核实后修，重跑测试；PR 正文写「多维审查」一节。维度：
  - 正确性与回归（普通回信逐字不变、BIDPAGE 依赖的导出与返回形状）；
  - 安全 / 隐私与八条硬纪律（逐个向量再试一遍，含全角 / 半角变体、零宽字符、Cf 类、证据里的引号组合）；
  - 规格—代码—测试一致性；
  - 使用流畅与文案（备注里附件一栏的显示）；
  - 另加「旧数据」：手写若干条本次改动之前的备注字符串，核对 R1–R3 不丢真实字段。
- PR 合并后跑 `/opsx:archive inbound-notes-filename-forgery --yes`，走独立小 PR；TASKFLOW FIX-24 改 `[x]`；至少一个子 agent 核对主规格与 delta、TASKFLOW 状态与合并记录。
