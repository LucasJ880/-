# Design：Alberta 授标的人工录入

## Context

- 授标记录唯一写入口是 `src/lib/tender-intel/awards.ts` 的 `createOrObserveAwardRecord`：按 `(orgId, sourceType, sourceKey)` 幂等；同招标编号 + 同中标方 → 挂源到既有记录（`ATTACHED_EXISTING`）；同中标方 + 同采购方但日期 / 金额对不上 → 新记录 `status = NEEDS_REVIEW` + `possibleDuplicateOfId`；`SYSTEM_VERIFIED` 只认带编号的 `CANADABUYS_OPEN_DATA`（服务里强制）。它不写审计。
- 信任级词表：`AI_EXTRACTED | HUMAN_CONFIRMED | SYSTEM_VERIFIED | NEEDS_REVIEW`；来源类型：`CANADABUYS_OPEN_DATA | WEB_SEARCH | PROJECT_RECORD | USER_ENTRY | OTHER_PUBLIC`。
- 授标情报的数字层（`deriveAwardIntelligence`）只算 `ACTIVE` 且 `HUMAN_CONFIRMED / SYSTEM_VERIFIED` 的记录；`NEEDS_REVIEW` 只算线索、不出数字。组织管理员在「历史授标」页确认（→ `HUMAN_CONFIRMED`）或撤回（`tender/award-review`）。
- CHAIN-2 / CHAIN-3 的「本采购方的他人授标」读同一张表，按采购方规整名找；CHAIN-3 的中标者名单只认 `ACTIVE` 且人工确认或权威来源的记录，CHAIN-2 的可比价格只用权威记录——待复核的人工录入要等组织管理员确认后才进入它们。
- CHAIN-1 前置核查：APC 对程序化访问返回 Cloudflare 人机验证，到此为止；交接文档第四十四次更正：现有授标历史面板做不了 Alberta 人工录入。

## Goals / Non-Goals

**Goals**：人在 APC 上看到的 Alberta 授标能如实录进来，来源、链接、信任级一看就知道是人工录入待复核；系统从头到尾不访问 APC。

**Non-Goals**：
- `src/lib/tender-intel/awards.ts` 的写入规则（幂等、去重、信任级白名单）——只调用，不改。
- `src/app/api/organizations/[orgId]/tender-awards/[awardId]/review/route.ts`（复核照旧）。
- `src/app/api/projects/[id]/external-intel/award-history/route.ts`（项目里确认 CanadaBuys 检索结果的入口不改）。
- `src/lib/tender-intel/award-intelligence.ts`、`src/lib/tender-intel/sourcing-suggestions.ts`、`src/lib/tender-import-leads/**`。

## Decisions

### D1：落库口径；撤回后可以重录

调用 `createOrObserveAwardRecord`：`actor = { actorType: "user", userId }`；`source.sourceType = "USER_ENTRY"`、`source.sourceUrl = 规整后的 APC 链接`、`source.sourceKey = "manual:apc:" + sha256(规整链接 + "\n" + 中标方规整名)[0:32]`、`source.capturedAt = 现在`、`evidenceSnippet = null`（系统没读过公告，不写任何「原文」）；`verificationStatus = "NEEDS_REVIEW"`、`confidence = "MEDIUM"`；`projectId = null`（组织级录入）。写入服务的幂等不看记录状态：同一来源键命中一条已被撤回的记录时，改用确定性的后继键 `{来源键}:after:{撤回记录 id}` 再写（与项目结果回灌 `own-result-backfill.ts` 的做法相同），撤回的那条保持撤回，重放仍幂等。

- 备选 A：`verificationStatus = "HUMAN_CONFIRMED"`（录入的人就是人）。否决：Lucas 定「信任级为待复核」；确认应由组织管理员在页面上做。
- 备选 B：`sourceType = "OTHER_PUBLIC"`。否决：Lucas 定「来源标成人工录入」。
- 备选 C：来源键 = `manual:{cuid}`（每次新建）。否决：同一条公告的同一个中标方录两次就是两条；用链接 + 中标方做键，重录返回「已经录过」。一条公告有多个中标方时各自一条。
- 备选 D：不处理撤回，撤回的就永远录不进来。否决：`tender/award-review` 写明撤回的记录不参与去重；填错的人撤回后要能更正。

### D2：APC 链接的校验与规整（不访问）

