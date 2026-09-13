# QYANE Supplier Intelligence M1 — S3-B 切片 2：供应商产品 / 资质 / 证据工作台（UI）

> 继续 PR #210（base = main）。零 schema / 零 migration。S4 未开始。
> 本报告刻意区分四件事：**Slice 1 已有的后端**、**Slice 2 新增的 UI**、**什么是 CLAIMED / 什么才是 VERIFIED**、**什么只是资料状态、什么留给 S4**。

---

## 0. 基线（执行前 fetch 核实）

| 项 | 值 |
| --- | --- |
| S3-A | MERGED，`7261388a3dbadfc53caaae94e884ead6d728cf94`（main） |
| #210 base | `main`（已不再指向 S3-A 分支） |
| #210 起点 | `56cfa6f73659d603cc42afa4b8c914e3ed0c6df9`（只含 Slice 1 差量，10 个文件） |
| main drift（自 S3-A 合并后） | 无 |

> 诚实记录：09-11 那轮 Slice 2 后端加固曾做到 typecheck 通过但**未提交**，scratchpad worktree 随后被临时目录清理器删除，改动丢失。本轮按同一设计重做，并改为**按里程碑提交推送**（后端加固 → UI → 测试与报告），不再让未提交的工作暴露在清理器面前。

## 1. Slice 1 已有的后端（本轮不重建，只消费）

`supplier-capability-view.ts` + 六条 HTTP：

```text
GET   /suppliers/[id]/capability                    聚合只读视图
POST  /suppliers/[id]/offerings                     新建可供产品（sourceKind 恒 MANUAL）
PATCH /suppliers/[id]/offerings/[offeringId]        更新工作层字段
POST  /suppliers/[id]/certifications                登记资质（恒 CLAIMED）
PATCH /suppliers/[id]/certifications/[certId]       verify / reject / expire
POST  /suppliers/[id]/capability-signals            记录能力声明（须有出处）
```

没有新建 `SupplierProductV2 / SupplierEvidenceV2 / VendorCertification / TenderSupplierProduct` 之类平行模型。UI 消费的就是这六条。

## 2. Slice 2 新增 —— 先堵 Slice 1 的四条缝（后端）

在给 UI 开面之前，读 Slice 1 代码时发现四个问题；都在 `eaa759fd` 修掉并各有断言：

| # | 缝 | 修法 | 断言 |
| --- | --- | --- | --- |
| 1 | **供应商页成为项目情报的后门**：视图把「所有已归属到这家的线索」连标题列出，没过项目可见性，无该项目权限的 org 成员可借供应商页读到线索标题与能力内容 | 线索与挂其上的能力证据一律按 `buildSignalListScopeFilter`（S2 同一套批量可见性）过滤；另按写权限集合给出 `canAttachCapability` | S2-1a–i |
| 2 | **产品编辑静默覆盖同事改动** | `updateOffering` 以 `updatedAt` 作版本号做乐观并发（列已存在，零 schema）；命中 0 行 → `STALE_WRITE` 409；HTTP 面强制带 `expectedUpdatedAt`，不带 400 | S2-3a–j |
| 3 | **借 A 的 URL 改 B 的记录** | offering PATCH / certification PATCH 校验记录属于 URL 里的供应商；登记时的 `sourceSignalId` 必须是自己读得到的线索 | S2-4a–d、S2-5a–f |
| 4 | **拿看不见的项目里的档案来核验** | verify 前对 `archiveItemId` 补项目读权限门（服务层只校验 org 归属） | S2-6a–d |

同时新增只读选择器 `GET /projects/[id]/archive-evidence`：非官方登记库来源的资质**只能凭一份项目档案**核验（S1 冻结口径），没有选择器这类资质在界面上永远核验不了。

### 2.1 浏览器验收抓到、DB 测试抓不到的一个 UI bug

第一次跑浏览器验收时 F3l 失败：核验面板的档案列表永远转圈，但直接调选择器接口是 200 且有数据。
原因在 `VerifyPanel` 的 effect：同时用了「已加载」ref 和 `alive` 标志。React StrictMode（dev）把 effect 跑两遍——
第一遍刚发出请求就被清理（`alive=false`），第二遍被 ref 挡住直接返回，于是回来的响应没人接。
去掉 ref 守卫、只靠 `alive` 标志后修复。DB/HTTP 测试直接调路由，永远看不见这一层；这就是为什么浏览器验收不能省。

