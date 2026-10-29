# Proposal: install-2h-warranty-shades-update

**TASKFLOW：** INSTALL-2h（`docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2 段）。依赖 INSTALL-2g（质保部件 `frame`、种子、报价单文字交叉校验）。来源：Lucas 2026-10-29——帘类与窗帘"也按新款的来"。官网原文转录：`docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` §0a。
**受影响的 Muse 意图：** 无。不改 `src/lib/muse-bridge/**`。

## Why

官网新条款对帘类 / 窗帘另有无绳升降机构 3 年、电机 5 年、电机配件 5 年、电池 1 年，系统质保表与报价单、Order Form 只写人工 1 / 面料 5 / 部件 15，质保邮件少列这几项，与已生效的条款不一致。

## What Changes

- 质保部件新增三种：`cordless`（无绳升降机构，邮件写 "Cordless Lift Mechanism (cordless models)"）、`motor_accessories`（电机配件，"Motor Accessories (if supplied)"）、`batteries`（电池，"Batteries (if supplied)"）；既有 `motor` 的邮件文字改为 "Motor (if supplied)"。部件顺序：人工、面料、部件、无绳升降机构、框架与叶片、电机、电机配件、电池。
- 质保设置种子：帘类改为人工 1 / 面料 5 / 部件 15 / 无绳升降机构 3 / 电机 5 / 电机配件 5 / 电池 1 年；窗帘改为人工 1 / 面料 5 / 部件 15 / 电机 5 / 电机配件 5 / 电池 1 年；Shutters 不变（1 / 15 / 25）。
- 报价单 PDF 帘类段、窗帘段质保文字按新种子改写；Order Form 页面（帘类、窗帘）的质保文字同步改写；测试把报价单与两张 Order Form 的文字与种子逐段比对。
- 设置页质保表随部件多出三列。
- 写 `docs/QINGYAN_INSTALL-2h_REPORT.md`，TASKFLOW 增 INSTALL-2h 行并改 `[G]`；更新质保邮件模板文档与 HANDOFF。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `installation/warranty-email`：修改「质保设置」「质保设置读写」「质保设置种子」「邮件内容」「报价单质保文字」。

## Impact

- 改：`src/lib/install/warranty.ts`（部件、标签、种子）、`src/app/(main)/sales/quote-sheet/quote-pdf.ts`（帘类、窗帘段质保文字）、`src/app/(main)/sales/quote-sheet/order-shades.tsx`、`order-drapes.tsx`（Order Form 质保文字）；设置页 `warranty-panel.tsx` 随部件常量自动多列，不改逻辑。
- 数据库：零 schema（质保设置仍在 `Organization.settingsJson.sunnyWarranty`）。
- 已保存过质保设置的企业：不被种子覆盖，由老板在「质保设置」补填新部件。
- 权限、审批、发信、抄送：不变。
- 测试：`warranty.test.ts`、`warranty-db.isolated.test.ts` 补断言；不新增测试文件。

## Out of scope

- 按单元的操控方式（普通 / 无绳 / 电动）只列适用的部件：窗帘与外采购行没有可靠的操控信息，按品类全列并在邮件里注明 "(if supplied)" / "(cordless models)"。
- Shutters 加电机年限；Order Form Shutters 页加质保文字。
- 按签单日期区分新旧条款版本（沿用 INSTALL-2g D6：一律按当前设置）。
- 自动改写企业已保存的质保设置。
