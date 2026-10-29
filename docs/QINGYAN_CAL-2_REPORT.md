# QINGYAN CAL-2 报告 — 网站预约一键转入（website-booking-intake）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-29 |
| TASKFLOW | CAL-2（Phase K — Sunny 日程归因与期间看板） |
| OpenSpec change | `openspec/changes/website-booking-intake/` |
| 分支 | `claude/magical-shannon-keegzr` |
| 设计稿 / 交接 | `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §2；`docs/QINGYAN_SUNNY_SCHEDULE_KPI_HANDOFF.md` |
| 拍板 | 用户 2026-10-29："不依赖 webhook"（基于 CAL-1 观察到的 Google 日历事件）、"销售认领"（Sunny 只有销售人员可新建客户） |

## 1. 做了什么

| 部分 | 文件 | 说明 |
|---|---|---|
| 纯函数核心 | `src/lib/calendar-watch/intake-pure.ts` | 待转入推导、描述解析与 HTML 清理、电话末 10 位比对、转入 / 忽略请求体校验、预约默认时间 |
| 服务 | `src/lib/calendar-watch/intake.ts` | 查看 / 转入授权、列表、实时详情（读取函数可注入）、转入事务（advisory lock、复查、重复电话 409 零写入、预约记 `googleEventId`、只记 ID 的审计）、幂等忽略；不调用任何 Google 写接口与预约同步 |
| 接口 | `src/app/api/sales/website-bookings/**` | `GET` 列表、`GET {eventId}` 详情、`POST {eventId}/convert`、`POST {eventId}/dismiss` |
| 页面 | `src/app/(main)/sales/website-bookings/page.tsx`、`src/components/sales-command-center/website-booking-banner.tsx`、`src/app/(main)/sales/home/page.tsx` | 列表 + 转入面板（显示描述原文核对预填、关联已有客户、409 自动切换）+ 忽略；首页在有待转入时显示入口 |
| 测试 | `website-booking-intake-pure.test.ts`（test-all + test-ci-unit）、`website-booking-intake-db.isolated.test.ts`（test-all） | 见 §2 |

无 schema、无 cron、无队列、无出站、无 LLM；对 Google 只读；不改 CAL-1、客户 / 预约既有接口与任何岗位权限。预约同步 `src/lib/sales/appointment-gcal-sync.ts` 只加一处保护：网站预约转入的预约不回写 Google（§3 第 5 条）。

## 2. 怎么验

| 检查 | 结果 |
|---|---|
| apply 前基线 | calendar-watch-pure 175、calendar-watch-db.isolated 80 |
| `npx tsx src/lib/calendar-watch/__tests__/website-booking-intake-pure.test.ts` | 62 通过 0 失败 |
| 纯测试变异检查（临时副本，未提交） | 不排除删除 / 只看最近一条归因 / 电话只留数字 → 5 项变红 |
| `website-booking-intake-db.isolated.test.ts`（隔离库 127.0.0.1:5433） | 44 通过 0 失败：授权（运营主管 403、老板只读、销售可转入）、列表过滤、详情预填与已有客户、`READER_NOT_CONNECTED`（路由，不打网络；读取账号离职）/ `EVENT_NOT_FOUND` / `NOT_PENDING`、转入 `CUSTOMER_EXISTS` 零写入 / `CUSTOMER_NOT_FOUND` / `INVALID_INPUT` / 关联已有、并发认领一成一 409 且只有一条预约、忽略幂等、审计无联系方式、只读 Google、同步保护、转入后 CAL-1 归因 R1 |
| 端到端变异检查（临时，已还原） | 去已转入与重复电话检查 → 变红；去同步保护 → 测试真的发出 Google 请求并失败（exit 1） |
| 无 `DATABASE_URL` 跑端到端 | 打印跳过，退出 0；清理后无残留 |
| CAL-1 回归 | calendar-watch-pure 175、calendar-watch-db.isolated 80 |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出 0 |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | 退出 0，`CI unit subset PASS`（审查修复后的最终代码） |
| `bash scripts/check-test-registry.sh` | 通过；`scripts/test-all.sh` 的 run_test 由 main 的 509 增至 511 |
| `openspec validate website-booking-intake --strict` | valid |
| `npm run build` | 退出 0；4 条接口与 `/sales/website-bookings` 在产出表中 |
| PR [LucasJ880/-#340](https://github.com/LucasJ880/-/pull/340) CI `validate-lint-typecheck-test-build` | 绿（提交 `0abdcc9a`），合并为 `9da2c221`（用户授权全流程掌控） |

真实浏览器检查（`next start -p 3100` + Playwright，种子只写本机测试库、未进仓库）：

| 检查 | 结果 |
|---|---|
| 无待转入时打开首页 | 没有"网站预约待转入"入口 |
| 有 2 条待转入 | 首页出现"网站预约待转入 2 条" |
| 老板打开 `/sales/website-bookings` | 2 条；0 个转入按钮、2 个忽略按钮 |
| 销售打开同一页面 | 2 个转入按钮；打开表单显示"读取账号未连接 Google 日历，无法预填，请手工填写"（种子读取账号无连接；预填由隔离库测试以注入读取覆盖） |
| 销售手填姓名、电话后确认 | "已转入：客户与预约已建好 · 查看客户"；列表剩 1 条 |
| 手机宽度 390px | 无横向溢出；无页面错误 |

## 3. 对设计稿 §2 原案的偏离

1. **不接网站 webhook**：原案是 book-now 直连青砚 webhook。网站插件与 webhook 能力无法核实（本会话访问 `sunnyshutter.ca` 被代理拒绝），用户选定改为基于 CAL-1 已观察到的、归因为网站的 Google 日历事件。
2. **人工确认后转入，不自动建客户**：描述格式未知，自动建客户会产生脏数据；每条都要销售确认表单。
3. **销售认领**：Sunny 只有 `sales_rep` 持 `sales.customer.create`（隔离库用授权引擎实测），老板只读、运营主管无客户权限。客户归转入的销售，不改岗位权限。
4. **Muse / 微信变更推送拆为 CAL-3**：原案 CAL-2 含此项，与"转入"无依赖，单独排期。

**独立审查后修订**（一个只读审查代理没有看我的结论；逐条核实后修复，纯测试 51 → 62，隔离库 39 → 44）：

5. **转入的预约被青砚同步覆盖或删除（高）**：既有同步在预约修改时用青砚模板覆盖 Google 事件的标题与描述，取消 / 删除时删掉 Google 事件（删除用的是操作人的写入日历）并清空事件 ID，之后该事件还会重新出现在待转入列表。已在 `appointment-gcal-sync` 加保护：存在转入审计的事件跳过同步与解除同步。变异检查：去掉保护后测试真的发出了 Google 请求并失败。spec 新增"转入的预约以 Google 为准"。
6. **账本 2 万行上限截掉最新的行**：改为先按片段只取"新建且网站"的账本行定位事件，再取这些事件的全部行。
7. **单个事件判断受 200 条上限影响**：详情 / 转入 / 忽略不再受列表上限影响。
8. **事务里用了全局连接做重查询**：待转入判断移到事务外，事务内只在锁下复查已转入；事务超时 15 秒、等待 10 秒。
9. **全天事件结束日多一天**：`endAt` 改为最后一天（Google `end.date` 不含）。
10. **解析误判**：尖括号邮箱不再被当成 HTML 去掉；电话正则加数字边界（订单号 / 会议号不当电话）；`Contact` 不再当姓名标签；标签电话不足 10 位（N/A）回落；网站预约账号本身不当客户邮箱。
11. **其它**：时间须带时区；读取账号离开企业时详情返回 409；未使用的 `calendarId` 参数去掉；spec 写明列表标题按账本原样返回。

## 4. 已知限制

- **预填依赖描述格式**：规则是通用的（中英文标签行、邮箱与北美电话正则、地点回落、姓名不猜）；真实 book-now 事件的格式未验证，表单可编辑兜底。
- **转入后在青砚改预约不回写 Google**：这类预约以 Google 共享日历为准；改约要在 Google 里改（CAL-1 会通知）。青砚里改时间只改青砚记录。
- **只提示本人名下的同电话客户**：与新建客户接口一致，不跨销售提示（避免泄露别人的客户）。
- **忽略不可撤销**：误忽略的事件仍在 Google 里，可走手工新建。
- **老板不能代为转入或分派**：需要时另开 change 调整岗位权限。
- **列表只看开始时间在当地 7 天前之后的事件**，更早的不列。

## 5. 上线步骤

1. 先按 `docs/QINGYAN_CAL-1_REPORT.md` §5 开启日历观察并完成基线。
2. 网站上提交一条测试预约，15 分钟内首页出现"网站预约待转入 1 条"。
3. 销售打开 `/sales/website-bookings`，点"转入"，核对描述原文与预填；把实际描述格式记进本报告，必要时另开小 change 加格式专用规则。
4. 确认转入后，客户与预约出现在该销售名下，列表清空；再在 Google 里改这条事件的时间，CAL-1 通知里应显示为青砚预约的改动。

## 6. 全量测试

（6.1 完成后填写）
