# INSTALL-2g 报告 — 官网新质保条款（Shutters）+ 报修联系方式 + 质保邮件抄送

change：`openspec/changes/install-2g-warranty-update/`（proposal / specs：`installation/warranty-email` 修改 5 条、新增 2 条 / design D1–D6 / tasks 6/6）
来源：Lucas 2026-10-29——"官网新条款已经开始了，shutters 的质保按照最新的来，链接保留，报修邮箱用 service@sunnyshutter.ca 同时 cc miki@sunnyshutter.ca"。官网原文转录与对比：`docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` §0a。
零 schema：抄送存 `Organization.settingsJson.sunnyWarranty.cc`；审批内容在既有 `PendingAction.payload`。不加权限键，不新增 LLM 调用；出站仍只在审批批准后由执行器发出。

## 1. 做了什么

| 场景 | 之前（2c） | 现在 |
|---|---|---|
| Shutters 质保年限 | 人工 1 / 部件 5 | **人工 1 / 部件 15 / 框架与叶片 25**（新部件 `frame`，邮件里写 "Frame & Panels"）；帘类、窗帘不变（人工 1 / 面料 5 / 部件 15） |
| 报价单 PDF Shutters 段 | "Warranty: 1 year labour / 5 years components." | "Warranty: 1 year labour / 15 years components / 25 years frame & panels."；测试把报价单三段文字与质保设置种子逐段比对 |
| 报修电话 / 邮箱 | 种子留空，老板不填就不生成质保邮件 | 种子预填 647-857-8669（官网与报价单一致）、service@sunnyshutter.ca（Lucas 确认） |
| 质保邮件抄送 | 没有 | 质保设置新增"质保邮件抄送"（种子 miki@sunnyshutter.ca，最多 5 个，大小写 / 重复合并）；生成审批时定稿进审批内容（去掉与收件人相同的地址），会计页与审批预览显示"抄送"；批准后按审批内容抄送；审计 `install.warranty.sent` 记抄送；抄送只取企业设置，接口请求体里带 `cc` / `to` 一律忽略 |
| 官网条款链接 | 邮件里带 | 保留（Lucas） |
| 已保存过质保设置的企业 | — | 不被种子覆盖（旧设置读出来仍是 Shutters 1 / 5、无抄送），由老板在「质保设置」手改；页面"当前为默认值"提示可判断是否保存过 |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/install/warranty.ts` | 部件加 `frame`（顺序 labour → fabric → components → frame → motor）；种子改 Shutters 1 / 15 / 25、电话、邮箱、抄送；`WarrantySettings.cc`；`parseWarrantyCc`（数组或分隔字符串 → 小写去重）、校验（格式、≤ 5）；`warrantyCcProblem`（执行器用） |
| `src/lib/install/warranty-service.ts` | 审批内容带 `cc`（设置抄送去掉收件人）；预览（`WarrantyPreview.cc`）与审批预览文字带抄送 |
| `src/lib/pending-actions/exec-install-warranty-email.ts`、`types.ts` | 审批内容 `cc?`；执行前校验（不合法 → `INVALID_PAYLOAD`）；按抄送发送；审计记 `cc`；成功消息带抄送 |
| `src/lib/trade/email.ts`、`email-sender.ts` | `SendEmailInput.cc`（非空才传给 Resend）；`sendAsOrg` 消息参数带 `cc`，每次尝试（含平台地址代发）原样带上；外贸等既有调用方不传，行为不变 |
| `src/components/accounting/warranty-panel.tsx` | 质保表多"框架与叶片"列（随部件列表）；"质保邮件抄送"输入框（保存后回填合并结果）；待批准预览显示"抄送" |
| `src/app/(main)/sales/quote-sheet/quote-pdf.ts` | Shutters 段质保文字 |
| `src/app/api/install/warranty-settings/route.ts` | 注释（部件五种、抄送） |
| 测试 | `warranty.test.ts`（46 → 62）、`warranty-db.isolated.test.ts`（31 → 43）、`email-sender.test.ts`（7 → 9；登记进 `scripts/test-all.sh`，从 `ci/test-registry-baseline.txt` 删除） |
| 文档 | 本报告；`docs/install-2g-screenshots/`；邮件模板文档实现状态与 §0a；HANDOFF；TASKFLOW INSTALL-2g → `[G]` |

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/install/__tests__/warranty.test.ts` | 62 passed |
| `npx tsx src/lib/trade/__tests__/email-sender.test.ts` | 9 passed |
| 隔离库 + 真实路由 `warranty-db.isolated.test.ts` | 43 passed（见 §3.1；`/opsx:verify` 后补 [6] 确认接口带抄送、[9] INVALID_PAYLOAD 两条） |
| 安装回归（隔离库） | `balance-db` 36、`closeout-db` 26、`repair-db` 61、`repair-dispatch-db` 54、`repair-close-db` 76 全过；纯函数 `balance` 56、`repair` 127、`closeout` 16、`closeout-units` 48、`stage` 28 全过 |
| 浏览器走查（本地 `next dev` + Playwright：老板 → 会计） | 13/13（见 §3.3） |
| `npm run typecheck` | 0 error（沙箱需 `NODE_OPTIONS=--max-old-space-size=8192`） |
| `npx eslint`（改动的源文件与测试） | 0 error |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | PASS |
| `bash scripts/check-test-registry.sh` | OK（487 注册；欠账基线 72 → 71） |
| `openspec validate install-2g-warranty-update --strict` | valid |

### 3.1 隔离库端到端覆盖（`warranty-db.isolated.test.ts`）

