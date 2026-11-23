# FIX-26 报告 — 旧报价单、Excel、报价 AI 与报价工具里的内部成本和利润率只给有财务查看权的人（`legacy-quote-finance-gate`）

合并当天起，项目负责人、有全企业「查看项目结算」权限的人和平台超级管理员在旧报价单里看到的、能改的、能导的都和以前一样（Excel 菜单改叫「导出内部成本表（Excel）」，表头第一行写明「不要发给客户」）。其他能读项目的人打开旧报价单，看得到品名、数量、单价、总额与条款，看不到内部成本、成本价一栏和利润率，顶部有一句为什么、找谁；不是负责人的同事（含项目管理员、operator、组织管理员）不能再新建、修改、确认、删除旧报价单，也不能用报价 AI，编辑器变成只读。报价页（报价引擎、逐行报价、只报总价）建的报价不再出现在旧报价单列表里，从旧链接打开会看到「请到报价页查看和修改」和一个链接。问青砚的两个报价工具先查项目读权限、对没有财务查看权的人不给利润率；审计日志详情对没有财务查看权的人把成本与毛利那几格置空并写一句说明。

**没有开关，合并即在生产生效。**

| 项 | 值 |
|---|---|
| TASKFLOW | FIX-26 主体（原「待定」FIX-21 后续 8 的报价单部分；CHAIN-2e 报告 §5 两行「编号待定」；FIX-25 安全审查 S1 审计日志详情） |
| GATE | 协调会话 2026-11-23 定（Lucas 2026-11-22 授权按推荐；① 例外，移出为 FIX-26b），见 §7 |
| OpenSpec change | `openspec/changes/legacy-quote-finance-gate/`（新能力 `projects/legacy-quote-finance-view`，13 条 Requirement） |
| 基线 | 四件套写于 main `9ff1b29e` / 核对 `c376be86`；实现基线 = CHAIN-2e 分支合入 main `c339cb40` 后的 `534049a3`（带进 FIX-25 #578、FIX-14、TREE-2 等）+ 四件套 `7445a6f8` |
| 分支 | `claude/zen-turing-azudvx-fix26-impl`（只提交在本地，由协调会话推送；叠在 CHAIN-2e 上，CHAIN-2e 合并后再合） |
| 开关 | 没有；合并即生效 |

## 1. 合并后谁会发现什么变了

- **只读成员、operator、不是负责人的项目管理员、没有财务键的组织管理员、`bids` 岗位同事**（今天都能读旧报价单）：
  - 「报价管理」区块不再有「新建报价」，换成一句「你不是本项目负责人，不能新建、修改、确认或删除报价单。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。」（项目负责人还是导入用的系统账号时后半句换成「这个项目还没有指定负责人，请找组织管理员……」）；列表照旧显示标题、模板、行数、总额。
  - 打开旧报价单：顶部两句（看不到成本那句 + 不能编辑那句），行项表没有「成本价」一栏，合计条只有「报价总额」，顶部摘要不显示利润率，报价检查里没有「利润率 x%」那几条；表单只读，没有「保存草稿」「确认报价」，右侧没有「一键生成完整报价」「AI 草稿生成」「AI 深度审查」，不自动请求模板推荐。导出 PDF 照旧（客户报价单，FIX-26a 起不印利润率）；导出的 Excel 没有内部成本、利润率与成本价。
  - 直接调接口：新建 / 修改 / 确认 / 删除 / 保存 AI 草稿 403「没有改动：……」，AI 起草 403「没有生成：……」，AI 审查 403「AI 审查用到的成本和利润率只给……」，都不写库、不调模型；列表与详情里内部成本、利润率、内部备注、AI 草稿与审查原文、每行成本价为 `null`，带 `costHidden: true`。
