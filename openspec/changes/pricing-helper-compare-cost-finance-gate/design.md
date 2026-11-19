# Design：报价表助手的比价落地价只给有财务查看权的人（FIX-12）

## Context

- 动机见 proposal.md「Why」；行为契约见 `specs/tender/pricing-compare-cost-source/spec.md`。
- `GET …/pricing-helper` 先过 `requireProjectReadAccess`（成员 / 负责人 / 组织 org_admin / 平台超级管理员），开关开启时调 `loadCompareCostSuggestionSafe` 取比价建议，组成 `compareCost = { suggestion, source, staleNoteZh }`。`suggestion`（状态 `ok`）带 `landedCadTotal`、`breakdown`（货值 / 内陆 / 海运 / 保险 / 关税 / 清关）、`assumptions`、`warnings`、`quantityBasis`、供应商、轮次、条目 id；`source`（`rfq_compare`）带当时的 `landedCadTotal`；`staleNoteZh` 的文字里写着现在的落地价与已保存的成本两个金额。
- `POST …/pricing-helper`（save）先过 `requireProjectWriteAccess`（负责人 / org_admin / 项目 `project_admin` / 平台超级管理员）；请求带来源声明时取一次比价建议交给 `nextCostSource` 核对，响应带 `ourCostSource`（可能是带 `landedCadTotal` 的比价来源）。
- 财务查看权已有统一判定：`src/lib/project-finance/access.ts` 的 `resolveFinancePrivilege(user, orgId, projectOwnerId).canReadAll` = 平台超级管理员 ∨ 企业级（ORG）`project.finance.manage` ∨ 企业级 `project.finance.read` ∨ 项目负责人。TI-4a 成本核算表（`src/app/api/projects/[id]/bid-workspace/cost-sheet/route.ts`）就用它，没有就 403。岗位模板里 `owner` 持 manage + read、`accounting` 持 read（ORG），`bids` 只持 `project.finance.read`（ASSIGNED），不算 `canReadAll`。
- 卡片 `src/components/tender/pricing-helper-card.tsx` 以 `compareCost` 是否存在决定「毛利率（按售价）」字样与成本加成提示；「来自比价矩阵」一行由 `src/components/tender/pricing-compare-source.tsx` 呈现；填入按钮经 `fillFromSuggestion`，只对状态 `ok` 生效。保存后卡片重新 GET，不读保存响应里的 `ourCostSource`。

## Goals / Non-Goals

**Goals**

- 开关开启时，没有财务查看权的人从这个接口（GET 与 POST save）拿不到比价矩阵算出的任何金额、逐项、换算依据，也拿不到已保存成本的比价来源与过时提示。
- 有财务查看权的人、开关关闭时，请求、返回、存库逐字段不变。

**Non-Goals（具体到文件）**

- 不改 `src/lib/project-finance/access.ts`（只调用 `resolveFinancePrivilege`）。
- 不改 `src/lib/tender-pricing/compare-cost-source-load.ts`（取数与换算不变）。
- 不改 `src/components/tender/pricing-helper-card.tsx`（它按 `compareCost` 存在与否切换字样，新状态下按钮自然不生效）。
- 不改 GET 返回的 `inputs` / `result`，也不改 POST save 返回的 `inputs` / `model`（见 proposal「Out of scope」第一条）。
- 不改 POST `derive` 分支。
- 不改询价区比价矩阵路由 `src/app/api/projects/[id]/inquiries/[inquiryId]/compare/matrix/route.ts`、`…/compare/analysis/route.ts`，不改 `src/lib/muse-bridge/**`。

## Decisions

### D1 没有财务查看权就不取数，而不是取完再删字段

GET 对没有财务查看权的人不调比价取数，直接给一项固定的「受限」建议（只有状态与一句说明），`source = null`、`staleNoteZh = null`。

- 否决：照常取数，返回前删掉金额字段。`staleNoteZh` 把金额写在文字里，`warnings` / `assumptions` 也可能带数，只能逐字段、逐句处理；FLOW-H2 以后再加字段时容易漏删。还会替看不到结果的人跑一次比价矩阵查询。
- 否决：整项不返回 `compareCost`（等同开关关闭）。卡片会跟着去掉「毛利率（按售价）」字样与成本加成提示，改到与金额无关的部分；成员也不知道为什么没有这一行。

### D2 「受限」作为建议的又一个状态，不改 `compareCost` 的形状

`CompareCostSuggestion` 加一个 `{ status: "restricted"; messageZh }`，与 `none_selected` / `unavailable` 同形。呈现组件把它与这两种归在「只显示说明」一支；`staleNoteZh` 对它返回 `null`；`verifyCostSource` / `fillFromSuggestion` 本来就只认 `ok`。

- 否决：在 `compareCost` 上加 `restricted: true`、其余字段可选。每个读 `compareCost` 的地方都要另加分支；放进联合类型里，类型检查会逼着呈现组件与过时提示处理新状态（漏了就编译不过）。

