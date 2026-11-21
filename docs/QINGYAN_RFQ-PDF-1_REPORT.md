# 青砚 · RFQ-PDF-1 报告：菜单里的供应商文件收口到询价单

- OpenSpec change：`supplier-docs-converge`（`openspec/changes/supplier-docs-converge/`）
- 任务书：`docs/QINGYAN_RFQ-PDF_TASKBRIEF.md` §5「T1」
- 分支：`claude/adoring-feynman-w8btkv`；核对基线：main `91d928e4`
- 日期：2026-11-21。授权：Evan 2026-11-21 在本会话说「现在你来全权负责……如果需要合并你来做，如果有问题，按照你推荐的做」

## 1. 做了什么

项目页「标书与报价」→「一键生成文档」里发给供应商的文件，原来有三种、四条生成路径，现在只剩一种：

| 改之前 | 改之后 |
|---|---|
| 「国内供应商询价 PDF」：没有分析综合时是 7 行固定英文；有分析综合时把 AI 写给我方看的要求说明印给工厂，只查招标身份、不查敏感词 | 「供应商询价单 PDF」：与发询价时的询价单用同一个生成器（只收当前可用分析里**人工确认过**的供应商侧要求）、询价邮件附件的同一个模板、同一套 PDF 检查。发起人填写项与贸易条款为空 |
| 「供应商技术确认表 PDF」：英文占位模板 | 停止生成；接口回 400 与指路的说明；旧文件仍在列表里，标「已停用的旧文件」 |
| 「国内供应商简报 PDF」+ 简报面板：面板默认备注（一句内部提醒）会印进正文 | 停止生成，面板删除；同上 |
| PDF 转换失败时改存 HTML 文件 | 供应商询价单不合格就不保存（是 PDF、内嵌 Noto Sans SC、不超过 5 MB 三项任一不过）；内部文件的 HTML 回落不变 |

接口 `POST /api/projects/{id}/generate-pdf`（`supplier_rfq`）不生成时各回什么：

| 情形 | 状态码 | `errorCode` | 说明 |
|---|---|---|---|
| 没有已确认的供应商侧要求（含没有分析） | 422 | `NO_CONFIRMED_REQUIREMENTS` | 没有已确认且属于供应商侧的要求，先在青砚「招标要求」里逐条确认后再生成询价。 |
| 含内部财务信息 | 422 | `SENSITIVE_LEAK` | 询价内容里有不能发给供应商的内容（如我方价格或内部备注），询价单没有生成，也没有保存文件。请到「招标要求」核对已确认的要求，并看一下询价设置里的发件抬头；页面上改不了的请联系管理员。 |
| 含招标身份信息 | 422 | `IDENTITY_LEAK` | 供应商侧文件含招标身份信息（命中：{类别}·{位置}），未生成。（CHAIN-4b 既有句子） |
| PDF 生成出错 / 不是 PDF / 没有内嵌中文字体 | 503 | `RFQ_SHEET_RENDER_FAILED` | 询价单 PDF 没能生成，没有保存任何文件。请稍后再试；一直不行请联系管理员。 |
| PDF 超过 5 MB | 422 | `RFQ_SHEET_TOO_LARGE` | 询价单 PDF 超过 5 MB，没有保存。通常是已确认的供应商侧要求太多，请联系管理员处理。 |
| `tech_confirm` / `china_supplier_brief` | 400 | `DOC_TYPE_RETIRED` | 「{名称}」已停用，请改用「供应商询价单 PDF」。之前生成的文件仍可在列表里打开、下载。 |

五种情形都在写任何东西之前返回：不存文件、不建记录、不动旧记录的「可能过期」标记。

生成记录：标题「询价单-{询价编号} vN」（下载文件名因此带询价编号）；版本号与「可能过期」标记照旧按 `supplier_rfq` 这一类计（旧版记录计入）；元数据记询价编号、起草时刻与日期（组织时区）、内容指纹、版式版本、提前量、页数，不记项目名称。

### 与任务书的出入（都按「有问题按推荐做」处理）

