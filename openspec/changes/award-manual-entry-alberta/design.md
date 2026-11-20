# Design：Alberta 授标的人工录入

## Context

- 授标记录唯一写入口是 `src/lib/tender-intel/awards.ts` 的 `createOrObserveAwardRecord`：按 `(orgId, sourceType, sourceKey)` 幂等；同招标编号 + 同中标方 → 挂源到既有记录（`ATTACHED_EXISTING`）；同中标方 + 同采购方但日期 / 金额对不上 → 新记录 `status = NEEDS_REVIEW` + `possibleDuplicateOfId`；`SYSTEM_VERIFIED` 只认带编号的 `CANADABUYS_OPEN_DATA`（服务里强制）。它不写审计。
- 信任级词表：`AI_EXTRACTED | HUMAN_CONFIRMED | SYSTEM_VERIFIED | NEEDS_REVIEW`；来源类型：`CANADABUYS_OPEN_DATA | WEB_SEARCH | PROJECT_RECORD | USER_ENTRY | OTHER_PUBLIC`。
- 授标情报的数字层（`deriveAwardIntelligence`）只算 `ACTIVE` 且 `HUMAN_CONFIRMED / SYSTEM_VERIFIED` 的记录；`NEEDS_REVIEW` 只算线索、不出数字。组织管理员在「历史授标」页确认（→ `HUMAN_CONFIRMED`）或撤回（`tender/award-review`）。
- CHAIN-2 / CHAIN-3 的「本采购方的他人授标」读同一张表（不按信任级过滤，按采购方规整名找）。
- CHAIN-1 前置核查：APC 对程序化访问返回 Cloudflare 人机验证，到此为止；交接文档第四十四次更正：现有授标历史面板做不了 Alberta 人工录入。

## Goals / Non-Goals

**Goals**：人在 APC 上看到的 Alberta 授标能如实录进来，来源、链接、信任级一看就知道是人工录入待复核；系统从头到尾不访问 APC。

**Non-Goals**：
- `src/lib/tender-intel/awards.ts` 的写入规则（幂等、去重、信任级白名单）——只调用，不改。
- `src/app/api/organizations/[orgId]/tender-awards/[awardId]/review/route.ts`（复核照旧）。
- `src/app/api/projects/[id]/external-intel/award-history/route.ts`（项目里确认 CanadaBuys 检索结果的入口不改）。
- `src/lib/tender-intel/award-intelligence.ts`、`src/lib/tender-intel/sourcing-suggestions.ts`、`src/lib/tender-import-leads/**`。

## Decisions

### D1：落库口径

调用 `createOrObserveAwardRecord`：`actor = { actorType: "user", userId }`；`source.sourceType = "USER_ENTRY"`、`source.sourceUrl = 规整后的 APC 链接`、`source.sourceKey = "manual:apc:" + sha256(规整链接 + "\n" + 中标方规整名)[0:32]`、`source.capturedAt = 现在`、`evidenceSnippet = null`（系统没读过公告，不写任何「原文」）；`verificationStatus = "NEEDS_REVIEW"`、`confidence = "MEDIUM"`；`projectId = null`（组织级录入）。

- 备选 A：`verificationStatus = "HUMAN_CONFIRMED"`（录入的人就是人）。否决：Lucas 定「信任级为待复核」；确认应由组织管理员在页面上做，与 AI 线索同一道复核。
- 备选 B：`sourceType = "OTHER_PUBLIC"`。否决：Lucas 定「来源标成人工录入」；公开与否由链接本身说明。
- 备选 C：来源键 = `manual:{cuid}`（每次新建）。否决：同一条公告的同一个中标方录两次就是两条；用链接 + 中标方做键，重录返回「已经录过」。一条公告有多个中标方时各自一条。

### D2：APC 链接的校验与规整（不访问）

只接受 `https:` 协议、主机名恰为 `purchasing.alberta.ca`（大小写不敏感）、不带用户名密码、去掉 `#` 之后的部分、长度 ≤ 2048；路径为空或只有 `/` 不接受（那是首页，不是公告）。规整：主机名小写、去掉末尾的 `/`。整个过程只做字符串解析（`new URL`），SHALL NOT 发起任何请求；源码断言该模块与接口里没有 `fetch`、`http`、`axios`、`undici` 的调用。

- 备选：接受任何链接。否决：Lucas 定「带 APC 公告链接」；链接不是 APC 的，就不是这张表单要录的东西。

### D3：谁能录入