先用 `new URL` 解析（只做字符串解析，SHALL NOT 发起请求），再规整：去掉 `#` 之后的部分、主机名小写、去掉路径末尾所有的 `/`；规整后才判：协议恰为 `https:`、主机名恰为 `purchasing.alberta.ca`、没有端口、没有用户名密码、路径不为空（规整后不是 `/`，即不是首页）、规整后的串 ≤ 2048。存、算来源键、显示都用规整后的序列化结果（`origin + pathname + search`），不用原始输入——反斜杠、全角主机名、`:443`、空白都由解析器收敛，`javascript:`、别的主机、`@` 把戏、带端口、末尾带点的主机都被拒。query 参数与路径大小写保留原样（同一条公告不同写法会算两个来源键，可接受：APC 的链接格式未核对，不猜）。源码断言该模块与接口里没有网络调用。

- 备选 A：接受任何链接。否决：Lucas 定「带 APC 公告链接」。
- 备选 B：只接受 `/posting/…` 一种路径。否决：APC 的公告链接格式本次没有核对（不访问 APC），写死会把真实链接拒掉；PR 里请 Lucas 给一个样例链接再决定要不要收紧。

### D3：谁能录入

本组织有效成员且组织角色不低于 `org_member`（`org_viewer` 不行），平台超级管理员按既有规则（`requireOrgRole(request, orgId, "org_member")`）；平台超级管理员录入时组织必须存在（不存在 404）。复核仍只限组织管理员。列表接口返回 `canEnterManual`（同一判定），页面据此显示表单。

- 备选 A：只限组织管理员录入。否决：录的人常是做标的人；信任级已是「待复核」，确认仍要管理员。
- 备选 B：任何能看页面的人（含 `org_viewer`）。否决：查看角色不应写数据。

### D4：其它字段的校验

- 采购方、中标方：去空白后非空、≤ 200 字。采购方输入框带候选（本组织招标项目的采购方写法与已有授标的采购方写法，去重、最多 200 个），照项目里的写法填才能和 CHAIN-2 / CHAIN-3 对上（按规整名完全相等，不做模糊匹配）。
- 招标编号：选填、≤ 100 字。
- 授标日期：选填、`YYYY-MM-DD`，并且往返一致（`2023-02-29` 这种会被 JS 进位的日期拒绝）、不晚于今天（UTC 日期 + 1 天容差，与 CHAIN-3 同口径）。
- 合同金额：选填、数字、0 ≤ 金额 ≤ 1,000,000,000,000、最多两位小数；只填币种不填金额时忽略币种；币种只认 `CAD`、`USD`，缺省 `CAD`。
- 范围摘要：选填、≤ 2000 字；表单提示「同类采购照公告标题写同一句，可比价格才算得上」。
- 请求体 ≤ 16 KB；校验失败 400 `{ error, code }`，返回第一处错误的那句话（顺序：采购方、中标方、链接、编号、日期、金额、币种、摘要）；不写库。

- 备选：币种接受任意三个字母。否决：落地价与可比价格只认 CAD / USD；别的币种录进来也用不上。

### D5：结果、审计、事务、并发

判定顺序：未登录 401 → `requireOrgRole` 403（平台超级管理员 + 组织不存在 404）→ 授标情报开关关 409 `组织授标情报尚未启用`（与既有处理接口同一句）且不访问授标表 → 校验 400。接口在一个事务里：调用写入服务（传事务客户端，撤回时按 D1 换后继键）→ 新建、疑似重复、挂到既有时写审计 `tender.award_manual_entry`（`targetType = "award_record"`、`targetId = 记录 id`；`afterData` 含结果、提交的全部字段（采购方、中标方、编号、日期、金额、币种、摘要、APC 链接）、信任级、挂到既有时那条记录的信任级）。重录（`ALREADY_OBSERVED`）不写审计。两次并发提交撞上来源唯一约束（P2002）时重读一次，按「已经录过」返回。成功 200，返回 `{ outcome, record: { id, verificationStatus, status, buyerName, solicitationNumber, awardDate }, messageZh }`。挂到既有的原因分两种说：招标编号与中标方相同；没有编号但中标方、授标日期、金额都相同（写入服务的两条强匹配路径，前者看编号、后者不看采购方）。

- 备选 A：审计写在事务外。否决：记录写了、审计没写，就查不到是谁录的。
- 备选 B：结果只返回代码、页面自己拼句子。否决：说法要和规格逐字一致，一处定义。

### D6：文字与页面

