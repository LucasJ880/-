# Design: spec-strict-hygiene

## Context

- 失败原因逐个确认（`OPENSPEC_TELEMETRY=0 openspec validate <spec-id> --type spec --strict`，2026-11-08，main 1c9ea12）：
  - `authorization/position-catalog` requirements[7]「新增权限键登记」：描述 510 字 > 500。
  - `sunny/process-order-autogen` requirements[4]「斑马帘布纱比对照表」：描述 535 字 > 500。
  - `accounting/workspace`、`inventory/fabric-stock-access`：Purpose < 50 字。
- OpenSpec 1.15.0 的两条机制决定了做法（见 `@fission-ai/openspec/dist/core/specs-apply.js` 与 `validation/validator.js`）：
  - 归档时 MODIFIED 整块替换原要求；若 MODIFIED 块少了原要求的任何场景名，`validate <change>` 报 ERROR，`archive` 直接拒绝（"current spec contains scenario(s) not present in the modified block"）。
  - 增量里的 `## Purpose` 只在目标规格不存在时生效；规格已有 Purpose 时归档只打警告"Edit … directly to change it"。
  - ADDED 与 REMOVED 不能同名（"Requirement present in both ADDED and REMOVED"）；归档顺序 RENAMED → REMOVED → MODIFIED → ADDED，ADDED 追加在要求列表末尾。
- 两条超长要求各自恰好由两句组成，每句一个行为，场景也能按句一一归属：
  - 「新增权限键登记」：第一句登记 15 个键（459 字）→ 场景「权限键可识别」；第二句 `identity.position.manage` 只允许人类主体（51 字）→ 场景「岗位管理键不开放给数字员工」。
  - 「斑马帘布纱比对照表」：第一句存储 / 种子 / 读写入口 / 保存权限 / AuditLog（398 字）→ 场景「组织隔离」「出单岗位可以保存」「无出单权限的普通成员只读」「只持其他品类出单键」；第二句按 SKU 查表口径（137 字）→ 场景「系列名命中」「未命中」。

## Goals / Non-Goals

**Goals:**
- 归档后 `openspec validate --specs --strict` 81/81 通过（现有 80 个主规格 + 新增 `qa/spec-validation`；`--all` 另含进行中的 change）。
- 拆分前后，要求原文的每个字、每条场景的每个字都还在，且各自只出现一次。

**Non-Goals:**
- `src/**`、`scripts/**`、`ci/**`、`prisma/**`、`.github/workflows/**` 任何文件。
- `openspec/specs/authorization/position-catalog/spec.md` 与 `openspec/specs/sunny/process-order-autogen/spec.md` 里除被拆的两条以外的 23 + 16 条要求。
- `openspec/changes/archive/**`（含 `2026-10-27-perm-1-positions`、`2026-10-27-sunny-zebra-ratio-fulfillment-permission` 里这两条要求的历史写法）。
- `openspec/config.yaml` 的 context / rules。
- 正在进行的 change `rfq-tracking-notify`（它的增量只涉及 `notifications/*` 与 `tender/*`，与本 change 不交叉）。

## Decisions

### D1：拆分用 REMOVED 原要求 + ADDED 两条新名要求
- 做法：每个规格的增量里 REMOVED 原要求（写明 Reason / Migration），再 ADDED 两条新名字的要求；原文按句号切开，前一句给第一条、后一句给第二条，场景整段原样搬到它所说明的那一句下面。
- 被否决：MODIFIED 原要求只保留第一句，再 ADDED 第二句——MODIFIED 必须保留原要求的全部场景，否则 `validate --strict` 报 ERROR、`archive` 拒绝；保留全部场景就会让「岗位管理键不开放给数字员工」「系列名命中」「未命中」挂在一条不再陈述它们的要求下，而 ADDED 的那条又必须有自己的场景，只能复制一份（同一场景出现两次）或新编一份（场景数增加）。
- 被否决：RENAMED + MODIFIED——归档先改名再按新名比对场景，同样不允许少场景，问题不变。
- 被否决：把超长的键清单或查表口径挪进场景来缩短描述——SHALL 要求降为示例，规范力度变了，属于改含义。
- 代价：两个原要求名消失，新要求排在各自规格末尾；全仓库只有这两个主规格把它们当要求名使用（`src/` / `docs/` 里的同名串是页面标题、注释和报告小节名）。

### D2：新要求名按它保留的那一句命名
- 做法：「岗位体系权限键登记」（这 15 个键是 PERM-1 岗位体系引入的，与目录里已有的「安装相关权限键」「运营内容权限键」等区分）、「岗位管理键只允许人类主体」、「斑马帘布纱比对照表维护」、「斑马帘布纱比查表」。
- 被否决：「新增权限键登记（一）/（二）」——名字不说明行为，以后再追加键时无从判断归哪条。
- 被否决：沿用原名给第一条——ADDED 与 REMOVED 同名会被 OpenSpec 拒绝（见 Context）。
- 已核对：四个新名与两个规格现有的 24 + 17 条要求名都不重复，也不是只差大小写 / 空格的近似名。

