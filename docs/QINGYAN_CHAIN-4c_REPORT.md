# CHAIN-4c 报告 — 拆短 `tender/rfq-web-entry`「原地审批与待批轮次保护」（`rfq-web-entry-spec-split`）

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-4c（Phase F（续）— 情报串联的后续；新起的编号，任务书里没有） |
| 起因 | 交接文档第四十四次 §0.5h「之后还有什么」第 4 条：主规格 `tender/rfq-web-entry` 一条要求正文 522 字，`openspec validate --specs --strict` 143 过 1 不过（只有这一条） |
| 拍板 | Lucas 2026-11-20：「拆短 tender/rfq-web-entry 里 522 字的那条要求，让 openspec validate --strict 对这份规格通过，不改行为。」 |
| OpenSpec change | `openspec/changes/rfq-web-entry-spec-split/`（`tender/rfq-web-entry`：REMOVED 1 条、ADDED 2 条） |
| 基线 | origin/main `91d928e4` |
| PR | #533，2026-11-23 合并（合并提交 `07c02358`）；归档 `openspec/changes/archive/2026-11-23-rfq-web-entry-spec-split/`；归档后 `openspec validate --specs --strict` 147 / 147 |
| 开关 | 不涉及（只改规格，不改代码、测试、界面文字） |

## 1. 做了什么

| | 以前 | 归档后 |
|---|---|---|
| 要求 | 「原地审批与待批轮次保护」正文 522 字（W-1 写的 351 字 + CHAIN-4a 加的 171 字例外），5 个场景 | 「询价卡的原地审批与待批轮次保护」390 字（原 351 字逐字不变 + 一句不含 SHALL 的指引 39 字），4 个场景；「询价单 PDF 对不上时只给驳回」198 字（原例外句，开头补两处），1 个场景 |
| `openspec validate tender/rfq-web-entry --type spec --strict` | 失败（`requirements[5]` 超过 500 字） | valid |
| `openspec validate --specs --strict` | 143 过 1 不过 | 144 / 144（演练基线 `91d928e4`；2026-11-23 在 `07c02358` 上实际归档后 147 / 147） |
| 本规格要求 / 场景 / SHALL / SHALL NOT | 13 / 35 / 52 / 17 | 14 / 35 / 52 / 17 |

为什么是 REMOVED + ADDED 而不是 MODIFIED（design D2）：OpenSpec 1.15 不允许 MODIFIED 丢掉现有场景，也不允许同一个名字既在 REMOVED 又在 ADDED（两条都实测过）。所以原条换名为「询价卡的原地审批与待批轮次保护」（只在前面加「询价卡的」）。

与原文的差别只有三处，都不改含义：

1. 新例外条开头「例外（CHAIN-4a）：卡带……」补为「本条是「询价卡的原地审批与待批轮次保护」的例外（CHAIN-4a）：待批的发询价卡带……」——写明是哪一条的例外；「待批的发询价」补全主语（催单卡本来不带附件，待批以外的卡本来没有决策按钮；与 `web-entry-approval.ts` 只对待批卡核对附件、`rfq-approval-panel.tsx` 催单卡不看附件、`tender/rfq-supplier-attachment`「读带附件、状态为待批的发询价卡时」一致）。
2. 原条末尾加一句指引「带询价单 PDF 的卡对不上时的例外，见「询价单 PDF 对不上时只给驳回」。」——不含 SHALL，单独读原条也知道有例外。
3. 两条 ADDED 由 CLI 追加在规格末尾（第 13、14 条）；要求之间没有按位置的引用。

## 2. 等价核对

脚本（一次性，不入库；在仓库根目录、归档前运行）：

```python
import re,sys
main=open("openspec/specs/tender/rfq-web-entry/spec.md",encoding="utf-8").read()
delta=open("openspec/changes/rfq-web-entry-spec-split/specs/tender/rfq-web-entry/spec.md",encoding="utf-8").read()
def blocks(s):
    out={}
    for b in re.split(r'(?m)^(?=### Requirement: )',s)[1:]:
        b=re.split(r'(?m)^## ',b)[0].rstrip("\n")
        head=b.split("\n")[0][len("### Requirement: "):]
        rest=b.split("\n",1)[1]
        body=rest.split("\n#### ")[0].strip()
        scen=["#### "+x.strip() for x in rest.split("\n#### ")[1:]]
        out[head]=(body,scen)
    return out
M=blocks(main); D=blocks(delta.split("## ADDED Requirements")[1])
ob,os_=M["原地审批与待批轮次保护"]
nb,ns=D["询价卡的原地审批与待批轮次保护"]; pb,ps=D["询价单 PDF 对不上时只给驳回"]
EXC_OLD="例外（CHAIN-4a）：卡带询价单 PDF"
EXC_NEW="本条是「询价卡的原地审批与待批轮次保护」的例外（CHAIN-4a）：待批的发询价卡带询价单 PDF"
BACK="带询价单 PDF 的卡对不上时的例外，见「询价单 PDF 对不上时只给驳回」。"
i=ob.index(EXC_OLD); j=ob.index("「卡上提前说附件已变」。",i)+len("「卡上提前说附件已变」。")
exc=ob[i:j]; rest=ob[:i]+ob[j:]
r1 = (nb == rest+BACK)
r2 = (pb == exc.replace(EXC_OLD,EXC_NEW,1))
r3 = (os_ == ns+ps or sorted(os_)==sorted(ns+ps))
print("原条正文 =", len(ob), "；新原条 =", len(nb), "；新例外 =", len(pb))
print("新原条 = 原条去例外 + 指引：", r1)
print("新例外 = 原例外句（开头补两处）：", r2)
print("场景 5 = 4 + 1 且逐字相同：", r3, len(os_), len(ns), len(ps))
sys.exit(0 if (r1 and r2 and r3 and len(nb)<=500 and len(pb)<=500) else 1)
```