1. **内部财务信息的说明没用生成器原句。** 原句叫人「检查范围说明/自定义问题」，菜单生成没有这两栏。错误码沿用。
2. **说明里的地方叫「招标要求」，不叫「需求」。** 页签的真名是「招标要求」（`src/lib/tender/detail-tabs.ts`）；询价入口的既有说明写的是「需求」，那是既有的叫法不一致，本次没有动它。
3. **不叫人去「减少要求」。** 已确认的要求在页面上改不了（只有未确认的能确认 / 驳回），所以超过 5 MB 与内部财务信息两句都改成「联系管理员」。
4. **起草流程的两个文件有改动，但输出不变。** `service.ts`、`attachment-service.ts` 各有一段内联代码抽成共用函数（`rfqTemplateOnlyDocument`、`renderCheckedRfqSheet`），菜单路径与起草询价因此走同一段检查代码。既有的 `attachment` / `build` / `round-pure` 与隔离库 `attachment-db`、`supplier-identity-guard-db` 不改期望值通过。
5. **情报室默认交付物清单里的「国内供应商中文 PDF」删掉了**（它的 key 就是简报的文件类型；同一清单里已有「厂家询价表」）。只影响之后新建的情报室。
6. **多做了三件小事**（审查里发现、顺手修）：生成结束后无论成败都收起菜单的下拉层（它是浮层，开着会把错误说明盖住）；列表里两类已停用的旧文件加「已停用的旧文件」标记；请求体是 JSON `null` 时原先回 500，现在回 400。
7. **主规格 `tender/supplier-identity-guard` 改了六条，不是两条。** 另四条只改措辞（去掉 China Brief 的说法、场景不再指向已删除的文件），否则归档后主规格自相矛盾。OpenSpec 校验器不允许 MODIFIED 丢场景，所以旧场景名全部保留、内容改写为现状。

## 2. 真实 Chromium 抽检

联邦标样例（14 条已确认的供应商侧要求、地点事实是精确地址、组织时区多伦多），`CHROME_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`，经菜单路径的同一个函数（`composeRfqSheet` → `renderCheckedRfqSheet`）生成：

```
{ "magic": "%PDF-", "bytes": 104140, "ms": 5244, "pagesByCount": 4, "pagesByParser": 4,
  "notoSansSC": true, "hasChinese": true, "hasReference": true, "destination": true,
  "identityInTextLayer": [], "attachmentSameHash": true, "attachmentPages": 4 }
```

4 页、约 104 KB、约 5 秒；内嵌 Noto Sans SC；文字层里没有招标编号、采购方、项目名称、截标日期与精确地址；同一份内容经起草询价的附件函数得到相同的内容指纹与页数。14 条 4 页与任务书 §5 末尾的对照表一致（RFQ-PDF-2 的目标是 3 页）。

## 3. 改了哪些文件

| 类别 | 文件 |
|---|---|
| 新增 | `src/lib/tender-rfq/sheet-download.ts`（纯函数：排内容、错误码与说明、异常类型）、`sheet-download-service.ts`（读项目资料、排版并检查）、两个测试、本报告、任务书 `docs/QINGYAN_RFQ-PDF_TASKBRIEF.md` |
| 生成与落库 | `src/lib/projects/generate/generate-docs.ts`（`supplier_rfq` 分支；落库拆成算版本号 / 写存储 / 建记录三步，内部文件的回落保持原样）、`tender-doc-html.ts`、`pdf-common.ts` |
| 接口与类型 | `src/app/api/projects/[id]/generate-pdf/route.ts`、`src/lib/bid-workflow/pdf-doc-types.ts` |
| 询价模块（输出不变） | `src/lib/tender-rfq/build.ts`、`service.ts`、`attachment-service.ts` |
| 界面 | `src/components/project-generate/project-generate-menu.tsx`、`src/components/project-detail/tabs/bid-tab.tsx`；删除 `src/components/bid-workflow/china-supplier-brief-panel.tsx` |
| 清理 | `src/lib/bid-workflow/china-supplier-brief.ts`（只留敏感词判断）、`start-intelligence.ts` |
| 改断言的既有测试 | `tender-doc-html`、`china-supplier-brief`、`project-identity-deny`、`cjk-pdf`、`analyst-memo-v1`、`bid-workflow-phase1` |
| 脚本与注册 | `scripts/cjk-pdf-e2e.ts`、`scripts/test-all.sh`、`scripts/test-ci-unit.sh` |
| 文档 | `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`（新增 Phase F（续）— 询价单 PDF 两行） |

`git diff origin/main -- prisma/ vercel.json` 为空。没有新环境变量、没有新开关。

## 4. 测试（开工前 → 结束）

