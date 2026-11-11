# Design

## Context

- TI-1 至 TI-3b 的四个纯函数目录（`tender-price-schedule`、`tender-bid-cost`、`tender-competition`、`tender-bid-readiness`）线上不可达。
- Owner Gate B 由本会话按授权代定为方案甲：零 schema，落既有 JSON 位（交接文档 §0.4）。
- 实施前核对存储位时发现：`GET /api/projects/{id}/bid-intelligence` 用 `include` 把情报室整行（含 `summaryJson`）返回给任何有项目读权限的人（`src/app/api/projects/[id]/bid-intelligence/route.ts:20-31`）。这个 JSON 位里已有 `pricingInputs.ourCostCad`——差距分析 §8 记过「定价助手的成本对所有项目读者可见」。
- 另一个候选位 `BidIntelligenceModule.dataJson`（每模块一行）不能用：情报页签遍历全部模块并把未知模块的数据原样渲染出来（`src/components/bid-workflow/project-intel-sections.tsx:467`、`module-data-view.tsx:60`）。
- 财务访问规则：`resolveFinancePrivilege`（`src/lib/project-finance/access.ts`）——平台超级管理员、持企业级 `project.finance.manage` 者、项目负责人有管理权；持 `project.finance.read` 者只读。
- 同类写法先例：`tender-watch`、`pricing-helper` 路由都是「upsert 情报室 → 读出 summaryJson → 展开合并 → 整块写回」，没有加锁。
- 隔离库测试的先例：`src/lib/procurement-records/__tests__/procurement-records-db.isolated.test.ts`（真实路由 + `createSession` 造登录态）。

## Goals / Non-Goals

**Goals:**

- 让项目页拿得到价格表、阻断项与三张清单，并能算出核算表。
- 覆盖任务书验收项 A17（租户隔离）、A20（开关关闭零影响）、A22（操作者来自登录身份）。
- 财务数据不进入普通项目成员读得到的存储。

**Non-Goals:**

- 不动 `src/app/api/projects/[id]/bid-intelligence/**`、`pricing-helper/**`、`bid-fit/**`、`tender-watch/**`。
- 不动 `src/lib/quote-engine/**`、`src/lib/project-finance/**`（只调用 `resolveFinancePrivilege`）、`src/lib/projects/access.ts`（只调用）。
- 不动 `prisma/schema.prisma`；不动 `src/components/**` 与任何页面。
- 不动 `openspec/config.yaml`。

## Decisions

### D1：非财务内容存 `BidIntelligenceRoom.summaryJson.bidWorkspace`，成本输入不存

价格表行项是公开的招标事实；拟投型号、证书、领取方名单、补遗与情报页签里已有的内容同一敏感级别，项目成员本来就该看到。供应商报价与成本假设不同——按 Owner Gate A 第 10 项要走财务访问规则，而这个 JSON 位对所有项目读者敞开，所以不放。

- 被否决：成本输入也放进这个键，再在 `bid-intelligence` 接口上把它剥掉。整块返回这个 JSON 的地方不止一处时漏一处就是泄露，而且要改既有接口。
- 被否决：存进 `BidIntelligenceModule` 新增一行。情报页签会把它原样渲染出来。
- 被否决：存进 `Organization.settingsJson` 按项目分键。那是规则明文认可的落点，也有按项目分键的先例（落地成本的关税率），但每个项目几 KB、所有功能读组织设置时都要带上它，而且组织管理员不等于有财务权限。
- 被否决：存进报价引擎的 `ProjectQuote.engineJson`。建一行报价会改变既有流程的判断（「下一步」查表用报价是否存在判断是否已定价），副作用不可控。
- 被否决：现在就建专用表。需要硬纪律第 1 条的例外与一次生产迁移，Lucas 不在场时不做这种不可逆的决定。

这个前提（分析轮次与情报室的 JSON 位可作扩展落点）在 `openspec/config.yaml` 第 1 条的文字里没有列出，是按代码先例执行的；本 change 不改 config.yaml，在 PR 里标出等确认。

### D2：成本核算做成「带着输入算一次」的接口