### 2.2 一次环境抖动暴露的页面脆弱点

第三次跑验收时 F8 失败：返回链接不见了。dev 日志里是隔离 Neon 分支两次 **P1001「无法连接数据库」**——
计算节点瞬时不可达，下一次请求就恢复了。这是环境问题，不是代码问题；但它暴露了页面的一个真问题：
写入成功后紧接着的读回失败，`load()` 直接把整页切成 fatal 态，用户刚填好的产品页整个消失。

修法：已经加载出页面之后再刷新失败，只在顶部提示「刷新失败，显示的可能不是最新内容」并给重试，
**不清空页面**；只有权限 / 不存在 / 未启用这三种确定性结论才走 fatal。
验收脚本的 API 读回相应地对 5xx 重试（最多 3 次），4xx 一律不重试——权限与校验的结论必须如实。

## 3. Slice 2 新增 —— UI

唯一 canonical 页：`/projects/intelligence/supply-chain/supplier?supplierId=…`（`f495498b`）。

### 3.1 两个真实入口，同一个终点

| 入口 | 携带 | 页面上的语义 |
| --- | --- | --- |
| S3-A 线索抽屉，LINKED 后 | `supplierId + projectId + signalId` | 「该线索已人工关联到此供应商（这是身份归属，不代表已认证）」 |
| 搜索记录 → 内部候选 | `supplierId + projectId + searchRunId` | 「内部候选来源：历史 / 已存 / 企业记忆——是『值得看看』，不是系统推荐」 |

URL 参数只表达「从哪来」。**是否属实由服务端核实后回传**（`entryContext`）：伪造一个未关联的 `signalId`，页面不会显示「已关联」（S2-2f、浏览器 B10）。

### 3.2 顶部与项目上下文

供应商名称 / 「当前用于：项目」/ 身份状态「已人工关联的供应商记录」/ 返回采购工作台。
明写一句：**身份关联 ≠ 已认证 ≠ 本标合规**。供应商仍是 org 级资源，没有把 Offering 复制成项目行；项目上下文只用于返回、判断线索权限、和后续 S4 匹配。

### 3.3 四个页签

**可供产品** — Supplier ≠ Product。登记 / 查看 / 编辑：名称、型号、类别、规格（键: 值）、MOQ、交期、单价、币种、价格状态、贸易术语、资料链接、可选「从哪条线索登记」。
- 缺价合法：价格状态默认「待确认」，单价留空可保存，卡片显示**「价格待确认」**，绝不显示「资料不完整，无法保存」。
- 来源诚实：**没有** sourceKind 下拉；卡片显示「人工登记」（服务端固定）。
- 编辑带版本号；被同事改过 → 409 → 提示「已被其他同事更新，请刷新」并给刷新按钮，**不静默覆盖**。历史 Candidate 的 `offeringSnapshotJson` 不受影响（S1 T11-C/D/E 已覆盖）。

**认证与资质** — 三件事分开：厂家声称有证书 ≠ 证书资料已归档 ≠ 证书已核验。
- 登记**永远**得到「厂家声称 / 待核验」；表单上明写「没有任何登记选项能直接得到『已核验』」；请求里硬塞 `status=VERIFIED` 落库仍是 CLAIMED。
- 核验面板：必须选**项目档案**（选择器）或填**官方登记库链接**（仅来源为登记库时可用）；未选依据时提交按钮禁用；无依据 → 422 → 「无法标记为已核验：缺少独立核验依据」。
- 四态文案：CLAIMED「厂家声称 / 待核验」、VERIFIED「已独立核验」、REJECTED「核验未通过」、EXPIRED「已过期 / 不再有效」——**文字为主，颜色只是辅助**。
- VERIFIED 的卡片显示**「核验依据：」**（档案标题，或可点的登记库链接）；看不见所属项目的成员只看到「项目档案（无权查看）」。
- **按日期已过期**：存的状态是 VERIFIED、日期已过 → 状态文案变成「已独立核验（按日期已过期）」并加徽标；**GET 不写库**。

**能力证据** — 能力必须有出处。
- 录入必须从「已关联到这家、且自己对其所属项目有写权限」的线索里选出处；无权限的线索在下拉里禁用。
- 证据程度只有「厂家声称 / 有人看到过 / 不确定」，**没有「已独立核验」可选**；API 直接传 VERIFIED → 422。
- 每条卡片：类型、内容、证据程度、人工/AI 辅助、置信度、出处线索 + 平台 + 来源链接 + 原文摘录。

