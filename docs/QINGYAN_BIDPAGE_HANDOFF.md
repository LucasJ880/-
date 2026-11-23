# BIDPAGE 交接（「标书与报价」页改版，BIDPAGE-1 ～ 8）

> 只写核对过的事实；没核对的写「未核实」。每合并一个 PR 更新一次。

## 0. 接手的人从这里开始

1. 先读本文件 §1 ～ §3，再读任务书 `docs/QINGYAN_BIDPAGE_BID_QUOTE_REDESIGN_TASKBRIEF.md`（尤其「合并授权、交叉验证与交接」与附录 C）。
2. 第一条命令：`git fetch origin && git log --oneline -5 origin/main && openspec list`（看 main 走到哪、有没有进行中的 change）。
3. 正在做的那个 change 用 `/opsx:continue <change>` 或 `/opsx:apply <change>` 接着做，不要重开。

## 1. 当前状态（2026-11-23）

| 项 | 值 |
|---|---|
| 当前 main | `c339cb40`（#578 FIX-25 合并后；2026-11-23 核对） |
| 工作分支 | `claude/laughing-curie-2b9s1v`（每个 PR 合并后从最新 main 重开同名分支做下一个） |
| BIDPAGE-1 | **已合并**（#557，`d1b0d3e2`，2026-11-23）；开关默认关，合并后页面无变化；生产部署：**已部署**——2026-11-23 04:41 UTC `release-drift`（workflow_dispatch，run 45113342662）读到线上 `deployedCommit = f9c73ba`，即 main 当时的最新提交，`d1b0d3e` 是它的祖先（中间只多了 FIX-21 的归档 #560）。合并后约 1.5 分钟那次查时线上还是 `212613e`（太早）。开关没设，页面与改版前相同（开关是否确实未设：未核实，会话看不到生产环境变量）；归档 `2026-11-23-bid-page-v2-shell`（主规格 `tender/bid-page` 13 条），归档 PR 见下表 |
| BIDPAGE-3 | **已合并**（#564，`c376be86`，2026-11-23 09:31）；开关默认关；生产部署：**已部署**——2026-11-23 09:47 UTC `release-drift`（workflow_dispatch，run 45150109772）读到线上 `deployedCommit = c376be8`，与 main 一致；合并后约 1 分钟那次（run 45147965079）线上还是 `2a0eb96`（太早）。开关没设，页面与改版前相同（开关是否确实未设：未核实，会话看不到生产环境变量）；归档 `2026-11-23-quote-line-mode-persist`（主规格 `tender/quote-line-mode` 15 条、`tender/bid-page` 改 3 条），归档 PR 见下表 |
| BIDPAGE-4 | **已合并**（#581，`4b6c3dd4`，2026-11-23）；开关默认关；生产部署：**已部署**——2026-11-23 13:50 UTC `release-drift`（workflow_dispatch，run 45187960729）读到线上 `deployedCommit = 4b6c3dd`，与 main 一致。开关没设，页面与改版前相同（开关是否确实未设：未核实，会话看不到生产环境变量）；归档 `2026-11-23-quote-lump-sum-mode`（主规格新增 `tender/quote-lump-sum-mode` 19 条、`tender/quote-line-mode` 改 6 条；1 个子代理逐字核对主规格与增量一致），归档 PR 见下表 |
| BIDPAGE-6 | **PR #587 审核中**（开关默认关）；报告 `docs/QINGYAN_BIDPAGE-6_REPORT.md`；开工前审查 + 六维审查 + 交叉验证都做完，意见去向见报告 §5 |
| 正在做 | BIDPAGE-6 PR：CI 绿后合并 → 确认部署 → 归档小 PR |
| 下一步 | BIDPAGE-5 `quote-margin-advice-market`（AI 毛利建议；审查多一个「模型调用」维度） |