| 测试 | 开工前 | 结束 |
|---|---|---|
| `tender-rfq/__tests__/sheet-download.test.ts`（新） | — | 65 |
| 隔离库 `sheet-download-db.isolated.test.ts`（新） | — | 38 |
| `attachment.test.ts` | 65 | 65（不改期望） |
| `build.test.ts` | 46 | 46（不改期望） |
| `round-pure.test.ts` | 34 | 34（不改期望） |
| `web-entry-pure.test.ts` | 162 | 162（不改期望） |
| `auto-draft-pure.test.ts` | 68 | 68（不改期望） |
| 隔离库 `attachment-db` | 42 | 42（不改期望） |
| 隔离库 `supplier-identity-guard-db` | 21 | 21（不改期望） |
| 隔离库 `auto-draft-db` | 75 / 76 | 75 / 76（失败那 1 项是既有失败，main 上同样） |
| `tender-doc-html.test.ts` | 23 | 11（分析综合版供应商表的用例随代码删除；留内部备忘录与「改前的抬头过禁出清单」） |
| `china-supplier-brief.test.ts` | 通过 | 通过（只留敏感词判断的用例） |
| `project-identity-deny.test.ts` | 69 | 68（调用方名单少一个文件） |
| `bid-workflow-phase1.test.ts` | 通过 | 通过 |
| `cjk-pdf.test.ts` | 11 | 12（新增 CJK-GEN-04：供应商询价单不回落） |
| `analyst-memo-v1.test.ts` | 18 | 17（AM-16c 取证清单随简报移除，RFQ-PDF-2 加回） |

任务书 T1 的验收逐条对应：

| 验收 | 在哪 |
|---|---|
| 菜单询价单与起草询价的附件 HTML 逐字节相同 | 隔离库测试第 2 段（同一项目、同一时刻、先送审再生成：渲染内容相等、内容指纹相等）；纯逻辑测试另有一条不经数据库的 |
| 没有已确认要求 → 422 与那句说明，记录数不变 | 隔离库测试第 4 段 |
| 分析综合里写着「毛利」「预算」→ 生成成功且没有这些词 | 隔离库测试第 3 段 |
| 没有内嵌中文字体的 PDF → 错误说明，不建记录，没有 HTML 落库 | 隔离库测试第 6 段（另含抛错、不是 PDF、超过 5 MB）；第 10 段用真实生成函数 + 不存在的 Chromium |
| 两类 POST 被拒；GET 仍含旧记录 | 隔离库测试第 9 段 |
| 生成代码不再引用分析综合的供应商询价表模板与简报正文拼装 | 纯逻辑测试的源码断言 |
| 门禁 | 见 §5 |

## 5. 门禁

（最后一轮的输出在合并前填入本节。）

## 5a. 多维审查

开工前 1 轮（一个子 agent 审四件套）+ 实现后两轮（第一轮五个维度各一个子 agent，第二轮见下）。每条意见都先自己核实再处理。

### 开工前：四件套

| 意见 | 处理 |
|---|---|
| 回复截止落在截标当天时整份被拦（截标前 2 天，或提前量设成 0） | 属实，是询价单生成规则的既有行为（起草询价同样）。本次在规格里写明、在测试里固定；根治并入 RFQ-PDF-2（那里本来就要升版式版本） |
| 归档后主规格还有四处提到 China Brief 与已删除的文件 | 已修：四条一并 MODIFIED |
| 「SHALL NOT 含项目名称」写成了绝对，与「要求原文不查项目名称」矛盾 | 已修：限定为我方撰写的部分 |
| 组织没配置询价设置 / 项目没有组织时的行为没写 | 已修：规格加场景，测试覆盖 |
| D1 与 D4 对元数据键的说法冲突 | 已修：design 写明不记 `projectName` 与 `addendumFingerprint`（没有代码读） |
| 拆落库函数会丢掉「PDF 写入失败也回落 HTML」 | 已修：内部文件的转换与写入仍在同一个 try 里 |
| 版本号「先数后建」不在事务里，并发会重号 | 不改：这是现状，所有文件类型共用；design 写明接受 |
| 「下载文件名含询价编号」没有 SHALL | 已修 |
| 内部财务信息的说明偏离任务书「沿用既有结果」 | 不改：理由见 §1 出入第 1 条 |

### 第一轮（实现后，五个维度）

**正确性与回归**——没有发现回归。用 main 快照与分支各实跑内部文件，标题、路径、元数据键、版本与过期标记一致。

| 意见 | 处理 |
|---|---|
| 并发生成会出重复版本号（实跑复现；main 上已有） | 不改，同上 |
| 请求体是 JSON `null` 时回 500（main 上已有） | 已修：回 400，测试覆盖 |
| 与 #538 在 `generate-docs.ts` 的 import 块有文本冲突，无语义冲突 | 记入 §6；后合并的一方保留两边的 import |

**规格—代码—测试一致性**——没有发现代码违背规格的地方。

| 意见 | 处理 |
|---|---|
| tasks 4.1 已勾但报告还没写 | 已修：本报告 §2 |
| 「零出站」场景里「发信函数被调用 0 次」没有断言 | 已修：场景改为数轮次与审批卡（生成模块不引用发信模块，由源码断言守住） |
| proposal 写改两条，实际改六条 | 已修 |
| 「回复截止落在截标当天」只断言了命中，没断言不生成 | 已修：隔离库测试加端到端 |
| 两个场景的断言不在对应用例上（第二次生成、旧记录的文件地址） | 已修 |
| 主规格两处悬空指代（「同一项目」「文件抬头」） | 已修 |
| tasks 3.2 的 grep 会命中测试里的否定断言 | 已修：verify 排除 `__tests__` |
| design 两处与实现有出入 | 已修 |
| 规格没写的可观察行为（元数据的页数、可用类型列表、空状态提示） | 已修：规格补上 |

