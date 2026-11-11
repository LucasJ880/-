# tender/rfq-auto-draft Specification

## Purpose
规定「要求确认后自动起草第 1 轮询价」：人完成对招标要求的审核之后，系统在什么条件下替人备好一张待批的发询价审批卡、供应商从哪里来、什么情况下不起草以及怎么告诉人。系统只起草，不批准、不发信。

## Requirements

### Requirement: 开关关闭时行为不变
开关 `TENDER_RFQ_AUTO_DRAFT_ENABLED` 未开启，或组织不在 `TENDER_RFQ_AUTO_DRAFT_ORG_ALLOWLIST`（非空时）之内时，系统 SHALL NOT 自动起草询价；四个审核接口的响应 SHALL NOT 含 `rfqAutoDraft` 字段；询价入口的响应 SHALL NOT 含自动起草轮次的字段；界面 SHALL NOT 出现任何自动起草的文字或标记。

#### Scenario: 开关关闭
- **WHEN** 开关未开启，一个要求全部已确认的项目批准了招标分析
- **THEN** 没有新的询价轮次、没有新的审批卡，响应里没有 `rfqAutoDraft`（`npx tsx src/lib/tender-rfq/__tests__/auto-draft-db.isolated.test.ts`）

### Requirement: 只在人的审核动作成功之后判定
系统 SHALL 只在以下四个动作成功之后判定是否自动起草：批准招标分析、确认一条要求、批量确认要求、驳回一条要求。这四个动作都要求操作者对项目有写权限。系统 SHALL NOT 由定时任务、后台扫描或 Muse 消息触发自动起草。重复批准（幂等返回）SHALL NOT 触发判定。自动起草的判定或执行出错时，触发它的审核动作 SHALL 仍然成功，响应里的 `rfqAutoDraft` SHALL 说明没有起草及原因。

#### Scenario: 起草失败不影响审核动作
- **WHEN** 批准招标分析成功，但建轮次时出错
- **THEN** 批准仍然成功（状态为已批准），`rfqAutoDraft.drafted` 为 false，原因为起草失败（`auto-draft-db.isolated.test.ts`）

### Requirement: 起草条件
系统 SHALL 在以下条件全部满足时自动起草，否则不起草并给出第一条不满足的原因：
开关为开；这次动作所属的招标分析是该项目当前有效的一份且状态为已批准；项目还没有任何询价轮次（包括已取消的）；既有入口对这个操作者显示为可以发询价（有已确认的要求、询价单不含不能发给供应商的内容、授权邮箱已连接并有发信权限）；操作者有至少一家在用且有联系邮箱的常用供应商。
批准招标分析即视为要求审核完成：批准时还没有确认也没有驳回的要求 SHALL NOT 阻止起草，SHALL NOT 进入询价单；系统 SHALL 在结果与审批卡的摘要里写明询价单带了几条已确认的要求、有几条没有确认的没带上。
判定 SHALL 是确定性的，SHALL NOT 调用模型。

#### Scenario: 全部满足
- **WHEN** 一个项目的招标分析等待审核、有 2 条要求已确认、还没有询价轮次、操作者有 3 家就绪的常用供应商，操作者批准招标分析
- **THEN** 生成第 1 轮询价与一张待批的发询价审批卡，收件人是这 3 家（`auto-draft-db.isolated.test.ts`）

#### Scenario: 批准时还有没确认的要求
- **WHEN** 批准招标分析时，2 条要求已确认、1 条已驳回、1 条还没有确认也没有驳回
- **THEN** 照样起草；询价单正文只有已确认的 2 条；结果与卡的摘要写明「带了 2 条已确认的要求，另有 1 条没有确认的没带上」（`auto-draft-db.isolated.test.ts`）

#### Scenario: 逐条不满足
- **WHEN** 分别构造：分析未批准、分析已被新的一份取代、项目已有轮次、没有已确认的要求、询价单含不能外发的内容、授权邮箱未连接、授权邮箱缺发信权限、没有就绪的常用供应商
- **THEN** 每一种都不起草，并给出对应的原因（`npx tsx src/lib/tender-rfq/__tests__/auto-draft-pure.test.ts` 逐条覆盖）

#### Scenario: 批准之前逐条确认不起草
- **WHEN** 招标分析还在等待审核，操作者确认或驳回了一条要求
- **THEN** 不起草；之后操作者批准分析的那一次动作才起草（`auto-draft-db.isolated.test.ts`）

### Requirement: 供应商只取操作者保存的常用供应商
自动起草的收件供应商 SHALL 只来自触发动作的操作者本人已保存的常用供应商，按其保存的顺序取在用且有联系邮箱的，最多 8 家；审批卡上收件人的顺序 SHALL 与操作者保存的顺序一致。系统 SHALL NOT 按品类、标签、评分、历史报价或任何模型输出增补或替换供应商。常用供应商里不在用或没有邮箱的 SHALL 被跳过，并在结果里列出被跳过的家数。贸易条款 SHALL 取操作者保存的默认贸易条款（没有则留空），其余栏目（目的地、补充说明、追加问题）SHALL 留空。

#### Scenario: 跳过未就绪的常用供应商
- **WHEN** 操作者的常用供应商有 4 家，其中 1 家已停用
- **THEN** 起草的卡收件人是另外 3 家，结果里写明跳过 1 家（`auto-draft-db.isolated.test.ts`）

#### Scenario: 别人的常用供应商不被使用
- **WHEN** 操作者没有常用供应商，同组织的另一位成员有
- **THEN** 不起草，原因为没有就绪的常用供应商（`auto-draft-db.isolated.test.ts`）

