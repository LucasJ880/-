# Sunny 日程归因 + 期间看板 · 交接（HANDOFF）

> 任何新会话从这里进。先读本文件，再按"下一步"执行，不凭记忆重写。本文件只记录**已核对过的事实**；未核对的写明"未核对"。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-10-28（会话 1：设计稿 + KPI-1 四件套 + 三轮交叉核对，共更正 17 处；**未写任何代码**） |
| 设计稿 | `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md`（§7 判断点已拍板；判断点 5 已更正并经用户确认） |
| 主线状态 | `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` → Phase K（KPI-1 / CAL-1 / KPI-2 / CAL-2，全部 `[ ]`） |
| 进行中的 change | `openspec/changes/sales-period-summary/`（KPI-1；四件套齐，`validate --strict` 通过；**等审，未 apply**） |
| 工作分支 | `claude/magical-shannon-keegzr`（基于 origin/main `ed3b55f`，2026-10-28 核对时 main 未前进） |
| OpenSpec CLI | 未装进依赖：`OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 <cmd>` |
| 运行环境 | 云容器默认 Node 22（`.nvmrc` 要求 24）；仓库不带 `node_modules`，跑测试前先 `npm ci`（会触发 `prisma generate`）。Node 22 下 muse-bridge 纯测试能跑通 |

---

## 1. 用户诉求（Sunny，2026-10-28 原话要点）

1. 日程用 Google Calendar 排；销售 / 运营直接在 Google 里放或改日程，别人不知道；网站 `sunnyshutter.ca/book-now/` 的客户自主预约也进日历；**要能按账号统计"这个月谁放了多少日程"**（销售 / 运营 / 网站分开）。
2. 看板上要能看"10 月 1 日到今天 28 日一共成了多少单、一共报了多少钱出去"，带 AI 分析。
3. 判断点："先按推荐的来"；补充"**销售与运营是分开登入的**"（各用自己的 Google 账号写共享日历 → 设计稿 R2 按成员归因有效）。

## 2. 拆分与顺序（已拍板：KPI-1 → CAL-1 → KPI-2 → CAL-2）

| ID | change 名 | 内容 | 前置 | 状态 |
|---|---|---|---|---|
| KPI-1 | `sales-period-summary` | 期间汇总一套口径 + 九条确定性洞察 + `GET /api/sales/period-summary` + 首页期间面板 + `sales_overview` 可选 `period` | 无 | 四件套待审 |
| CAL-1 | `calendar-watch-attribution` | syncToken 增量拉共享日历（cron 每 15 分钟）→ 查表归因（青砚 / 成员 / 网站 / 不明）→ AuditLog 账本 + 站内通知 + 按账号统计 | 运维前置（§6） | 未 propose |
| KPI-2 | `sales-period-narrative` | LLM 只解读 KPI-1 的 JSON，数字校验不过整段回落；开关默认关 | KPI-1；**Evan 拍板 config.yaml 第 7 条例外** | 未 propose |
| CAL-2 | `website-booking-intake` | book-now 直连青砚 webhook → 建 Appointment → 推 Google | CAL-1；网站插件能发 webhook | 未 propose |

## 3. 判断点（设计稿 §7）

| # | 结论 | 来源 |
|---|---|---|
| 1 | 销售 / 运营分开登入 → R2 成员归因有效 | 用户答复 |
| 2 | book-now 写日历的身份：**未知**，运维前置第 2 条去查 | 待查 |
| 3 | 成单按报价签字 `grandTotal`（含税），同时给税前 | 按推荐 |
| 4 | 按人归属 = 报价创建人 `createdById` | 按推荐 |
| 5 | **已更正，2026-10-28 用户确认（"判断点5按更正后的来"）**：成单不去重（每份已签报价各计）；报价按商机去重，但已签每份都计、未签只计最新一份 | 交叉核对后更正（见 §4-③） |
| 6 | LLM 叙述单独做 KPI-2，默认关 | 按推荐 |
| 7 | 日程变更通知收件人 = owner + ops_lead（可配置） | 按推荐 |
| 8 | 通知只走站内，Muse / 微信留 CAL-2 | 按推荐 |
| 9 | 顺序 KPI-1 → CAL-1 → KPI-2 → CAL-2 | 按推荐 |

## 4. 交叉核对记录（为什么四件套和设计稿初版不一样）

### 第一轮（本会话，逐条对代码）—— 发现并已更正 7 处