- **持组织范围「查看项目结算」（`project.finance.read`）、但项目角色只读的人（会计岗）**：看得到全部成本与利润率、能导内部成本表、能调 AI 审查接口；编辑器只读（与报价引擎同口径：能编辑 = 能看 且（特权或项目角色带成本写权限））。
- **项目负责人、持组织范围 `project.finance.manage` 的人、平台超级管理员**：编辑器、AI 起草与审查（模型输入逐字不变）、PDF 与改动前相同；Excel 菜单写「导出内部成本表（Excel）」，文件第一行由「报价单信息」改为「内部成本表（含成本和利润率，不要发给客户）」，其余单元格不变；导出菜单的 PDF 项写「导出客户报价单（PDF）」。
- **所有人**：旧报价单列表（报价管理区块、版本历史抽屉）只列旧报价单，报价引擎 / 逐行报价 / 只报总价建的报价不再出现（它们在报价引擎区块与新报价页的列表里照常有）；用旧链接打开这类报价，编辑器写「打不开这个报价单：这份报价是在报价页里做的，旧报价单不能打开或修改它；请到报价页查看和修改。」加「去报价页」链接；旧接口对它们读、改、删、AI 审查一律 409。读取失败（无权、不存在）时编辑器写「打不开这个报价单：」加原因，不再留下一张空白表单。保存旧报价单时每一行都存成客户行（请求里标的「内部行」不再采用）。
- **问青砚**：`project_bid_quote` 与 `project_get_project_quotes` 先查项目读权限，不是项目成员的普通组织成员得到「项目不存在或不属于当前组织」；`project_get_project_quotes` 对没有财务查看权的人 `profitMargin` 为 `null`、带 `costHidden`；报价技能按执行的人判（问青砚、智能体任务、一键投标方案）：审查只认本项目的报价，看不到成本时不调模型、规则检查不评利润率，起草不调模型并写「没有起草：起草报价草稿要看供应商报价并填成本价，……」。
- **审计日志详情**（组织管理员、项目管理员）：没有财务查看权时，记录里成本、毛利、落地价类的值显示为 `null`，详情顶部写「这条记录里的成本和毛利只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」；动作、操作人、时间、版本、原因、卖价照旧。报价另起新版的审计从此不再记原版估算成本与毛利率（原版报价里查得到）。

## 2. 改了什么

