# Design：询价节奏三项可以在组织页上改（W-2b）

## Context

- 读取：`readTenderRfqSettings`（`round-pure.ts`）把 `tenderRfq.replyLeadDays` / `roundLockDays` 读成「有限且 ≥ 0 的数字，否则默认 7 / 3」；`resolveChaseAfterDays`（`chase-pure.ts`）按「项目负责人个人偏好 > 组织 `tenderRfq.chaseAfterDays` > 3」，两层都只认 1–60 的整数。
- 用处：回复提前量在建轮次时算回复截止（`computeReplyBy`：截标 − N 天，且不早于发出后第 2 天），只影响以后新建的轮次；轮次锁天数在每次建轮次时判定；催单天数被催单扫描、追踪页、首页建议、Web 下一步实时读取。开了自动跟进的轮次用授权里定格的天数（`chaseDaysForRound`）。
- 写入：`PUT tender-rfq-settings` 的 zod 是 `.strict()`，现在收到这三项会 400。合并在 `applyTenderRfqSettingsUpdate`（纯函数，有单测），写库走 `mutateOrgSettings`（锁行），写审计（前后都是整段 `tenderRfq`）。
- 页面：W-2 的 `settings-form.ts`（表单 ↔ 请求体、只发改过的项）与 `settings-section-state.ts`（reducer）。

## Goals / Non-Goals

**Goals**：管理员能在页面上看、改这三项；页面保存 = PUT 的效果；默认值不变。

**Non-Goals（具体到文件）**：不改 `round-pure.ts` 的 `readTenderRfqSettings`、`chase-pure.ts`（催单 / 未响应判定）、`build.ts`（`computeReplyBy`）、`chase-service.ts`（扫描与定格天数）、`muse-bridge/prefs-pure.ts`（个人偏好）；不改 `prisma/schema.prisma`。Muse 只改 `router-pure.ts` 的 `preferencesAdvisory` 一行文案与 `router.ts` 给它传天数（D5）。

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

### D3 页面只发改过的项、空 = null；先比较后校验

沿用 W-2 D1：逐项比较打开时的值；改成空发 null（回到默认）。**先比较、后校验**：库里已有读取认得但不在 1–60 的旧值（如轮次锁 0、回复提前量 2.5），不改就不发，也不挡别的项保存。改了才按 D1 校验（只收纯数字写法），接口仍是最终把关。

- 否决：先校验整张表单。库里有旧值 0 的组织就什么都存不了（连汇率也存不了）。
- 否决：页面不校验、全交给接口。接口的错误是 `replyLeadDays: Number must be…`，管理员看不懂是哪一项。

### D4 写明生效范围

每项一句说明（常量，测试断言），按代码里的实际行为写：
- 回复提前量：回复截止 = 截标日前 N 天（不早于起草后第 2 天，`computeReplyBy`）；起草时就定了，只影响以后新建的询价，已起草等批的不变。
- 轮次锁：上一轮已发出、没结束时，从它建立起 N 天内不开新一轮（`decideRoundLock`）；可以往已发的一轮加供应商。
- 催单天数：首次催单、第二次催单、标「未响应」都按 N（`decideChases` / `decideNoResponse`）；回复截止已过且最后一次联系满 N 天的，下一次扫描直接标未响应，不起草、不用批；催单卡交项目负责人批；本人偏好优先；开了自动跟进且授权仍生效（`roundPolicyInEffect`）的轮次按定格天数，授权失效后按现在的设置。

- 否决：只写名称、不写说明。三个数字的影响面不同（尤其催单天数会让在途询价直接被标未响应），不写清楚管理员会误改。

### D5 Muse「查看偏好」写出实际天数

`preferencesAdvisory` 多一个参数（本人没设时实际用的天数），`router.ts` 用已有的 `chaseDaysFor(identity, null)`（即 `resolveChaseAfterDays(null, 组织设置)`）算好传入；文案「未设（按组织设置：N 天没回）」。

- 否决：保持「默认 3 天」。组织能在页面上改之后，这句话会和扫描、追踪页实际用的天数不一致。
- 否决：Muse 回复里不提组织天数。用户问的是「几天没回会催」，只说「未设」答非所问。

## 与八条硬纪律的关系

1. 零 schema：只读写 `Organization.settingsJson.tenderRfq` 里的三个键，不改 `prisma/schema.prisma`。
2. 出站先审批：不新增出站动作。催单仍是审批卡，批了才发；标「未响应」是既有的内部状态迁移，不对外。
3. 禁止第三套队列：不涉及（不新建队列、表或后台任务）。
4. 脱敏：不涉及（三个天数不是敏感字段；页面与接口不显示密码、令牌）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及（不碰发件 / 授权邮箱的规则）。
7. 确定性优先：全部是确定性代码，不调模型。
8. 测试注册：新增 `rfq-timing-settings.test.tsx` 与 `rfq-timing-settings-db.isolated.test.ts`，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-rfq/__tests__/rfq-timing-settings.test.tsx`：接口校验与合并、读法、表单（只发改过的、先比较后校验、纯数字）、页面状态、呈现与说明文字、Muse 偏好文案、接线。
- 隔离库 `npx tsx src/lib/tender-rfq/__tests__/rfq-timing-settings-db.isolated.test.ts`：真实接口往返；`loadRfqWebEntry` 读到新的轮次锁天数与催单天数；回复截止；清空回到默认；400 / 403；审计。
- W-2 原有测试 `settings-form.test.tsx`、`settings-form-db.isolated.test.ts` 仍通过。
- 门禁：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate rfq-timing-settings --strict`。
- 真实浏览器截图 `docs/acceptance/w-2b/*.png`。

## Risks / Trade-offs

- **改催单天数立刻影响在途询价**：没有生效中的自动跟进授权的轮次，下一次扫描就按新天数判定：可能马上起草一批催单卡（仍须项目负责人批）；**调小时，回复截止已过、最后一次联系已满新天数的供应商会被直接标「未响应」**（既有规则，不用批）。说明文字写明；这与现在直接改数据库的效果相同。
- **库里已有 0 或小数的旧值**：读取照旧认，页面照旧显示；只要不改这一项就不会发出去，改的时候按 1–60 整数校验。