| # | 初版说法 | 实际（证据） | 已改 |
|---|---|---|---|
| ① | 销售首页"本月签约"按报价签字金额，与驾驶舱"两页两个数" | 首页英雄区与驾驶舱**同一口径**：商机 `wonAt` + `estimatedValue`（`src/lib/sales/home/build-home.ts:94-104, 261-262`；`src/app/api/sales/cockpit/route.ts:108-111`）。首页的报价签字查询只用于定金 / 尾款 | 设计稿 §1.2、§5 Why；proposal Why |
| ② | 驾驶舱"不能按人" | 驾驶舱有按人 `teamPerformance`（`cockpit/route.ts:86`），同为估值口径 | 设计稿 §1.2 |
| ③ | 判断点 5：同商机多份已签"只计最新一份"，理由是存在"已签后改价回 draft 的旧版本" | 已签报价被修改是**同一行**清签字回 draft（`src/lib/sales/quote-update.ts:298-302`），仓库无复制报价路径（第二轮穷举全部 4 处 `salesQuote.create` 确认）；每份已签报价各自走签字后工艺单生成（有可生产行时各一张）→ 同商机多份已签 = 多张合同。按初版会**少算真实签单额** | 设计稿 §3.1 / §7；spec"成单口径""报价口径""在手未签"；design D2 |
| ④ | `SalesQuote.version` 是"报价自身版本号，同商机各自从 1 起" | `version` = 该**客户**已有报价数 + 1（`src/app/api/sales/quotes/route.ts:213,222`；`measurements/[id]/generate-quote/route.ts:81,97`） | design Context / D2 |
| ⑤ | Muse"意图总数为 14"（tasks 4.1、spec 增量） | 现为 18（`muse-bridge-pure.test.ts:59`）；归档规格 `openspec/specs/muse-bridge/sales-intents/spec.md:24` 仍写 14，是 S2 / S3 归档时未同步的旧文字 | tasks 4.1；spec 增量 MODIFIED 场景 |
| ⑥ | 金额格式化复用 `quote-display-amounts.ts` | 该文件导出的是 `deriveQuoteDisplayAmounts`，不是格式化；首页用的是 `formatSalesMoney`（`src/lib/sales/home/formatters.ts:3`） | design D7；tasks 3.1 |
| ⑦ | （遗漏）口径没提已归档客户 | 首页与统计排除归档客户是测试强制的约定（`src/lib/sales/__tests__/archived-customer-visibility.test.ts`） | spec 新增"排除已归档客户"；design D1；tasks 2.1 / 2.2 |

同轮补上的两处设计缺口：
- 首页按 `sales.customer.read` 放行、面板按 `sales.analytics.read`：面板 403 时整块不渲染（spec 新场景"无分析权限时首页不受影响"）。枚举 `role-defaults.ts` 全部 20 个默认模板，目前没有"有客户读、无分析读"的组合，属防御性要求。
- 首页是 client 组件、无范围信息；面板用 `useSearchParams` 必须包 `<Suspense>`（先例 `src/app/(main)/sales/quotes/page.tsx:80`），范围以接口返回的 `scope` 为准。

第一轮确认无误的关键事实（节选）：`sales.analytics.read` 键存在（`permissions.ts:61`，PRINCIPAL / ORG）；窗饰 `owner` 以 ORG 绑定、窗饰 `sales_rep` 与系统模板并集得 PRINCIPAL、`pricing_lead` / `accounting` 有 ORG（**这两个岗位会在面板里看到全员按人金额**，与其现有报价全企业读一致）；`resolveSalesScope(user, orgId, permission)`（`src/lib/sales/org-context.ts:51`）；Muse `resolveSalesScope` / `amountsVisible`（`src/lib/muse-bridge/sales-pure.ts:47,61`）；`resolveOrgTimezone`（`src/lib/automation/registry.ts:93`）；`zonedLocalToUtc` / `nextDay`（`src/lib/revenue-spine/business-days.ts:171,111`）；`getLocalTimeParts(...).date`（`src/lib/automation/local-time.ts:7`）；Google 日历 scope 已含 `calendar.readonly`（`src/lib/google-calendar.ts:7-12`）；`pushEventToGoogle` 不收 description、`updateGoogleEvent` 才写（`google-calendar.ts:374` / update 路径）；`requireCronSecret`（`src/lib/cron/auth.ts:26`）、`runTrackedAutomation`（`src/lib/automation/runner.ts:24`）、`tender-rfq-settings` 路由、`AiUsageLedger` 模型均存在。