输出：

```
原条正文 = 522 ；新原条 = 390 ；新例外 = 198
新原条 = 原条去例外 + 指引： True
新例外 = 原例外句（开头补两处）： True
场景 5 = 4 + 1 且逐字相同： True 5 4 1
```

**归档演练**（临时 worktree，跑完已删）：`openspec archive rfq-web-entry-spec-split --yes` 输出 `+ 2 added, - 1 removed`；前后 diff 只有原条被删、两条追加到末尾；之后 `validate tender/rfq-web-entry --type spec --strict` valid、`validate --specs --strict` 144 / 144。另一个审查子 agent 独立复核：SHALL 52 → 52、SHALL NOT 17 → 17、场景 35 → 35。

**引用**：`openspec/specs/**` 里没有别处引用旧名；归档目录之外只有 `docs/QINGYAN_TENDER_FLOW_HANDOFF.md` §0.5h 那句（旧名、「第 6 条」、「超过 500 字」、「143 过 1」都会过时）——**归档 PR 要改**（tasks 4.2、design D2）。场景引用的测试：`web-entry-pure.test.ts` 162、`attachment.test.ts` 65 通过；隔离库 `attachment-db` 在全量里通过。

## 3. 门禁

| 项 | 结果 |
|---|---|
| `npm test`（本机，带隔离库） | `702/712 通过, 10 失败`，10 项全是 main 上同样失败的既有项（`docs/QINGYAN_CHAIN-3_REPORT.md` §4 那 11 项里，这一轮 Mention Gateway M2-A 过了）。本 change 不改代码，结果与 main 相同 |
| `npm run test:ci`（不带数据库，与 CI 相同） | PASS（注册校验：已注册 679 个，历史欠账 66 条） |
| `npm run typecheck` / `npm run lint:baseline` | 不改代码；与 main 相同 |
| `openspec validate rfq-web-entry-spec-split --strict` | valid |
| `git diff origin/main --stat` | 只有 `openspec/changes/rfq-web-entry-spec-split/**`、本报告与 TASKFLOW 一行 |

## 4. 多维审查

**开工前（一个子 agent，只给四件套与主规格）**——并入四件套（`a3fa5267`）：原条加一句指引（单独读也知道有例外）；新条写「待批的发询价卡」；D1 / D3 补备选与理由（含「不拆、只挪引用到场景、472 字」的备选 C，否决理由：Lucas 要拆短、只剩 28 字余量）。

**开 PR 前（两个子 agent，各审一个维度）**：

| 维度 | 意见 | 处理 |
|---|---|---|
| 规格等价与 OpenSpec 机制 | 逐句等价（规范性内容不增不减）、两条各自能单独读、没有别处引用旧名、归档演练 144 / 144 | — |
| | design 里指引句写 38 字，实际 39 字 | **已改** |
| | 标题「询价卡」与正文「发询价卡」用词不一，可改为「发询价卡的……」 | 不改：这条也管草稿轮次的按钮，不只管发询价卡；「询价卡」是面板上的叫法 |
| | 挪到了规格末尾 | 不改：CLI 只会追加；design Risks 已写 |
| 产物质量与流程 / 文档一致性 | design 说 351 字是 RFQ-AUTO 写的，实际是 W-1 `rfq-web-entry` | **已改** |
| | proposal Impact 说只改 change 目录，与 tasks 要写报告、改 TASKFLOW 矛盾 | **已改** |
| | 差异口径 design 写「补的主语」、tasks 写三处；脚本不入库没法重跑 | **已改**：统一为三处；脚本全文贴在 §2 |
| | 「## 八条硬纪律」不合惯例；proposal 说「其它规格接近 500 字」举的却是本规格；What 第 1 条与第 2、3 条重复；「只有交接文档引用旧名」漏了归档目录 | **已改** |
| | 根因没修：`validate <change> --strict` 不查 MODIFIED 后整条的长度，CI 不跑 `validate --specs --strict` | 不在本次：列为后续（§5 第 1 条） |
| | CHAIN-4c 是新起的编号 | 照实写在页头 |

## 5. 后续

1. **把 `npx openspec validate --specs --strict` 加进 CI**（`scripts/test-ci-unit.sh` 或 CI 工作流）：change 级 `--strict` 不查 MODIFIED 后整条的长度，下一个 MODIFIED 碰到贴边的要求（`tender/import-leads` 498 / 497、`cockpit/company-log` 496、`revenue-spine/fde-v2-readiness` 492、`sales/period-summary` 491）还会把主规格弄超。另立小 change。
2. 归档 PR：改交接文档 §0.5h 那句（见 §2）；TASKFLOW 这一行改 `[x]`。
