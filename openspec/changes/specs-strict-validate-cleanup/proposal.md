# Proposal：主规格 `validate --specs --strict` 归零

TASKFLOW：无（基础设施）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

`openspec validate --specs --strict` 在 main 上报 5 个失败，全部是 strict 把告警升级成失败（非 strict 下五份规格都 valid）：两份 Purpose 不足 50 字，三条 Requirement 正文超过 500 字。这条命令不归零就不能当 GATE 用，新的告警会被旧的五条盖住。

## What Changes

逐份原因与处理（校验器阈值 `MIN_PURPOSE_LENGTH = 50`、`MAX_REQUIREMENT_TEXT_LENGTH = 500`，按字符数计）：

| 规格 | 原因 | 处理 |
|---|---|---|
| `authorization/position-catalog` | 「新增权限键登记」正文 510 字 | 本 change 的 delta |
| `sunny/process-order-autogen` | 「斑马帘布纱比对照表」正文 535 字 | 本 change 的 delta |
| `accounting/workspace` | Purpose 49 字 | delta 改不了已有规格的 Purpose；归档 PR 里按 design D3 原文替换，需 Owner 批准 |
| `inventory/fabric-stock-access` | Purpose 35 字 | 同上 |
| `cockpit/posts-overview` | 「等你 N 件按现成"待我审批"口径并与需要你去重」正文 1395 字 | 本 change 不碰：已合并未归档的 `vis-1c-notify-settings-search`（LucasJ880/-#410）已把它拆成四条，归档该 change 后消失 |

- 把 `authorization/position-catalog`「新增权限键登记」正文末句"`identity.position.manage` SHALL 只允许人类主体，不允许数字员工主体。"换成指向「数字员工禁区键登记」的一句引用（该条已规定所有 `identity.*` 只允许 `HUMAN`），正文 510 → 481 字；两个场景原样保留。
- 把 `sunny/process-order-autogen`「斑马帘布纱比对照表」按它写的两件事拆成两条并移除原条：「斑马帘布纱比对照表的维护」（存放、种子、读写接口、保存权限、审计；398 字、4 个场景）与「斑马帘按对照表取布纱比」（生成工艺单与退回自产时怎样查表；162 字、2 个场景）。
- 归档 PR 里把 `accounting/workspace`、`inventory/fabric-stock-access` 的 Purpose 换成 design D3 给出的原文（82 字、113 字）。这是本 change 唯一不经 delta 的规格改动；Owner 不批准则这两份保持失败，以 design D3 的说明为留存理由。
- 不改任何行为：两份规格的场景总数前后相同（53、30），规范性语句只搬位置或换成引用，不增不减。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `authorization/position-catalog`：「新增权限键登记」末句由重复陈述改为引用「数字员工禁区键登记」。
- `sunny/process-order-autogen`：「斑马帘布纱比对照表」拆成「斑马帘布纱比对照表的维护」与「斑马帘按对照表取布纱比」。

## Out of scope

- 不改 `src/`、`scripts/`、`prisma/`、`docs/`、`ci/` 下任何文件；不新增、不改名、不删除测试。
- 不动 `cockpit/posts-overview`；不在本 change 里归档 `vis-1c-notify-settings-search` 或其它待归档 change（各走各的归档 PR）。
- 不把 `openspec validate --specs --strict` 接进 CI。
- 不改其它接近阈值但未超的 Requirement（如 `authorization/position-catalog`「出单岗位权限」488 字）。
- 不改 `openspec/config.yaml`。

## Impact

- 规格：归档后 `authorization/position-catalog` 一条 Requirement 改一句（25 条不变）；`sunny/process-order-autogen` 移除一条、新增两条（17 → 18 条）。D3 获批时另有两份规格各改一行 Purpose。
- 代码、测试、依赖、schema、环境变量、部署：不变。
- 归零条件：本 change 归档、`vis-1c-notify-settings-search` 归档、D3 获批，三者齐备后 `openspec validate --specs --strict` 为 0 失败。design「验证方式」的模拟归档已得到这个结果（main 上 94 项 0 失败；叠加待合并的招投标归档 LucasJ880/-#421 后 103 项 0 失败）。