### 第二轮（独立子代理，只给文档与代码、不给结论）—— 报 10 条，**我逐条复核全部属实**，已更正

| # | 发现 | 证据（复核过） | 已改 |
|---|---|---|---|
| ⑧ | design.md 的 Context 第一条仍是初版错误说法（首页按签字金额、没有按人），第一轮漏改 | design.md 原第 7、13 行 | design Context 重写 |
| ⑨ | 已有两处"按签字金额"的统计，新口径会成为第三个数 | 驾驶舱折扣统计 `src/app/api/sales/cockpit/discount-stats/route.ts:53-95`（只计带折扣率的报价、服务器时区、不排除归档）；会计提成 `src/lib/accounting/service.ts:16-28`（只计 signed、按月、不排除归档） | 设计稿 §1.2；proposal Why / Out of scope；design 新增 D9（不改它们，报告附差异表） |
| ⑩ | 首页英雄区标签不叫"本月签约" | 实为"本月已签 / 本月签单"（`sales-performance-hero.tsx:45,58`）；首页别处已用"本月签约（商机估值）"（`sales-payment-summary.tsx:44`、`sales/performance/page.tsx:269`），驾驶舱改标签与之一致 | 设计稿 §1.2；design Context |
| ⑪ | spec 的 I1 场景算术错：61,230 对 51,900 是 +18%，不到 20% 阈值 | 计算 | 场景改为 63,000（+21.4%）触发，61,230 改为"不触发"场景；设计稿示例换成能触发的 I3 |
| ⑫ | 文档之间互相矛盾：驾驶舱标签两种写法、验收写"去重后求和"、洞察码 `I1_WON_UP` / `I1_WON_DELTA` 两种 | 设计稿 §3.2 / §5、tasks 2.2 | 统一 |
| ⑬ | Muse 与网页的范围不总一致 | Muse 范围来自派生角色（`src/lib/muse-bridge/sales-pure.ts:47-58`；`src/lib/rbac/effective-platform-role.ts:15,34`）：合价岗派生为销售 → Muse 本人范围；会计岗派生为 user → Muse 拒绝；而网页两者都是全企业 | Muse spec 增量只承诺老板与销售两种一致，新增"范围沿用 S1"场景；design D6；proposal Out of scope |
| ⑭ | `sentAt` 不是干净的"发送日" | 邮件发送覆盖（`send-email/route.ts:126`、`email-compose/route.ts:158`），标记已发送保留首次（`mark-sent/route.ts:63`），已签改回 draft 时保留 | design Context / Risks；设计稿 §3.1；报告已知限制 |
| ⑮ | spec 写"金额单位为 CAD"，但外贸转入的报价可能是别的币种，且不写 `sentAt` / `signedAt` | `src/lib/trade/trade-quote-sales-quote.ts:403,435,446` | spec 新增"只汇总 CAD 报价"+ `nonCadExcludedCount`；design D1 字段加 `currency`（12 个）；tasks 1.1 / 2.1 |
| ⑯ | CAL-1 部分：`AuditLog.userId` 必填、`afterData` 是字符串；"按岗位找人"仓库里没有现成函数（`recipients.ts` 按权限键） | `prisma/schema.prisma` AuditLog；`src/lib/trade/recipients.ts` | 设计稿 §2.2 / §2.4 |
| ⑰ | **现有代码缺陷**：`pushEventToGoogle` 把逗号分隔的多日历 ID 整串当一个日历写入，选了多个日历的人从青砚建的预约推不进 Google 且不报错 | `src/lib/google-calendar.ts:403`；其它三处取第一个 `:442,513,556` | 设计稿 §2.3 R1 标为 CAL-1 前置；已另提修复任务卡（不在 KPI-1 范围） |

第二轮同时确认无误：MODIFIED 增量标题与归档规格逐字一致、保留了原有场景；改驾驶舱"本月签约"文案不会打破任何测试；zod 版本 4.4.3，在 `discriminatedUnion` 成员上加 `.superRefine` 不会破坏联合（子代理用临时脚本实测；zod 3 会破坏）；`resolveSalesOrgIdForRequest` 存在（`src/lib/sales/org-context.ts:28-34`）；仓库没有时区安全的 `addDays(字符串)` / 月初月末工具，需在 `summary-pure.ts` 新增（照 `nextDay` 的 `Date.UTC` 写法，design D3 已写明）；`npm run build` 里的两个数据库闸门在本地与 CI 都自动跳过，验证步骤可执行。