### D3：两个 Purpose 不进本 change 的增量与 tasks
- 做法：经维护者同意，作为一次性例外，在本 PR 里单独一个 commit 直接改 `openspec/specs/accounting/workspace/spec.md` 与 `openspec/specs/inventory/fabric-stock-access/spec.md` 的 `## Purpose` 段，只按各自现有 Requirements 如实概括，不碰任何 Requirement / Scenario。
- 被否决：在增量里写 `## Purpose`——规格已存在，归档会忽略它，问题不会被修掉。
- 被否决：写成本 change 的一条 task——`openspec/config.yaml` 规定 task 不得直接写 `openspec/specs/**`。
- 被否决：给这两个规格硬凑一条 MODIFIED 让 Purpose "顺带"进来——MODIFIED 不携带 Purpose，且等于为了过校验编造要求变更。

### D4：新增 `qa/spec-validation` 一条要求覆盖本次唯一的对外可观察结果
- 做法：本 change 的对外结果只有一个：`openspec validate --specs --strict` 的输出与退出码。按 `openspec/config.yaml` specs 规则（每个对外可观察行为——含退出码——必须有 Requirement 覆盖），新增能力 `qa/spec-validation`，场景就是两条可直接执行的命令。
- 被否决：并入 `qa/test-registry`——那是测试文件注册纪律，校验对象与命令都不同。
- 被否决：不写增量、只在 PR 描述里说明——GATE 审核项要求 specs 增量覆盖本次改动的全部对外行为。

## 八条硬纪律

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 不涉及（不改 `prisma/`、不改代码；斑马帘要求里的 `Organization.settingsJson.sunnyProcess.zebraRatios` 是原文，未改） |
| 2 | 出站先审批 | 不涉及 |
| 3 | 禁止第三套队列 | 不涉及 |
| 4 | 脱敏（决定 A） | 不涉及 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 不涉及（查表口径原文照搬，仍是确定性查表） |
| 8 | 测试注册 | 不涉及（不新增、不改名任何 `__tests__/*.test.ts`）；已注册测试不受影响，用 `npm test` 复核 |

## 验证方式

- 增量本身：`OPENSPEC_TELEMETRY=0 openspec validate spec-strict-hygiene --strict` 输出 `Change 'spec-strict-hygiene' is valid`。
- 逐字保留：对每个被拆的要求，把增量里两条 ADDED 的描述按顺序直接拼接，应与原描述逐字相等；原要求的每个场景块在增量里恰好出现一次且逐字相等（tasks 1.1 / 1.2 给出命令）。
- 行为未变：拆分涉及的场景由已注册测试覆盖——`src/lib/authorization/__tests__/authorize.test.ts`（"identity.position.manage 仅 HUMAN"、`UNKNOWN_PERMISSION` fail closed；`test-all.sh` "Security-1 Authorization"）、`src/lib/sunny-process/__tests__/zebra-ratios.test.ts`（种子 / 匹配 / 查表）、`src/lib/sunny-process/__tests__/autogen-db.isolated.test.ts` 第 [5b] 段。本 change 不改它们，`npm test` 结果应与改前基线相同。
- 最终结果：归档 PR 合并后 `OPENSPEC_TELEMETRY=0 openspec validate --specs --strict` 全部 ✓、退出码 0（`qa/spec-validation` 两条场景）。

## Risks / Trade-offs

- [归档后新要求排到规格末尾，阅读顺序和原来不同] → 只影响阅读顺序，不影响含义；REMOVED 的 Migration 写明了每句、每个场景的去向。
- [本 PR 合并后、归档 PR 合并前，main 上 strict 仍有 2 项失败（两条超长要求）] → 按仓库约定 archive 只能在 PR 合并后另开小 PR；Purpose 的 2 项在本 PR 里就修掉，合并后 `--specs --strict` 为 78/80。
- [以后的 change 再写出超长要求或过短 Purpose] → `qa/spec-validation` 写明了纪律；是否把这条命令接进 CI 不在本 change 范围（proposal Out of scope）。

## Migration Plan

1. 本 PR：change 四件套 + 两个 Purpose 的直接修订（单独 commit）。
2. 合并后：`/opsx:archive spec-strict-hygiene --yes`，独立小 PR；该 PR 里复跑 `openspec validate --specs --strict` 应全部通过。
3. 回滚：revert 归档 PR 即恢复原要求；本 change 不涉及代码与数据。