**资料缺口** — 见 §5。

## 4. 什么是 CLAIMED、什么才是 VERIFIED

| | 谁写 | 需要什么 | 界面文案 |
| --- | --- | --- | --- |
| **CLAIMED** | 任何登记入口（社媒 / 官网 / 画册 / 人工登记 / 登记库来源都一样） | 无 | 厂家声称 / 待核验 |
| **VERIFIED** | 只有 `verify` 动作 | 本 org **且自己读得到的项目**里的一份档案，或受支持官方登记库的 https 链接 | 已独立核验 + 核验依据 |

「证书资料已上传」（档案存在）本身**不是** VERIFIED：档案只是可以拿来核验的材料，核验仍是人点的、并记录依据与备注。

## 5. 什么只是「资料状态」（不是评分）

`computeInformationCompleteness()`（纯函数，CI 单测）只回答「记了什么、还缺什么」，输出九行，每行只有六种**事实状态**之一：

```text
已记录 / 部分 / 待确认 / 未记录 / 厂家声称 / 已核验
```

产品型号、产品规格、价格、MOQ、交期、认证、认证核验、来源线索、能力声明。

没有 0–100、没有红黄绿、没有合格率、没有排名、没有 Tender Fit。页面上明写「不是评分，不是合规判定」。测试断言文案里不出现「合格 / 评分 / 得分 / 排名 / %」。**S4 才使用冻结的 supplier-score-v1（40/25/20/15）**。

## 6. 权限（Slice 1 规则保持，Slice 2 补齐）

- 供应商 = org 级：本 org 活跃成员可读可写；跨 org 404 且零业务内容。
- **供应商门不替代项目门**：能力证据挂在项目范围的线索上，org 成员无该项目写权限 → 403；界面上该出处被禁用，但真正的拦截在服务端。
- 线索可见性、档案证据、登记出处三处都走项目读门（§2）。

## 7. 审计

| 写路径 | 审计 |
| --- | --- |
| 资质 verify | 有（S1 既有 `CERTIFICATION_VERIFIED`，本轮不退化） |
| 资质登记 / reject / expire、产品新建 / 编辑、能力声明 | **DEFERRED** —— S1 service 未写 Supplier Intelligence 专属审计；本轮按任务书不临时创造第二套 audit framework |
| Supplier create 本身 | DEFERRED（S3-A 已知） |

## 8. 留给 S4 / 明确不做

SupplierRequirementMatch、Mandatory Gate、supplier-score-v1 评分、PRIMARY / BACKUP / NOT_ELIGIBLE、自动 shortlist、自动采购决策、RFQ、邮件 / 微信询价、PO、付款、landed cost、自动写 Corporate Memory、Offering 批量导入、Certification 到期自动提醒、新 schema。

## 9. 验证

全部在 **merge 了 main 之后的代码头** `e845ea4c` 上执行（见 §10 的 drift 说明）。

| 项 | 结果 |
| --- | --- |
| S3-B 纯核（evidence-display：文案诚实性 + 资料状态计算） | PASS（test:ci 内） |
| S3-B 服务 + HTTP（隔离库；Slice 1 38 条 + Slice 2 49 条） | **87 通过 / 0 失败** |
| 浏览器验收（Playwright，8 条流程 + 入口 B + 资料缺口 + 3 视口） | **110 通过 / 0 失败**，12 个区块，18 张截图 |
| S3-A 回归（隔离库） | **131 通过 / 0 失败**（新建隔离分支复跑）。同一段代码在用了一天的原分支先得 130/1，复跑又在 T5 抛 P2028 事务超时（5000ms 限、5593ms 过）；该分支当天已两次 P1001，判为计算节点疲劳。换新分支后 131/0，且日志中 P2028/P1001 计数为 0。本轮 27 个改动文件不含 run-service / claim 代码路径 |
| S2-TB / S2 / S1 回归（隔离库） | 118 / 32 / 86，全部 0 失败 |
| typecheck | PASS |
| 改动文件 lint（27 个文件，含 main 同步进来的） | 0 problems |
| lint baseline | PASS（error 41，较基线 53 少 12；无新增 fingerprint） |
| build（webpack） | PASS（362/362 静态页，+1 = 新的供应商证据页） |
| GitHub CI（run 34764622675，head `e845ea4c`） | success，17/17 steps |
| Vercel staging（head `e845ea4c`） | Deployment has completed |
| 本地运行时冒烟（dev server + 隔离库 + 真实浏览器） | RUN（= 浏览器验收本身） |
| staging 运行时冒烟 | NOT_RUN |
| 真实外部搜索 provider | NOT_RUN（本轮不涉及） |
| 真实采购同事 UAT | NOT_RUN |