| 文件 | 改动 |
|---|---|
| `src/lib/quote/finance-view.ts`（新，纯模块） | 列表行与响应（`profitMargin` 置空、`capabilities`、`costHidden`）、详情白名单与裁剪、`isEngineQuote`（所属组织不为空）、报价页地址、读取失败的文字、全部固定句子（由 CHAIN-2e 的 `financeHiddenHintZh`、`NO_OWNER_NEXT_STEP_ZH`、`UNCONFIRMED_HINT_ZH`、`QUOTE_EDIT_HIDDEN_HINT_ZH` 拼成）、编辑器该出哪几句 |
| `src/lib/quote/legacy-access.ts`（新，服务端） | `resolveLegacyQuoteCaps(access)`：`resolveFinanceViewSafe` → `resolveQuoteCapabilities` → 不能编辑时 `resolveFinanceHintReason`；`resolveLegacyQuoteCapsForUser(userId, projectId)` 给技能与工具用 |
| `src/app/api/projects/[id]/quotes/route.ts` | GET 只取 `orgId: null`、按能力裁剪、带 `capabilities`；POST 要能编辑 |
| `src/app/api/projects/[id]/quotes/[quoteId]/route.ts` | GET / PATCH / DELETE：404 → 引擎报价 409 → 写要能编辑 403；返回走白名单；PATCH 每行 `isInternal: false` |
| `…/quotes/[quoteId]/ai/review/route.ts`、`…/quotes/ai/generate-draft/route.ts`、`…/quotes/save-ai-draft/route.ts` | 审查：引擎报价 409、没有财务查看权 403；起草 / 保存草稿：不能编辑 403（不读请求体）；有资格的人代码路径不变 |
| `src/lib/quote/rules.ts` | `runQuoteChecks` 第 4 个参数 `{ costHidden }`：不出利润率检查项；不传时结果逐字不变 |
| `src/lib/quote/export-excel.ts` | 内容抽成纯函数 `buildQuoteExcelContent`；`costVisible` 必填，分内部成本表 / 不含成本两种 |
| `src/components/quote/quote-editor.tsx` | 拆成读取（`QuoteEditor`）、读取失败（`QuoteLoadFailed`）与展示（`QuoteEditorView`）；按 `capabilities` 显示两句话、只读、隐藏成本与 AI 入口；规则检查与 Excel 按能不能看成本 |
| `quote-summary-bar.tsx`、`quote-line-table.tsx`、`quote-top-summary.tsx`、`quote-ai-panel.tsx` | 必填的 `showCost` / `canEdit` 属性；导出菜单文字 |
| `src/components/quote/project-quote-section.tsx` | 拆出 `ProjectQuoteSectionView`；不能编辑（或还不知道能力）时不出「新建报价」，写那句话 |
| `src/lib/agent/skills/quote.ts` | 按 `ctx.userId` 判；review 只取本项目的报价；看不到时不调模型、带 `costHidden`；draft 看不到时返回那句话 |
| `src/lib/agent-core/tools/project-skills.ts` | 只对 `project_bid_quote` 先 `probeProjectAccess(…, "read")` |
| `src/lib/agent-core/tools/enterprise-readonly.ts` | `project_get_project_quotes` 先 `probeProjectAccess`，没有财务查看权时 `profitMargin: null`、`costHidden: true` |
| `src/lib/audit/redact-finance.ts`（新，纯模块） | 写死清单 + 键名兜底（cost / margin / markup / profit / landed），递归对象与数组，返回被置空的键路径 |
| `src/app/api/audit-logs/[id]/route.ts` | 原有权限检查之后判财务查看权；没有的人裁剪，有值被置空时带 `costHidden` 与 `redactedPaths`；有的人逐字节不变 |
| `src/app/(main)/admin/audit-logs/page.tsx` | 详情 `costHidden` 时写那句 |
| `src/lib/quote-engine/service.ts` | 只改另起新版那条审计（本分支第 352 行）：不再写 `sourceCost` / `sourceMargin`；`transitionQuote` 等别的函数一行没动 |
| 测试 | 新增三个（§5），登记进 `scripts/test-all.sh`（三个）与 `scripts/test-ci-unit.sh`（两个不连库的） |

零 schema、零依赖、不新增模型调用（被拒的 AI 请求与看不到成本的技能调用不调模型，比改动前少）、没有新增出站。不改 `src/lib/quote/export-pdf.ts`（FIX-26a）、任何询价文件（FIX-26b）、`src/lib/muse-bridge/**`、`src/lib/bid-page-v2/**`（含 `quote-line/api-gate.ts`）、`src/lib/project-finance/access.ts` 与 `view-hint.ts`、`openspec/config.yaml`、`openspec/specs/**`、`prisma/`、`package*.json`、`vercel.json`、`.claude/launch.json`。

**新加的用户可见文字（原文）**

- 写被拒：`没有改动：你不是本项目负责人，不能新建、修改、确认或删除报价单。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。`（没有真人负责人时后半句 `这个项目还没有指定负责人，请找组织管理员在项目成员里把做报价的同事设为主负责人。`；授权查询出错时整句 `没有改动：暂时无法确认你的查看权限，请稍后刷新。`）
- AI 起草被拒：`没有生成：你不是本项目负责人，不能用 AI 起草报价单。要做报价，……`（同样换句）
- AI 审查被拒：`AI 审查用到的成本和利润率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。`
- 引擎报价 409：`这份报价是在报价页里做的，旧报价单不能打开或修改它；请到报价页查看和修改。`（带 `href: /projects/{项目}/quote-engine/{报价}`，界面「去报价页」）
- 编辑器：`报价单的内部成本和利润率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。`；不能编辑那句（去掉「没有改动：」）；读取失败 `打不开这个报价单：` + 原因
- 导出：`导出客户报价单（PDF）`、`导出内部成本表（Excel）` / `导出 Excel`；内部成本表首行 `内部成本表（含成本和利润率，不要发给客户）`
- 技能起草：`没有起草：起草报价草稿要看供应商报价并填成本价，只给项目负责人和有全企业「查看项目结算」权限的人用。`
- 审计详情：`这条记录里的成本和毛利只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。`