**使用流畅与文案**

| 意见 | 处理 |
|---|---|
| 说明里写「需求」，页签叫「招标要求」；「减少后再试」页面上做不到 | 已修（§1 出入第 2、3 条）。「没有已确认的要求」那句是任务书指定的原句，不改 |
| 失败后菜单不收起，浮层盖住错误说明 | 已修 |
| 两类已停用的旧文件看上去比旧询价更「有效」 | 已修：加「已停用的旧文件」标记 |
| 身份命中的说明没有下一步，位置名「询价附件」在下载场景不贴切 | 不改：CHAIN-4b 定的句子，任务书要求沿用；与回复截止的问题一起在 RFQ-PDF-2 处理 |
| 生成新版后立刻出现「此前生成的 PDF 可能过期」 | 不改：所有文件类型的既有行为，另开任务 |
| 等待中只有菜单项前的转圈 | 不改：既有行为，另开任务 |
| 下载文件名带「 vN」 | 不改：任务书指定标题格式 |
| 列表只显示前 8 条 | 不改：既有行为；「版本历史」里看得到全部 |
| 询价单模板本身的三处（回复方式那句在下载场景说不通、回复截止按生成时刻算、「招标文件未明确数量」） | 留给 RFQ-PDF-2（模板不在本次范围） |

**测试有效性**——在单独的工作树里逐个引入 16 种坏改动，看有没有测试变红。

| 意见 | 处理 |
|---|---|
| 菜单路径的「模板文字命中」没有端到端用例（把交给检查的模板稿掏空，测试全绿） | 已修：隔离库测试加一段（截标前 2 天 → 抛身份命中、PDF 生成函数没被调用、什么都没写） |
| CI 里隔离库测试会跳过（CI 没设 `DATABASE_ENVIRONMENT=isolated`），接口映射在 CI 里没有保护 | 已修：纯逻辑测试加接口映射的结构性断言。CI 配置不在本次范围，记入 §6 |
| 所有断言都用假 PDF 函数 | 已修：手工脚本 `scripts/cjk-pdf-e2e.ts` 加供应商询价单的真实 Chromium 段；本报告 §2 是一次实跑 |
| 落库重构后「只标同类」「版本号数全部」无保护 | 已修：两个测试各加断言 |
| 四处恒真或分辨不出的断言 | 已修 |
| 环境里有 `TENDER_RFQ_FROM_NAME` 时一段必红 | 已修：测试清掉并还原这三个变量 |

**安全 / 隐私与八条硬纪律**——（结论与逐条处理在合并前填入。）

### 第二轮

（在第一轮的修复之上再审一遍，结论在合并前填入。）

## 6. 已知限制与后续

1. **回复截止会落在截标当天并被拦下。** 截标前 2 天（或组织把回复截止提前量设成 0）时，菜单询价单与起草询价都生成不了，说明是「命中：截标日期·询价附件」。既有行为，计划在 RFQ-PDF-2 修。既有的 `attachment-db.isolated.test.ts` 夹具截标日是 2026-12-05、走真实时钟，2026-12-03 当天会因此失败，同一处修。
2. **合规取证清单的空窗。** 简报下线后、RFQ-PDF-2 合并前，营业执照 / 工厂照片 / 劳工制度那份清单不在任何生成文件里。
3. **与 #538（CHAIN-2d）的冲突。** 只在 `generate-docs.ts` 的 import 块；后合并的一方保留本分支的两行 import，再加 `redactLegacyMemo` 那一行。
4. **CI 不跑隔离库测试。** `ci.yml` 设了 `DATABASE_URL` 与 `NODE_ENV=test`，没设 `DATABASE_ENVIRONMENT=isolated`，所有 `*.isolated.test.ts` 在 CI 里自动跳过（不是本次引入）。本次用纯逻辑测试里的结构性断言补了接口映射；要不要让 CI 真跑隔离库测试，另行决定。
5. **并发生成的版本号。** 同一项目同一类并发生成可能重号（现状，所有文件类型共用）。
6. **菜单的两处既有体验问题**（生成新版后立刻提示「可能过期」；等待中反馈弱）没有动。
7. **生产验证没做。** 沙箱访问不到线上；合并部署后需要有人在一个真实投标项目上点一次「供应商询价单 PDF」，确认能下载、中文正常。