本组织有效成员且组织角色不低于 `org_member`（`org_viewer` 不行），平台超级管理员按既有规则（`requireOrgRole(request, orgId, "org_member")`）。复核仍只限组织管理员。列表接口返回 `canEnterManual`，页面据此显示表单。

- 备选 A：只限组织管理员录入。否决：录的人常是做标的人；信任级已是「待复核」，确认仍要管理员，录入不必再收紧。
- 备选 B：任何能看页面的人（含 `org_viewer`）。否决：查看角色不应写数据。

### D4：其它字段的校验

- 采购方、中标方：去空白后非空、≤ 200 字（与项目里的采购方写法一致才对得上——表单提示里写明）。
- 招标编号：选填、≤ 100 字。
- 授标日期：选填、`YYYY-MM-DD`、不晚于今天（按 UTC 日期 + 1 天容差，与 CHAIN-3「在未来」同口径）。
- 合同金额：选填、数字、0 ≤ 金额 ≤ 1,000,000,000,000、最多两位小数；填了金额才认币种，币种只认 `CAD`、`USD`，缺省 `CAD`。
- 范围摘要：选填、≤ 2000 字（与授标表的服务层上限相同）。
- 校验失败 400，返回第一处错误的那句话（见 D6）；不写库。

### D5：结果、审计、事务

接口在一个事务里：调用写入服务（传事务客户端）→ 按结果写审计 `tender.award_manual_entry`（`targetType = "award_record"`、`targetId = 记录 id`、`afterData` 含结果、采购方、中标方、招标编号、APC 链接、信任级；不含金额以外的任何联系方式——表单也不收联系方式）。`ALREADY_OBSERVED` 不写审计（什么都没变）。返回 `{ outcome, record: { id, verificationStatus, status }, messageZh }`。授标情报开关关闭 → 409 `授标情报未启用` 且不访问授标表；组织不存在 / 不是成员 → 沿用 `requireOrgRole` 的 403。

### D6：文字

- 表单标题：`录入 Alberta 授标（APC）`；说明：`只录入你在 Alberta Purchasing Connection（APC）上自己看到的授标公告。系统不会打开这个链接。录入后标为「待人工复核」，组织管理员确认属实后才进入统计。`；采购方提示：`照公告原文填写；与项目里的采购方写法一致，系统才能把它们对上。`
- 结果：`已录入，等组织管理员复核。`（新建）／`已录入；和已有的一条记录可能重复，等组织管理员裁决。`（疑似重复）／`已有同一条授标（招标编号与中标方相同），这条公告链接已挂到那条记录上。`（挂到既有）／`这条公告的这个中标方已经录过了。`（重录）
- 校验：`请填写采购方。`、`请填写中标方。`、`请填写 APC 公告链接。`、`APC 公告链接要以 https://purchasing.alberta.ca/ 开头，并指向具体的公告。`、`授标日期要写成 年-月-日，且不能晚于今天。`、`合同金额要是不小于 0 的数字，最多两位小数。`、`币种只能是 CAD 或 USD。`、`{字段}太长了（最多 N 字）。`
- 列表：人工录入的记录在中标方下面写 `人工录入 · APC 公告`（链接，新窗口打开，`rel="noopener noreferrer"`）。

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
- 隔离库：`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`——成员录入 → `USER_ENTRY` / `NEEDS_REVIEW` / 链接 / 审计；重录 → 已经录过、不写审计；同编号同中标方 → 挂到既有（既有记录信任级不变）；疑似重复；`org_viewer` 403；别的组织 403；开关关 409 且不访问授标表；组织管理员确认后变 `HUMAN_CONFIRMED`；列表接口返回 `canEnterManual` 与链接；全程外部请求 0（替换 `globalThis.fetch` 计数）。
- 既有不改期望：`awards.test.ts`、`award-review-db.isolated.test.ts`、`award-intelligence` 相关测试、`sourcing-suggestions-db.isolated.test.ts`、`import-leads-db.isolated.test.ts`。
- 全量：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`。

## Risks / Trade-offs

- 采购方写法与项目里的不一致时，CHAIN-2 / CHAIN-3 对不上这条授标（按规整名找）；表单提示写明，不做模糊匹配（T3 纪律）。
- 待复核的人工录入记录会作为「本采购方的他人授标」进入 CHAIN-3 的中标者名单（那里本来就不按信任级过滤，线索契约照旧是「线索，未证实」）；数字统计要等管理员确认。
- 录入的人可能填错：组织管理员复核时可撤回（既有入口，原因必填、留痕）。