## 3. 出口清单与去向

本 change 处理（编号同 design「出口清单」；都没有开关、生产在跑）：

| # | 出口 | 改动前给谁 | 改动后 |
|---|---|---|---|
| 1 | `GET …/quotes`（`totalAmount` + `profitMargin`，并列出引擎报价） | 项目读者 | 只列旧报价单；没有财务查看权 `profitMargin: null`、带 `costHidden`；所有人带 `capabilities` |
| 2 | `GET …/quotes/{报价}`（整行，引擎报价还有 `pricingRate`、`summaryJson` 等） | 项目读者 | 白名单；没有财务查看权内部数字 `null`；引擎报价 409 |
| 3 | `PATCH …/quotes/{报价}`（只读成员能改价、确认、整组替换行项；`isInternal` 原样存） | 项目读者 | 要能编辑，否则 403 不写库；引擎报价 409；每行存成客户行；返回按 #2 |
| 4 | `POST …/quotes`、`DELETE …/quotes/{报价}`、`POST …/quotes/save-ai-draft` | 项目读者 | 要能编辑；`DELETE` 引擎报价 409 |
| 5 | `POST …/quotes/{报价}/ai/review`（成本价、内部成本、利润率交给模型） | 项目读者 | 没有财务查看权 403、不调模型；引擎报价 409 |
| 6 | `POST …/quotes/ai/generate-draft`（供应商单价交给模型、草稿带成本价） | 项目读者 | 不能编辑 403、不调模型 |
| 7 | 旧报价单编辑器（内部成本、利润率、成本价一栏、利润率检查；读取失败留空白表单） | 项目读者 | 按 `capabilities` 显示；读取失败写原因 |
| 8 | Excel（内部成本、利润率、成本价） | 项目读者 | 有财务查看权：内部成本表；没有：不含这三样 |
| 9 | 智能体报价技能（审查不核对报价属于本项目；成本交给模型；起草返回带成本价的草稿） | 问青砚任一 admin / sales 组织成员、智能体任务执行人、一键投标方案（项目写者） | 按执行的人判；审查只认本项目；看不到时审查不调模型、不评利润率，起草不调模型；问青砚路径先查项目读权限 |
| 10 | 问青砚 `project_get_project_quotes`（`profitMargin`） | 本组织任一 active 成员（含企业微信 @青砚） | 先查项目读权限；没有财务查看权 `profitMargin: null`、带 `costHidden` |
| 11 | 审计日志详情 `GET /api/audit-logs/{id}`（`sourceCost` / `sourceMargin`、财务预测剩余成本、Muse 账本行里的落地价） | 平台超级管理员、组织管理员、该项目 `project_admin` | 没有财务查看权：成本 / 毛利 / 落地价类的键置 `null`；另起新版的审计不再记这两个数 |

不在本 change（归属已定）：

| # | 出口 | 归属 |
|---|---|---|
| 12 | 报价单 PDF「Profit Margin」 | FIX-26a（#574，`71a86a0a`，已合并） |
| 13–17 | **合并后仍能拿到供应商原价的地方**：询价列表 / 单轮明细 / 旧比价 / 询价写接口的返回 / 录入报价 / 询价明细表的单价、总价、报价备注（`src/lib/inquiry/service.ts`、`src/components/inquiry/inquiry-detail.tsx`）；比价矩阵行里的原价 `quoted` 与 AI 报价分析模型输入里的原价；询价追踪页「报价 CAD x / 件」；供应商履历 `GET /api/suppliers/{供应商}/history` 的跨项目总价；组织项目智能的供应商平均单价——对所有项目读者（或本组织成员）可见；供应商报 DDP 加元时原价就是落地价 | **FIX-26b**（待 Lucas 答 GATE ①；TASKFLOW 已加一行） |
| 18 | Muse `compare` / `price_scenario` 的所选供应商落地价 | 决定 A；CHAIN-2e 登记的「编号待定」 |
| 19 | 报价引擎 14 个路由、「报价与成本」卡、单个报价页 | CHAIN-2e |
| 20 | 逐行报价 / 只报总价自己的接口 | BIDPAGE-3 / BIDPAGE-4（金额门）；经旧接口的路本 change 用 409 堵上 |
| 21 | 报价表助手的目标毛利、房间 JSON | CHAIN-2b / FIX-25（已合并） |