| change | ID | 状态 | PR | 分支 |
|---|---|---|---|---|
| `bid-page-v2-shell` | BIDPAGE-1 | 已合并、已归档 | #557（合并 `d1b0d3e2`）；归档 #561（合并 `b717427f`） | `claude/laughing-curie-2b9s1v` |
| `quote-line-mode-persist` | BIDPAGE-3 | 已合并、已归档 | #564（合并 `c376be86`）；归档 #572（合并 `325cbdc0`） | `claude/laughing-curie-2b9s1v` |
| `quote-lump-sum-mode` | BIDPAGE-4 | 已合并、已归档 | #581（合并 `4b6c3dd4`）；归档 #582（合并 `9ff1b29e`） | `claude/laughing-curie-2b9s1v` |
| `quote-one-step-confirm` | BIDPAGE-6 | PR 审核中 | #587 | `claude/laughing-curie-2b9s1v` |
| `quote-margin-advice-market` | BIDPAGE-5 | 未开始 | — | — |
| `bid-page-sourcing-step` | BIDPAGE-2 | 未开始 | — | — |
| `bid-page-documents-step` | BIDPAGE-7 | 未开始 | — | — |
| `bid-page-zh-copy` | BIDPAGE-8 | 未开始 | — | — |

上线顺序：1 → 3 → 4 → 6 → 5 → 2 → 7 → 8。

## 2. 授权与拍板（原话与日期）

- Evan 2026-11-22 18:01：八个 PR 由实现者自行合并，条件见任务书「合并授权、交叉验证与交接」六条；改环境变量、打开开关、对外发东西不在授权内。
- Lucas 2026-11-22：合并后「GitHub 上合并提交的部署状态，确认是部署了就行」。
- Lucas 2026-11-22：附录 C 的 A、B、C「都按你推荐」。
- Lucas 2026-11-22：「现在起，这个项目交给你全权负责，都按照你的推荐来，合并也交给你做，PR 的审查需要用子agent多方面交叉审查，记得做好hand off」。据此：每个 change 的归档小 PR 也由实现者合并。

## 3. 判断点与不确定处的结论

| 项 | 结论 | 落在哪 |
|---|---|---|
| 判断点 1 ～ 6 | 按任务书默认 | 各 change 的 design |
| 附录 C 的 A / B / C | 拍板按推荐（共用代码按开关分流 / 入口改 `page.tsx` / 金额门 = 内部成本 ∧ 财务查看权） | 任务书附录 C |
| 附录 C 的 D ～ K | 按默认 | 任务书附录 C |
| 不确定处 2 | `engineConfigSchema` 非严格、`engineOf` 用 `safeParse`，加可选字段不会让旧数据失败；不认识的做法值只丢自己（`.catch`）；专业模式保存的表头不收做法字段 | 任务书附录 C；BIDPAGE-3 design D1 |
| 不确定处 1 / 4 | 逐行只用引擎一套算法，四个数取引擎；Σ行合计与引擎合计差 ≤ Σ(数量 × 0.005)（数量带小数的行再各加 0.005），数量大时可达上百加元；行毛利率接近整体但不总相同 | 任务书附录 C；BIDPAGE-3 design D4；报告 §6 第 4 条请 Evan 确认 |
| BIDPAGE-3 出入 | 七条（proposal）：没有财务查看权的人看不到报价合计；不恢复编辑；逐行只配只供货；提交批准仍在专业模式；行实际从招标分析带入；差额上限；类别与说明细节 | `openspec/changes/archive/2026-11-23-quote-line-mode-persist/proposal.md`；报告 §6 |
| 不确定处 3 | 未核实（BIDPAGE-2 时复现） | — |
| 不确定处 5 | 实现会话连不上生产库，未核实；BIDPAGE-6 用合成数据回归（0 份 / 1 份 / 已有另一份 / 两份已批准没选 / 另一份已中标）；只读查询在 `docs/acceptance/bidpage-6/prod-check.sql`，留给 Lucas / Evan 跑 | BIDPAGE-6 design「Migration Plan」 |
| BIDPAGE-1「下一步」规则 | 「已定」「有未定的报价」挪到找供应商之前；招标分析那条只在没往下走时命中；新增「看供应商回复，把报价录入」；询价按每家供应商最近一次算（共 8 条出入） | `openspec/changes/archive/2026-11-23-bid-page-v2-shell/design.md` D3；主规格 `tender/bid-page` |
| BIDPAGE-1 金额门 | 内部成本权限（`resolveQuoteCapabilities`）∧ 财务查看权（`canReadAll`），与报价引擎开关无关；只决定新页面挂不挂带金额的旧组件，不是数据保护 | design D4 / D5 |
| BIDPAGE-1 临时出入 | 看不到金额的人在新页面 ① ② 暂时不能起草询价、编辑报价。起草询价由 BIDPAGE-2 恢复；编辑报价**不恢复**——Evan 2026-11-22 对 CHAIN-2e 的答复 ①（`docs/QINGYAN_CHAIN-2b_REPORT.md` §6 第 4 条）：不是项目负责人的投标同事不新建、编辑、批准报价，谁做报价谁就是负责人（负责人有财务特权）；逐行表本身就是成本，编辑必须看见成本 | BIDPAGE-1 design D5；BIDPAGE-3 design D7 |

