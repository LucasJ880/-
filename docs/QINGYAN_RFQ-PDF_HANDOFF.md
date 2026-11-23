# 询价单 PDF（RFQ-PDF-1 / RFQ-PDF-2）· 交接（HANDOFF）

> 新会话做这条线从这里进。先读本文件，再读任务书 `docs/QINGYAN_RFQ-PDF_TASKBRIEF.md`，按「下一步」执行，不凭记忆重写。只记核对过的事实；没核对的写明。每完成一个节点更新本文件并提交。
> 招投标主线的总交接是 `docs/QINGYAN_TENDER_FLOW_HANDOFF.md`（由另一条会话线维护，本线不动它，避免冲突）。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-11-23 第三次（RFQ-PDF-1 已合并 #544、归档 #553 已合并；RFQ-PDF-2 四件套与源码已写完并推到分支，测试期望更新中，从 §0a 进） |
| 任务来源 | Evan，2026-11-20：「国内供应商询价 PDF 很差」；任务书由产品侧会话写，§4 七项已拍板 |
| 授权 | Evan 2026-11-21 在 Coding 会话原话：「现在你来全权负责，需要做多轮交叉验证，如果需要合并你来做，如果有问题，按照你推荐的做，需要多个子AGENT 从多方面来审计PR……这个是个长任务，做好hand off」。任务书 §1 的其余边界照旧：不开 `TENDER_RFQ_ATTACHMENT_ENABLED`、不在真实供应商的询价卡上点批准、不改生产环境变量、不发对外邮件 |
| 主线状态 | `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` → Phase F（续）— 询价单 PDF：RFQ-PDF-1、RFQ-PDF-2 两行 |
| 工作分支 | `claude/adoring-feynman-w8btkv`（本会话唯一可推的分支）。RFQ-PDF-1 合并后，归档与 RFQ-PDF-2 都要从最新 `main` 重开这个分支名（已合并的历史可 force-with-lease 覆盖） |

## 0. 下一步

