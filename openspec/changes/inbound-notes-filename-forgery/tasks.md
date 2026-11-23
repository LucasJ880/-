# Tasks：供应商的附件文件名与证据不能在报价备注里冒充回读字段（FIX-24）

> 开工前提：
> 1. 等 FIX-14（`extracted-text-nul-other-paths`，PR #569）合并，协调会话安排后再开工；开工时把 main 合入本分支（`git merge origin/main`）。
>    - 四件套按 main `2a0eb964` 写行号；FIX-14 合并后的版本见 design「相邻改动」（起草时对照 `e2b4cd83`，审查时 `101efab9`，以合并时为准）。
>    - 合入后逐处复核 `inbound-apply.ts`、`inbound-parse.ts`、`notes-parse.ts`、两个测试脚本、`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 FIX-24 一行与 CHAIN-0 一行、`docs/QINGYAN_CHAIN-0_ENV_CHECK.md` 第 7 项。对不上就先改四件套、跑 `openspec validate inbound-notes-filename-forgery --strict`，再动代码。
>    - 复核 FIX-14 附件提示句的最终原文。design 里引的是「…多半是勾选框；请打开原件核对勾选项和价格」，3.2 的 SQL 照原文排除。
> 2. design「留给 GATE」三条已定：1 = A、2 = B + 整段 R3（按多维审查收窄）、R4、R5、3 = A（协调会话 2026-11-23 定，Lucas 2026-11-22 授权按推荐）。下面各条按这个结论写，没有分支。
> 3. 开工前跑一遍将要触碰模块的已注册测试，记下通过数，写进报告草稿。
>    - main 上实测：`notes-parse.test.ts` 17、`inbound-apply.test.ts` 72、`inbound-parse.test.ts` 38、`chase-pure.test.ts` 55、`compare.test.ts` 47、`tracker-pure.test.tsx` 89。
>    - 合入后再记：`tracking-notify.test.ts` 与 FIX-14 的 `src/lib/files/__tests__/extracted-text-other-paths.test.ts`。

## 1. 测试先行

- [x] 1.1 写 `src/lib/tender-rfq/__tests__/notes-forgery.test.ts`（不连库、不调模型，用例名用中文），按 design D7 分五节，每条用例对应规格 `tender/rfq-inbound-notes` 的一个 Scenario。
  - 每条用例单独计入通过 / 失败，跑完全部再按失败数退出：不用 `assert` 抛错中途退出，失败清单一次打全。
  - 第 5 节普通回信的期望串取自 main 的实际输出，写死在测试里。
  - 注册：
    - `scripts/test-all.sh` 放在 `notes-parse.test.ts` 那一条之后，标签「招标询价 报价备注自动段防冒充（文件名 / 证据 / 币种，FIX-24）」；
    - `scripts/test-ci-unit.sh` 放在 P1-6G 一段之后，加一行注释 `# FIX-24：…（纯逻辑，无 DB / 无 AI）`。
  - verify：在改动前的代码上 `npx tsx src/lib/tender-rfq/__tests__/notes-forgery.test.ts` 退出码非 0，失败的是第 1–4 节（照过的几条见 design D7），第 5 节除「报价备注里是中和后的文件名」外全部通过；输出的失败清单完整（不是在第一条失败处停下），存进报告。`bash scripts/check-test-registry.sh` 输出 OK。

## 2. 实现

- [x] 2.1 `src/lib/tender-rfq/inbound-apply.ts`（design D1、D2、D5）。
  - 加一个不导出的中和函数，规则三条：
    - 控制字符（U+0000–U+001F、U+007F–U+009F）与 U+2028、U+2029 → 空格；
    - 「；」→「;」；
    - 紧挨着的「"）」→「")」。
  - 用在：附件一栏的文件名、两处币种事实、「不一致」里的本次币种与已录币种。
  - `q()` 依次做三步：先换控制字符与 U+2028 / U+2029，再做原有的空白归一，最后「"）」→「")」。
  - 附件说明按「文件名：」最长前缀对上；同名后一条覆盖前一条。
  - 保留 FIX-14 的提示句与整段 `toStorableText`。
  - verify：`notes-forgery.test.ts` 第 1、5 节通过；`notes-parse.test.ts`、`inbound-apply.test.ts` 通过数与开工前相同；`git diff origin/main -- src/lib/tender-rfq/inbound-apply.ts | grep -E '^[-+]export'` 无输出；`npm run typecheck` 退出码 0。
