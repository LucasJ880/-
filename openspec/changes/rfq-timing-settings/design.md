# Design：询价节奏三项可以在组织页上改（W-2b）

## Context

- 读取：`readTenderRfqSettings`（`round-pure.ts`）把 `tenderRfq.replyLeadDays` / `roundLockDays` 读成「有限且 ≥ 0 的数字，否则默认 7 / 3」；`resolveChaseAfterDays`（`chase-pure.ts`）按「项目负责人个人偏好 > 组织 `tenderRfq.chaseAfterDays` > 3」，两层都只认 1–60 的整数。
- 用处：回复提前量在建轮次时算回复截止（`computeReplyBy`：截标 − N 天，且不早于发出后第 2 天），只影响以后新建的轮次；轮次锁天数在每次建轮次时判定；催单天数被催单扫描、追踪页、首页建议、Web 下一步实时读取。开了自动跟进的轮次用授权里定格的天数（`chaseDaysForRound`）。
- 写入：`PUT tender-rfq-settings` 的 zod 是 `.strict()`，现在收到这三项会 400。合并在 `applyTenderRfqSettingsUpdate`（纯函数，有单测），写库走 `mutateOrgSettings`（锁行），写审计（前后都是整段 `tenderRfq`）。
- 页面：W-2 的 `settings-form.ts`（表单 ↔ 请求体、只发改过的项）与 `settings-section-state.ts`（reducer）。

## Goals / Non-Goals

**Goals**：管理员能在页面上看、改这三项；页面保存 = PUT 的效果；默认值不变。

**Non-Goals（具体到文件）**：不改 `round-pure.ts` 的 `readTenderRfqSettings`、`chase-pure.ts`、`build.ts`；不改 `prisma/schema.prisma`。

## Decisions

### D1 三项都是 1–60 的整数，null 清空

- 与催单天数现有的两层校验（`resolveChaseAfterDays`、个人偏好 `CHASE_AFTER_DAYS_RANGE`）一致；回复提前量与轮次锁按同一范围，读取（≥ 0 即可）一定认得写进去的值。
- 否决：允许 0。轮次锁 0 天等于关掉防重复发的保护；回复提前量 0 天让供应商回复截止等于截标日，来不及做报价。都不在这次范围里。
- 否决：允许小数。读取虽然认，但「2.5 天」在说明文字与判定里都不直观。

### D2 GET 给生效值、默认值与 stored

`GET` 多返回 `timing: { replyLeadDays, roundLockDays, chaseAfterDays }`（组织层生效值：存了且读取认得就用存的，否则默认）、`timingDefaults`（7 / 3 / 3），`stored` 多三项（读取认得的值算「存了」）。

- 页面据此与发件三项同样处理：没存显示为空、占位写「未单独设置，默认 N 天」；存了显示存的值。
- `chaseAfterDays` 用 `resolveChaseAfterDays(null, settingsJson)`，只看组织层——个人偏好不属于组织设置。
- 否决：只返回存的值。页面就得自己知道默认值，两处默认值会漂移。

### D3 页面只发改过的项、空 = null

沿用 W-2 D1：逐项比较打开时的值；改成空发 null（回到默认）。页面先按 D1 校验（1–60 整数），接口仍是最终把关。

### D4 写明生效范围

每项一句说明（常量，测试断言）：
- 回复提前量：供应商回复截止 = 截标日前 N 天（不早于发出后第 2 天）；只影响以后新发的询价。
- 轮次锁：同一项目 N 天内不再发新一轮（可以往已发的一轮加供应商）。
- 催单天数：发出满 N 天没回就起草催单给你批；项目负责人自己设了催单天数时按个人设置；开了自动跟进的轮次按开的时候定下的天数。

## Risks / Trade-offs

- **改催单天数立刻影响在途询价**：没开自动跟进的轮次，下一次扫描就按新天数判定（可能马上起草一批催单卡，仍须人批）。说明文字写明；这与现在直接改数据库的效果相同。
- **库里已有 0 或小数的旧值**：读取照旧认，页面照旧显示；只要不改这一项就不会发出去，改的时候按 1–60 整数校验。
