# Design: install-2h-warranty-shades-update

## Context

动机见 proposal.md。INSTALL-2g 之后：质保部件为 labour / fabric / components / frame / motor；种子帘类、窗帘为人工 1 / 面料 5 / 部件 15，Shutters 为 1 / 15 / 25；报价单 PDF 三段质保文字由 `warranty.test.ts` 与种子交叉比对；Order Form 帘类、窗帘页面各有一句手写的质保文字（`order-shades.tsx`、`order-drapes.tsx`），没有被比对。

官网新条款（§0a）里与帘类 / 窗帘相关的：Labour（Sunny 安装）1；Fabrics 5（zebra、roller、solar、Shangri-La、drapery）；Manual components & hardware 15（不含无绳升降机构）；Cordless lift mechanisms 3（手动无绳的帘与卷帘，含斑马帘）；Motors 5（经 Sunny 电动方案供应的电机）；Motor accessories 5（遥控等）；Batteries 1。

收口单元里，Blinds 行有操控方式（普通 / 无绳 / 电动），国内下单行有 `control`，窗帘行只有工艺、外采购行没有操控信息。

## Goals / Non-Goals

**Goals**
- 种子、报价单 PDF、两张 Order Form、质保邮件四处的帘类 / 窗帘年限一致，并由测试锁定。
- 邮件不让手动有绳帘的客户误以为自己有电机或无绳机构。

**Non-Goals**
- 不改 `warranty-service.ts`、执行器、发信、抄送（INSTALL-2g 的行为不变）。
- 不改 `src/lib/install/closeout.ts` 的单元结构，不把操控方式带进质保单元。
- 不改 `order-shutters.tsx`、Shutters 年限。
- 不碰 `src/lib/muse-bridge/**`、Prisma schema。

## Decisions

### D1 新增三种部件，`motor` 只改邮件文字
新增 `cordless`（无绳升降机构）、`motor_accessories`（电机配件）、`batteries`（电池）；顺序 labour → fabric → components → cordless → frame → motor → motor_accessories → batteries。
- 否决：把电机与配件合成一个部件——官网分两行，老板以后可能分别改年限。
- 否决：把无绳机构并进 components 改成 3 年——会把有绳帘的五金也写成 3 年。

### D2 按品类全列，邮件文字注明适用条件
帘类种子含无绳 3、电机 5、配件 5、电池 1；窗帘含电机 5、配件 5、电池 1（官网无绳机构只针对帘与卷帘，不含窗帘）。邮件里电机 / 配件 / 电池写 "(if supplied)"，无绳机构写 "(cordless models)"。
- 否决：按单元操控方式只列适用部件——窗帘与外采购行没有可靠的操控信息，电动窗帘会被漏列（少写客户的保修），且要把操控方式带进质保单元，改动面大；按品类全列加注明，既确定又不少写。

### D3 Order Form 文字与 PDF 同句，由测试比对
两张 Order Form 的质保文字改为与对应 PDF 段同一句（去掉句末句点）；`warranty.test.ts` 由种子年限拼出期望句子，逐字比对 PDF 三段与两张 Order Form，并断言旧句不再出现。
- 否决：Order Form 直接 import `quote-pdf.ts` 的常量——该模块带 PDF 渲染相关依赖，页面组件只为一行文字引入它不值得；文字比对已足够锁定。

### D4 不改写已保存设置（沿用 INSTALL-2g D2）
已保存过质保设置的企业，帘类 / 窗帘新部件为空，邮件不会列出；由老板在「质保设置」补填。设置页"当前为默认值"提示可判断。

## 与八条硬纪律

1. 零 schema：质保设置仍在 `Organization.settingsJson.sunnyWarranty`；不加 model / 字段 / migration。
2. 出站先审批：不涉及（审批与执行器不变）。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及 Muse；质保邮件仍不含金额。
5. 不爬登录页：不涉及；条款来自 Lucas 提供的公开页面截图。
6. 邮箱分离：不涉及（发件身份、抄送逻辑不变）。
7. 确定性优先：部件按品类查表，邮件确定性渲染；不加 LLM 调用。
8. 测试注册：不新增测试文件；`warranty.test.ts`、`warranty-db.isolated.test.ts` 已注册。

## Risks / Trade-offs

- [手动有绳帘的邮件也列出电机 / 电池 / 无绳机构] → 文字注明 "(if supplied)" / "(cordless models)"，与官网条款写法一致。
- [已保存过设置的企业不会自动获得新部件] → 报告与 HANDOFF 写明老板补填的值。
- [质保表变成 8 列] → 设置页表格已有横向滚动。

## Migration Plan

部署即生效（种子在读取时计算）。回滚 = 回退本 PR；已保存的新部件在旧代码校验里是"未知部件"，读取会回退到种子（旧代码行为），不影响发送。

## 验证方式

- `npx tsx src/lib/install/__tests__/warranty.test.ts`：种子、部件顺序、新部件保存、帘类邮件内容与注明文字、报价单 PDF 三段与两张 Order Form 文字交叉比对。
- 隔离库 `warranty-db.isolated.test.ts`：接口读出新种子；保存新部件读回；未知部件 400。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate install-2h-warranty-shades-update --strict`；全量 `npm test`（隔离库）。
- 本地浏览器走查：老板质保设置 8 列与帘类 / 窗帘新种子；会计确认帘类单尾款后预览邮件含新部件与注明文字。截图存 `docs/install-2h-screenshots/`。