### D3 复用成本核算表的判定 `resolveFinancePrivilege(...).canReadAll`

组织取服务端鉴权得到的 `access.project.orgId`，负责人取 `access.project.ownerId`，用户取 `access.user`；不读请求里的任何身份字段。

- 否决：`requireCostAccess(..., PROJECT_COST_READ)`。它先看 `isFinancialControlEnabled()`（默认关 → 404），会把报价表助手绑到另一个开关上；而且它按项目角色放行 `project:cost:read`，与成本核算表的口径不一致。
- 否决：新开一个权限键。要改岗位目录与种子，且成本核算表已经定了用 `canReadAll`，两处口径应当相同。

### D4 只在开关开启时判定

开关关闭时不求财务查看权，GET / POST 与改动前逐字相同，也不多两次授权查询。

- 否决：总是判定。开关关闭时没有要收的东西，只白多查询。

### D5 保存：不采信没有财务查看权的人的来源声明，响应不带来源

POST save 在开关开启时求一次财务查看权；没有的人：声明当作没带（不取比价建议），`nextCostSource` 照原规则走（成本变了记手填、没变保留原来的来源、请求没带成本保留原来的来源），响应省掉 `ourCostSource`。库里仍照常记来源，有财务查看权的人之后读取看得到。

- 否决：照常核对，只删响应里的来源。正常的卡片上这些人没有填入按钮，声明只会来自手工构造的请求；为它替人算一次看不到的落地价与 D1 相违。
- 否决：带声明就 403。权限被收回时还开着旧页面的人（表单里残留声明）会保存失败，而不是存成手填。

### D6 判定出错不另兜底

`resolveFinancePrivilege` 抛错（数据库不可用）时接口照常报错，与成本核算表相同，属于失败即关闭。

- 否决：抛错时当作受限。有财务查看权的人会看到错误的原因（「只对有财务查看权的人显示」）；而这时同一请求前面的项目鉴权查询多半也已失败。

## 与八条硬纪律的关系

1. 零 schema：遵守。不改 Prisma，不加字段，不写迁移；来源仍记在既有的 `pricingInputs` JSON 位。
2. 出站先审批：不涉及。没有任何对外发送。
3. 禁止第三套队列：不涉及。
4. 脱敏（决定 A）：不涉及 Muse 通道，`src/lib/muse-bridge/**` 不改；本次只收紧 Web 接口的可见范围，不放宽任何输出。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。不新增 LLM 调用；判定是查授权表。
8. 测试注册：遵守。新增 `src/lib/tender-pricing/__tests__/compare-cost-finance-gate-db.isolated.test.ts`，同一 task 里注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`bash scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不加行。

## 验证方式

- 测试先行：新增隔离库测试 `npx tsx src/lib/tender-pricing/__tests__/compare-cost-finance-gate-db.isolated.test.ts`（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated`，本机 Postgres 16 隔离库），先在改动前的路由上跑，「没有财务查看权的人拿不到金额 / 声明不采信 / 响应不带来源 / 不收过时提示」几项失败；改动后全部通过。
- 变异核对：分别去掉 GET 的判定、POST 的声明判定、POST 响应的判定，新测试对应项重新失败。
- 回归：`compare-cost-source.test.tsx`、`compare-cost-source-db.isolated.test.ts`、`pricing-helper.test.ts`、`pricing-helper-save-db.isolated.test.ts`、`pricing-helper-lock-db.isolated.test.ts` 照旧通过（它们的读写者都是项目负责人，有财务查看权）。
- 门禁：`bash scripts/check-test-registry.sh`、`npm run typecheck`、`npm run lint:baseline`、`npm test`（本机隔离库；对比 main 上本来就失败的测试清单）、`openspec validate pricing-helper-compare-cost-finance-gate --strict`。

## Risks / Trade-offs

- [已保存的「我方成本」仍对所有项目读者可见；若它是从比价矩阵填进来的，数字就是当时的落地价] → 本次按任务范围不改（proposal「Out of scope」），报告里列为待拍板的后续项。
- [询价区比价矩阵按项目读权限返回每一家的落地价，没有财务查看权的成员仍能在那里看到] → 本次不改，报告里列为后续项；本 change 只保证报价表助手不再是一个额外出口。
- [开关开启时每次 GET 与 save 多两次授权查询] → 只在开关开启时发生；对没有财务查看权的人反而省掉一次比价矩阵查询。
- [岗位被收回后，旧页面里残留的声明] → 保存照常成功，记为手填（D5）。

## Migration Plan

无数据迁移，不加开关。改动跟随既有开关 `TENDER_PRICING_COMPARE_SOURCE_ENABLED`：生产上该开关默认关、未启用，合并后在生产上没有可见变化；开关打开时即按财务查看权收口。回滚：还原本 PR。
