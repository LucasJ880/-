# Design: install-2g-warranty-update

## Context

动机见 proposal.md。现状（INSTALL-2c）：

- 质保设置存 `Organization.settingsJson.sunnyWarranty`：`terms`（品类 × 部件 labour / fabric / components / motor）+ `contact`（公司名、电话、邮箱、地址、条款链接）。从未保存或已存坏数据时读种子；种子 Shutters 为人工 1 / 部件 5，电话与邮箱为空（当时只有检索摘要，未核实不进种子）。
- 尾款确认 / 重新生成时渲染邮件并把收件人、主题、正文、HTML 定稿进 `install.send_warranty_email` 审批；执行器重新校验后经 `sendAsOrg` 以组织发件身份发出。`sendAsOrg` 已支持组织级密送（`trade.email_sender.bcc`），发信底层（Resend）支持抄送但 `SendEmailInput` 没有透出。
- 报价单 PDF 各产品段的质保文字是 `quote-pdf.ts` 里的常量文本。

官网原文与核对：`docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` §0a。Shutters 新条款：Labour（Sunny 安装）1 年；Manual components & hardware 15 年（铰链等五金按功能保）；Shutter frame & panels 25 年。电话 647-857-8669 与官网、报价单 `COMPANY_INFO.phone` 一致；报修邮箱 service@sunnyshutter.ca 与抄送 miki@sunnyshutter.ca 由 Lucas 2026-10-29 确认。

## Goals / Non-Goals

**Goals**
- 新装企业开箱即按新条款发 Shutters 质保，联系方式与抄送不用手填。
- 报价单、质保设置种子、质保邮件三处 Shutters 年限一致，并由测试交叉校验。
- 抄送只来自企业设置、在审批里可见、执行时校验。

**Non-Goals**
- 不改帘类 / 窗帘年限与报价单帘类文字（`quote-pdf.ts` shades / drapes 段、`order-shades.tsx`、`order-drapes.tsx`）。
- 不改 `src/lib/trade/email-sender.ts` 的组织密送（`trade.email_sender.bcc`）语义与外贸发信调用方（`sendTradeEmailForOrg`）。
- 不改 `exec-install-warranty-email.ts` 的发送前校验顺序、一单一封的锁与 `RECIPIENT_MISMATCH` 规则。
- 不改 `order-shutters.tsx`（Order Form 页面无质保文字）。
- 不碰 `src/lib/muse-bridge/**`、`vercel.json`、Prisma schema。

## Decisions

### D1 新部件 `frame`（框架与叶片），不复用 `components`
Shutters 新条款把框架与叶片（25 年）和五金（15 年）分开。新增部件 `frame`（英文 "Frame & Panels"、中文"框架与叶片"），部件顺序为 labour → fabric → components → frame → motor；Shutters 用 components = 15（五金）+ frame = 25。
- 否决：Shutters 只写 `components` = 25——会把铰链等五金也写成 25 年，比官网多写。
- 否决：部件改为自由文本——失去校验与确定性渲染，设置页也无法逐格填写。

### D2 改种子，不改写已保存设置
种子改为 Shutters 1 / 15 / 25、电话 647-857-8669、邮箱 service@sunnyshutter.ca、抄送 [miki@sunnyshutter.ca]。已保存的设置原样使用；老设置没有 `cc` 键按空列表处理。
- 否决：读取时自动把旧值升级成新值（例如 Shutters 部件 5 → 15 / 25、缺 `cc` 补 miki@）——无法区分"老板有意保存的值"与"旧种子"，静默改写老板的设置。代价：已保存过设置的企业要老板手动改一次，交付报告写明。

### D3 抄送存在质保设置里，生成时定稿进审批
`WarrantySettings` 加顶层 `cc: string[]`（不放进 `contact`，`contact` 是写给客户看的报修信息）。校验：接受数组或逗号 / 分号 / 空白分隔的字符串，转小写、去重，每个过邮箱格式，最多 5 个。生成审批时 `payload.cc` = 设置里的抄送去掉与收件人相同的地址；审批标题下的预览与会计页预览显示抄送。执行器只用 `payload.cc`，重新校验格式与个数，不合法 → `INVALID_PAYLOAD`；发送时传给 `sendAsOrg`；审计 `install.warranty.sent` 记 `cc`。
- 否决：把 miki@ 加进组织发件身份的密送（`trade.email_sender.bcc`）——那是全企业所有对外邮件（外贸询盘回复、开发信）共用的密送，且是密送不是抄送，与 Lucas 要求不符。
- 否决：写死在代码里——人员变动要改代码。
- 否决：执行时按当前设置重算抄送——批准人批准的是预览里看到的抄送；设置在生成后变化不应改变已批准的内容。