- 页面叫「历史中标」（导航与页面标题）。表单标题：`录入 Alberta 授标（APC）`；说明：`只录入你在 Alberta Purchasing Connection（APC）上自己看到的授标公告。系统不会打开这个链接。录入后标为「待人工复核」，组织管理员确认属实后才进入统计、可比价格和历史中标者。`；采购方提示：`照公告原文填写；与项目里的采购方写法一致，系统才能把它们对上。`；范围提示：`同类采购照公告标题写同一句，可比价格才算得上。`
- 结果：`已录入，等组织管理员复核。`（新建）／`已录入；和已有的一条记录可能重复，等组织管理员裁决。`（疑似重复）／`已有同一条授标（招标编号与中标方相同），这条公告链接已挂到那条记录上。`（按编号挂到既有）／`已有同一条授标（中标方、授标日期、金额都相同），这条公告链接已挂到那条记录上。`（按日期金额挂到既有）／`这条公告的这个中标方已经录过了。`（重录）
- 校验：`请填写采购方。`、`请填写中标方。`、`请填写 APC 公告链接。`、`APC 公告链接要以 https://purchasing.alberta.ca/ 开头，并指向具体的公告。`、`授标日期要写成 年-月-日，且不能晚于今天。`、`合同金额要是不小于 0 的数字，最多两位小数。`、`币种只能是 CAD 或 USD。`、`{字段}太长了（最多 N 字）。`（链接超长也用这句：`APC 公告链接太长了（最多 2048 字）。`）
- 列表：人工录入的记录在中标方下面写 `人工录入 · APC 公告`（原生 `<a>`，新窗口打开，`rel="noopener noreferrer"`；不用 `next/link`、不预取、不嵌入）。统计条原来的「AI 待确认 N」改为「待确认（AI 提取 / 人工录入）N」（这一项本来就把待人工复核的记录算在里面）。
- 表单提交期间按钮禁用。

- 备选：结果写在列表顶部的通知栏。否决：通知栏离表单远，人看不到自己的录入结果。

### D7：列表里只显示人工录入的 APC 链接

列表接口对列出的记录查来源：只取 `sourceType = "USER_ENTRY"` 且 `sourceKey` 以 `manual:apc:` 开头的，返回前按 D2 重新校验一次主机，按来源创建时间取第一条，作为 `manualApcUrl`。别的 USER_ENTRY 来源（项目结果回灌、项目里确认的对手）不显示。

- 备选：显示一条记录的全部来源。否决：本次只为复核人工录入；全部来源的展示是另一件事。

## 八条硬纪律

1. 零 schema：遵守（写既有 `AwardRecord` / `AwardRecordSource` / `AuditLog`；不改 `prisma/`）。
2. 出站先审批：不涉及（没有任何出站）。
3. 禁止第三套队列：不涉及。
4. 脱敏：遵守（不收、不存联系方式；审计不记联系方式）。
5. 不爬登录页：遵守——本 change 的核心约束：系统不访问 APC，链接只存不开（D2 的源码断言与隔离库「零外部请求」）。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守（零模型调用）。
8. 测试注册：新测试登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- 纯函数：`npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts`（每条校验与那句话、链接规整、来源键确定性、结果说法、源码里没有网络调用）。
- 隔离库：`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`——成员录入 → `USER_ENTRY` / `NEEDS_REVIEW` / 链接 / 审计（含提交的全部字段）；重录 → 已经录过、不写审计；同编号同中标方 → 挂到 CanadaBuys 的 `SYSTEM_VERIFIED` 记录（仍是 `SYSTEM_VERIFIED`）；没有编号、同中标方同日期同金额 → 挂到既有（第二句话）；疑似重复；组织管理员撤回后重录 → 新建一条、撤回的那条仍撤回、重放幂等；组织管理员确认后变 `HUMAN_CONFIRMED`（不是 `SYSTEM_VERIFIED`）；并发提交两次 → 一条记录、两次都 200；`org_viewer` 403；别的组织 403；平台超级管理员 + 不存在的组织 404；开关关 409 且不访问授标表；列表接口返回 `canEnterManual`、`manualApcUrl`（别的 USER_ENTRY 来源不显示）、采购方候选；全程外部请求 0（替换 `globalThis.fetch` 计数）。
- 既有不改期望：`awards.test.ts`、`awards-db.test.ts`、`award-dedupe-db.isolated.test.ts`、`award-review-db.isolated.test.ts`、`award-semantics.test.ts`、`sourcing-suggestions-db.isolated.test.ts`、`import-leads-db.isolated.test.ts`。
- 全量：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`。

## Risks / Trade-offs

- 采购方写法与项目里的不一致时，CHAIN-2 / CHAIN-3 对不上这条授标（按规整名找）；表单提示写明，不做模糊匹配（T3 纪律）。
- 待复核的人工录入记录不进统计、可比价格与 CHAIN-3 的中标者名单，要等组织管理员确认；表单说明写明这一点。
- 项目里有人按编号确认了同一条授标（授标历史面板带编号确认、或项目结果回灌），写入服务会把这条人工录入直接提升为人工确认，不经组织管理员（既有规则）；之后 CanadaBuys 观察到同一条时只挂来源、记录不升级。
- 录入的人可能填错：组织管理员复核时可撤回（既有入口，原因必填、留痕）。
