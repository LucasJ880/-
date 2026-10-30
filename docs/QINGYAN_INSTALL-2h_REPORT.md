# INSTALL-2h 报告 — 帘类 / 窗帘按官网新质保条款

change：`openspec/changes/install-2h-warranty-shades-update/`（proposal / specs：`installation/warranty-email` 修改 5 条 / design D1–D4 / tasks 4/4）
来源：Lucas 2026-10-29——帘类与窗帘"也按新款的来"。官网原文转录：`docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` §0a。
零 schema：质保设置仍在 `Organization.settingsJson.sunnyWarranty`。审批、执行器、发信、抄送都不变（INSTALL-2g）。

## 1. 做了什么

| 项 | 之前（2g） | 现在 |
|---|---|---|
| 帘类年限 | 人工 1 / 面料 5 / 部件 15 | 人工 1 / 面料 5 / 部件 15 / **无绳升降机构 3 / 电机 5 / 电机配件 5 / 电池 1** |
| 窗帘年限 | 人工 1 / 面料 5 / 部件 15 | 人工 1 / 面料 5 / 部件 15 / **电机 5 / 电机配件 5 / 电池 1**（官网无绳机构只针对帘与卷帘） |
| Shutters | 1 / 15 / 25 | 不变 |
| 质保部件 | 5 种 | 8 种：人工、面料、部件、无绳升降机构、框架与叶片、电机、电机配件、电池（设置页质保表 8 列） |
| 邮件文字 | "Motor" | 电机 / 电机配件 / 电池写 "(if supplied)"，无绳机构写 "(cordless models)"——手动有绳帘的客户不会误以为自己有电机或无绳机构 |
| 报价单 PDF 帘类段 | "Warranty: 1 year labour · 5 years fabric · 15 years components." | "Warranty: 1 year labour · 5 years fabric · 15 years components · 3 years cordless lift mechanisms · 5 years motors & motor accessories (if supplied) · 1 year batteries (if supplied)." |
| 报价单 PDF 窗帘段 | 同上旧句 | 同帘类，去掉无绳机构一项 |
| Order Form 帘类 / 窗帘页 | "1 year Labour, 5 years fabric, 15 years components" / "1yr labour / 5yr fabric / 15yr components" | 与对应 PDF 段同一句 |
| 交叉校验 | 报价单 PDF 三段 vs 种子 | 报价单 PDF 三段 + 两张 Order Form vs 种子，逐字比对；旧句出现即失败 |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/install/warranty.ts` | 部件加 `cordless` / `motor_accessories` / `batteries`；中英文标签；种子帘类 / 窗帘 |
| `src/app/(main)/sales/quote-sheet/quote-pdf.ts` | 帘类、窗帘段质保文字 |
| `src/app/(main)/sales/quote-sheet/order-shades.tsx`、`order-drapes.tsx` | Order Form 质保文字 |
| `src/app/api/install/warranty-settings/route.ts` | 注释（部件八种） |
| 测试 | `warranty.test.ts`（62 → 73）、`warranty-db.isolated.test.ts`（43 → 46） |
| 文档 | 本报告；`docs/install-2h-screenshots/`；邮件模板文档实现状态；HANDOFF；TASKFLOW INSTALL-2h → `[G]` |

`warranty-panel.tsx` 不用改：质保表按部件常量渲染，自动多出三列。

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/install/__tests__/warranty.test.ts` | 73 passed |
| 隔离库 + 真实路由 `warranty-db.isolated.test.ts` | 46 passed（新种子经接口读出；保存帘类无绳 3 / 电池 1 读回；未知部件 400；2c / 2g 场景全过） |
| 浏览器走查（本地 `next dev` + Playwright） | 7/7（见 §3.2） |
| `npm run typecheck` | 0 error |
| 改动文件 eslint | 0 error（`quote-sheet` 目录其余文件 12 处 `react/no-unescaped-entities` 为既有欠账，改动前后数量相同） |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | PASS |
| `bash scripts/check-test-registry.sh` | OK（489 注册） |
| `openspec validate install-2h-warranty-shades-update --strict` | valid |

### 3.1 全量 `npm test`

隔离库、`NODE_OPTIONS=--max-old-space-size=8192`：**499/508**（2g 时 497/506；中间 main 上别的 change 新登记了 2 个测试）。9 个失败与 2a–2g 报告记录的同一批环境性失败完全一致、与本 change 无关：Mention Gateway M2-A Identity DB、Sunny 工艺单签字→导出 DB 端到端（`NO_BINDING`）、Phase3A-3 Approvals Smoke、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview Acceptance、T4 授标情报矩阵、报价 PDF 分页（无 Chromium 字体）。套件内类型检查与测试注册校验（489）通过；INSTALL-1 / 2a–2h 全部安装测试 0 失败（`warranty` 73、`warranty-db.isolated` 46）。

过程中的一个问题：第一次跑 `npm run typecheck` 发现种子里 `{ part: "cordless" }` 被推断成 `string`（数组字面量展开后不收窄），改为先声明 `WarrantyTerm` 再拼接；`tsx` 单测不做类型检查所以没暴露。

### 3.2 浏览器走查

| 检查 | 结果 |
|---|---|
| 质保表 8 列（含无绳升降机构 / 电机配件 / 电池） | ✓（`01-settings-8-columns.png`） |
| 帘类默认 1 / 5 / 15 / 无绳 3 / 电机 5 / 配件 5 / 电池 1 | ✓ |
| 窗帘默认 1 / 5 / 15 / 电机 5 / 配件 5 / 电池 1 | ✓ |
| Shutters 不变 1 / 15 / 25 | ✓ |
| 会计确认帘类单（斑马帘）尾款 → 预览只有帘类覆盖段 | ✓（`02-shades-preview.png`） |
| 预览 7 项年限与 "(if supplied)" / "(cordless models)" 注明 | ✓ |
| 预览有单元位置、无金额 | ✓ |

## 4. 判断点（审核请重点看）

1. **按品类全列，不按单元操控方式筛**（D2）：窗帘与外采购行没有可靠的操控信息，按单元筛会漏列电动窗帘的电机保修；按品类全列并注明适用条件，与官网写法一致、不少写。
2. **窗帘不列无绳升降机构**：官网原文 "manually operated cordless blinds and shades, including zebra blinds"。
3. **电机与电机配件分两个部件**（D1）：官网分两行，老板以后可分别改；报价单上同年限时合写为 "5 years motors & motor accessories (if supplied)"。

## 5. 上线后要做 / 已知限制

- 老板打开「质保设置」：显示"当前为默认值"则无需操作；若已保存过，帘类补无绳升降机构 3 / 电机 5 / 电机配件 5 / 电池 1，窗帘补电机 5 / 电机配件 5 / 电池 1（已保存的设置不被种子覆盖）。
- Shutters 未加电机年限；Order Form Shutters 页仍无质保文字。
- 已生成、待批准的质保审批内容不变（旧年限），会计拒绝后重新生成即可。