所以「项目读者拿不到我方成本」在本 change 与 CHAIN-2e 合并后对报价单这一侧成立；原价 ≈ 成本的那一侧要等 FIX-26b。

## 4. 与报价能力的口径

| 身份 | `canViewInternal` | `canEdit` |
|---|---|---|
| 只读成员（viewer）、operator、不是负责人的项目管理员、不是成员也没有财务键的组织管理员、`bids` 岗位（`project.finance.read` 只在分配范围） | 否 | 否 |
| 持组织范围 `project.finance.read`、项目角色 viewer（会计岗） | 是 | 否 |
| 项目负责人、持组织范围 `project.finance.manage` 的人、平台超级管理员 | 是 | 是 |
| 授权查询出错 | 只剩负责人与平台超级管理员，其余人带 `hintReason: "unconfirmed"` | 同左 |
| 项目没有组织 | 只剩负责人与平台超级管理员（不调授权查询） | 同左 |

与报价引擎（CHAIN-2e）、成本核算同一判定：`resolveFinanceViewSafe` + `resolveQuoteCapabilities`，本 change 没有写第二份规则。

## 5. 怎么验证的

新测试（隔离库 `qy_iso_fix26`；「改动前」= 本分支 `7445a6f8` 的源文件、本 change 的新测试，见 §12 的做法）：

| 测试 | 改动前 | 改动后 |
|---|---|---|
| `npx tsx src/lib/quote/__tests__/legacy-quote-finance-view.test.ts`（新，不连库） | 8 过 20 不过（其中 6 组因新模块 / 新导出不存在没跑完，各记 1 条；过的 8 条是规则检查默认输出与改动前逐字相同的 6 条、「本来就没有利润率项」的 2 条） | **78 过** |
| `npx tsx src/lib/audit/__tests__/audit-detail-redaction.test.ts`（新，不连库） | 0 过 6 不过（3 组因新模块不存在没跑完） | **20 过** |
| `NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`（新，隔离库） | 47 过 114 不过（161 条都跑到；过的是「与负责人看到的相同」「有资格的人与改动前相同」「模型输入与改动前相同」一类） | **161 过** |

隔离库测试覆盖：八种身份 + 不是项目成员的普通组织成员 + 组织管理员 + accounting 岗位 + 负责人是系统账号的项目；旧报价单（成本价 17.31、内部成本 91,234.56、利润率 23.45、内部备注 / AI 草稿 / 审查原文各带少见词）与报价引擎（快照估算成本 87,654.32、毛利率 23.7、定价比例 27.13）、逐行报价、只报总价各一份；列表只有旧报价单、`capabilities` 逐人对、总额相同、利润率置空；详情白名单（没有引擎字段与 `sourceJson`）、内部数字逐个 `null`；AI 审查 / 起草被拒 403 与句子、假模型服务 0 次，有资格的人 1 次且请求正文与用同样输入现拼的提示词逐字相同；新建 / 改价并确认 / 删草稿 / 保存 AI 草稿被拒 403、库逐字段不变；负责人改价并确认重算成本、请求里标内部行库里与返回都为否；三种引擎报价对负责人的详情 / PATCH（带行项与 `status: approved`）/ DELETE / AI 审查都 409 带 `href`、库不变、模型 0 次；判定顺序（不是成员先 403、不存在 404、别的项目的报价 404）；`project_bid_quote` 审查本项目 / 别的项目的报价 ID / 起草 / 不是成员；`project_get_project_quotes` 三种人；审计详情五种人 + 平台超级管理员（历史行含 `sourceCost` / `sourceMargin` 与数组里的 `costPrice`，读到被置空的键路径）；另起新版后新写的审计没有这两个键；系统账号负责人项目的 `hintReason: "no_owner"` 与换句；没有财务查看权的每个响应（去掉时间戳后）搜不到那几个少见数与词。