## 4. 已知问题与没验证到的地方

- 预发验收、生产页面、Sunny 组织 id：实现会话访问不到（未核实）。
- **旧接口仍给金额**（`/quote-engine*`、`/inquiries`、`/quotes`、`GET /api/projects/{id}` 的 `ourBidPrice` / `winningBidPrice`）：附录 C 决定 C 留给 CHAIN-2e。开关开着时，入口第一次渲染与汇总接口第一次出错时仍是旧页面，期间看不到金额的人照今天的口径拿到金额（不新增暴露）。见 §5 上线前置条件。
- ③ 的「内部项目分析 PDF」在项目同时有我方报价与中标价时会写出两者，有编辑权、没有财务查看权的人能生成：由 BIDPAGE-7 按金额门处理。
- 全量门禁的「Mention Gateway M2-A Identity DB」在同一个库上第二次跑会因残留的平台组织 wecom 网关行撞唯一约束（与本任务无关）；跑全量前先删：`DELETE FROM "WeChatGateway" WHERE "orgId"='__qingyan_platform__' AND channel='wecom' AND "corpId" LIKE 'corp_shared_%';`。
- 本地起过 `next dev` 后，`.next/dev/types/routes.d.ts` 可能被写坏，导致 `npm run typecheck` 报一串 `.next/dev/types` 语法错：删掉 `.next/dev` 再跑。
- 跑 `npm run test:ci` 要用 CI 同款环境变量（`DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci?schema=public`、`NODE_ENV=test`、**不设** `DATABASE_ENVIRONMENT`）：带着隔离库的变量跑，会把子集里的隔离库端到端测试也跑起来，停在 main 上既有失败的 RFQ-AUTO-2（2026-11-23 踩过）。
- 合并后怎么看生产部署：工具里查不到单个提交的部署状态，容器也连不上生产（出站代理拒绝）。用仓库自带的 `release-drift` 工作流（`workflow_dispatch`）：它读 `https://qingyan.ca/api/health` 的 `checks.deployedCommit` 与 main 比对，日志里有「生产与 main 一致（<短 sha>）」或「生产部署落后于 main」。部署要几分钟，合并后过一会儿再触发。
- main 动得很勤（别的轨道的归档 / 交接文档 PR）：合并前每次 `git fetch` 发现 main 动了都要变基、重跑门禁（全量约 35 分钟 + CI 约 15 分钟）。
- **CHAIN-2e（#556）合并后**：报价的内部成本权限改成等于财务查看权，BIDPAGE-1 汇总接口与 BIDPAGE-3 逐行接口的金额门随之实际等于财务查看权（持组织范围财务查看权、不是项目成员的组织管理员 / 企业负责人会新看到金额；已回复 CHAIN-2e 按新口径走）。合并后：变基、重跑 `bid-page-summary-db.isolated.test.ts` 与 `quote-line-db.isolated.test.ts`，核对两份规格里的身份表；CHAIN-2e 改了 `resolveQuoteCapabilities` 的签名（`{ finance }`），BIDPAGE-1 的汇总接口在它的改动清单里，由 CHAIN-2e 改。
- BIDPAGE-3 留给后续的：
  - BIDPAGE-6：我方报价卡（`TenderOurBidCard`）里的英文、`quote-engine/access.ts` 的两句报错（「报价引擎未启用」「无权执行该报价操作」）在 CHAIN-2e 改动中；没有财务查看权的人要不要看报价合计（报告 §6 第 1 条）。
  - BIDPAGE-7：我方报价不是逐行报价时「已定」标题仍写「导出价格表 / 生成投标文件」，③ 里没有价格表导出；供货加安装 / 长期供货协议的我方报价要不要按价格表导出（报告 §6 第 3 条）。
  - BIDPAGE-8：价格表单位（Each、Box、sqft…）、GST / HST / PST、币种代码、导出文件名 `price-schedule-…csv` 与 CSV 英文列名要列为英文守卫的例外（附录 A 已补）；判断点 4「旧版报价单收进『更多』」——现在在 ② 报价区下面折叠着；`paste-import.ts` 的「缺少说明」在逐行报价里已换成「缺少品名」显示，共用文件没改。
  - 共用的 `official-export.ts` 没有防公式：逐行报价的导出在调用前自己加了前缀（`csvSafeText`），其它调用方以后各自处理。
  - 专业模式保存与逐行保存之间有一个很窄的丢更新窗口（BIDPAGE-3 design Risks），要改专业模式的服务才能堵上。
  - 报价建好后才存的价格表没有带入入口（`seed` 只在表空时给）；生产上新页面开着时本来就存不了价格表。
