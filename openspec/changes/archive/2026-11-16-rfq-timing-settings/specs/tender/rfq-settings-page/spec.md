## ADDED Requirements

### Requirement: 接口收询价节奏三项
`PUT tender-rfq-settings` SHALL 收 `replyLeadDays`、`roundLockDays`、`chaseAfterDays`：1–60 的整数，null 清空（回到默认）；传了的覆盖、没传的保留；不在范围内或不是整数 SHALL 400 且设置不变。`GET` SHALL 返回这三项在组织层的生效值、默认值（7 / 3 / 3），以及 `stored` 里各自是不是组织自己存的。默认值与读取规则 SHALL NOT 改变。

#### Scenario: 改回复提前量
- **WHEN** 管理员 PUT `{ replyLeadDays: 10 }`
- **THEN** 读回来 10、`stored.replyLeadDays` 为真；其它设置不变；之后新建的轮次回复截止是截标前 10 天；建轮次读到的轮次锁天数、催单天数就是存的值（`npx tsx src/lib/tender-rfq/__tests__/rfq-timing-settings.test.tsx`；`npx tsx src/lib/tender-rfq/__tests__/rfq-timing-settings-db.isolated.test.ts`）

#### Scenario: 不合规
- **WHEN** PUT `{ roundLockDays: 0 }`、`{ chaseAfterDays: 2.5 }` 或 `{ replyLeadDays: 61 }`
- **THEN** 400，设置不变（`rfq-timing-settings.test.tsx`；`rfq-timing-settings-db.isolated.test.ts`）

#### Scenario: 清空回到默认
- **WHEN** 组织存了催单天数 5，管理员 PUT `{ chaseAfterDays: null }`
- **THEN** 读回来是默认 3、`stored.chaseAfterDays` 为假；项目负责人自己设的催单天数仍然优先（`rfq-timing-settings-db.isolated.test.ts`）

#### Scenario: 普通成员
- **WHEN** 普通成员 PUT 这三项
- **THEN** 403，设置不变（`rfq-timing-settings-db.isolated.test.ts`）

### Requirement: 页面上的询价节奏
「询价与落地价设置」一节 SHALL 有「询价节奏」三项：没单独设置时 SHALL 显示为空并写明当前用的默认天数；保存 SHALL 只发改过的项，改成空 SHALL 发 null；不是 1–60 的整数 SHALL 不发请求并写明哪一项不对。每一项 SHALL 写明它管什么与生效范围：回复提前量只影响以后新建的询价；催单天数同时决定第二次催单与标「未响应」（标未响应不用批），以项目负责人个人设置为先，开了自动跟进且仍生效的轮次按当时定下的天数。

#### Scenario: 只改催单天数
- **WHEN** 管理员只把催单天数从空改成 5 后保存
- **THEN** 请求里只有 `chaseAfterDays: 5`；读回来与直接调接口相同（`rfq-timing-settings.test.tsx`；`rfq-timing-settings-db.isolated.test.ts`）

#### Scenario: 填错
- **WHEN** 管理员把轮次锁天数填成 0 或 abc
- **THEN** 页面写明「轮次锁天数」要 1–60 的整数，不发请求（`rfq-timing-settings.test.tsx`）

#### Scenario: 说明文字
- **WHEN** 渲染这一节
- **THEN** 三项各有说明，没单独设置的写明默认天数（`rfq-timing-settings.test.tsx`）

### Requirement: Muse 查看偏好写出实际的催单天数
Muse「查看偏好」的回复里，本人没设催单天数时 SHALL 写明实际按的组织层天数（组织设置，没有就是 3 天），SHALL NOT 固定写 3 天。本人设了的照旧写本人的天数。

#### Scenario: 组织设了 5 天、本人没设
- **WHEN** 组织催单天数是 5，本人没设，问 Muse 查看偏好
- **THEN** 回复写「催单：未设（按组织设置：5 天没回）」（`npx tsx src/lib/tender-rfq/__tests__/rfq-timing-settings.test.tsx`）
