# Design：主规格 `validate --specs --strict` 归零

## Context

动机见 proposal.md「Why」。这里只写决定做法所需的现状。

- 五个失败都是告警级：`openspec validate <spec> --type spec`（不带 `--strict`）对五份规格都输出 valid。没有结构性缺陷（缺 Scenario、缺 SHALL、空小节等）。
- 两条阈值写死在 `@fission-ai/openspec@1.15.0` 里：Purpose 少于 50 字符、Requirement 正文（标题行到第一个 Scenario 之间）多于 500 字符。按字符计，不分语言。
- OpenSpec 1.15.0 归档时的两条约束决定了 delta 的写法：
  - MODIFIED 块不得少于主规格里该条现有的场景，否则 `validate <change>` 报 ERROR、`archive` 中止。所以"拆一条 Requirement 并把场景分走"只能写成 REMOVED 原条 + ADDED 新条，新条必须换名（同名同时出现在 REMOVED 与 ADDED 会被拒）。
  - 已有规格的 Purpose 不接受 delta：delta 里的 `## Purpose` 只在规格不存在时用来建新规格，否则被忽略并提示"Edit `<spec>` directly to change it"。
- `vis-1c-notify-settings-search`（LucasJ880/-#410，已合并未归档）的 `specs/cockpit/posts-overview/spec.md` 已经用 REMOVED + 4 条 ADDED 拆了 1395 字的那条。

## Goals / Non-Goals

**Goals:**

- 三项动作（本 change 归档、`vis-1c-notify-settings-search` 归档、D3 的两行 Purpose）齐备后，`openspec validate --specs --strict` 为 0 失败。
- 规格描述的行为一字不变：不增加、不放宽、不收紧任何规范性语句。

**Non-Goals:**

- 不改 `src/**`、`scripts/**`、`prisma/**`、`ci/**`、`docs/**`、`openspec/config.yaml`、`.claude/launch.json`。
- 不改 `openspec/specs/cockpit/posts-overview/spec.md`，不替 `vis-1c-notify-settings-search` 归档。
- 不动 `openspec/specs/**` 里除下列之外的任何 Requirement：`authorization/position-catalog`「新增权限键登记」、`sunny/process-order-autogen`「斑马帘布纱比对照表」。
- 不新增 `scripts/` 校验脚本，不改 `.github/workflows/**`。

## Decisions

### D1 `authorization/position-catalog`「新增权限键登记」：重复句换成引用，场景不动

正文 510 字，超 10 字。末句"`identity.position.manage` SHALL 只允许人类主体，不允许数字员工主体。"与同一份规格的「数字员工禁区键登记」重复（后者规定"所有 `identity.*`"的允许主体类型只有 `HUMAN`）。把末句换成"各键允许的主体类型见「数字员工禁区键登记」。"，正文 481 字。两个场景（「权限键可识别」「岗位管理键不开放给数字员工」）留在原条下，后一个的规范依据由引用指向。

- 否决：把场景「岗位管理键不开放给数字员工」移到「数字员工禁区键登记」。OpenSpec 不允许 MODIFIED 块少场景，要移就得把「新增权限键登记」改名重建，为 10 个字动两条 Requirement，改动面大于问题本身。
- 否决：只删"，不允许数字员工主体"（正好 500 字，`> 500` 才告警）。卡在阈值上，下次往键清单里加一个键就再次失败。
- 否决：新增一条「岗位管理键只允许人类主体」。与「数字员工禁区键登记」第三次陈述同一件事。

### D2 `sunny/process-order-autogen`「斑马帘布纱比对照表」：按两件事拆成两条

正文 535 字，写了两件事：对照表本身（存放位置、种子、读写接口、保存权限、审计）与取值规则（生成工艺单 / 退回自产时怎样按 SKU 查表、未命中默认值）。拆成：