- **main 动得很勤时怎么合**（BIDPAGE-3 #564 的做法，2026-11-23）：开 PR 后 main 约每 10–30 分钟动一次（06:41 开 PR 到 09:31 合并之间动了 8 次）。碰到代码的就把 main 合进分支（用合并，不变基、不强推），重跑全量门禁；只进文档 / 规格的（各轨道的归档、交接）合并后核对与上一次跑门禁的提交比 `git diff <gated> HEAD -- . ':(exclude)docs' ':(exclude)openspec'` 为空，补跑 `openspec validate --specs --strict` 与注册校验；最后一次只进文档时可以在本地合并核对（不推送），直接以 PR 头合并，免得再等一轮 CI。挂一个每 2 分钟 `git ls-remote origin refs/heads/main` 的监视器，main 一动就停掉作废的门禁、马上重来。
- **BIDPAGE-4 的做法**（已定，细节见 `openspec/changes/quote-lump-sum-mode/design.md`，归档后在 `openspec/changes/archive/` 下）：
  - 总价表的项用自己的行身份 `metadata.bidLine = { role: "lump", key }`，**不借用 BIDPAGE-3 的「共用参数」身份**，也不加进 BIDPAGE-3 的行身份联合类型：逐行表读到它当作其它成本行、照样计入、逐行保存不碰。货品明细沿用 BIDPAGE-3 的货品行身份，预置沿用预置行身份。
  - 销售税存 `engineJson.tax` 的 HST / GST / PST 三项（不是成本行）；总价表保存时只换配置里的税。我方报价照旧是税前报价。
  - 范围与库里能存的一致（金额 4 位小数、关税 / 售后预留 / 预备金比例 0–100、保函 < 100、备注 ≤ 2000），转换与专业模式写进来的数能原样保存。
  - 互转写库前用 `computeQuote` 对「转换前」与「按库里位数模拟的转换后」各算一次，四个数不同就 409 不转；同一项两条、共用参数算法在专业模式里改过、货品是总数 / 总数和明细都计入、供货加安装转逐行都 409。