- [1] 接口读出新种子（Shutters 1 / 15 / 25、电话、邮箱、抄送 miki@）；非法抄送 / 6 个抄送 → 400，设置不变。
- [2] 老板清空电话 / 邮箱后确认尾款 → blocked「缺报修电话 / 缺报修邮箱」（种子已预填，原场景改为先清空）。
- [3] 抄送 "Miki@Fixture.test, miki@fixture.test, office@fixture.test" → 读出 miki@、office@；抄送设为 miki@ + 客户本人邮箱 → 预览与审批内容抄送只有 miki@；请求体带 `cc` / `to` → 被忽略；审批预览文字带"抄送 miki@fixture.test"；预览含 "Components 15 yr (until 2041-10-28)"、"Frame & Panels 25 yr (until 2051-10-28)"、无金额。
- [5] 批准发送 → 抄送 miki@；审计 `install.warranty.sent` 记抄送。
- [6] 确认尾款接口（不是重新生成）的预览同样带设置里的抄送。
- [8] 抄送清空 → 预览无抄送，发送不带抄送。
- [9] 审批内容里的抄送被改成不合法地址 → 批准失败 `INVALID_PAYLOAD`，不发送。
- 2c 原有场景（NO_ORG_SENDER、ALREADY_SENT、RECIPIENT_MISMATCH、SEND_FAILED 通知、客户无邮箱、无金额）全部保留并通过。

### 3.2 全量 `npm test`

隔离库、`NODE_OPTIONS=--max-old-space-size=8192`：**497/506**（2f 时 480/489；中间 main 上别的 change 新登记了测试，本 change 新登记 `email-sender.test.ts` 1 个）。9 个失败与 2a–2f 报告记录的同一批环境性失败完全一致、与本 change 无关：Mention Gateway M2-A Identity DB、Sunny 工艺单签字→导出 DB 端到端（`NO_BINDING`）、Phase3A-3 Approvals Smoke、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview Acceptance、T4 授标情报矩阵、报价 PDF 分页（无 Chromium 字体）。套件内类型检查与测试注册校验（487）通过；INSTALL-1 / 2a–2g 全部安装测试 0 失败（`warranty` 62、`warranty-db.isolated` 43、`email-sender` 9）。

### 3.3 浏览器走查

本地 `next dev`（隔离库）+ Playwright，截图在 `docs/install-2g-screenshots/`：

| 检查 | 结果 |
|---|---|
| 老板打开质保设置：未保存过，显示默认值提示 | ✓ |
| Shutters 默认：人工 1 / 部件 15 / 框架与叶片 25；帘类部件 15、框架与叶片为空 | ✓（`01-settings-default.png`） |
| 报修电话 647-857-8669 / 邮箱 service@sunnyshutter.ca 已预填；抄送默认 miki@sunnyshutter.ca | ✓ |
| 老板改抄送（大小写 / 重复）→ 保存后显示 "miki@fixture.test, office@fixture.test" | ✓ |
| 非法抄送 → 页面红字"抄送地址格式不对" | ✓（`02-settings-cc-invalid.png`） |
| 会计确认尾款 → 第二步预览：收件人 + "抄送：miki@fixture.test、office@fixture.test" | ✓（`03-confirm-preview-cc.png`） |
| 预览邮件：Components 15 yr、Frame & Panels 25 yr；报修电话 / 邮箱为新值；正文不出现抄送地址；无金额 | ✓ |
| 会计看质保设置：只读，框架与叶片 25、抄送不可改 | ✓（`04-settings-readonly.png`） |

走查环境注意：main 上的运行环境防护（`src/lib/env/runtime-isolation.ts`）在 development 下要求显式放行数据库，否则建审批等写入静默失败；本地起 dev server 需加 `QINGYAN_ALLOWED_DB_ENDPOINT_PREFIXES=127`（已写进 HANDOFF §4b）。

## 4. 判断点（审核请重点看）

1. **Shutters 部件 15 年 + 框架与叶片 25 年**（D1）：官网新条款把框架与叶片（25）与五金（Manual components & hardware 15，铰链按功能保）分开；只写一个 25 年会把五金多写。
2. **不改写已保存设置**（D2）：无法区分老板有意保存的值与旧种子；代价是保存过设置的企业要老板手改一次（§5）。
3. **抄送放质保设置、生成时定稿**（D3）：不用组织级密送（那是全企业对外邮件共用、且是密送）；批准人批准的是预览里看到的抄送，执行时不按当前设置重算。
4. **新旧订单一律按当前设置**（D6，Lucas 拍板"按最新的来"）：本 change 上线后生成的 Shutters 质保邮件都写 15 / 25 年，包括签单时报价单还写 5 年的老订单（对客户更有利）。已生成、待批准的旧审批内容不变（旧年限、无抄送），会计拒绝后重新生成即可。
5. **抄送客户可见**：Lucas 要求的是抄送（CC），客户能看到 miki@ 的地址；设置页输入框旁已写明。

## 5. 上线后要做 / 已知限制

- **老板打开「质保设置」看一眼**：显示"当前为默认值"则无需操作；若已保存过（不是默认值），把 Shutters 改为人工 1 / 部件 15 / 框架与叶片 25，并在"质保邮件抄送"填 miki@sunnyshutter.ca。
- 组织发件人仍需老板配置（设置 → 邮件 → 组织发件人），否则质保邮件失败 `NO_ORG_SENDER`。
- 未做（Lucas 本次只定了 Shutters）：帘类 / 窗帘按新条款细分（无绳升降机构 3 年、电机 5、电机配件 5、电池 1）及报价单帘类文字。
- 不按签单日期区分条款版本（见 §4.4）。