1. **RFQ-PDF-1 已做完**：PR [#544](https://github.com/LucasJ880/-/pull/544) 由 Lucas 2026-11-22 合并；归档走独立小 PR（本文件这次更新所在的那个）。合并时 #538（CHAIN-2d）还没合并：它后合并时在 `src/lib/projects/generate/generate-docs.ts` 的 import 块会冲突，保留 main 上的两行（`buildProjectRfqSheet`、`rfqSheetRecordTitle`），再加它的 `redactLegacyMemo` 那一行。线上验证（在一个真实投标项目上点一次「供应商询价单 PDF」）还没有人做。
2. **RFQ-PDF-2**（`rfq-sheet-template-v2`，任务书 §5「T2」）：**下一步就是它**。从最新 main 开工（#533 已合并并归档，`tender/rfq-web-entry` 现在是 14 条，写增量前按 main 上的条目名写），`/opsx:propose` → 独立审四件套 → apply → 全量测试 → verify → 多维审查两轮 → 开 PR。报告里要有 8pt 与 7.5pt 两份样张的页数与首页截图。**字号由 Evan 打印后定（任务书 §4 第 6 项：定稿前不合并 RFQ-PDF-2）**——这一项是 Evan 自己要看实物才能定的，开出 PR、附上样张后停下来问他，不要替他定。
   - T2 的 8 组内容如果装不下 8 条 task，按任务书拆成两个 change，但只升一次版式版本。
   - RFQ-PDF-1 的审查带出三件事，已定并入 RFQ-PDF-2（TASKFLOW 那一行已写）：
     a. 回复截止不再落在截标当天（`build.ts` `computeReplyBy` 的下限是「今天 + 2 天」，截标前 2 天正好等于截标日，模板文字过禁出清单就命中「截标日期·询价附件」，起草询价与菜单询价单都生成不了；提前量设成 0 时每次都这样）。建议规则：回复截止不晚于截标前一天，算不出来就写「请尽快」。同时把 `attachment-db.isolated.test.ts` 等走真实时钟、截标日 2026-12-05 的夹具改成注入 `now`（否则 2026-12-03 当天会红）。
     b. 内部字段词表扩充（`build.ts` `INTERNAL_FIELD_PATTERNS` 现在只有 estimatedValue / ourBidPrice / winningBidPrice / 毛利 / 利润率 / 底价 / 我方预算 / 中标概率），要求编号与数量也过检查。安全审查实跑：「我方报价 98.7 万」「target margin 31%」、数量事实带金额、编号「底价-987654」之外的写法都会照印。
     c. 两句说明给出出路：身份命中的「供应商侧文件含招标身份信息（命中：…），未生成。」与「没有已确认且属于供应商侧的要求……」（后者在「都确认了但没有一条属于供应商侧」时指错路）。
     d. 归档核对带出的两处规格措辞，用 RFQ-PDF-2 的增量补回（主规格不手写）：`tender/supplier-identity-guard`「供应商侧生成文件」归档时为了不超过 500 字压短，丢了「内容只取自询价单本身」与「我方撰写的部分 SHALL NOT 含项目名称」两句（改这一条时注意正文仍要 ≤ 500 字，否则 `openspec validate --specs --strict` 不过）；`tender/rfq-sheet-download`「菜单入口与说明」里那句提示的引文与界面差一个标点（界面是「项目文件可能已更新，此前生成的 PDF 可能过期。建议重新生成。」）。
3. **不在这条线里做、但要有人知道的**（都不是本线引入，报告 §6 有出处）：CI 不跑隔离库测试（`ci.yml` 没设 `DATABASE_ENVIRONMENT=isolated`）；地点事实缺失时交付事实里的门牌地址、换了写法的截标日期绕得过禁出清单；生成接口兜底的 500 会回显异常原文；内容安全策略挡不住 meta refresh；同一项目并发生成会出重复版本号；询价入口等既有说明把「招标要求」页签叫成「需求」（12 处）；菜单生成新版后立刻提示「可能过期」。

## 0a. RFQ-PDF-2 做到哪了（2026-11-23）

change `rfq-sheet-template-v2`，分支 `claude/adoring-feynman-w8btkv`（从 main `22a87fb7` 开）。还没开 PR。

| 步骤 | 状态 |
|---|---|
| 四件套（proposal / 五份 specs 增量 / design / tasks 8 条） | 写完，`openspec validate rfq-sheet-template-v2 --strict` 通过；开工前的独立审查已派出，**结果还没处理**（回来后逐条核实，改四件套与代码） |
| 源码（tasks 1.1 / 1.2 / 2.1 / 3.1 / 3.2 的非测试部分 + 样张脚本） | 写完，`npm run typecheck` 通过（提交 `2231a5c1`） |
| 测试期望 | 更新中（派了一个子 agent，只改 `__tests__`，期望取自规格；它的报告里会列「规格与代码不一致」的地方，回来后逐条处理）。更新前 `build` / `attachment` / `sheet-download` 三个单测是红的，属预期 |
| 真实 Chromium 样张（`npx tsx scripts/rfq-sheet-sample.ts`） | 跑过：14 条 8pt **3 页**、7.5pt **2 页**；60 条两种字号都是 **6 页**；内嵌 Noto Sans SC；文字层没有招标身份；长编号 `MAND-TECH-0012` 不压到右边一列。产物在 `docs/acceptance/rfq-pdf-2/`（改模板后要重跑并覆盖） |
| 全量 `npm test` | 没跑。main `22a87fb7` 的基线在跑（scratchpad，可能已丢；丢了就重跑：检出 `origin/main` 的 worktree + 单独的库） |
| verify、多维审查两轮、PR、报告 `docs/QINGYAN_RFQ-PDF-2_REPORT.md`、TASKFLOW | 没做 |

接手顺序：① 看 `git status` 与 `git log`，测试子 agent 的改动若在工作区没提交，先跑一遍它改的测试再提交；② 处理开工前审查与测试子 agent 报出的不一致；③ tasks 逐条核对打勾；④ 全量测试对基线；⑤ `/opsx:verify`；⑥ 多维审查两轮（§5）；⑦ 写报告、更新 TASKFLOW；⑧ 开 PR，**停下把 `docs/acceptance/rfq-pdf-2/` 里 8pt 与 7.5pt 两份样张交给 Evan 定字号，定之前不合并**。

做 RFQ-PDF-2 时自己定的、要让审核方知道的几处（都写在 design 里）：
- 数量阶梯只认人填的；没填时照印数量事实的中文原文，不再从事实里解析一个数字当阶梯（D2）。
- 邮件正文每行以要求编号开头（`R-001 【必须】…`），回信解析 `rfqContextFromBody` 两种写法都认（D5）——这是任务书「不改回信解析」之外唯一动到的一个正则。
- 回复截止按组织时区的日期算，且不晚于截标前一天；算出来早于今天就写「请尽快」（D6）。
- 载荷 `attachment.draft` 多了可选的 `contactName` 与 `timeZone`（定格起草时的联系人与时区，D8）。
- 派生材料项的措辞从「样品（按行项说明的规格）」改成「样品（按要求里写的规格）」。
- 「客户未明确数量…」替换原来的「招标文件未明确数量…」（供应商手里没有招标文件；保留「未明确」三个字，回信解析靠它）。

## 1. 进度

| 节点 | 状态 |
|---|---|
| 任务书入库 | 完成（`docs/QINGYAN_RFQ-PDF_TASKBRIEF.md`） |
| RFQ-PDF-1 四件套 | 完成，经开工前一轮独立审查修订 |
| RFQ-PDF-1 实现 | 完成（tasks 8 条全勾） |
| RFQ-PDF-1 多维审查 | 两轮做完（第一轮五个维度、第二轮三个子 agent），无阻断，逐条处理见报告 §5a |
| RFQ-PDF-1 PR | [#544](https://github.com/LucasJ880/-/pull/544)，2026-11-22 由 Lucas 合并 |
| RFQ-PDF-1 归档 | 完成（`2026-11-23-supplier-docs-converge`；`openspec validate --specs --strict` 149 / 149） |
| RFQ-PDF-2 | 未开工；事实摸底已做（§3） |

## 2. 已核对的要点（RFQ-PDF-1 做完后系统是什么样）

- 发给供应商的生成文件只有一种：`supplier_rfq`「供应商询价单 PDF」。入口 `generateProjectDocument`（`src/lib/projects/generate/generate-docs.ts`）最前面的分支 → `buildProjectRfqSheet`（`src/lib/tender-rfq/sheet-download-service.ts`）→ `composeRfqSheet`（`sheet-download.ts`，纯函数）→ `renderCheckedRfqSheet`（`attachment-service.ts`，起草询价的附件也走它）。**改询价单模板（`attachment.ts`）或生成规则（`build.ts`）会同时改变邮件附件与菜单文件**——这正是 RFQ-PDF-2 要的。
- 菜单文件与邮件附件的区别只有：发起人填写项与贸易条款为空。同一项目、同一时刻、发起人什么都没填时，两边渲染内容逐字节相同（隔离库测试第 2 段守着）。
- 不生成的五种情形与错误码表在 `sheet-download.ts` `RFQ_SHEET_FAILURES`；路由映射在 `src/app/api/projects/[id]/generate-pdf/route.ts`。
- 落库拆成 `nextGeneratedVersion` / `putGeneratedBlob` / `recordGeneratedFile`；内部文件走 `persistGeneratedHtml`（转换或写入失败回落 HTML），供应商询价单走 `persistGeneratedFile`（不回落）。
- `tech_confirm`、`china_supplier_brief` 已从白名单去掉，`RETIRED_PROJECT_PDF_DOC_TYPES`（`src/lib/bid-workflow/pdf-doc-types.ts`）管说明与列表里的「已停用」标记。旧记录不删。
- `src/lib/bid-workflow/china-supplier-brief.ts` 只剩敏感词判断 `containsSensitiveSupplierBriefText`（文件名是历史遗留，5 个模块在引用，没有改名）。
- `tsconfig.json` 不含 `scripts/` 与 `**/__tests__`：`npm run typecheck` 查不到测试与脚本里的类型错误，改它们之后要实跑。

## 3. RFQ-PDF-2 的事实摸底（子 agent 2026-11-21 在 `f386926` 上查的；开工时抽查，行号可能已变）

1. INBOUND_MISSING_FIELDS inbound-contract.ts:13 = price,currency,deliveryDays,validUntil,moq,incoterm；标签 :17 INBOUND_MISSING_LABEL 价格/币种/交期/有效期/起订量/贸易条款（与报价表栏目名不同字，测试里写映射）。
   mandatoryCodes：inbound-contract.ts:102 rfqContextFromBody(body)，:104/106 /^-\s*数量：/ 取第一档数量，:108 /【强制】(\S+)/g 取强制编号。调用 inbound-sync.ts:220、compare-service.ts:80；下游 inbound-parse.ts:289/382、landed-cost.ts:433。
   **正文改【必须】后 mandatoryCodes 变空 → 必须让解析同时认【强制】【必须】（旧信仍是【强制】）；主规格 supplier-identity-guard :75「数量行与【强制】{编号}写法 SHALL 不变」要在增量里改。**
   extractAttachmentTexts inbound-parse.ts:128：读 pdf/docx/xls/xlsx/csv/txt；图片「图片附件未解析」；空文本「可能是扫描件」。
2. needsChineseTranslation: src/lib/tender-auto-analysis/requirement-lang.ts:9 (text)=>boolean，CJK 占比<0.15 → true，空串 false。translate: requirement-translate.ts:73，失败保留原文。翻译按钮 src/components/tender-analysis/bid-fit-matrix-card.tsx:365 (data-testid bid-fit-translate) → POST /api/projects/{id}/bid-fit/translate。build.ts:233 specZh = chineseTranslation || original。
3. quoteHeader: src/lib/tender-profile/contract.ts:22-33 companyName/addressLines/phone/email/website/taxNumber/preparedByDefault；存 settingsJson.tenderProfile (store.ts KEY)，getTenderProfile(orgId)；参考 quote-engine/quotation-identity.ts:15。询价抬头实际取 settings.fromName；展示发件人 fromEmail，授权 mailboxEmail（round-pure.ts）。
4. 入口状态 web-entry-pure.ts:27 RfqEntryState{enabled,reason,message,action,warnings[]}；decideRfqEntryState :126；warnings 现有 READ_SCOPE_WARNING(:124) 与 web-entry.ts:237 No-Go；web-entry.ts:179 预构建 built 可数缺译文。前端渲染 warnings：components/inquiry/rfq-web-entry-drawer.tsx:340、project-inquiry-section.tsx:293。菜单 project-generate-menu.tsx 生成后不看返回值；接口只回 {document} → 要加字段。
5. 主规格：rfq-supplier-attachment :23 附件的内容、:30 回复说明签章栏页脚与安全、:37 附件不输出什么、:89 邮件正文提到附件、:107 执行前核对附件；rfq-requirement-selection :56「询价单行项上的类别…请随报价提供清单按归一后的类别生成…」场景「小写的样品类触发样品提示」，:13 场景写「是否强制与来源页码」；rfq-web-entry 13 条（1 发起前的入口状态 2 入口说明文字与出路 …）。
6. 要改期望的测试：build.test.ts :53 :63-65；attachment.test.ts :91-122（定版指纹 GOLDEN version 1）；attachment-db.isolated :136 :139 :169（pages===2）；sheet-download-db.isolated（标题「询价单 / 符合性确认表」、pages===2）；sheet-download.test.ts:68；inbound-parse.test.ts:177-179；fixture 含「- 数量：」「【强制】」：inbound-apply.test.ts:99、analysis-update-note-db.isolated:62、tracker-db.isolated:101、tender-pricing compare-cost-source-db.isolated:87。chase/followup/muse 不解析正文。
7. RfqDocument 的 seq/sourcePage/questions/attachmentsRequested/quantityTiers/quantityNote 只在 tender-rfq 内读（attachment.ts、build.ts）。类别 21 个 tender-understanding/contract.ts:134；供应商侧 10 类 build.ts:33；deriveAttachments build.ts:204。行项顺序 = requirementCode asc（service.ts:429）。
8. 版式参考稿 claude/QINGYAN_RFQ-PDF_TARGET_LAYOUT.html 仓库里没有。
9. 抽检：CHROME_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome；可参考 scripts/quotation-pdf-layout-e2e.ts（pdfjs 文字坐标判重叠）。
另：回复截止落在截标当天会被身份防护拦（build.ts computeReplyBy 下限 今天+2）——计划在 RFQ-PDF-2 一并修（升版式版本只升一次）；attachment-db.isolated 夹具截标 2026-12-05 走真实时钟，12-03 当天会红。
使用审查留给模板的：回复方式句「回复发来本询价单的邮件」在下载场景不通；回复截止按生成时刻算；「招标文件未明确数量」供应商没有招标文件。

## 4. 环境与坑（本会话实际用的）

```bash
export PATH=/opt/node24/bin:$PATH            # 容器默认 Node 22，仓库要 24
npm ci --no-audit --no-fund                   # 约 5 分钟
npm install -g @fission-ai/openspec@1.15.0    # CLI 不在依赖里；跑的时候带 OPENSPEC_TELEMETRY=0
apt-get install -y postgresql-16-pgvector || (apt-get update && apt-get install -y postgresql-16-pgvector)
pg_ctlcluster 16 main start
su postgres -s /bin/bash -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\" && createdb qy_test"
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/qy_test DIRECT_URL=$DATABASE_URL
export DATABASE_ENVIRONMENT=isolated JWT_SECRET=<任意 32 字节以上>
export CHROME_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome
npx prisma db push --skip-generate
NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts
```

- 全量 `npm test`（带隔离库、`NODE_ENV=test`、`PRODUCT_CONTENT_LOCAL_STORE=1`）约 40–50 分钟。**先在一个检出 `origin/main` 的 worktree 里（另建一个库）跑一遍当基线**：2026-11-21 main `91d928e` 是 701/712，失败的 11 项见 RFQ-PDF-1 报告 §5；分支只要失败名单相同就算过。
- 给子 agent 审查用再建一个库（如 `qy_review`），别让它们和全量测试抢同一个库。
- 真实 Chromium 抽检不需要数据库：直接调 `composeRfqSheet` → `renderCheckedRfqSheet`（做法见 RFQ-PDF-1 报告 §2）。临时脚本要放在仓库目录里跑（`@/` 路径别名），跑完删掉。
- 容器是临时的：重启后 Postgres 要重新 `pg_ctlcluster 16 main start`；scratchpad 会清空，要留的东西写进本文件并提交。
- 沙箱访问不到线上与 Vercel；线上验证要请有权限的人做。

## 5. 审查的规矩（本线沿用）

- 开工前：一个子 agent 审四件套。实现后：第一轮至少五个维度各一个子 agent（正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案、测试有效性——在单独的 worktree 里逐个引入坏改动看有没有测试变红），第二轮在修复之上再审（修复增量 + 通读、verify + 报告逐句核对、文案与界面用真实浏览器截图）。
- 每条意见先自己核实再改；不改的写理由；超范围的记进报告 §6 或并入下一个 change。PR 正文与报告都要有「多维审查」。
- 测试有效性那一轮最值：RFQ-PDF-1 里它找出 4 处「坏改动没有任何测试变红」。

## 6. 不要做的事

- 不打开 `TENDER_RFQ_ATTACHMENT_ENABLED`，不做 staging 收信核对（要 Vercel 权限）。
- 不碰另一会话的 change 与 PR（2026-11-23 时 `openspec list` 里还有一个别人的 `pricing-helper-finance-gate` 等归档；#538 等还开着）。
- 不做 Excel 回复表、按价格表行项询价（任务书 §7）。
- 不手写 `openspec/specs/**`，不删 `docs/` 下任何文件，不动 `.claude/launch.json`。
- RFQ-PDF-2 的字号不要替 Evan 定。