- **引擎读成本行只按 `sortOrder` 排，同序行的先后不固定**（`getQuote`，原有特性；BIDPAGE-4 交叉验证实测）：按直接成本比例算的项会因先后差一分。BIDPAGE-4 的互转写库前按 `sortOrder`、id 模拟，写库后在事务里按真实读出再核对，转换本身不会把差写进库；转换之后的读出仍可能差一分（专业模式同样会）。要根治得在引擎读法里加固定的第二排序键（不在 BIDPAGE 范围；专业模式「复制」用 sortOrder + 1、新加行用 (n + 1) × 10，容易与明细行同序）。
- **注册脚本的同位置追加**：BIDPAGE-4 与 FIX-26a（#574）都在 `scripts/test-ci-unit.sh` BIDPAGE-3 那几行后面追加，合 main 时冲突过一次，两边的注册行都保留。以后别的轨道也在同一处追加时照此处理。
- **其它轨道的协调说明**（「青砚招投标线交接」会话 2026-11-23 10:21 发来，只是告知）：
  - FIX-26（`quote-inquiry-cost-finance-gate`，分支 `claude/zen-turing-azudvx-fix26`）会改 `src/components/quote/project-quote-section.tsx` 与旧报价单的接口、编辑器、Excel 导出；`orgId` 不为空的报价引擎报价（含逐行 / 总价报价）经旧接口读详情、修改、删除、AI 审查返回 409。它叠在 CHAIN-2e 之上、CHAIN-2e 合并后才合。**BIDPAGE-8 若要动 `project-quote-section.tsx`，等 FIX-26 合并后变基、保留它的判断。**
  - FIX-26a（报价 PDF 不再印「Profit Margin」）先单独合，只改 `src/lib/quote/export-pdf.ts`。
  - FIX-26b（询价明细里的供应商原价给谁看）等 Lucas 拍板；**BIDPAGE-2 重做询价表时先按现状来。**
  - FIX-14（#569）只改 `import-service.ts`、`inbound-apply.ts` 内部；FIX-24 之后改 `inbound-apply.ts`、`inbound-parse.ts`、`notes-parse.ts`，都不动导出。FIX-25（`target-margin-finance-gate`）让没有财务查看权的人拿不到目标毛利、项目列表与调查室读取接口去掉 `pricingInputs`，不碰 `bid-page-summary`。完整顺序见 `docs/QINGYAN_TENDER_FLOW_HANDOFF.md` §0.5k。
- 本地隔离库：容器里 Postgres 16 已起、`vector` 扩展可用（`postgresql-16-pgvector` 装不上但扩展已在），库 `qingyan_test` 已 `prisma migrate deploy`。**容器会重启**（2026-11-23 07:17、10:05 左右各重启过一次，Postgres 随之停了；07:17 那次紧接着跑的全量门禁 161 项连库失败、作废）：跑门禁前先 `service postgresql status`，停了就 `service postgresql start`；`uptime -s` 能看出什么时候重启的。

- **BIDPAGE-6 的做法与留下的事**（细节见 `openspec/changes/quote-one-step-confirm/design.md`，归档后在 `openspec/changes/archive/` 下）：
  - 一次定价（提交 + 批准 + 选定）在一个事务里，迁移与台账用 `transitionQuote` 抽出的同一段代码（`applyQuoteTransitionTx`）；锁的顺序是**报价行 → 马上项目行**（台账写入对项目行取共享锁、同步取排他锁，两份报价同时定时若先各拿共享锁会互锁——开工前审查指出、实测复现）。
  - **专业模式状态接口的并发缺口（原有）**：`transitionQuote` 在事务外读状态、更新不带状态条件。新页面一次定价与专业模式「送审 / 退回」同时发时，状态会被专业模式改回，项目的我方报价指针与金额还写着已定（审查 ② 与交叉验证实测）。修法：`applyQuoteTransitionTx` 的更新加 `where status = from`、0 行 → 409；会改专业模式的库写语句，BIDPAGE-6 不做，报告 §6 第 4 条列给 Evan。
  - 与修订 / 中标交错时数据库偶尔判互锁（40P01）：一次定价返回 409「同一时间有别的操作…请再点一次」，整笔没写。
  - 编辑权限的人可以「新页面提交 → 专业模式退回（编辑级）→ 再提交」反复给负责人发高优先级通知（只是站内打扰；审查 ③ 实测）。没有加时间窗口。
  - 「提交给负责人」的通知用既有类型 `project_update`、对象类型 `bid_quote`；开关关掉以后点这类通知落到项目的标书页签（旧页面没有 `#bid-quote-{id}` 锚点，不报错）。
  - 报价列表接口多返回 `ourBid`（② 最上面那一行）；金额取 `resolveTenderBid` 现算的税前报价。
  - 新页面不再挂 `TenderOurBidCard`；改版前的页面与工作台照旧挂（它的中文化归 BIDPAGE-8）。
  - ② 标题右边那句状态没带版本（不改 `next-step.ts`，避开 CHAIN-2e 在改的 `next-step.test.ts`）；CHAIN-2e 合并后可以补。
