# Proposal：询价节奏三项可以在组织页上改

TASKFLOW：W-2b（依赖 W-2，已完成）
来源：W-2 的余项（W-2 proposal 的 Out of scope 第 1 条）；交接文档 §0.5f 第 3 项。Lucas 2026-11-15「如果有新的四件套或者是其他的方案，都按照你推荐的走……你全权负责这个项目」。

## Why

回复提前量（供应商回复截止 = 截标前几天）、轮次锁天数（同一项目多少天内不再发新一轮）、催单天数（几天没回就起草催单）这三项，系统一直在读 `Organization.settingsJson.tenderRfq`，有默认值（7 / 3 / 3 天），但没有任何接口能写：`PUT tender-rfq-settings` 不收它们，组织想改只能改数据库。W-2 的设置页因此只能把它们列为余项。

## What Changes

- `PUT /api/organizations/[orgId]/tender-rfq-settings` 多收三项：`replyLeadDays`、`roundLockDays`、`chaseAfterDays`，都是 1–60 的整数，传 null 清空（回到默认）。合并规则与其它项相同：传了的覆盖、没传的保留。
- `GET` 多返回这三项当前生效的值、默认值，以及 `stored` 里这三项是不是组织自己存的。
- 组织页「询价与落地价设置」一节多一小块「询价节奏」：三个天数输入框。没单独设置时显示为空、写明当前用的默认值；保存仍只发改过的项。每一项写明它管什么、什么时候生效（催单天数同时决定第二次催单与标「未响应」；项目负责人自己设了以个人设置为准；开了自动跟进且仍生效的轮次按当时定下的天数）。
- Muse「查看偏好」里，本人没设催单天数时写出实际按的组织天数（原来固定写「默认 3 天」，组织能改之后就不对了）。
- 默认值不变；读这三项的代码（`readTenderRfqSettings`、`resolveChaseAfterDays`）不变。

## 受影响的 Muse 意图

- `preferences`（查看偏好）：本人没设催单天数时，回复里的「未设（默认 3 天）」改成「未设（按组织设置：N 天没回）」，N 是组织层生效的天数。
- `set_preference`（设置催单天数）：不变。个人偏好仍优先于组织设置。

## Out of scope

- 改默认值、改三项的读取与判定规则（回复截止「不早于发出后第 2 天」、轮次锁判定、催单与未响应判定）。
- 关掉轮次锁（0 天）：不提供。
- 改谁能改（仍是 org_admin / 平台管理员）；新开关；schema 变更；模型调用；对外动作。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tender/rfq-settings-page`：多了询价节奏三项（接口收、页面改）。