`POST …/cost-sheet` 收成本输入、读已存的价格表行项、返回核算表，不写库。输入由界面在浏览器里保留（TI-4b）。

- 被否决：等存储方案定了再做核算表。Lucas 明确要核算表「表现出来」；计算与展示不依赖存储方案，先交付这一半。
- 被否决：接口同时把结果缓存到库里。缓存就是存储，同样要回答放哪里的问题。

### D3：保存时锁住情报室那一行再读改写

事务里先 `SELECT … FOR UPDATE` 锁住该项目的情报室行，再读出 JSON、只替换 `bidWorkspace` 键、写回。分块保存按块合并。

- 被否决：沿用先例的无锁读改写。这个键会被界面分块频繁保存，并发时后写的会覆盖先写的整块 JSON，连带丢掉别的功能刚写入的内容。
- 被否决：用数据库的 JSON 局部更新函数。可以避免覆盖别的键，但同一键内的分块合并仍需读改写；加锁一并解决。

### D4：读取结果由服务端现算，不存

价格表校验、尺寸对照、认证闸、领取方汇总、可投标判定、阶段决定都在读取时从已存输入算出。

- 被否决：保存时算好一并存。规则会随后续 change 变，存下来的结果会过期；现算保证读到的永远是当前规则。

### D5：「手头材料」从实际数据推导

有招标文件 = 项目有文件或已存价格表；有领取方名单 = 已存名单；有供应商报价 = 该项目询价里已有「已报价」的供应商行。不让用户手工勾选。

- 被否决：让用户勾选手头有什么。这又回到「逐项询问」。

### D6：开关关闭返回 404，且在访问控制之前判断不了组织时先过项目访问

顺序：登录与项目访问（拿到项目所属组织）→ 按组织判开关 → 关闭即 404。开关判断不读写投标工作区。

- 被否决：开关判断放最前、不分组织。白名单按组织生效，必须先知道项目属于哪个组织；项目访问检查本身是既有逻辑，不产生新的可观察行为。

## 与八条硬纪律的关系

1. 零 schema：遵守。只在既有 JSON 位下加一个键；项目没有情报室时按既有写法建一行。落点属于「代码先例」而非规则明文，见 D1 末段。
2. 出站先审批：不涉及。没有任何对外动作；阶段清单里要批准的阶段只是显示「停下等批准」。
3. 禁止第三套队列：不涉及。没有后台任务；全部在请求内同步完成。
4. 脱敏：触碰——成本核算接口返回成本、报价与毛利。只对有财务查看权的人返回，不存、不进通知与邮件、不进 Muse。读取接口不含任何金额。审计记录只记改了哪几块，不记金额。
5. 不爬登录页：不涉及。没有外部请求。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。全部是已有纯函数的组合，零模型调用。
8. 测试注册：新增 2 个纯逻辑测试与 1 个隔离库测试，全部登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-bid-workspace/__tests__/workspace-contract.test.ts`
- `npx tsx src/lib/tender-bid-workspace/__tests__/workspace-view.test.ts`
- 隔离库（本地 PostgreSQL，已应用全部迁移）：`DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/tender-bid-workspace/__tests__/bid-workspace-db.isolated.test.ts`
- `bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-bid-workspace-api --strict`

## Risks / Trade-offs

- [成本输入不落库，换浏览器就没了] → 界面提供导出 / 导入；这是有意的临时状态，直到 Owner 定下成本数据放哪里。报告里把两个候选（专用表；并入报价引擎）的利弊写清楚。
- [这个键会随 `bid-intelligence` 接口返回给所有项目读者] → 只放非财务内容，并有一条测试断言已存内容里没有成本字段。
- [情报室行锁与其它无锁写入并存] 其它功能的读改写不加锁 → 本 change 的保存不会丢别人的改动（持锁期间读到的是最新值），但别人的无锁写入仍可能覆盖本键；窗口是它们一次请求的时长。报告里记为已知限制，彻底解决要改那几处先例。
- [开关打开后多三个接口] → 默认关、按组织白名单灰度；关掉即回到现状。

## Open Questions

无。成本输入的存储位置是下一个 change 的前置决定，不影响本次的规格、做法与任务。