不连库测试覆盖：句子逐字（含按原因换句、与报价引擎同一句式）；判定矩阵八种身份、授权查询出错兜底、没有组织不调授权查询、系统账号负责人；列表行与响应形状、详情白名单与逐字段相同；规则检查默认调用与改动前输出的哈希相同、「看不到成本」只少利润率项；Excel 两种内容只差三样与首行、`costVisible` 必填；编辑器四种状态（看不到且不能编辑 / 能看不能编辑 / 403 / 409）、能看能编辑与改动前一样、没带 `capabilities` 不放开；合计条、行项表、顶部摘要、AI 面板、报价管理区块的静态渲染；路由、编辑器、技能、两个工具、`service.ts` 的接线源码断言；`finance-view.ts` 不 import `next/server` 与数据库。审计守卫：清单与兜底、递归（嵌套、数组、顶层数组）、不改输入、接口与页面接线；扫全仓 344 处审计写入、511 个键，像钱的 18 个都已分到「藏」或写明理由的「可见」，传变量的 97 处按名单核对。

既有测试（开工前 / 改完后，均在本分支）：

| 测试 | 开工前 | 改完后 |
|---|---|---|
| `src/lib/projects/__tests__/project-routes-guard.test.ts` | 98 过 | 98 过 |
| `src/lib/quote-engine/__tests__/quote-engine-contract.test.ts` | 43 过 | 43 过 |
| `src/lib/project-finance/__tests__/finance-access.test.ts` | 59 过 | 59 过 |
| `src/lib/mention-gateway/__tests__/m2c-tool-policy.test.ts` | 105 过 | 105 过 |
| `src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx` | 101 过 | 101 过 |
| `src/lib/quote/__tests__/export-customer-pdf.test.ts`（FIX-26a） | 32 过 | 32 过 |
| 另跑（改完后）：`quote-ops-contract` / `digital-employee` / `mail-untrusted-guard` / `m1-tool-policy` / `marketing-tools-org-isolation` / `quote-step` | — | 75 / 50 / 56 / 124 / 36 / 63 过 |
| 另跑（改完后，隔离库）：BIDPAGE-4 只报总价 / BIDPAGE-3 逐行报价 / CHAIN-2e 比价与报价引擎 / B3 台账 producer | — | 72 / 64 / 155 / 11 过 |

## 6. 门禁

| 命令 | 结果 |
|---|---|
| `npm test`（`< /dev/null`，全新库 `qy_full_fix26`，`prisma migrate deploy` 后） | 见下方「全量」 |
| CI 子集 `npm run test:ci`（CI 同款环境变量） | 见下方「全量」 |
| `npm run typecheck` | 0 错误 |
| `npm run lint:baseline` | PASS（errors 38 / 基线 53，无新增 fingerprint） |
| `npx tsx scripts/check-swc-nullish-logical.test.ts` | PASS |
| `bash scripts/check-test-registry.sh` | OK（已注册 726，基线剩余 66；`ci/test-registry-baseline.txt` 没有改动） |
| `bash scripts/test-runtime-architecture.sh` | PASS（9 通过） |
| `npx openspec validate legacy-quote-finance-gate --strict` | valid |
| `git diff 534049a3 -- prisma/ vercel.json package.json package-lock.json` | 空 |
| `docs/acceptance/fix-26/prod-check.sql` | 在隔离库上整段执行无语法错误（只读事务） |

全量：（填在提交前最后一次运行之后，见文末「全量结果」。）

## 7. GATE（已定）

协调会话 2026-11-23 定，Lucas 2026-11-22 授权按推荐（① 例外）：