### Requirement: 只起草，不批准、不发信
自动起草 SHALL 经既有的建轮次流程产出一张状态为待批的发询价审批卡，有效期、幂等键、载荷结构、轮次锁与人工起草的相同。系统 SHALL NOT 批准这张卡，SHALL NOT 发出任何邮件。自动起草的卡 SHALL 只在触发起草的操作者本人开启了「自动起草的轮次带跟进授权」的个人开关、且跟进授权的功能开关对该组织打开时带跟进授权；否则 SHALL NOT 带。带授权时，面板上的结果 SHALL 写明这张卡带跟进授权、批准它会一并批准后面的催单和追问。自动起草的卡 SHALL NOT 能在 Muse 里批准（起草时没有人看过收件人与正文，而 Muse 里只显示标题），只能在网页上批；驳回不受影响。卡的来源 SHALL 记为自动起草；卡的标题 SHALL 标明「自动起草」，摘要 SHALL 写明供应商取自谁的常用供应商、询价单带了几条已确认的要求、有几条没有确认的没带上。

#### Scenario: 起草后零出站
- **WHEN** 自动起草成功
- **THEN** 库里有一张待批的发询价卡（没有批准人）、没有任何询价项被标为已发出、轮次还没有开始；操作者没有开启个人开关时，卡的载荷里没有跟进授权（`auto-draft-db.isolated.test.ts`）

#### Scenario: 自动起草的卡不能在 Muse 里批
- **WHEN** 有人在 Muse 里对一张自动起草的发询价卡回复「批准」
- **THEN** 不批准、不发信，回复说明这一轮是系统自动起草的、还没有人核对过收件人和正文，需在青砚项目页看完后批准（`npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts`）

#### Scenario: 驳回后不再自动起草
- **WHEN** 人驳回了自动起草的卡，之后又确认或驳回了别的要求
- **THEN** 不再自动起草（项目已有轮次），原因为项目已有询价轮次（`auto-draft-db.isolated.test.ts`）

#### Scenario: 带授权时结果里写明
- **WHEN** 操作者开启了个人开关，自动起草成功
- **THEN** `rfqAutoDraft` 里带一个标记说明这张卡带跟进授权，说明文字写明「批准它会一并批准后面的催单和追问」（`npx tsx src/lib/tender-rfq/__tests__/auto-draft-pure.test.ts`）

### Requirement: 并发与重复触发只起草一轮
同一个项目被并发或重复触发时，系统 SHALL 最多生成一个第 1 轮询价与一张发询价审批卡。项目里已经有轮次（不论是谁、从哪个入口建的）时，自动起草 SHALL NOT 建出第 2 轮。建轮次途中出错时，系统 SHALL NOT 留下没有审批卡的草稿轮次（已建的那一轮标为已取消）。

#### Scenario: 并发两次触发
- **WHEN** 对同一个项目同时触发两次自动起草
- **THEN** 只有一个轮次、一张待批卡；另一次的结果为没有起草，原因为项目已有询价轮次（`auto-draft-db.isolated.test.ts`）

### Requirement: 结果写进响应并显示在界面上
开关开启时，四个审核接口的成功响应 SHALL 含 `rfqAutoDraft`：起草了则给出轮次号、收件家数、被跳过的家数、没有带上的未确认要求数、一句中文说明与审批卡所在的链接；没起草则给出原因码、一句中文说明与一个去处（如「去发询价」「去连接邮箱」「去需求」，没有合适去处时为空）。`rfqAutoDraft` SHALL 带一个 `quiet` 标记：审核过程中必然反复出现的情形（分析还没批准、项目已有轮次）为 true，其余为 false。招标分析面板 SHALL 在审核动作成功后显示 `quiet` 为 false 的结果，SHALL NOT 显示 `quiet` 为 true 的结果。项目页的轮次列表 SHALL 对自动起草的轮次显示「自动起草」标记，并 SHALL 在这一轮待批的审批卡上方显示卡摘要里的那句说明（供应商取自谁的常用供应商、带了几条已确认的要求、有几条没带上）。`rfqAutoDraft` SHALL NOT 含供应商邮箱以外的联系信息、我方价格、项目估值或毛利率。

#### Scenario: 没起草时给出去处
- **WHEN** 操作者没有就绪的常用供应商
- **THEN** `rfqAutoDraft` 为 `{ drafted: false, reason: "NO_DEFAULT_SUPPLIERS", quiet: false, … }`，说明里写明去哪里选供应商，链接指向既有的询价入口（`auto-draft-pure.test.ts`）

#### Scenario: 逐条确认时不反复提示
- **WHEN** 招标分析还在等待审核，操作者确认了一条要求
- **THEN** 这次确认的响应里 `rfqAutoDraft` 为 `{ drafted: false, reason: "RUN_NOT_APPROVED", quiet: true, … }`，面板不显示（`auto-draft-pure.test.ts`；`auto-draft-db.isolated.test.ts`）

#### Scenario: 界面显示
- **WHEN** 在招标分析面板批准分析并自动起草成功
- **THEN** 面板显示「已为你起草第 1 轮询价：N 家常用供应商……还没有发出，批准后才发」，点「去批准」到项目页的这一轮；轮次上有「自动起草」标记，审批卡上方有那句说明（截图 `docs/acceptance/rfq-auto-2/panel-result.png`、`round-auto-drafted.png`）

### Requirement: 自动起草留审计
每次自动起草成功，系统 SHALL 写一条审计，记下：触发的动作、操作者、轮次、审批卡、选中的供应商、被跳过的供应商及原因、供应商来源为「操作者的常用供应商」、没有带上的未确认要求数。

#### Scenario: 审计内容
- **WHEN** 自动起草成功
- **THEN** 有一条审计，操作者是触发动作的人，内容含审批卡与供应商清单（`auto-draft-db.isolated.test.ts`）