浏览器验收跑了四遍才全绿，前三遍的失败**全部是脚本或环境问题，没有一条是被测行为错**：

| 遍 | 失败 | 归因 |
| --- | --- | --- |
| 1 | F1m / F3e / G3 | 断言把页面**必须**写的否定句（「≠ 已认证」「不等于已认证」「不是评分」）当成了陈述 → 断言改为剥掉否定形式再匹配 |
| 1 | F2l / F2m | 固定 3 秒等待，dev 首次编译 PATCH 路由用了更久；几秒后 F2o 已读到新值 → 改为等表单卸载 + 轮询服务端 |
| 1 | F3l | **真 bug**：VerifyPanel 在 StrictMode 下档案列表永远转圈（§2.1） |
| 2 | F6b | Playwright `locator.isDisabled()` 对 `<option>` 返回 false，DOM 属性实为 true → 按 DOM 属性断言 |
| 3 | F8 | 隔离分支 P1001 ×2（环境）；暴露页面在刷新失败时清空的脆弱点（§2.2，已修） |
| 4 | — | 110 / 0，无 5xx 重试触发 |

## 10. Git / drift

| 项 | 值 |
| --- | --- |
| 本轮起点（BASE_HEAD） | `56cfa6f73659d603cc42afa4b8c914e3ed0c6df9` |
| 后端加固 | `eaa759fd` |
| UI | `f495498b` |
| 测试 / 验收 / 两处修复 | `41aa2ad8` |
| main 同步（普通 merge，无 rebase / force） | `e845ea4c` |
| REMOTE_MAIN_SHA | `7261388a3dbadfc53caaae94e884ead6d728cf94` |

**MAIN_DRIFT 说明**：分支是从 S3-A 分支头切出来的，不含 main 上 #207（梦馨官网桥接）那批 first-parent 提交；
GitHub 的三点 diff 看不出来，但 CI 与 staging 跑的是一棵**缺 main 当前 schema** 的树。
#207 与本轮零文件重叠、不碰 supplier-intel（RELEVANT_MAIN_DRIFT = NO），
按任务书「优先普通 merge/sync 保持可审计性」做了一次普通 merge，再重新 `prisma generate`，
所有门都在合并后的头上跑。合并后 drift = 0。

## 11. 审计 / 遗留

见 §7（资质 verify 有审计；资质登记 / reject / expire、产品、能力声明的 SI 专属审计 DEFERRED；Supplier create 审计 DEFERRED）。
另：worktree 放在 scratchpad 会被临时目录清理器删掉——本轮按里程碑提交推送，未再丢失工作。

## 12. 最终状态（机器可读）

```text
S3_A_MERGE_SHA        = 7261388a3dbadfc53caaae94e884ead6d728cf94
BASE_MAIN_SHA         = 7261388a3dbadfc53caaae94e884ead6d728cf94
BASE_HEAD             = 56cfa6f73659d603cc42afa4b8c914e3ed0c6df9
CODE_HEAD_SHA         = e845ea4cfa22e526d6584bc7c472fc07fc323914   （main 同步 merge；最后一个代码提交 41aa2ad8）
FINAL_PR_HEAD_SHA     = 本报告所在的 docs 提交（见 PR #210，不为写入自身 SHA 再加提交）
REMOTE_MAIN_SHA       = 7261388a3dbadfc53caaae94e884ead6d728cf94
MAIN_DRIFT            = 起点缺 #207（无关，已普通 merge 同步）；同步后 0
CI_HEAD_SHA           = e845ea4cfa22e526d6584bc7c472fc07fc323914（run 34764622675，17/17）
STAGING_HEAD_SHA      = e845ea4cfa22e526d6584bc7c472fc07fc323914（Deployment has completed）
SCHEMA_CHANGED = NO / MIGRATION_CHANGED = NO / PRODUCTION_DB_TOUCHED = NO / PRODUCTION_FLAGS_CHANGED = NO
PR = #210 / PR_STATE = DRAFT / PR_MERGED = NO / S4_STARTED = NO / PRODUCTION_ENABLED = NO
```