### D4 发信底层透出抄送，不传时行为不变
`SendEmailInput` 加可选 `cc?: string[]`，非空时传给 Resend；`sendAsOrg` 的消息参数加可选 `cc` 并在每次尝试（含平台地址代发）原样带上。其他调用方不传 `cc`，行为与现在完全一致。
- 否决：执行器绕过 `sendAsOrg` 直接调 Resend——会丢掉"发件域名未验证用平台地址代发"的既有规则。

### D5 报价单 Shutters 文字随种子改，并由测试交叉校验
`quote-pdf.ts` Shutters 段改为 "Warranty: 1 year labour / 15 years components / 25 years frame & panels."。`warranty.test.ts` 读 `quote-pdf.ts` 源文本，由种子年限拼出期望文字逐段比对（Shutters、Shades、Drapes），任何一边单独改都会测试失败。
- 否决：测试里 import `quote-pdf.ts`——它带 PDF 渲染依赖，在 tsx 单测里加载成本高且易受浏览器 API 影响；读源文本已足够锁定对外文字。

### D6 新旧订单都按当前设置
Lucas 定为"Shutters 按最新的来"：本 change 上线后生成的质保邮件一律按当前设置出年限，不按签单日期区分版本。已生成、待批准的审批内容已定稿，不重渲。

## 与八条硬纪律

1. 零 schema：抄送存 `Organization.settingsJson.sunnyWarranty.cc`，审批内容在既有 `PendingAction.payload`；不加 model / 字段 / migration。
2. 出站先审批：抄送地址在生成审批时定稿、批准前可见；批准前零出站；执行器只按审批内容发送。
3. 禁止第三套队列：不涉及（沿用既有审批执行器）。
4. 脱敏：不涉及 Muse；质保邮件仍不含金额（「邮件不输出的内容」不变）。
5. 不爬登录页：不涉及；官网条款来自 Lucas 提供的公开页面截图。
6. 邮箱分离：发件身份仍只读组织设置 `trade.email_sender`；抄送是收件人，不是发件邮箱，且只取自企业质保设置，不从请求取（spec「抄送来源」）。
7. 确定性优先：抄送与年限都是查设置，渲染确定；不加 LLM 调用。
8. 测试注册：不新增测试文件。`warranty.test.ts`、`warranty-db.isolated.test.ts` 已注册；`email-sender.test.ts` 原在历史欠账基线（`ci/test-registry-baseline.txt`），本次登记进 `scripts/test-all.sh` 并从基线删除（只减不增）。

## Risks / Trade-offs

- [已保存过质保设置的企业仍是旧年限、无抄送] → 交付报告与 HANDOFF 写明：老板在「质保设置」把 Shutters 改为 1 / 15 / 25 并填抄送；设置页"当前为默认值"提示可判断是否保存过。
- [抄送地址客户可见] → 抄送本就对收件人可见，Lucas 要求的是抄送；只放内部业务邮箱，最多 5 个。
- [老订单按新条款发，年限多于签单时] → Lucas 拍板（D6），对客户更有利；报告写明。
- [待批准的旧审批仍是旧年限、无抄送] → 会计拒绝后重新生成即可；报告写明。

## Migration Plan

部署即生效（种子在读取时计算）。回滚 = 回退本 PR；已保存的 `cc` 键在旧代码里被忽略（旧校验只读 `terms` / `contact`），不影响读取。

## 验证方式

- `npx tsx src/lib/install/__tests__/warranty.test.ts`：种子、部件顺序、抄送校验、旧设置原样读取、Shutters 邮件内容、报价单文字与种子交叉比对。
- `npx tsx src/lib/trade/__tests__/email-sender.test.ts`：`sendAsOrg` 带抄送（含代发重试）与不带抄送两种。
- 隔离库 `warranty-db.isolated.test.ts`：种子经接口读出、抄送保存 / 合并 / 非法 400、预览与审批带抄送（去掉收件人）、请求体里的 cc / to 被忽略、批准后发送带抄送且审计记录、抄送为空不带抄送。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate install-2g-warranty-update --strict`；全量 `npm test`（隔离库）。
- 本地浏览器走查：老板打开质保设置看到新年限、框架与叶片列、抄送；会计确认尾款后预览显示抄送。截图存 `docs/install-2g-screenshots/`。
