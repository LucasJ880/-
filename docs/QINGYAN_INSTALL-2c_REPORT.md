# INSTALL-2c 报告 — 尾款确认后：完工 + 质保邮件（审批后发出）

change：`openspec/changes/install-2c-warranty-email/`（proposal / spec `installation/warranty-email` 12 条 / design D1–D11 / tasks 8/8）
方案：`docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §3、§12 Q1–Q3（2026-10-28 Lucas 拍板：质保以报价单为准）；邮件模板 `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md`
零 schema：设置在 `Organization.settingsJson.sunnyWarranty`；审批是既有 `PendingAction`（type `install.send_warranty_email`）；发送记录 `AuditLog(install.warranty.sent)`；设置改动 `AuditLog(install.warranty.settings)`；通知用既有 `Notification`。不新增 LLM 调用，邮件由确定性模板渲染。

## 1. 做了什么

| 场景 | 改前（2b 之后） | 现在 |
|---|---|---|
| 会计确认尾款 | 单子变"已完成"，客户什么都收不到 | 同一个对话框出第二步「质保邮件」：资料齐 → 显示整封邮件预览（收件人、主题、正文），会计点"批准发送"或"稍后再批"；资料不齐 → 列出全部原因（如"缺报修电话""客户没有邮箱"），尾款确认本身照常生效 |
| 邮件内容 | — | 英文；质保编号 `W-<单号>`、单号、客户名、安装地址、安装日（企业时区）、每扇窗 / 每行的位置 + 产品 + 面料、单内每个品类各部件的年限与到期日、条款链接、报修电话 / 邮箱 / 地址；**不含任何金额**、成本、内部备注、员工信息 |
| 质保年限 | 只写在报价 PDF 上 | 会计「待收尾款」页签下方「质保设置」：品类 × 部件年限 + 联系方式；老板可改（`sales.settings.manage`），会计只读；种子 = 报价单口径（帘类 1/5/15，Shutters 1/5）；报修电话 / 邮箱种子留空，填之前不生成邮件 |
| 发出去 | — | 只在批准后由审批执行器发；只用组织发件身份（设置 → 邮件 → 组织发件人）；没配置 → 失败 `NO_ORG_SENDER`，不回落到任何个人邮箱；每单只发一封（两条审批先后批准也只发一封） |
| "最近已确认"列表 | 只有尾款信息 | 新列「质保邮件」：未生成 / 缺资料（查看原因）/ 待批准（预览并批准）/ 已发送 · 时间 / 发送失败（原因）/ 已拒绝 / 已过期；非"已发送 / 待批准"都可"生成质保邮件"重来 |
| 谁知道结果 | — | 发出 → 该单销售收到"质保邮件已发出"（无金额），点开工艺单详情；失败 → 批准人收到"质保邮件未发出"（含原因），点开会计「待收尾款」页签并定位该单 |
| 微信 / Muse | — | 新审批类型登记为"对外发送"：微信回数字与 Muse 都不能批，只能在网页看过全文后批 |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/install/warranty.ts`（新，纯） | 常量、`seedWarrantySettings`、`validateWarrantySettings`、`readWarrantySettings`、`addYears`、`warrantyBlockers`、`renderWarrantyEmail`、`deriveWarrantyStatus` |
| `src/lib/install/warranty-service.ts`（新） | `loadWarrantyStatuses`（列表状态 + 待批准预览）、`generateWarrantyApproval`（已发送 / 已有待批准 / 缺资料 / 建审批；幂等键 `install-warranty:<单 id>:<第几次>`，有效期 7 天，批准人 = 当前操作人） |
| `src/lib/pending-actions/exec-install-warranty-email.ts`（新） | 执行器：组织一致 → 批准人有效成员 → 单属本企业 → 已确认尾款 → 收件人 = 客户档案当前邮箱 → 组织发件身份存在；advisory lock 内查 `install.warranty.sent` 后发送并写审计；成功通知销售、失败通知批准人 |
| `src/lib/pending-actions/{types,executor}.ts` | payload 类型；`install.send_warranty_email` 分支 |
| `src/lib/ai-grader/actions/wechat-confirm-policy.ts` | 新类型 = `web_only_external`（守卫测试同步） |
| `src/lib/install/closeout.ts`、`src/lib/fulfillment/category.ts` | 收口单元带品类（Blinds 行 `categoryOfProductType`；国内下单→shades、窗帘→drapery、Vinyl→vinyl、外采购按段映射，段映射改为导出） |
| `src/app/api/install/warranty-settings/route.ts`（新） | GET（会计 / 确认尾款者 / 老板可读，返回 canEdit、saved）；PUT（`sales.settings.manage`；行锁内只替换 `sunnyWarranty` 键；写审计） |
| `src/app/api/accounting/balance/[orderId]/warranty/route.ts`（新） | POST 重新生成：404 / 409 `NOT_CONFIRMED` / 409 `ALREADY_SENT` / 500 `APPROVAL_FAILED` / 200 `{warranty}` |
| `src/app/api/accounting/balance/[orderId]/confirm/route.ts`、`route.ts` | 确认响应带 `warranty`（首次确认生成；重复确认只读状态；出错兜底为 error 状态，不影响尾款确认）；列表 `recentConfirmed[].warranty` |
| `src/components/accounting/warranty-panel.tsx`（新）、`balance-tab.tsx` | 预览（iframe `srcdoc` + 空 `sandbox`，不跑脚本）、批准、阻断原因、状态列、质保设置面板；确认对话框第二步 |
| `src/lib/install/balance{,-service}.ts` | 通知落点覆盖两个新类型；`notifyInstallUser` 导出复用 |
| `src/lib/notifications/{constants,delivery-gate}.ts`、`src/components/notification/*` | `install_warranty_sent` / `install_warranty_failed` 登记、grandfather 时间、开关文案、图标 |
| `src/lib/api-fetch.ts` | `/api/install/warranty-settings` 归入按企业作用域的接口 |
| 测试 | `warranty.test.ts`（纯 46）、`warranty-db.isolated.test.ts`（隔离库 + 真实路由 31）、`closeout-units.test.ts`（+品类断言，32）、`balance.test.ts`（+落点，38）、`wechat-confirm-policy.test.ts`（11）；均已在 `scripts/test-all.sh` 注册 |

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/install/__tests__/warranty.test.ts` | 46 passed |
| `npx tsx src/lib/install/__tests__/closeout-units.test.ts` | 32 passed |
| `npx tsx src/lib/install/__tests__/balance.test.ts` | 38 passed |
| `npx tsx src/lib/ai-grader/actions/__tests__/wechat-confirm-policy.test.ts` | 11 passed |
| 隔离库 + 真实路由 `warranty-db.isolated.test.ts` | 31 passed（见 §3.1） |
| 浏览器走查（本地 `next dev` + Playwright，会计 / 老板两个会话） | 13/13（见 §3.3） |
| `npm run typecheck` | 0 error |
| `npm run test:ci` | PASS |
| `npm run lint:baseline` | PASS（相对基线 −14 error，无新增 fingerprint） |
| `bash scripts/check-test-registry.sh` | OK（465 注册） |
| `openspec validate install-2c-warranty-email --strict` | valid |

### 3.1 隔离库端到端覆盖

设置：会计读 200 / canEdit false / 未保存即种子（Shutters 1 / 5、电话空）；会计保存 403；Shutters 部件 99 年 400。缺电话时确认尾款：200，`warranty.status = blocked`，原因含"缺报修电话""缺报修邮箱"，0 审批、0 发送。老板补齐：200，其他设置键（时区）保留，设置审计一条。重新生成：`pending_approval` + 审批 id；收件人 = 客户邮箱、主题格式对；预览无金额、含 "Components 5 yr (until 2031-10-28)"；审批人 = 确认尾款的会计、状态 pending；再点生成 → 同一审批。未配置发件身份时批准：400、审批 failed、原因 `NO_ORG_SENDER`、0 发送；批准人收到失败通知（落会计页签）；列表 failed 且可重新生成。配置发件身份后：重新生成得到新审批（第 2 次尝试）；批准 200 → executed、发送 1 次、以组织身份发给客户邮箱；`install.warranty.sent` 一条（含消息 id）；销售收到"质保邮件已发出"（无金额）；列表 sent、不可再生成；再生成 409 `ALREADY_SENT`。第二张单：确认尾款直接 `pending_approval` + 预览；人为构造同单第二条审批，先后批准 → 只发一封，第二条 `ALREADY_SENT`。客户邮箱被改后批准 → `RECIPIENT_MISMATCH`、不发；再生成后发件通道报错 → `SEND_FAILED`、不发，批准人对同一单收到第二条失败通知；客户无邮箱 → blocked「客户没有邮箱」；所有已发邮件无金额。

### 3.2 全量 `npm test`

隔离库：**474/484**。10 个失败 = 2a / 2b 报告里同一批 9 个环境性失败（Mention Gateway M2-A Identity DB、`sunny-process/autogen-db.isolated`、Phase3A-3 Approvals Smoke、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Phase3A-5 Overview Acceptance、Autopilot A2-P0、T4 授标情报矩阵、报价 PDF 分页）+ 套件内 `tsc` 这次没带 `NODE_OPTIONS=--max-old-space-size=8192` 而堆溢出；同一命令带 8 GB 堆单独跑 0 error。套件里本 change 的测试：`warranty.test.ts` 46/46、`warranty-db.isolated.test.ts` 31/31（含下面自审修正的回归断言）、2a / 2b 的收口与尾款测试全过。

### 3.3 浏览器走查

本地 `next dev`（隔离库）+ Playwright；会计、老板两个会话；种子：三张已收口的 Shutters（Vinyl）单，其中一张已确认尾款并已有发送记录。

| # | 步骤 | 结果 |
|---|---|---|
| 1 | 会计确认尾款（设置未填电话 / 邮箱） | 第二步「质保邮件」列出"缺报修电话""缺报修邮箱"，尾款已确认 |
| 2 | 关闭后看"最近已确认" | 该行"缺资料"+"生成质保邮件"；已发过的单显示"已发送 · 时间" |
| 3 | 会计打开「质保设置」 | 只读，提示"只有老板可以修改"，Shutters 部件 5 年 |
| 4 | 老板填报修电话 / 邮箱并保存 | "已保存" |
| 5 | 会计刷新后点"生成质保邮件" | 行内出现邮件预览：质保编号、Shutters 部件年限，无金额 |
| 6 | 会计点"批准发送"（组织未配置发件身份） | 批准接口 400；预览下方红字 `NO_ORG_SENDER：组织未配置发件身份：请老板在 设置 → 邮件 → 组织发件人 配置后，重新生成并批准`；不显示"已发送" |
| 7 | 刷新列表 | 该行"发送失败"+ 原因 +"生成质保邮件" |
| 8 | 会计点铃铛 | 第一条"质保邮件未发出：<单号>" |
| 9 | 点这条通知 | 跳到 `/accounting?tab=balance&order=<id>`，页面上能看到这张单 |

截图：`docs/install-2c-screenshots/01-confirm-step2-blocked.png` … `07-bell-landing.png`。
真实发信（配置了组织发件身份 + `RESEND_API_KEY`）没有在本地走：本地没有 Resend 凭据；成功路径由隔离库测试注入发件函数覆盖（§3.1）。

走查与自审中发现并修正：
- "生成质保邮件"在网络异常时没有任何提示（只有 `finally`）——补 `catch`，显示"网络错误，请重试"。
- 走查脚本第一次把预览下方的说明文字"以组织发件身份…"当成了失败原因（假阳性），改为等批准接口响应并只认红字里的 `NO_ORG_SENDER`。
- 自审：失败通知按"单 + 人 + 类型"去重，同一单第二次发送失败时批准人收不到通知（spec 要求每次失败都通知）——失败通知改为按审批 id 去重（`notifyInstallUser` 加可选 `dedupeKey`），隔离库加回归断言。
- 本地 `next dev` 需要 `QINGYAN_ALLOWED_DB_ENDPOINT_PREFIXES=127`，否则运行时隔离守卫（`assertNonProdSideEffectsAllowed("write")`）拒绝建审批，页面显示"生成审批失败：创建待确认草稿失败"——这是守卫按设计工作，不是本 change 的问题；已写进交接 §4b。

## 4. 判断点（审核请重点看）

1. **批准人 = 确认尾款的会计**（D6）：确认与批准是同一人连续两步，中间看到完整邮件；不需要新权限键。要改成老板批准请告诉我。
2. **只用组织发件身份**（D5）：上线前老板必须在 设置 → 邮件 → 组织发件人 配置，否则每封都会 `NO_ORG_SENDER`（不会误发、不会走个人邮箱）。
3. **种子按报价单**（D2）：帘类 Labour 1 / Fabric 5 / Components 15；Shutters Labour 1 / Components 5；电机不单列。官网检索摘要里的 Shutters 25 年未采用。
4. **报修电话 / 邮箱不预置**（D10）：摘要里的 647-857-8669 / sales@ 未核实，种子留空；老板填之前所有单都是"缺资料"。
5. **内容在生成时定稿**（D4）：批准的就是会发出的；之后改了设置或客户邮箱，要"生成质保邮件"重来（改了客户邮箱时执行器会拒发 `RECIPIENT_MISMATCH`）。
6. **一单一封**（D7）：以 `install.warranty.sent` 为准，advisory lock 内检查；失败 / 拒绝 / 过期后可以重新生成（幂等键带第几次）。
7. **安装日 = `installedAt` 的企业时区日期**（D8）：返修后由 INSTALL-2e 更新。

## 5. 上线动作

| # | 谁 | 做什么 |
|---|---|---|
| 1 | 老板 | 设置 → 邮件 → 组织发件人：配置发件身份（平台需已配 `RESEND_API_KEY`） |
| 2 | 老板 | 会计视图 →「待收尾款」→「质保设置」：填报修电话、报修邮箱；核对各品类年限是否与当前报价单一致 |
| 3 | Lucas / Evan | 对照官网 `warranty-service` 原文（本会话读不到）确认条款链接与年限无冲突 |
| 4 | 运维 | `install.warranty.sent`、`install.warranty.settings` 加入不可清理清单（已写进任务书 §7）：删了 `install.warranty.sent` 会导致重发 |

## 6. 已知限制

- 只有英文邮件；中文版（模板 §5 / 方案 Q5）未做。
- 邮件不列销售姓名（spec 不输出员工信息）；模板草稿里的 `{{salesName}}` 已在模板文档标注为不实现。
- 待批准的质保审批在 7 天后过期，过期后列表显示"已过期"，可重新生成；不额外提醒。
- 返修单（INSTALL-2d / 2e）完成后的质保邮件：本 change 只处理一次装完的单；返修关闭后接回 2b / 2c 由 2e 负责。
