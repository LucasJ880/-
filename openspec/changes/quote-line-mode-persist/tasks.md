# Tasks：报价做法一「逐行报价」，成本存进系统（BIDPAGE-3）

## 1. 契约与纯函数

- [ ] 1.1 `engineConfigSchema` 加可选 `entryMode: "LINE"`；`service.ts` 导出既有 `nextQuoteNumber`（不改行为）；测试：旧配置解析结果逐字段不变、`entryMode` 经合并保留
- [ ] 1.2 `src/lib/bid-page-v2/quote-line/contract.ts`：`metadata.bidLine` 结构、共用参数 / 预置的键、保存请求的校验（行数、品名、数量、单位、币种、证据类别、手填必须有证据、汇率）
- [ ] 1.3 `mapping.ts`：逐行状态 ↔ 成本行（货品 / 共用参数 / 预置；一种币一个汇率；按件换算招标单位价；只动自己管的行、保留其它 `metadata` 键）；新建时的种子（价格表 / 空），预置与 `templateSupplyOnlyLines` 逐项相同
- [ ] 1.4 `allocation.ts`：按 D4 从引擎结果分摊到手成本、我方单价、行合计、行毛利率；逐行合计与差额、差额上限；导出用单价
- [ ] 1.5 `draft-import.ts`：旧本地草稿按行号带入（报价、口径、币种、证据、汇率、目标毛利率），列出没导入的项
- [ ] 1.6 纯逻辑测试（往返、模板对照、分摊不变量与差额上限、四个数与 `computeQuote` 相同、校验、草稿导入），注册进 `test-all.sh` 与 `test-ci-unit.sh`

## 2. 服务与接口

- [ ] 2.1 `service.ts`：列表、新建（逐行一次写入；另两种业务走 `createEngineQuote`）、读逐行视图（含询价回复、表空时的招标分析带入）、保存（事务、并发 409、冻结 409、快照、审计）、导出（AUTHORITATIVE 且指向这一份）
- [ ] 2.2 三个路由文件、五个处理函数：第一步 `requireQuoteAccess` 并紧接着检查，再金额门、开关与招投标项目
- [ ] 2.3 隔离库端到端测试（真实路由；身份：负责人、有财务查看权的同事、无财务查看权的成员、只读成员、组织外；开关关；专业模式改过后；另起新版；并发；导出；`QuoteLineItem` 与投标工作区不变），注册进 `test-all.sh`

## 3. 新页面 ② 定报价

- [ ] 3.1 报价区组件：列表、新建两问、逐行表（7 列）、共用参数与预置（说明文字）、四个数、差额与警告、询价回复点选、粘贴 / 招标分析带入 / 加一行、草稿提示、保存、导出、「更多 → 专业模式」
- [ ] 3.2 `bid-page-v2.tsx` ② 换成新区块（我方报价卡保留；`#bid-quote-area` 保留；不再挂投标工作区面板与旧报价区；旧报价单折叠在最下面）；`next-step.ts` 的 `bid_decided` 去处改为 ②
- [ ] 3.3 渲染测试与源码断言（新区块、看不到金额的人、开关关零变化、不写 `localStorage` 成本 / `QuoteLineItem` / 投标工作区），更新 BIDPAGE-1 测试里受影响的断言

## 4. 门禁与验证

- [ ] 4.1 `npm test` 全量（失败名单与 main 相同）、`test:ci`、typecheck、`lint:baseline`、测试注册、`openspec validate quote-line-mode-persist --strict`、`prisma/` 无 diff
- [ ] 4.2 浏览器抽检（本地合成数据，开关开）：新建逐行报价、两行报价与共用参数、四个数、导出；开关关与 main 截图一致

## 5. 报告与 TASKFLOW

- [ ] 5.1 `docs/QINGYAN_BIDPAGE-3_REPORT.md`（改了什么、出入、门禁、审查意见与去向、未验证、回退）；TASKFLOW BIDPAGE-3 `[~]`；交接文档

## Workflow follow-up

- 合并后 `/opsx:archive quote-line-mode-persist --yes`（独立小 PR）
