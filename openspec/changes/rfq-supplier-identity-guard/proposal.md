# Proposal：询价不再带出招标身份（CHAIN-4b）

TASKFLOW：CHAIN-4b（Phase F（续）— 情报串联；任务书 `docs/QINGYAN_CHAIN_TENDER_INTEL_CHAIN_TASKBRIEF.md`）。核对基线：main `15bb79c`（2026-11-16）。判断点 6 按推荐 A 起草，落法与任务书不完全相同，见 design「审核关注点」Q1。

## Why

发给供应商的询价邮件标题是「询价：{项目名}」，「供应商询价与符合性确认表」抬头印着项目编号、采购方与投标截止，供应商拿到就能绕过我们直接投标；核对时还发现，没有分析综合结果时的「国内供应商询价 PDF」和「供应商技术确认表 PDF」会把项目 AI 上下文原样印进去，其中有标号、客户、**预估金额、我方报价、中标价**。

## What Changes

**禁出清单与格式检查**
- 新增每个项目专属的禁出清单，五类：招标编号、采购方名称、截标日期、交货地址（街道与邮编）、项目名称 / 招标标题。来源是项目字段与当前可用招标分析的关键事实；规整后不足 4 个字符的词条不收。
- 新增格式检查：供应商侧内容里出现邮箱地址（我方发件地址与授权邮箱除外）或电话号码即命中。
- 命中即整份失败，说明写明命中的类别与位置（哪一栏 / 哪条要求），不复述命中的原文，不做局部替换。既有敏感词表不改，照旧先过。

**询价邮件（`tender.send_rfq`）**
- 标题与正文对项目的称呼改为中性询价编号 `RFQ-{组织代码}-{年份}-{5 位码}`，同一项目各轮相同；标题、正文不再出现项目名称。
- 目的地只印人工填写的，或从分析的地点事实里取出的「城市, 省」；分析里的精确地址不再印进询价。
- 送审时（Web、Muse、自动起草三个入口同一流程）任一处命中即不建轮次、不建审批卡。询价入口在命中时显示新的不可发原因「含招标身份信息」并指明位置；自动起草不起草并说明原因。
- 发送执行前复核：载荷没有本防护标记的卡（本变更上线前起草的）一律拒发并提示重新起草；有标记的卡按当前项目资料再查一遍，命中即整张卡拒发，一封都不发。

**供应商侧生成文件**
- 「供应商询价与符合性确认表」用对外抬头：只有文件名、询价编号、生成日期，不印项目名称、项目编号、采购方、投标截止。内部决策备忘录的抬头不变。
- 「国内供应商询价 PDF」的旧路径与「供应商技术确认表 PDF」不再拼接项目 AI 上下文、项目名称与描述，只出固定模板与询价编号。
- 「国内供应商简报（China Brief）」去掉采购方、截标日期与源文件名三行；自动挑选的事实命中禁出清单的整行不收；编辑备注命中即整份失败。
- 以上文件生成前（含 China Brief 的预览）过禁出清单与格式检查，命中即不生成并说明。

**不加开关**：合并即对所有组织生效（任务书：修泄露不应该能关掉）。

## 受影响的 Muse 意图

不改 `src/lib/muse-bridge/**` 的代码。`rfq`：发出的询价标题与正文改用中性询价编号；询价内容命中禁出清单时，响应照旧是 `VALIDATION_FAILED`，说明文字改为写明命中类别与位置。`chase`：不变（追问与催单回复在原线程，标题沿用原询价标题）。其余意图不涉及。

## Out of scope

- 询价附件（CHAIN-4a）、推荐供应商进收件人（CHAIN-2）、其它 CHAIN 项。
- 让人在询价抽屉里选「本轮不带哪几条要求」：不做。命中时的出路是驳回那条要求或手工发询价，见 design Q7。
- 改既有敏感词表（`china-supplier-brief.ts` 的 `SENSITIVE_PATTERNS`、`pdf-common.ts` 的 `sanitizeSupplierFacing`）的内容。
- 催单 / 追问的模板与模板指纹（`chase-pure.ts`）；上线前已发出的轮次的后续邮件标题。
- 发给采购方的文件（RFI 问题清单、投标文件起草）与内部文件（内部决策备忘录、分析师备忘录、同事任务单）。
- 识别招标要求原文里采购方名称的缩写或另一种语言的写法（如 TBS、SCT、中文译名）：不做，确定性清单只认项目与分析里写明的值。
- schema、迁移、功能开关、定时任务、模型调用：没有。

## Capabilities

### New Capabilities

- `tender/supplier-identity-guard`：发给供应商的询价邮件与供应商侧生成文件不带出招标身份——禁出清单的来源与类别、格式检查、命中即整份失败、中性询价编号、目的地口径、发送前复核、供应商侧文件的对外抬头与取材范围、内部文件不变。

### Modified Capabilities

- `tender/rfq-web-entry`：「发起前的入口状态」新增不可发原因 `identity_leak`（排在 `sensitive_leak` 之后）；「生成并送审」的错误码转人话新增 `IDENTITY_LEAK`。

## Impact

- 新增：`src/lib/bid-workflow/project-identity-deny.ts`（纯函数：禁出清单、扫描、询价编号、城市级目的地）、`src/lib/bid-workflow/project-identity-sources.ts`（读项目与分析事实，只读）。
- 修改：`src/lib/tender-rfq/build.ts`（入参、称呼、目的地、`IDENTITY_LEAK`）、`service.ts`（读来源、送审前扫描渲染结果、载荷标记）、`types.ts`（载荷标记字段）、`execute.ts`（发前复核）、`web-entry.ts` / `web-entry-pure.ts`（入口原因与文案）、`auto-draft-pure.ts` / `auto-draft-service.ts`（自动起草原因）；`src/lib/projects/generate/generate-docs.ts`、`tender-doc-html.ts`（对外抬头）；`src/app/api/projects/[id]/generate-pdf/route.ts`（身份命中返回 422）；`src/lib/bid-workflow/china-supplier-brief.ts`（取材行与身份检查；`SENSITIVE_PATTERNS` 不改）。
- 测试：新增 `src/lib/bid-workflow/__tests__/project-identity-deny.test.ts` 与 `src/lib/tender-rfq/__tests__/supplier-identity-guard-db.isolated.test.ts`；改 `build.test.ts`、`tender-doc-html.test.ts`、`china-supplier-brief.test.ts`（同时注册进 `scripts/test-all.sh`、从 `ci/test-registry-baseline.txt` 删掉这一行）、`web-entry-pure.test.ts`、`auto-draft-pure.test.ts`，以及两个构造发询价载荷的隔离库测试（`stage-auto-db`、`followup-auto-db`）补载荷标记。
- 不动：`prisma/schema.prisma`、`vercel.json`、`src/lib/muse-bridge/**`、`src/lib/pending-actions/**`、`src/lib/tender-rfq/chase-pure.ts`、`src/lib/google-email.ts`、`openspec/config.yaml`。
