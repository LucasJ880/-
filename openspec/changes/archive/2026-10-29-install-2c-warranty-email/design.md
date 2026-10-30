# Design: install-2c-warranty-email

## Context

见 proposal.md「Why」。现状（2026-10-28 已读代码，基于 INSTALL-2b 本地头）：
- 尾款确认：`confirmBalance()`（`src/lib/install/balance-service.ts`）事务内写 `install.balance.confirmed` 并推进 `completed`，事务后通知销售；"最近已确认"由 `listBalance()` 输出。
- 收口单元：`buildCloseoutUnits()`（`src/lib/install/closeout.ts`）给出 Blinds 行 + 工艺参数四段，没有品类字段；品类映射已有 `categoryOfProductType()` 与外采购段映射 `PURCHASE_SECTION_CATEGORY`（`src/lib/fulfillment/category.ts`，后者未导出）。
- 审批：`requestApproval()`（`src/lib/approval/request.ts`）——对外发信用 `risk l3_strong`、`idempotencyKey` 必填、按 (orgId, idempotencyKey) 去重；批准 `POST /api/ai/pending-actions/[id]`，批准人 = `approverUserId` 即可（`canDecideTeamApproval`）；执行器 `executePendingAction` 先做 payloadHash 防篡改、工具停用检查，再按 type 分发（`src/lib/pending-actions/executor.ts`）。
- 类型登记三处一致：`PendingActionType` 联合、执行器 case、`WECHAT_CONFIRM_POLICY`（`Record<PendingActionType, …>`，`wechat-confirm-policy.test.ts` 断言三处一致与分类清单）；Muse 只批微信可确认的类型（`museCanApproveAction`）。
- 发信：组织发件身份 `trade.email_sender`（`loadOrgEmailSender` / `sendAsOrg`，平台 Resend；域名未验证时用平台地址代发、显示名 / 回复 / 密送仍为组织的），询盘回复执行器已用这条路且"组织有身份时不回落到个人 Gmail"（`src/lib/pending-actions/exec-sales-inquiry-reply.ts`）。窗饰 `owner` 持 `trade.settings.manage`，可在 设置 → 邮件 配置组织发件身份（`src/app/(main)/settings/email/org-sender-card.tsx`）。
- 质保条款：报价单 PDF（客户签字版）`quote-pdf.ts:99`（帘类）/`:128`（Shutters）/`:166`（窗帘）；官网原文未取到，见 `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` §0。

## Goals / Non-Goals

**Goals:**
- 会计确认尾款后，同一个对话框里看到要发给客户的完整邮件并一键批准；批准前零出站。
- 年限只来自"报价单口径"的设置，代码里没有任何默认年限；缺资料时明确说缺什么、谁去补。
- 一单只发一封，重复批准 / 重复生成都不会再发。

**Non-Goals:**
- 不改 `src/lib/pending-actions/exec-sales-inquiry-reply.ts`、`src/lib/trade/email-sender.ts`、`src/lib/trade/email.ts`（只调用）。
- 不改 `src/lib/muse-bridge/**`（新类型经既有分类自然落到"需网页审批"）。
- 不改 `src/app/(main)/settings/email/**`（组织发件身份沿用既有设置卡）。
- 不改报价单 PDF（`src/app/(main)/sales/quote-sheet/**`）。
- 不改 `src/lib/install/closeout.ts` 的聚合与编号逻辑（只给单元补品类字段）。

## 八条硬纪律对照

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守。设置在 `Organization.settingsJson.sunnyWarranty`；审批在既有 `PendingAction`；发送记录在 `AuditLog`；通知在 `Notification` |
| 2 | 出站先审批 | **触碰**。质保邮件只经 `install.send_warranty_email` 审批后由执行器发出；生成时只建审批不发信；测试断言批准前发送次数为 0 |
| 3 | 禁止第三套队列 | 不涉及。生成在请求内同步，发送在既有审批执行器内 |
| 4 | 脱敏 | 不涉及 Muse 内容。新增 SHALL NOT：邮件不含任何金额 / 成本 / 内部备注 / 照片地址；通知不含金额 |
| 5 | 不爬登录页 | 不涉及（官网条款只作为链接放进邮件，系统不抓取） |
| 6 | 邮箱分离 | **触碰（相邻）**。本 change 不用 Gmail / EmailProvider；发件身份只从组织设置（`trade.email_sender`）读，payload 只含收件人与内容，不含发件地址；执行器不回落到审批人邮箱 |
| 7 | 确定性优先 | 遵守。品类映射、年限查表、到期日计算、模板渲染全是纯函数；无 LLM |
| 8 | 测试注册 | 遵守。`warranty.test.ts`、`warranty-db.isolated.test.ts` 同 task 注册 |

## Decisions

### D1 设置放 `settingsJson.sunnyWarranty`，从未保存 = 种子
与 `sunnyProcess.zebraRatios` 同模式；保存走"读最新 → 只替换 `sunnyWarranty` 键 → 写回"，带审计。
- 否决：新表 / 字段——违反零 schema。
- 否决：写死在代码常量里——条款会变，老板要能改。

### D2 年限按"品类 × 部件"存，种子 = 报价单口径（Q1）
报价单写的就是"1 年人工 · 5 年面料 · 15 年部件"这种按部件的承诺；邮件按品类列出各部件到期日。
- 否决：每个产品一个年限——表达不了报价单上的分部件承诺。
- 否决：种子取官网检索摘要的 25 / 5 年——与客户签字版不一致，Lucas 已拍板以报价单为准。

