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

无 schema、无 cron、无队列、无出站、无 LLM；对 Google 只读；不改 CAL-1、客户 / 预约既有接口、预约同步与任何岗位权限。

## 2. 怎么验

（6.1 完成后补全）

## 3. 对设计稿 §2 原案的偏离

1. **不接网站 webhook**：原案是 book-now 直连青砚 webhook。网站插件与 webhook 能力无法核实（本会话访问 `sunnyshutter.ca` 被代理拒绝），用户选定改为基于 CAL-1 已观察到的、归因为网站的 Google 日历事件。
2. **人工确认后转入，不自动建客户**：描述格式未知，自动建客户会产生脏数据；每条都要销售确认表单。
3. **销售认领**：Sunny 只有 `sales_rep` 持 `sales.customer.create`（隔离库用授权引擎实测），老板只读、运营主管无客户权限。客户归转入的销售，不改岗位权限。
4. **Muse / 微信变更推送拆为 CAL-3**：原案 CAL-2 含此项，与"转入"无依赖，单独排期。

## 4. 已知限制

- **预填依赖描述格式**：规则是通用的（中英文标签行、邮箱与北美电话正则、地点回落、姓名不猜）；真实 book-now 事件的格式未验证，表单可编辑兜底。
- **转入后在青砚改预约**：沿用既有同步，按负责人连接的"写入日历"改 / 删该 Google 事件；若该销售的写入日历不是共享日历，Google 侧调用失败（记日志、不报错），共享日历里的原事件不变。建议销售的写入日历选共享日历。
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