1. 询价里的供应商原价暂不改，整体移出为 **FIX-26b**（待 Lucas 答；TASKFLOW 已加一行）。
2. 旧报价单的编辑权与报价引擎同口径（D4）。
3. AI 审查对没有财务查看权的人 403、不调模型（D6）。
4. 不出内部版 PDF；Excel 给有财务查看权的人导「内部成本表」（D5）。
5. 拆分：PDF 为 FIX-26a（已合并），本 change 为旧报价单其余部分，询价为 FIX-26b。
6. 与 BIDPAGE 交叠时本 change 先合；BIDPAGE-8 变基时保留「不能编辑时不出新建报价、写那句话」（`project-quote-section.tsx` 已拆出 `ProjectQuoteSectionView`）。
7. 叠在 CHAIN-2e 分支上做，CHAIN-2e 合并后再合。
8. 不设开关。
9. 顺手的小问题登记「待定」：旧报价单 `PATCH` 接受任意 `status`；AI 面板「输出版本」三个按钮没接线（TASKFLOW 已加两行；「抽屉与报价管理区块把引擎报价链到旧编辑器」随列表过滤消失）。
10. FIX-26a 审查后补：旧报价单的行都存成客户行（D10）、旧报价单列表只列旧报价单（D3）。
11. FIX-25 安全审查 S1 补：审计日志详情读取侧裁剪 + 另起新版的审计不再记成本与毛利（D11）。

## 8. 多维审查

（留空，由协调会话填写。）

## 9. 没验证到的

- 生产影响面：近 90 天由非负责人建 / 改的旧报价单、带成本价的行、`orgId` 不为空的报价、审计里带 `sourceCost` 的行、旧报价单里的内部行——要有生产只读权限的人跑 `docs/acceptance/fix-26/prod-check.sql`。旧路由不写审计，「谁改过」查不到，只能按创建人看。
- 浏览器里实际点一遍：编辑器、合计条、行项表、AI 面板、报价管理区块用 `renderToStaticMarkup` 做了静态渲染断言，读取与保存的接线用源码断言，没有起页面截图；导出的 Excel 只测了内容（`buildQuoteExcelContent`），没有打开真实 `.xlsx`。
- 一键投标方案面板「保存为报价单」（`src/components/agent-tasks/ai-bid-package.tsx`，不在本 change 的文件里）：403 时按钮静默不变，不写原因。会碰到的只有「能运行一键投标方案（项目写者）、有财务查看权、但不能编辑报价」的人（如不是成员的组织管理员 + 会计岗）——他们的起草步骤能成功、保存会被拒。没改，建议登记「待定」。
- 编辑器保存时若 403（权限在打开页面后被调整），沿用改动前的行为：不提示、不重新读取（能看到保存按钮的人一定能编辑，只在权限刚变时出现）。
- 有财务查看权的人在问青砚里拿到的利润率留在他自己的会话与智能体运行记录里，那些记录之后还有谁能读，没核实（design Risks 已列）。
- 直接 `db.auditLog.create` / `tx.auditLog.create` 的审计写入不在守卫扫描范围；它们的成本类键靠读取侧按键名兜底。
- 问青砚 `project_bid_quote` 对没有组织的老项目从此一律「项目不存在或不属于当前组织」（`probeProjectAccess` 只认本组织项目；改动前桥接放行没有组织的项目）。生产里还有没有没有组织的老项目在用问青砚报价，没查。

## 10. 回退办法

回退本 change 的合并提交即可（一个 PR，只改代码、测试与文档，不改库、不迁移数据；已存的成本、利润率、审计行都还在库里）。回退后旧报价单的成本与利润率重新对项目读者可见、写权限回到项目读权限、引擎报价重新出现在旧列表、另起新版的审计重新记 `sourceCost` / `sourceMargin`。

## 11. 合并后要人做的事

