# Proposal：自动起草的轮次也能带跟进授权——由本人事先在网页上明确开启

TASKFLOW：RFQ-AUTO-3（Phase F 续，接 RFQ-AUTO-1、RFQ-AUTO-2）
来源：Lucas 2026-11-11「开始 RFQ-AUTO-3，其他按照你推荐的做」。

## Why

RFQ-AUTO-2 自动起草的轮次不带 RFQ-AUTO-1 的跟进授权，所以这些轮次的催单与追问仍是每家每次一张卡——两步自动流中间断了一截。把它们接上之后，一个标从「批准分析」到「供应商回完价」，人只需要点两次：批准分析、批准发询价的那张卡。

## What Changes

- 新增一个个人开关「自动起草的轮次带跟进授权」，默认关。只能由本人在网页上开启或关闭；开启处同时展示授权范围与三段邮件模板。
- 开关的状态就是本人最近一条开关记录（只追加的审计记录，不新增表与字段，不放进组织设置的 JSON）；开启时记下当时的邮件模板指纹，模板之后改了开关自动失效。
- 关闭任何时候都可以（包括功能开关关闭期间）；开启要求两个功能开关都打开。
- 待批的发询价卡只要载荷里带授权，网页批准处就显示授权范围与模板，不论功能开关此刻是否打开（功能关闭时加一句说明）。
- 自动起草时，如果触发起草的操作者开启了这个开关、且 RFQ-AUTO-1 的开关对该组织打开，起草的发询价卡带上跟进授权（内容与网页勾选时相同：催单最多 2 次、间隔、回复截止、一次缺字段追问、模板指纹）。
- 带授权的自动起草卡：标题同时标明「自动起草」与「含自动跟进授权」；面板上的结果行写明这张卡带授权；项目页原地审批处照既有逻辑展示授权范围与模板预览。
- 询价入口的响应新增 `autoDraftFollowUp`（当前是否开启）；只在两个功能开关都打开时出现。
- 新增接口 `PUT /api/projects/{id}/tender-rfq/auto-follow-up`（开启 / 关闭本人的开关），要求项目写权限。
- 不改覆盖判定、不改执行方式、不改停止方式：授权一旦在卡上并被人批准，之后的行为与 RFQ-AUTO-1 完全相同。

## 受影响的 Muse 意图

不改 muse-bridge 的代码。`rfq`、`approve`、`set_preference` 的行为不变：这个开关不能在 Muse 里设置；Muse 发起的轮次仍不带授权；自动起草的卡与带授权的卡仍不能在 Muse 里批准。

## Out of scope

- 组织级的统一开关（管理员替所有人开启）：不做。
- 给已经起草好的卡补加授权：不做。要带授权，驳回后在「问供应商要价」里勾选重发。
- 改授权的内容（次数、间隔、模板）或覆盖判定的条件：不做。
- 放宽「只能在网页批」：不做。
- 批量确认按钮、常用供应商按品类分组：不在本 change，各自另开。
- 新的 LLM 调用、schema 变更、定时任务、通知类型：不做。
- `openspec/config.yaml` 硬纪律文字：不改（第 2 条现有的补充文字已覆盖本次行为）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tender/rfq-followup-preapproval`：授权的写入条件多一条途径（自动起草 + 本人事先开启）；新增个人开关的要求。
- `tender/rfq-auto-draft`：自动起草的卡从「一律不带跟进授权」改为「操作者开启了个人开关时带」。

## Impact

- `src/lib/tender-rfq/`：新增个人开关的记录与状态判定（纯函数 + 服务）；`service.ts` 的授权写入条件接受来源 `auto`；`auto-draft-service.ts` 读操作者的开关并传入；`auto-draft-pure.ts` 的结果文案；`web-entry.ts` 返回当前状态。
- `src/app/api/projects/[id]/tender-rfq/auto-follow-up/route.ts`：新接口。
- `src/components/inquiry/`：询价区块里的开关（含范围与模板预览）。
- 不改 `prisma/schema.prisma`、`followup-coverage.ts`、`chase-service.ts`、`chase-execute.ts`、`src/lib/pending-actions/**`、`src/lib/muse-bridge/**`、`openspec/config.yaml`。