| 新条 | 正文 | 场景 |
|---|---|---|
| 「斑马帘布纱比对照表的维护」 | 原正文第一句，逐字不改（398 字） | 组织隔离、出单岗位可以保存、无出单权限的普通成员只读、只持其他品类出单键 |
| 「斑马帘按对照表取布纱比」 | 原正文第二句，"查表"写成"查组织的布纱比对照表（见「斑马帘布纱比对照表的维护」）"（162 字） | 系列名命中、未命中 |

场景文字逐字不改，只有一处例外：「系列名命中」写明测试命令 `npx tsx src/lib/sunny-process/__tests__/zebra-ratios.test.ts`、「未命中」标"同一测试覆盖"。该测试的 ZR-05a/b/c 断言的正是这两个场景的数值与提示文案（命中 3.25 : 2.1875 且提示含"对照表「AQUAWIDE3」"，未命中 3 : 2 且提示含"不在布纱比对照表里"），已在 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` 注册。写法与 `vis-1c-notify-settings-search` 拆条时"每条的首个场景写明测试命令"一致。

原条名「斑马帘布纱比对照表」随 REMOVED 消失。除归档目录外，仓库里没有任何规格、文档或代码按 Requirement 名引用它（`grep -rn "「斑马帘布纱比对照表」"` 只命中本 change）。

- 否决：保留原条名，MODIFIED 留全部 6 个场景，另加一条取值规则并为它新写场景。「系列名命中」「未命中」会留在只讲"表的维护"的那条下，场景与正文对不上；还要凭空新增场景，超出"只修文字"。
- 否决：只删正文里的说明性括注"（出单·Roller/Zebra/Roman 岗位；斑马帘属 shades 品类）"（约 498 字）。同样卡在阈值上，且一条里仍写两件事。
- 否决：把保存权限的四个放行条件挪进场景。403 的判定条件会只剩例子、没有规范性语句。

### D3 两条 Purpose：归档 PR 里按下列原文替换，需 Owner 批准

delta 改不了已有规格的 Purpose（见 Context），所以这两处没有"经 change 归档进来"的路径。可行的做法只有在归档 PR 里直接改这两行。仓库有先例：归档提交里为新规格补 Purpose 一直是手写的（如 `50407a3`「新规格 cockpit/post-daily-digest 补 Purpose」），但改**已有**规格的 Purpose 没有先例，且字面上碰了"`openspec/specs/**` 禁止手写"，因此列为待批准项，原文放在这里先审：

| 规格 | 现 Purpose | 拟用 Purpose |
|---|---|---|
| `accounting/workspace` | 会计页面 `/accounting` 的入口：谁能看到导航、谁默认落地在这里、页签怎样按权限显示。（49 字） | 会计页面 `/accounting` 的入口：谁能看到导航里的"会计视图"、谁默认落地在这里、四个页签怎样按权限显示，以及 URL 参数 `tab` 怎样直达页签。（82 字） |
| `inventory/fabric-stock-access` | 面料库存的读写权限：运营主管管库存，其他岗位只读；每次码数变动可追溯。（35 字） | 面料库存的读写权限：运营主管管库存（新增面料、调整码数、改安全线 / 成本 / 基础信息需 `inventory.manage`），其他岗位凭 `inventory.read` 只读；每次码数变动留库存流水与审计记录，可追溯。（113 字） |

拟用文本只展开该规格现有 Requirement 已写明的内容，不引入新说法。

- 备选（Owner 可选）：两条都不改，留着失败。理由成立的部分：这是校验器的口径问题而不是规格缺陷——50 字符的下限不分语言，49 个与 35 个汉字都已是说清范围的完整句子，其中一条只差 1 字。否决它作为推荐做法的理由：留两条常驻失败，`validate --specs --strict` 的退出码永远非 0，不能当 GATE，本 change 的目的落空。
- 否决：REMOVED 全部 Requirement 后以新路径重建规格来带入新 Purpose。能力路径改名，`cockpit/posts-overview` 等处对 `/accounting` 落点的描述和归档历史都要跟着改。

### D4 `cockpit/posts-overview`：不重复拆，等 `vis-1c-notify-settings-search` 归档

该 change 的 delta 已 REMOVED 这条 1395 字的 Requirement 并 ADDED 四条（各自 ≤ 500 字）。模拟归档它之后，`validate --specs --strict` 的失败从 5 个降到 4 个，`cockpit/posts-overview` 不再出现。

- 否决：在本 change 里再拆一次。两个 change 对同一条 Requirement 各写一份 REMOVED + ADDED，后归档的那个会因原条已不存在、新条已存在而失败。

### 与八条硬纪律的关系

1. 零 schema：不涉及（不碰 `prisma/`）。
2. 出站先审批：不涉及（无代码改动）。规格里"保存记 AuditLog""否则 403"等语句逐字保留。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及（两份规格都不含敏感字段输出）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：不涉及。
8. 测试注册：不新增、不改名测试文件；D2 引用的 `zebra-ratios.test.ts` 已注册，`bash scripts/check-test-registry.sh` 结果不变。

另：工作约定"`openspec/specs/**` 只能通过 `/opsx:archive` 归档进来"——D1、D2 走 delta，遵守；D3 是例外申请，见上。

### 验证方式

1. `openspec validate specs-strict-validate-cleanup --strict` → `Change 'specs-strict-validate-cleanup' is valid`，退出码 0。
2. 模拟归档（在临时目录，不动仓库）：把 `openspec/` 整个复制到临时目录，在那里依次执行 `openspec archive specs-strict-validate-cleanup --yes`、`openspec archive vis-1c-notify-settings-search --yes`，再把 D3 两行 Purpose 换成上表原文，然后 `openspec validate --specs --strict`。期望逐步为 3 失败 → 2 失败 → `0 failed`。提案阶段已跑过一遍：main 上 94 项 0 失败；以 LucasJ880/-#421 分支的 `openspec/` 为底再跑一遍，103 项 0 失败。
3. 行为不变核对：对比模拟归档前后的两份主规格——`authorization/position-catalog` 只有「新增权限键登记」正文一行不同，Requirement 25 条、场景 53 个不变；`sunny/process-order-autogen` Requirement 17 → 18 条、场景 30 个不变，新两条的正文与场景除 D2 列明的两处外与原条逐字相同。
4. `npx tsx src/lib/sunny-process/__tests__/zebra-ratios.test.ts` 与 `npx tsx src/lib/authorization/__tests__/authorize.test.ts` 通过（证明场景里写的测试命令可直接执行）。

## Risks / Trade-offs

- [归档前别的 change 改了同一条 Requirement] → 现有 10 个待归档 change 都不碰 `authorization/position-catalog` 与 `sunny/process-order-autogen`（已逐个查过 `specs/` 目录）；归档前再跑一次验证方式 2。
- [ADDED 的两条会排到 `sunny/process-order-autogen` 的 Requirements 末尾，不在原条的位置] → 只影响阅读顺序；两条互相写了引用。
- [「斑马帘布纱比对照表」这个 Requirement 名消失] → 仓库内无按名引用（见 D2）；归档目录里的历史 delta 不受影响。
- [D3 开了"手改已有规格"的口子] → 只限这两行 Purpose、只限原文已在本文件审过的文本；不批准就不改，并保留 D3 的留存说明。
- [`vis-1c-notify-settings-search` 迟迟不归档] → `cockpit/posts-overview` 继续失败，与本 change 无关；归零条件在 proposal「Impact」里写明了三项。

## Migration Plan

本 change 的 PR 只含 `openspec/changes/specs-strict-validate-cleanup/**`，合并后对主规格没有任何影响。归档（独立小 PR）时规格才变；回滚 = revert 归档 PR。归档先后与 `vis-1c-notify-settings-search`、LucasJ880/-#421 互不依赖（三者改的 Requirement 互不重叠）。