### D3 品类挂在收口单元上
质保对应的是"实际装上去的东西"；收口单元正是逐窗 / 逐行的安装清单。映射复用 `category.ts`（Blinds 行用 `categoryOfProductType`，外采购按段，段映射改为导出）。
- 否决：从报价行取产品——工艺单在签字后可能被出单调整（发给国内 / 外采购），报价行不等于实际安装。

### D4 生成时定稿，执行时只校验不重渲
审批 payload 存最终的收件人 / 主题 / 正文 / HTML，`payloadHash` 防篡改；批准人看到的就是将要发出的。执行时只校验收件人是否仍等于客户档案邮箱、是否已发过、发件身份是否存在。
- 否决：执行时按最新设置重渲——批准人批的内容与实际发出的会不同。

### D5 只用组织发件身份发信（Q3）
执行器用 `loadOrgEmailSender` + `sendAsOrg`；未配置 → 失败 `NO_ORG_SENDER`，提示老板去 设置 → 邮件 → 组织发件人。测试通过注入发件函数，不触达真实通道。
- 否决：用投标的授权邮箱（`tenderRfq.mailboxEmail`，Gmail）——那是投标询价专用邮箱，给住宅客户发质保不合适。
- 否决：回落到审批人个人 Gmail——会把公司邮件从个人邮箱发出，与询盘回复执行器的既有原则冲突。

### D6 批准人 = 确认尾款的人（Q2）
确认与批准是同一个人的两次点击，中间看到完整预览；`approverUserId` 即可批（既有判定），不需要新权限键。
- 否决：批准人设为老板——会把每一单的收尾卡在老板手里。

### D7 一单一封：发送记录 + 每次尝试独立的幂等键
执行前查 `install.warranty.sent`，有则拒发；审批幂等键为 `install-warranty:<工艺单 id>:<第几次>`（第几次 = 该单已有的质保审批条数 + 1），这样被拒 / 过期 / 失败后能重新生成，而并发生成同一次尝试只会建一条。
- 否决：固定幂等键 `install-warranty:<id>`——失败过一次后就再也生成不了新的审批。
- 否决：只靠幂等键防重——两条不同尝试都被批准时仍会发两封。

### D8 安装日 = `installedAt` 在企业时区的日期
到期日 = 安装日 + 年限（同月同日；2 月 29 日顺延到 2 月 28 日）。返修后的安装日由 INSTALL-2e 更新 `installedAt`，本 change 不处理。
- 否决：用确认尾款日——质保从安装完成起算。

### D9 新类型归"对外发送"
`WECHAT_CONFIRM_POLICY` 里登记为对外发送，微信回数字与 Muse 都不能批；三处一致的守卫测试同步更新。
- 否决：允许微信回数字批准——客户邮件必须看过全文再批。

### D10 未核实的联系方式不进种子
电话 / 邮箱只有搜索摘要来源（模板文档 §0），种子留空；生成条件要求两者都填，由老板在设置面板补齐。
- 否决：用摘要里的 647-857-8669 / sales@ 预置——违反"未核实不进种子"。

### D11 质保设置面板放在会计"待收尾款"页签里
老板（持 `accounting.read`）与会计都能进这个页签；老板可编辑，会计只读；不新增导航入口。
- 否决：放到 `/settings`——会计进不去，被阻断时提示"去设置"会点不上。

## 验证方式

| 项 | 命令 / 产物 |
|---|---|
| 设置清洗 / 种子 / 渲染 / 不出金额 / 阻断原因 / 到期日 / 状态推导 | `npx tsx src/lib/install/__tests__/warranty.test.ts` |
| 单元品类 | `npx tsx src/lib/install/__tests__/closeout-units.test.ts` |
| 新类型分类与三处一致 | `npx tsx src/lib/ai-grader/actions/__tests__/wechat-confirm-policy.test.ts` |
| 真实路由端到端（隔离库 + 测试发件通道）：设置读写权限与校验；确认尾款 → 待批准、发送 0 次；缺电话 blocked；重新生成；批准 → 发送 1 次 + 审计 + 销售通知；未配置发件身份 → NO_ORG_SENDER + 失败通知；客户邮箱已改 → RECIPIENT_MISMATCH；两条审批先后批准只发一封；已发送后生成 409；列表状态 | `DATABASE_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/install/__tests__/warranty-db.isolated.test.ts` |
| 页面 | 本地 `next dev` + Playwright：确认尾款 → 对话框第二步显示邮件预览 → 批准发送（测试环境无发件通道时显示失败原因）；缺电话时显示阻断原因与"质保设置"；老板编辑设置 |
| 类型 / lint / 注册 / CI | `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`；`npm run lint:baseline`；`npm run test:ci`；`bash scripts/check-test-registry.sh` |
| 规格 | `openspec validate install-2c-warranty-email --strict` |

## Risks / Trade-offs

- [Sunny 尚未配置组织发件身份] → 批准会失败并提示；上线动作写明：老板在 设置 → 邮件 配置（发件名 Sunny Shutter Inc，回复地址用实际的客服邮箱），发件域名在平台 Resend 验证前由平台地址代发。
- [报价单 PDF 条款日后改了] → 设置面板改年限；已发出的邮件不追溯。
- [电机条款未单列] → 种子不含 `motor`；老板可在设置里为某品类加 `motor` 年限。
- [客户邮箱错误] → 收件人与客户档案一致才发；改档案后需重新生成。

## Migration Plan

无数据迁移。上线顺序：合并 → 老板配置组织发件身份与质保设置里的电话 / 邮箱 → 之后确认的尾款自动生成质保审批；此前已确认尾款的单在"最近已确认"里显示"未生成"，可逐单"生成质保邮件"。回滚：回退代码；已建的审批会因执行器分发不到而失败，不会发信。
