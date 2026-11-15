# Design：组织页上的「询价与落地价设置」（W-2）

## Context

- 接口已经有：`GET / PUT /api/organizations/[orgId]/tender-rfq-settings`，`requireOrgRole(…, "org_admin")`（平台管理员也放行）。PUT 的校验与合并在 `src/lib/tender-rfq/landed-cost.ts`（`tenderRfqSettingsPutSchema`、`applyTenderRfqSettingsUpdate`）：传了的键覆盖、没传的保留、null 清空；`projects` 按项目合并、null 删除该项目；合并后有汇率就必须有 `fxAsOf` 与 `fxSource`。项目必须属于本组织。写库走 `mutateOrgSettings`（锁行，FIX-3），写审计。
- GET 返回的发件设置是**解析后**的值（`readTenderRfqSettings`：没存就回退环境变量、再回退默认值），落地价参数是解析后的（不合法的当作没填）。
- 组织详情页 `src/app/(main)/organizations/[orgId]/page.tsx` 已有 `canManageOrg`（org_admin 或平台管理员，与 `requireOrgRole` 一致）。
- 组织项目列表：`GET /api/organizations/[orgId]/projects`（成员可读）。

## Goals / Non-Goals

**Goals**

- 管理员在页面上能看、能改这些设置；保存的效果与直接调接口完全相同。

**Non-Goals（具体到文件）**

- 不改 `landed-cost.ts` 的校验、合并规则。接口 `route.ts` 只有两处补充（D6）。
- 不改 `src/lib/tender-rfq/round-pure.ts`（回复提前量、轮次锁）。
- 不改 `prisma/schema.prisma`。

## Decisions

### D1 只发改过的项

表单记住打开时的值；保存时逐项比较，只把变了的放进请求。

- 否决：整张表单都发。GET 给的发件地址是解析后的（可能来自环境变量）；整张发会把环境变量的值写死进组织设置，以后改环境变量就不生效了。

### D2 汇率表整张发

汇率表改过任何一行就整张发（PUT 对 `fxRates` 是整体覆盖）；日期与来源跟着各自是否改过决定发不发。页面先做与接口相同的校验（有汇率就要日期与来源；三位大写币种；大于 0），省一次来回；接口仍是最终把关。

- 否决：逐行发。PUT 不支持逐行合并。

### D3 项目关税率：从本组织的招投标项目里选

列出已有设置的项目（名称取自组织项目列表；列表里没有的显示 id 并标「不在列表里」），可以加一行（下拉只列本组织 `workDomain = tender` 的项目）、改、删。删 = 发 null。

- 否决：手填项目 id。容易填错，也会让人填别的组织的。

### D4 纯函数在 `src/lib/tender-rfq/settings-form.ts`

`formFromView`（GET 返回 → 表单字符串）、`bodyFromForm`（表单 + 打开时的表单 → `{ ok, body } | { ok: false, errors }`）、`estimateModeLabel` 等。组件 `src/components/organizations/tender-rfq-settings-section.tsx` 只管取数、展示、调 PUT。

- 否决：逻辑写在组件里。不好测，「只发改过的项」这种规则必须能逐条测。

### D5b 页面状态放进纯函数 reducer

`src/lib/tender-rfq/settings-section-state.ts`：读到、读失败、改一项、加删行、撤销、校验失败、保存中、保存成功（用 PUT 返回的设置）、保存失败，全在这里；组件只取数、调接口、dispatch。独立审查指出组件里的状态变化几乎没有能失败的测试（11 处变异 10 处存活），改成 reducer 之后逐条测。

- 否决：引入 DOM 测试库。仓库里没有，为一节页面加依赖不值。

### D6 接口的两处补充（独立审查之后）

- GET 多返回 `stored`（发件三项各自是不是组织自己存的）。没有它，页面分不清「存的值」和「回退的值」：只改显示地址会把跟着回退的授权邮箱一起带走（审查 M1），清空一项之后读回来又显示回退值。页面据此把没存的项显示为空、占位文字写当前回退值；授权邮箱没存而显示地址改了，就把授权邮箱固定为改之前实际用的那个。
- PUT 里项目设置为 null（删除）不校验项目归属。项目可以被删除，之后它在设置里的那一行永远删不掉、连带别的修改都存不了（审查 M2）。删一个 id 只影响本组织自己的设置；要写入的仍校验。
- 否决：页面上禁止删「不在列表里」的行。那一行就永远留着。

### D7 汇率、日期、来源是一个整体

改了汇率就三项一起发。只发汇率时，两个人同时编辑会让一个人的汇率挂上另一个人的日期与来源（审查 M3），落地价引用的出处就错了。

### D5 不加开关

只对组织管理员显示；写的正是接口本来就允许写的东西，并且接口照旧写审计。加开关只会让管理员多一步才能用上 FLOW-H2。

- 否决：加开关默认关。开关关着时 FLOW-H2 仍然多半「换算不出」，等于两个开关都要开。

## 与八条硬纪律的关系

1. **零 schema**：遵守。写的是既有的 `Organization.settingsJson.tenderRfq`，经由既有接口。
2. **出站先审批**：不涉及。只改设置，不发信。
3. **禁止第三套队列**：不涉及。
4. **脱敏**：页面只显示组织自己的设置；没有密码、令牌输入（spec 有一条 SHALL NOT）。Muse 通道不变。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：遵守并写明。显示地址 `fromEmail` 与授权邮箱 `mailboxEmail` 是两个输入框；发信仍只按组织设置里的 `mailboxEmail` 找授权，页面只是改这个设置。
7. **确定性优先**：遵守。不调模型。
8. **测试注册**：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-rfq/__tests__/settings-form.test.tsx`（新，纯逻辑 + 呈现 + 接线）：表单与请求体的互转、只发改过的项、清空、汇率校验、项目增删改、说明文字、只对管理员渲染。
- `npx tsx src/lib/tender-rfq/__tests__/settings-form-db.isolated.test.ts`（新，隔离库，真实路由）：`bodyFromForm` 产出的请求体走真实 PUT，读回来与预期一致；只改一项时其它项与环境变量回退不变；普通成员 403；别的组织的项目被拒。
- 改动前的代码上新测试失败；变异核对；独立审查；真实浏览器截图 `docs/acceptance/w-2/`。
- 全量门禁：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate tender-rfq-settings-page --strict`。

## Risks / Trade-offs

- **页面让改授权邮箱更容易了**：改错会让询价发不出去（或用错账号）。只有管理员能改，接口写审计；页面写明两个地址的区别。
- **两个人同时编辑**：后保存的只发自己改过的项，不会把对方改的整张盖掉（D1）；同一项两个人都改，后者生效；汇率三项一起发（D7）。
- **授权邮箱被固定**：授权邮箱原来跟着显示地址或环境变量回退，人改了显示地址之后它会被写成固定值，以后改环境变量不再影响这个组织。这是有意的：发信账号不能因为改显示地址而悄悄变掉。
- **存量的不合法汇率**：接口按原始键判断「有没有汇率」，读取时把不合法的过滤掉；这种数据（只能绕过接口写进去）会让页面上的落地价保存一直被拒，页面只能显示接口的错误。
- **GET 把不合法的存量值当作没填**：页面显示为空；人不动它就不发，存量值原样留着。

## Migration Plan

零 schema，无回填，没有开关。合并后组织管理员在组织页上就能看到。回滚 = 回滚代码（设置照旧可以用接口改）。

## Open Questions

无。回复提前量、轮次锁、催单天数要不要也能在页面上改（需要扩接口），留到以后单独定。