### 第三轮（收口，2026-10-28）

- 全部 8 份文档扫描已更正的旧说法（意图数 14、去重后求和、`I1_WON_UP`、"商机估值（估）"、11 个标量、"两页两个数"、`quote-display-amounts`、`233-247` 等）：只剩 design.md 一处"11 个标量字段"，已改为 12；其余命中都是更正记录本身。
- `openspec validate sales-period-summary --strict`：valid；`openspec update`：无改动。
- tasks 8 条（上限 8）；spec 增量共 16 条 Requirement（`sales/period-summary` 13 条、`muse-bridge/sales-intents` 1 条 MODIFIED + 2 条 ADDED）。
- `bash scripts/check-test-registry.sh`：OK，463 个；muse-bridge-pure 61、sales-pure 73，与开工前一致。
- 相对 origin/main 只改了 `docs/` 与 `openspec/changes/sales-period-summary/`，**无任何 src / prisma / scripts / 配置改动**。

## 5. 测试基线（2026-10-28，本容器 Node 22，无 DB）

| 测试 | 结果 |
|---|---|
| `npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts` | 61 passed |
| `npx tsx src/lib/muse-bridge/__tests__/sales-pure.test.ts` | 73 passed |
| `advisory` / `next-step` / `prefs` / `inquiry-pure` / `followup-pure` | 70 / 59 / 30 / 27 / 42 passed |
| `sales-db.isolated.test.ts` | 无 `DATABASE_URL` → 跳过、退出 0 |
| `bash scripts/check-test-registry.sh` | OK，已注册 463 个，欠账基线 72 条 |

全量 `npm test`、`typecheck`、`lint:baseline` 本会话**未跑**（没改代码）。权限交接文档记录的全量基线：无 DB 时 450/463，13 条既有环境性失败（`docs/QINGYAN_PERMISSION_HANDOFF.md`）。

## 6. 下一步（按顺序）

1. **审 KPI-1 四件套**（Claude chat / Evan）：重点看判断点 5 的更正、"排除已归档客户"、转化率可能 > 100% 的说明。
2. 审过后 `/opsx:apply sales-period-summary`：开工前先跑 §5 的基线，结束前跑 tasks 5.1 全量门禁；新测试同 task 注册进 `scripts/test-all.sh`。
3. PR（一个 change 一个 PR）→ 合并 → `/opsx:archive sales-period-summary --yes`（独立小 PR，TASKFLOW KPI-1 → `[x]`）。
4. CAL-1 前置（Lucas）：
   - 共享日历 ID（`xxx@group.calendar.google.com`）与读取账号（已在青砚连接 Google 日历、对共享日历至少 reader）。
   - 打开一条 book-now 生成的日程，记下"创建者"邮箱与标题 / 描述里的固定字样。
   - 拿到后 `/opsx:propose calendar-watch-attribution`，以设计稿 §2 为母本。
5. KPI-2：Evan 先拍板 `openspec/config.yaml` 第 7 条例外，再 propose。

## 7. 已知坑

- 归档规格 `muse-bridge/sales-intents` 的"契约只追加"写着意图总数 14，代码是 18。本 change 的 MODIFIED 增量已顺带更正；archive 时会覆盖成新文字。
- `scripts/check-test-registry.sh` 在当前 main 上通过（2026-10-28 实跑：已注册 463 个，历史欠账基线剩 72 条）。本 change 新增 3 个测试文件，apply 后应为 466 个；欠账基线只能减不能加。
- 新面板与首页英雄区"本月已签"会出现两个不同的数（签字金额 vs 商机估值）。这是预期：本 change 只把驾驶舱标签改成"本月签约（商机估值）"，首页英雄区标签**未改**（Out of scope）。若审核时认为英雄区也要标注，改 tasks 3.1 一行即可。
- 新口径会是第三个"签单金额"（另两个是驾驶舱折扣统计、会计提成，口径各不相同，见 §4 ⑨）。报告必须附差异表；是否统一由 Evan 决定。
- Muse 里合价岗只看本人、会计岗被拒，网页上两者看全企业（§4 ⑬）。这是 S1 的既有范围规则，本 change 不改。
- `pushEventToGoogle` 多日历缺陷（§4 ⑰）在 CAL-1 之前必须先修，否则规则 R1 漏判。
- 排除已归档客户会让历史期间的成单额随归档操作变小；与首页约定一致，报告"已知限制"要写。