- **写文件时 `\u` 转义会被解码成真字符**（BIDPAGE-6 踩过两次）：经工具参数写进文件的 `\u200B`、`\u202E` 之类会变成不可见的方向 / 零宽字符，GitHub 会弹双向文字警告。要写转义就用脚本写 `\\u…`；`quote-confirm.test.ts` 第 10 节扫 BIDPAGE-6 的源码与测试。
- **只杀自己的进程**：停门禁时别用 `pkill -f "npx tsx"`（BIDPAGE-6 误杀过同时在跑的审查子代理的测试）；按 cwd 或 PID 杀。
- **本地浏览器抽检的演示账号**：`qingyan_dev` 的演示组织 `bpshot_org` 没有行业包；纯会计岗位的人会被路由门送到 `/accounting`，挂上「招投标」岗位以后项目页仍被路由门挡住（原因未核实，与 BIDPAGE 无关）。BIDPAGE-6 的「只有编辑权限」那一步改用他本人的会话直接调接口。夹具在会话草稿区，不入库。

## 5. 上线时要设的环境变量（八个都合并、预发验收通过后，由 Evan / Lucas 设）

| 变量 | 值 | 说明 |
|---|---|---|
| `TENDER_BID_PAGE_V2_ENABLED` | `1` | 新页面总开关 |
| `TENDER_BID_PAGE_V2_ORG_ALLOWLIST` | `<Sunny 组织 id>`（未核实，待填） | **必须填，不能留空**（留空 = 所有组织） |

**上线前置条件（打开开关之前）**：

1. 八个 change 都已合并，预发验收按任务书「验收」九条走过。
2. 旧接口的金额口径：CHAIN-2e 已合并；或由 Lucas / Evan 明确接受「开关开着时旧接口照今天的口径给金额」（BIDPAGE-1 design D1 / D5）。**BIDPAGE-4 起这也包括总价报价的备注**：专业模式读接口（`GET /api/projects/{id}/quote-engine/{quoteId}`，`read` 级、`canViewInternal` 即给内部视图）在 CHAIN-2e 合并前会把总价报价各项的备注与金额给有编辑权、没有财务查看权的人（BIDPAGE-4 审查 ③ 实测；那个文件归 CHAIN-2e，BIDPAGE-4 不改）。
3. `TENDER_QUOTE_ENGINE_ENABLED` 在生产已开（未核实，任务书说已开）。
3a. **FIX-26 的审计裁剪先合**（BIDPAGE-6）：新页面「另起新版」沿用既有修订审计，`beforeData` 里有原版的估算成本与毛利率（`sourceCost` / `sourceMargin`），没有财务查看权的组织管理员、项目管理员能在审计详情里读到（审查 ③ 实测）。FIX-26 计划写入侧去掉、读取侧裁剪。
3b. 生产上已有的待批准、已批准报价与负责人在职情况：跑 `docs/acceptance/bidpage-6/prod-check.sql`（只读）。负责人不是在职成员的项目，「提交给负责人」没人收到。
4. **开关开着时每次进页签都会先闪一下整个旧页面**（入口第一次渲染必须是旧 `BidTab` 才能保证「开关关 = 零变化」；旧组件的取数先于入口执行，所以必定先闪）。这与验收第 1 条「只看到下一步 + 三个分区」不符，CHAIN-2e 合并后也不会消失。打开开关前要么由 Lucas / Evan 明确接受，要么另起一个 change 解决（例如服务端渲染时就知道开关结果——要改项目页取数，届时再评估）。（BIDPAGE-1 交叉验证 2026-11-23 指出）

## 6. 本地跑测试

```bash
service postgresql start
export PATH=/opt/node24/bin:$PATH
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/qingyan_test" DIRECT_URL="$DATABASE_URL"
export NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET="<任意 32 位以上的本地测试串>"
npm test   # 全量；与 main 基线比对失败名单
```