- [x] 2.2 `src/lib/tender-rfq/inbound-parse.ts`：币种核对先看转大写后是否是三个 A–Z 字母，不是就判「原文里没有」、不拼正则（design D3）。不改提示、证据文本与附件抽取。
  - verify：`notes-forgery.test.ts` 第 2 节通过（含「(((」不抛错、作废清单有币种）；`inbound-parse.test.ts` 通过数与开工前相同；`git diff origin/main -- src/lib/tender-rfq/inbound-parse.ts | grep -E '^[-+]export'` 无输出；`npm run typecheck` 退出码 0。
- [x] 2.3 `src/lib/tender-rfq/notes-parse.ts`：读取五条规则（design D4）。
  - R1：行内 `\r`、U+2028、U+2029 先换空格；行头严格为写入时刻格式且能原样还原，消息编号只含字母、数字、`-`、`_`。
  - R2：读到以「附件：」开头的一块即停。
  - R3：整段（含附件一栏及之后）占位后仍含「"）」的，整段不认。
  - R4：第一个「附件：」块及之后出现证据占位的，整段不认。
  - R5：附件一栏之前认得出的字段按写入顺序、除「其它档」外不重复，违反的整段不认。
  - 更新文件头注释里的规则说明；导出签名与 `ParsedAutoNotes` 形状不变。
  - verify：
    - `notes-forgery.test.ts` 退出码 0（五节全过）；
    - `notes-parse.test.ts`、`chase-pure.test.ts`、`compare.test.ts`、`tracker-pure.test.tsx`、`tracking-notify.test.ts`、`src/lib/files/__tests__/extracted-text-other-paths.test.ts` 通过数与开工前相同；
    - `git diff origin/main -- src/lib/tender-rfq/notes-parse.ts | grep -E '^[-+]export'` 无输出；`npm run typecheck` 退出码 0。

- [x] 2.4 按多维审查修订（协调会话 2026-11-23 的修订清单）。
  - `notes-parse.ts`：R1 行头按原始行匹配、只对正文换空格（Q1 / M1）；R3 按多维审查收窄（K3、Q5，design D4）；导出写入顺序表 `AUTO_NOTES_WRITE_ORDER`（M6）。
  - `inbound-apply.ts`：「（证据：」也中和（K1）；强制项编号过同一个中和（Q4）。
  - `compare-service.ts`：取数循环原样抽成 `toCompareInputs`（M8，design D8）。
  - `notes-forgery.test.ts` 补 M2–M7、Q1、K1、K3、Q4、Q5、P3、P4 与可选各条；每条新断言在对应源码变异下跑一次（28 个变异），确认失败，记数字，再还原。
  - verify：`notes-forgery.test.ts` 120 / 0；28 个变异每个都有新断言失败、还原后 120 / 0；既有测试通过数与开工前相同；`npm run typecheck` 退出码 0。

## 3. 验收

- [x] 3.1 全部门禁。
  - verify：
    - `npm test` 对照既有失败清单无新增；
    - `npm run test:ci` PASS（含新测试）；
    - `npm run typecheck` 退出码 0；
    - `npm run lint:baseline` PASS；
    - `bash scripts/check-test-registry.sh` OK；
    - `OPENSPEC_TELEMETRY=0 openspec validate inbound-notes-filename-forgery --strict` valid；
    - 开工前提第 3 条记下的通过数不减。
- [x] 3.2 写 `docs/acceptance/fix-24/prod-check.sql`，内容是 design Migration Plan 的 A、B、C、C0、D 五段：`BEGIN READ ONLY` 开头、`ROLLBACK` 结尾，中间只有 `SET LOCAL`、SELECT / WITH 与 psql 的 `\echo` / `\gset` / `\if`。多维审查后：输出不出价格与原文、带项目名 / 轮次 / 供应商名 / 链接，B 段加「比价还采信这次回信吗」、口径与读取规则一致，`[0-9]` 代替 `\d`，不合法的审计原文挪进 C0（Q2、Q3、Q6、P5、W2、W3、W8）；新增隔离库回归测试 `src/lib/tender-rfq/__tests__/prod-check-fix24-db.isolated.test.ts`（M9），注册进 `scripts/test-all.sh`，每个条件一个 SQL 变异跑过。
  - 在隔离库上用一次性种子跑一遍。种子不进仓库，审计都是 `targetType = 'rfq_inbound_message'`、`action = 'rfq_inbound:applied'`、`afterData` 带对应 `itemId`、时间在行头之后 2 分钟内：
    - 真实条目甲：四行，**每行都配一条对得上的审计**：
      - ① 正常段；
      - ② 附件一栏带「；」，审计里文件名带「；」；
      - ③ 价格证据未成对跳出，审计里价格证据带「"）」；
      - ④ 贸易条款证据里成对跳出、字段顺序乱（审计里不含贸易条款证据）。
    - 条目乙：
      - ① 一行正常段，配审计；
      - ② 一行 2099 年的伪造行；
      - ③ 一行时间在过去、没有审计的伪造行；
      - ④ 一行 `2026-99-99T99:99:99.999Z` 的伪造行；
      - ⑤ 一行 `2026-02-30T00:00:00.000Z` 的伪造行（格式对、日期不存在，验当月天数那一层）。
    - 另三条审计：
      - `afterData` 里带 `\u0000` 转义；
      - 带反斜杠加「u0000」文字（JSON 里是 `\\u0000`）；
      - 带落单代理字符转义 `\ud800`。
    - 一个币种为「.*.」的条目。
  - verify（初版种子）：
    - 整个文件跑完、中途不报错；
    - A 段正好 4 行（乙②③④⑤），B 段正好 3 行（甲②③④），C 段正好 2 行（甲②的文件名、甲③的价格证据），C0 段正好 1 行，D 段正好 1 行；
    - 输出存进报告；
  - verify（多维审查后）：`NODE_ENV=test DATABASE_ENVIRONMENT=isolated … npx tsx src/lib/tender-rfq/__tests__/prod-check-fix24-db.isolated.test.ts` 在 `qy_iso_a` 上退出码 0；30 个 SQL 变异除 SQ-A7（这个库 `C.UTF-8` 排序规则下 `\d` 与 `[0-9]` 等价）外都让它失败；
    - `grep -vE '^\s*(--|$)' docs/acceptance/fix-24/prod-check.sql` 里没有 INSERT / UPDATE / DELETE / ALTER / CREATE / DROP。
- [x] 3.3 写 `docs/QINGYAN_FIX-24_REPORT.md` + 更新 TASKFLOW 状态列。
  - 报告：
    - 开工前复核：合入 FIX-14 后的行号、TASKFLOW 与核查表的现状；
    - design Context 向量表与「旧数据」表逐条的改动前 / 改动后，P1、P3、P4 与 L07 写明「仍生效」；
    - 测试改动前 / 改动后输出、门禁结果、多维审查结论；
    - 「留给 GATE」三条已定的结论；
    - 仍未核实的：Gmail 是否原样交出文件名里的换行、生产库的 PostgreSQL 版本；
    - **没有开关，合并即在生产生效**，回滚只能 revert 这一个 PR；三个询价自动化开关打开之前要满足前提 ④、⑤；
    - **合并后要人做的事**：
      - 有生产只读权限的人跑 `docs/acceptance/fix-24/prod-check.sql`，结果原样贴回；
      - A 段不为 0 时另开 change 做一次性修复（Owner Gate），修完再跑一次。
  - `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：
    - 改写「Phase F（续）— 情报串联」表里已有的 FIX-24 一行（FIX-14 已登记，main `fbacf6bd` 上状态 `[ ]`），写成本 change 的说明，依赖 FIX-14，状态 `[~]`，不另加第二行；
    - CHAIN-0 一行：核对已有的 ④「FIX-24 已合并部署」，在其后加 ⑤（A 段为 0 行；不为 0 时按 TASKFLOW「FIX-24 后续 4」另开 change 删掉伪造行、重跑核查；剩下的每一行写明为什么是真实行，经 Owner Gate 逐行确认，记在核查表验证表第 7 项）。
  - `docs/QINGYAN_CHAIN-0_ENV_CHECK.md`：
    - 填写顺序与第 7 行「建议值」同样核对 ④、加 ⑤；
    - 「验证」表第 7 项一行写明 ⑤ 的证据：只读核查跑的日期与 A 段行数。
  - 登记后续任务（各一行，编号「待定」，状态 `[ ]`）：
    - 原样读报价备注的三处模型调用与旧报价对比接口（proposal Out of scope 第 3 条）；
    - 询价明细只能整段覆盖报价备注（第 4 条）；
    - 强制项编号按 `【强制】(\S+)` 扫整封询价正文（含供应商名），编号里可能夹带分隔符（第 7 条）；
    - prod-check A 段不为 0 时的一次性修复（GATE 3 A）。
  - verify：
    - 报告存在，含「开工前复核」「没有开关，合并即在生产生效」「合并后要人做的事」三节；
    - `grep -n "^| FIX-24 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 正好一行、状态 `[~]`；
    - `grep -n "⑤" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md docs/QINGYAN_CHAIN-0_ENV_CHECK.md` 在 CHAIN-0 一行与核查表填写顺序、第 7 行都有命中，且都提到 `prod-check`。

## Workflow follow-up

- `/opsx:verify inbound-notes-filename-forgery`。
- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent，逐条核实后修，重跑测试；PR 正文写「多维审查」一节。维度：
  - 正确性与回归：普通回信逐字不变、BIDPAGE 依赖的导出与返回形状；
  - 安全 / 隐私与八条硬纪律：逐个向量再试一遍，含全角 / 半角变体、零宽字符、Cf 类、证据里的引号组合、成对与不成对跳出、假附件一栏；
  - 规格—代码—测试一致性；
  - 使用流畅与文案：备注里附件一栏的显示；
  - 另加「旧数据」：手写若干条本次改动之前的备注字符串，核对 R1–R5 不丢写入方写出的真实字段，并对照审查员的 L01–L18 与起草补测的 P1、P3、P4；
  - 另加「只读核查」：prod-check 在种子上的结果与 3.2 一致，每段都不会中途报错。
- PR 合并后跑 `/opsx:archive inbound-notes-filename-forgery --yes`，走独立小 PR；TASKFLOW FIX-24 改 `[x]`；至少一个子 agent 核对主规格与 delta、TASKFLOW 状态与合并记录。