- 有生产只读权限的人整段跑 `docs/acceptance/fix-26/prod-check.sql`（只读事务，最后 `ROLLBACK`），结果贴回本节：第 1 段为 0 说明生产里还没用过报价引擎 / 新报价页；第 2 段的名单是合并当天不能再改旧报价单的人所在的项目；第 5 段不为 0 时由负责人逐份看那几份报价单的内部行；第 6 段的项目先按 `docs/acceptance/chain-2e/prod-check.sql` 补负责人。
- 把下面这段转给投标同事：

  > 今天起，旧报价单（「报价管理」里的报价单）和报价页一样：内部成本、成本价和利润率只给项目负责人和有全企业「查看项目结算」权限的人看；新建、修改、确认、删除报价单和用报价 AI，只有项目负责人（或有财务权限且项目角色能改成本的人）能做，其他人打开是只读的，顶部会写为什么、找谁。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。报价页里做的报价不再出现在旧报价单列表里，到报价页看。

- CHAIN-2e 合并后：本分支变基 / 合入 main，重跑 §5、§6。
- 通知 BIDPAGE 会话：BIDPAGE-8 改 `src/components/quote/project-quote-section.tsx` 时保留 `ProjectQuoteSectionView` 里「不能编辑（或还不知道能力）时不出新建报价、写那句话」的判断；BIDPAGE-6 改 `src/lib/quote-engine/service.ts` 的 `transitionQuote` 时，本 change 在该文件只动了 `reviseQuote` 末尾那条审计（与一行注释）。
- FIX-26b：等 Lucas 答 GATE ①。

## 12. 与四件套的出入

（四件套已同步改，design 末尾「实施记录」一节逐条写明。）

- 新增服务端文件 `src/lib/quote/legacy-access.ts`（proposal Impact 已补）：`finance-view.ts` 要保持纯模块（D9），判定入口只好另放；规则仍只有 CHAIN-2e 一份。
- 审计详情只在真有值被置空时带 `costHidden` / `redactedPaths`（规格已改写）：没有命中的记录对没有财务查看权的人形状不变，审计页不会每条都写那句话。
- 审计场景里「持组织范围 `project.finance.read` 的成员」改为「持组织范围 `project.finance.read` 的组织管理员」并加平台超级管理员（规格已改）：审计详情原有权限只放行组织管理员与该项目 `project_admin`，项目角色 viewer 的会计岗读审计本来就 403。
- 守卫测试「像钱的键」按拆词判（design 已写）：按子串判会把 `generatedAt`、`feedback` 一类算进来。
- 问青砚 `project_bid_quote` 对没有组织的老项目从此拒绝（design 已写）；`project_get_project_quotes` 照旧列出报价引擎的报价、只置空利润率（D7 没要求过滤）。
- 编辑器对不能编辑的人多收了三处（不自动请求模板推荐、模板与检查项按钮不可点、空报价单不提示 AI 生成），看不到成本时已确认摘要写「可导出客户报价单」；报价管理区块在还不知道能力时也不出「新建报价」（design 已写）。
- TASKFLOW：「FIX-21 后续 8」那一行在本分支还在（第 331 行，ID「待定」），但 main 已另有 `| FIX-26 |` 一行，把它的 ID 改成 FIX-26 会出两行 FIX-26；改成「并入 FIX-26」、状态写明旧报价单部分由本 change 做、询价部分改由 FIX-26b。`| FIX-26 |` 那一行改状态为本 change 与 `[~]`（不新增第二行），描述里询价部分标「改由 FIX-26b 做」；CHAIN-2e 带进来的两行「编号待定」状态写「并入 FIX-26」；新增 FIX-26b 一行（`[ ]`）与两行「待定」小问题。
- 行号：`src/lib/quote-engine/service.ts` 另起新版那条审计在本分支是第 352 行（上面加了一行注释），四件套写的是核对时的第 351 行。
- 改动前失败条数的做法：三个新测试先写好，在改动前的源文件上跑（不连库的两个测试按组动态 import 被测模块，缺的模块只让那一组记一条失败）；最后一版测试在提交前又对改动前的源文件（暂存本 change 的源码改动、移开三个新源文件）重跑一遍，得到 §5 的数字，再恢复。

## 全量结果

（运行中，结果补在这里。）
