# 青砚 PROC-1 任务书副本 — Tender 采购情报与政府资料申请（v1.0，2026-11-05）

> 本文件是用户交付的开发指令书原文副本（TASKFLOW：PROC-1，Phase R）。仅做两处改动：加本说明；[H1] 链接含个人账户标识，仓库副本不保存该链接。

```text
青砚 Tender 采购情报与政府资料申请开发指令书
交付对象：Opus 编程助手
版本：v1.0
编写日期：2026-11-05
任务类型：在青砚现有 Tender 类目中完成业务功能开发
默认时区：America/Toronto

请把本文作为完整开发任务执行。先阅读当前仓库，再完成代码、迁移、必要测试和使用说明；不要停留在方案、页面原型或提示词阶段。遇到当前授权不覆盖的生产操作，先把可开发、可测试、可审阅的工作完成，再列出具体启用步骤。

一、业务目标与完成定义

我要在青砚现有 Tender 类目中增加“采购情报与资料申请”能力，服务 Sunny Shutter 的窗饰、纺织品和相关政府采购业务。

目标是：在下一次投标准备之前，持续发现值得关注的政府采购项目，查清以前的合同与实际采购记录；资料不足时，生成可以直接用于政府门户的申请材料；用户自行提交后，青砚保存回执、跟踪处理、接收披露文件，并整理数量、单价、订单和支出等商业信息。

核心流程：
定时扫描 → 候选项目 → 历史合同研究 → 公开资料及既有披露检索 → 申请卡 → 用户自助提交 → 回执及案件台账 → 来信与期限跟踪 → 实际披露文件 → 有来源的采购分析。

第一版必须让用户走完整个流程。仅做新闻列表、AI 聊天窗口、几张静态卡片或一个政府网站链接，不算完成。

“自助申请”的定义：青砚准备完整材料并指导填写；用户在官方渠道完成登录、身份验证、支付和最终提交，再回到青砚登记回执。无人值守代交、代付属于后续范围。

本文件是功能需求和开发指令，不是政府申请授权、付费授权或生产上线记录。

二、先检查青砚现有工程，再确定实现位置

先阅读当前仓库的 AGENTS.md、项目说明、相关开发约定以及 Tender 的实际实现，确认：
1. 当前分支、工作区改动、框架、数据库及迁移方式。
2. Tender 列表、详情、项目关联、阶段、任务、讨论流及附件模型。
3. 用户、组织、角色、服务端鉴权及组织隔离。
4. 现有 AI 调用入口、结构化输出、文件解析和 OCR 能力。
5. 现有定时任务、队列、worker、租约、重试、运行日志和通知机制。
6. 当前使用的文件存储及导出能力。
7. 生产部署、数据库迁移及 Owner Gate 的现行要求。

历史线索仅供定位，不作为当前源码事实：青砚曾使用 Prisma/PostgreSQL Neon，曾讨论 Assistant Dispatch、Workforce Job、Runtime V2、PendingAction 和任务状态。必须以当前代码核实，不能直接套用旧版本号、旧文件路径或假定链路已经启用。

集成原则：
- 入口和业务数据留在青砚现有 Tender 类目。
- 复用现有鉴权、数据库、任务、文件、通知、AI 和 UI 组件。
- 不另建独立采购网站，也不要求先搭建另一套 Agent 平台。
- Personal Muse、MVP-002 Coding Bridge 和 MVP-003 Agent Network 保持既有边界；本次不得因此跨仓库修改、共用凭证、扩大工具白名单或改动其生产环境。
- Google Sheets/Drive 可在已有集成基础上作为导出或文件引用；青砚数据库承担唯一正式申请台账，不再建立第二套权威状态。
- 若存在同类功能，扩展并迁移已有数据，避免平行表、平行任务和重复入口。
- 不覆盖用户未提交的代码改动；必要时使用隔离分支或工作区。

完成勘察后，用简短表格说明“现有能力、复用位置、需新增部分、真实阻塞”，然后继续实现。命名、目录和 API 路径按仓库约定自行决定；本文后续实体和操作名称表示业务能力，不强制某个代码框架。

三、V1 必须交付的功能范围

A. 采购监控
- 可配置产品关键词、排除词、机构、地区、监控合同和时间范围。
- 能立即运行一次扫描，也能保存并启用定时扫描。
- 首批官方来源覆盖 CanadaBuys 采购/合同资料、Open Government 合同资料、Completed ATI 查询。
- 至少完成一个能够发现新候选的真实官方来源适配器，另有已知合同刷新和既有披露检索路径。只刷新三条种子数据不算“发现新项目”。
- 哪些来源支持自动获取、哪些仅支持人工检索和导入，必须逐项显示能力与实际结果。

B. 历史研究及申请准备
- 项目与历史合同关联，公开证据归档，资料缺口判断。
- 区分直接取得公开资料、索取已披露副本、提出新的正式申请。
- 生成完整英文申请正文及中文说明、收件机关、日期范围、费用和字段指引。
- 申请人资料管理、草稿版本、重复检查和就绪检查。

C. 自助提交与申请台账
- 复制正文、打开经核实的官方入口、字段映射、提交后回填指引。
- 用户报告提交、上传回执、保存提交确认编号与正式案件编号。
- 案件时间线、人工登记政府来信、延期、补充说明和最终处理结果。
- 站内跟进任务及待办提醒。

D. 披露文件与分析
- 上传并保存实际 PDF、CSV、XLSX 等文件，按仓库实际解析能力实现。
- 解析结果可复核，金额、数量和结论可追溯至文件页码或表格行。
- 生成历史需求、已知订单、金额口径、缺口和下一步建议。
- 至少完成可读 PDF 和结构化表格的导入分析；扫描 PDF 没有 OCR 能力时显示明确阻塞并允许人工录入，不虚构内容。

以下不列为 V1 必须完成项：政府账号自动登录、浏览器自动填表、自动付款、自动代交、自动向政府发邮件、全邮箱读取、全国所有省市门户适配、自动供应商询价、自动投标、自动创建报价。可以预留接口，不得用空接口返回成功。

四、监控范围、节奏与来源处理

产品范围：towels、toweling/towelling、linens、pillow forms、blankets、fleece/fabrics，以及 curtains、drapery、blinds、shades、window coverings、安装、维修和更换。支持法语同义词及采购分类，具体词表可编辑。

地域策略：V1 联邦流程优先。Ontario、BC、Manitoba、Saskatchewan 等项目支持人工加入、记录机关和核实本地申请路径；未经验证的省市规则不显示“已支持自动申请”。

默认建议配置：
- 每周一、周四，多伦多时间 08:00 附近扫描；具体由现有调度器执行。
- 每轮最多展示 5 个新候选，最多新生成 3 张申请卡，已关注合同另按配置刷新。
- 对候选数、翻页量、运行时间、AI 调用量设置可配置上限；超过上限显示截断与待续情况。
- 新安装默认未启用。授权用户点击“保存并启用监控”后才启用该范围的研究任务。
- 启用扫描只授权配置内的检索、分析和内部草稿，不授权对政府发函或提交。
- 根据当前日期计算下一次运行时间，正确处理夏令时，不硬编码 2026-11-09 或 UTC 固定偏移。
- 到期前约 4–6 个月可提高研究优先级。这是内部备料策略，不是重招预测或政府答复承诺。

单轮任务：
取得租约 → 读取配置和已有状态 → 刷新已关注合同 → 分页获取新候选 → 标准化及去重 → 保存证据和变化 → 排序及草拟 → 持久化结果 → 发站内通知。

来源要求：
- 优先使用公开的官方 API、数据集、下载或可访问页面；先查官方文档，不猜测私有接口。
- 在没有合法可用适配器时，提供人工检索/链接导入，不把二级聚合站内容伪装成官方结果。
- 保存 source URL、抓取时间、发布日期、原始来源 ID、内容摘要/快照引用和解析状态。
- 每个来源记录 SUCCESS、PARTIAL、UNAVAILABLE、PARSE_FAILED 等结果；“成功但零结果”和“无法获取”必须不同。
- 来源失败不得清空既有候选或把未知字段改成零。
- 定时运行支持重启恢复、租约过期处理和幂等写入；两个 worker 不得生成重复申请卡。
- 无变化只更新核查时间；通知按实质变更去重。
- 不把抓取或模型任务塞进会超时的前端请求。复用后台任务并可见进度。
- UI 同时显示“配置已启用”和“最近一次实际成功运行”，避免配置成功冒充运行成功。

五、项目身份、申请机关与优先级

项目、采购工具和资料申请分开：
- 一个 Tender 可以关联多个历史合同/SO/SA。
- 一个 SO 可以有多个 call-up 或 PO。
- 一个项目可以对应多个资料持有机关，但每份申请的范围必须独立有据。
- 区分新项目与前序合同；“关联历史项目”不等于同一合同的编号别名。

去重键以组织、司法辖区、规范采购机构、采购工具类型和正式编号为基础；保留原始编号、平台别名、标点和来源。标题只用于检索辅助。同标题不同编号不合并；不同来源的同一合同合并来源，修订记录更新历史，不生成假新项目。

分别保存 contracting institution、buying institution、records holder。PSPC 可能持有招标、SO、价格附件；CSC/CORCAN 或 DND 可能持有订单和付款。必须按所需记录核实，不默认全部提交 PSPC。CanadaBuys、Ariba、MERX、Bonfire 是发布或采购平台，不自动成为申请接收机关。

分别保存 current expiry、已行使/剩余 options、confirmed retender date。未知保持 null；合同到期不自动生成“确定重招日期”。

排序使用可解释维度：业务匹配、重复采购迹象、准备时间、资料缺口、资料持有机关是否清楚。采购资格、原产地、本地内容、认证、交付区域等以当前正式文件为准；缺少证据显示未知，不编造中标概率。

六、资料取得路径与规则配置

每次准备申请，按顺序检查：
1. 正式公告、合同、修订、公开合同数据。
2. 已完成 ATI 摘要和可索取的既有披露包。
3. 确认缺口后，再起草新正式申请。

已完成 ATI 的副本可通过官方机制免费索取，但发出索取动作仍是对外申请；非正式副本请求不能套用正式申请的处理时限。[S3]

联邦 ATI 当前一般申请费为 CAD 5，现行制度取消了该申请费之外的其他费用；不要把省级检索/处理费模板套给联邦案件。联邦正常法定答复期为 30 个日历日，可以依法延期；不能承诺“两个月一定拿到”。省市费用和时限分别核实。[S1][S2]

建立轻量 RuleProfile，至少保存：jurisdiction、institution、law label、官方入口、渠道、费用/币种、其他费用规则、时限单位、适用日期、官方来源、核实时间、核实人或方法。未知费用是 null，不能默认 0。

本轮不必实现全国法规引擎。对未核实地区可研究、草拟和记录人工核实结果，但不能标为可直接提交。

官方已明确的日期优先记录为 official_due_at。系统推算另存 estimated_due_at，保留规则依据；内部提醒单独保存 internal_follow_up_at。起算日、周末/节假日、补充材料和延期无法可靠处理时，不显示精确法律倒计时。不要把某案实耗 82 天写成固定法定时限。

七、申请卡、申请人资料与正文

申请卡至少包含：
- 关联 Tender、历史合同/SO/SA、官方来源和核实时间。
- 中文商业目的及“还缺什么资料”。
- 接收机关、实际资料持有依据、司法辖区及法律。
- 申请记录类别、精确起止日期，含首尾日。
- 完整英文正文、版本号、text hash；可人工编辑并查看历史版本。
- 当前申请人/公司、代表人、地址、邮箱等必要字段和核实状态。
- 正式/非正式渠道、官方入口、费用、币种、适用的额外费用规则。
- 历史台账覆盖状态、重复/重叠检查结果、缺失字段、下一步。

历史 Sunny 通信有名称和地址变体。不要将旧回复信地址自动当成当前申请资料。允许填写草稿，但未确认必要资料不得进入 READY；未填写的姓名、地址或编号不能被 AI 补造。

正文范围优先包含既有合同及修订、call-up/PO、年度或季度使用报告、适用价格表，以及分别列示的 committed、ordered、invoiced、paid。不要默认索取所有内部邮件、竞争对手全部方案、成本利润秘密或未来采购承诺。

联邦正文基础模板如下；方括号必须由核实数据替换，按每个机关实际持有范围删减：

Pursuant to the Access to Information Act, please provide electronic copies of existing records under the control of [INSTITUTION] relating to [PROJECT TITLE], [SOLICITATION NUMBER], and [STANDING OFFER / CONTRACT NUMBER], for the period [START DATE] to [END DATE].

Please provide:
1. The final issued contract or Standing Offer, its applicable annexes, amendments and exercised renewal or extension options.
2. Existing call-up, purchase order or usage records showing, where recorded, item description, quantity, unit of measure, unit price, order date, delivery destination, order value and cumulative value.
3. Existing annual or quarterly usage reports for the specified instrument and period.
4. Records showing separately the amounts committed, ordered, invoiced and paid, together with recorded cancellations, returns, credits or refunds relevant to those amounts.
5. The applicable final Basis of Payment or price schedule, to the extent releasable.

Please provide existing electronic records or ordinary system exports in a reusable format such as CSV or XLSX where available; otherwise, electronic copies in their existing format are acceptable. Please preserve the distinction between contract limits, orders, invoices and payments. I am requesting existing records and not a new forecast or commercial analysis.

If some requested records are held by another institution, please advise which institution should be contacted or whether a transfer is appropriate. If exemptions apply, please release reasonably severable portions and identify the applicable provisions.

省市申请使用相应法律和正式渠道，不能只替换联邦模板里的机构名称。

八、自助申请的交互闭环

在申请详情提供：
1. 保存/修改草稿。
2. 重新核实机关、费用和重复范围。
3. 复制完整申请正文。
4. 查看官方表单字段对应关系与附件清单。
5. 打开经核实的官方入口。
6. 登记提交结果或登记“提交结果不确定”。
7. 上传回执、补录正式案件编号。
8. 添加政府来信、更新处理事件和上传披露文件。

只有必要资料齐全、接收路径和费用核实、台账检查完成、无未解决重叠时才能 READY。任何实质范围或正文变动生成新版本并重新校验；历史已提交正文不可覆盖。

用户去官方门户自行完成账号登录、MFA、验证码、付款和最终提交。青砚不保存政府密码、验证码、会话令牌或银行卡数据。字段说明必须基于实际观察/官方说明，不能虚构门户字段或声称存在通用申请 API。[S5]

“打开入口”“复制正文”“我准备申请”都不等于已提交。

用户回来填写：提交时间、渠道、实际费用、submission reference、使用的正文版本，并上传回执；正式 case number 可稍后补录。
- 仅用户口述时标记 USER_REPORTED_SUBMISSION/待核实，记录该用户和时间。
- 有匹配回执证据后标记 SUBMITTED，并保留证据等级。
- 后续收到正式受理信，另存 case number 和 ACKNOWLEDGED 事件。
- 如实际提交正文与草稿不同，保存实际版本或标记“最终提交正文未核实”，不可假装完全相同。
- document_verified 表示证据已匹配核对，不宣称做过文件真伪鉴定。
- 模型提取不等于证据核实。保存核实人或方法、核实时间及证据关联，确认回执属于该申请和接收机关。仅有付款凭证或未显示接收确认的门户截图，不能单独证明提交成功；无法匹配时保持待核实或 SUBMISSION_UNKNOWN。

付款/提交后页面超时、用户不确定是否成功时，进入 SUBMISSION_UNKNOWN；保存已知事实及待核查项。不得自动重试，也不得改用邮件/免费副本请求来绕过同范围的未知结果。引导核查官方账户、确认回执或可用付款证据，再据实际证据解决状态。

V1 不实现无人值守付款或提交，因此无需另造支付系统。预留后续适配器时必须说明未来还需要真实授权、精确版本绑定、事务化意图/预算保留、执行结果对账；本地幂等键不能保证政府网站幂等。

九、状态、版本与案件事件

避免用一个“完成”字段同时代表政府处理结束、文件收到、分析结束。可以沿用仓库模型，但至少表达以下独立维度：

申请状态：
DRAFT、READY、HANDOFF_PENDING、USER_REPORTED_SUBMISSION、SUBMISSION_UNKNOWN、SUBMITTED、ACKNOWLEDGED、PROCESSING、CLOSED。

文件状态：
NONE、NOTICE_RECEIVED、PARTIAL_FILES_RECEIVED、FILES_RECEIVED。

分析状态：
NOT_STARTED、QUEUED、RUNNING、NEEDS_REVIEW、COMPLETED、FAILED。

政府处理结果另存：
FULL_DISCLOSURE、PARTIAL_DISCLOSURE、NO_RECORDS、ALL_WITHHELD、TRANSFERRED、WITHDRAWN、CANCELLED、OTHER 或 null。

语义要求：
- “无记录”不等于实际采购金额为零。
- 最终部分披露可以结束政府处理，但资料覆盖仍可能不完整。
- 拒绝披露、转介、撤回等必须保留来信和原因；不要自动上诉或自动重新申请。
- 区分“建议向另一机关申请”和“机关已正式转交”。正式转交保留原申请关联及原提交时间，记录接收机关、新案件编号和待确认状态；不自动生成第二次提交，不把全流程视为完成，也不未经规则核实重置法定时限。
- 已提交案件只有实际最终回应或其他有效结案证据才能把政府处理标为 CLOSED，不能用内部提醒超时自动关闭。未提交草稿允许用户本地取消/归档，必须与向政府撤回已提交申请分开，不伪造政府确认。
- 收到披露通知或封面信，只能 NOTICE_RECEIVED；实际附件取得前不能 FILES_RECEIVED。
- 分析完成必须说明实际分析哪些文件、覆盖什么范围及缺少什么，不能表示全部目标已查清。
- 若复用旧 Skill 的 RELEASE_NOTICE_RECEIVED、PARTIAL_RELEASE 等单状态，建立明确映射；不得静默吞掉未知状态。

案件事件追加保存：回执、受理、范围澄清、补充说明、适用的费用通知、延期、转介、部分披露、最终回应、附件取得、分析修正等。
每个事件保存 actor、recorded_at、effective_at、原始证据、证据等级；修正有审计轨迹，不删除旧事实。
证据等级至少区分 user_reported、document_verified、runtime_verified。

十、数据、重复检查与权限

以下是逻辑实体，可与现有表合并：
- ProcurementWatch / ScanRun：监控配置、时区、启用状态、租约、运行结果、来源覆盖。
- ProcurementInstrument / SourceEvidence：Tender 关联、编号/别名、前序关系、call-up 子项、来源及变化。
- ApplicantProfile：当前必要资料、版本、核实状态。
- RecordsRequest / RequestVersion：申请主体、机关、范围、版本、正文哈希、状态、费用、规则依据。
- RequestEvent / Attachment：案件时间线、回执和披露文件。
- ProcurementLineItem / Analysis：提取记录、金额口径、来源位置、复核状态、分析版本。
- RuleProfile：机关申请路径、费用和期限规则。

所有组织业务数据、后台任务、附件访问及导出，都必须继承服务端真实组织/用户权限。不得信任浏览器传入的 orgId；不得使用 project-conversation 之类占位组织值处理真实业务；不得因这是 AI 功能而开放全部工具。

重复检查至少比较：
同一规范申请主体 + 司法辖区 + 资料持有机关 + 相交采购编号 + 相交记录类别 + 相交日期范围。
- formal/informal 渠道变化、标题变化或英文改写不能绕过去重。
- semantic scope fingerprint 与 exact text hash 分开保存。
- 合同/机关别名先规范化；无法确定别名时标记人工复核，不擅自合并。
- 新日期范围超出旧申请时，显示“已有覆盖”和“新增部分”；不能整段无提示重复提交。
- DRAFT/READY 等未提交版本优先续改；已提交、用户报告提交、未知结果、处理中及已披露的重叠必须提示或阻止重复。
- 对取消/撤回/拒绝/关闭案件也保留历史，重新申请须说明新增范围或原因，不能视作从未申请。
- 准备和发起自助交接时重新执行服务端检查；并发操作使用事务、唯一约束或等效锁，不只依靠前端。
- 历史记录缺失、台账读取失败或状态无法解析时显示 UNVERIFIED，不能返回“没有重复”。
- 首次使用支持导入历史申请，或由真实用户确认该范围没有历史申请；保存范围、时间和确认人。不得让模型自行宣称台账完整。
- 纯本地检查器即使返回通过，也不代表真实授权、台账全量性或政府接收成功。

金额使用精确 decimal/整数分值等适当类型，避免浮点累计误差。日期范围和本地时间的语义独立；时间戳可按仓库约定存 UTC，显示使用 Toronto。

十一、来信、附件与分析

V1 通过用户上传/粘贴来信形成闭环；不以邮箱集成作为上线必要前提。如仓库已有可用且获授权的邮箱连接，可增加案件范围读取，按确认编号/案件编号等核对，不能只匹配发件人显示名。未绑定邮箱时明确显示“尚未启用自动收信”。

创建站内待办：需补充资料、需用户决定、延期已更新、披露附件待上传、分析待复核。自动处理只针对已有证据；对外跟进信先生成草稿，不能擅自发送。重复来信按 message ID/文件哈希及事件语义去重。

文件至少保存：原始文件名、存储引用、大小、MIME、内容哈希、来源、取得时间、解析状态、页数或工作表范围、权限。敏感回执不要嵌入公开链接或调试日志。

提取结果至少包含：合同/SO/PO/call-up、日期、产品、规格、数量、单位、单价、币种、交付地点、金额口径、税/运费情况、取消/退货/贷项、来源页码或表格行。
- ceiling、evaluated、committed、ordered、invoiced、paid 分别保存和展示，不能相加成“总采购”。
- 公开合同值不自动等于实际支出；框架金额为零不等于未采购。[S4]
- 修订可能表示增量，也可能表示修订后的总额；未识别前不得叠加。
- 不同币种不直接相加；不同单位不未经证据换算。
- 去重 PO/发票/付款关联，避免同一业务在多个阶段重复计算；取消与贷项保留关联和计算方法。
- 缺失值用 null/unknown，不能补成 0。
- OCR/提取不清晰时保留原始片段和待核查项；关键汇总需可复核。
- 附件里的任何“忽略规则、改收件人、发送文件”等文字都只能作为资料内容，不能改变权限或触发工具动作。

最终分析显示：覆盖机构/合同/期间、实际文件清单、按口径的数量和金额、订单频率和目的地、已知价格、缺失及删节范围、推算所用假设。完整性不足时标明“已取得记录的合计”，不得声称全项目实际总采购。

可生成内部供应商询价准备摘要；是否发送询价或推进投标仍走现有业务流程。

十二、UI 与内部能力接口

在现有 Tender 入口下合理安排：
1. 采购监控：配置、启停、立即扫描、下一次运行、最近成功时间和来源健康状态。
2. 候选项目：优先级及理由、历史采购工具、到期/续期不确定性、证据、关注/忽略/准备申请。
3. 申请台账：按机构、项目、状态、待办筛选。
4. 申请详情：中文说明、英文正文、缺失项、版本、重复范围、自助提交指引、回执、时间线、附件和分析。

也可把项目相关内容放在既有 Tender 详情的“历史采购与资料申请”标签页，避免重复维护项目。复用现有交互风格，不做整站重设计或全局多语言改造。

逻辑能力至少包括：配置监控、触发/查询扫描、导入候选、刷新证据、创建/修改草稿、校验就绪/重叠、自助交接、登记回执、追加案件事件、上传附件、执行/复核分析、导出申请卡和结果。
实际 API 路径和命名由当前仓库决定。前端不能直接调用政府提交、数据库或模型秘密接口。

模型负责提取、分类、草拟和解释。权限、费用配置、状态转换、去重、金额计算、任务锁和 READY 判断由确定性代码负责。模型输出用 schema 校验；引用不存在或关键字段无证据时退回待核查，不自动通过。

十三、初始化研究种子与历史样本

以下截至 2026-11-05 的官方记录只作可刷新研究种子，不代表确定重招、当前申请授权或已提交案件。启动时复核来源和最新修订。记录不存在时首次导入，重复导入应更新而非重复新增。

1. 21C51-249059 Pillow Form
   Contract/SO：CW2379109
   Solicitation：WS4856068988
   采购执行：PSPC；购买机构：CSC/CORCAN
   公开到期日：2027-02-26
   来源：[S6]
2. 21C31-255912 Fleece Fabric
   Contract/SO：CW2450151
   Solicitation：WS5370452219
   采购执行：PSPC；购买机构：CSC
   公开到期日：2027-04-12
   来源：[S7]
3. W3380-23FD05 Hand Towels and Bath Towels
   Contract/SO：CW2370017
   Solicitation：WS4586333777
   采购执行：PSPC；购买机构：DND
   公开到期日：2027-07-30
   来源：[S8]

三者 remaining_options 和 confirmed_retender_date 初始为 null；未经核实不填 0 或推测日期。

历史复盘背景：我们为 21C81-267106 Cotton Toweling 研究了前序采购 CW2228162 / WS3250543003 / Ariba 11753631。前序采购编号与当前项目编号是关联关系，不能自动当作同一采购工具别名。
历史申请范围：2021-11-01 至 2025-07-04。
提交确认编号：EA2026_0187844。
正式案件编号：A-2026-00183。
政府登记日：2026-08-07；回复信日期：2026-10-28，间隔 82 个日历日。
回复信写有 105 页附件，但仅有回复信时不能声称已取得或分析全部 105 页。

这段案例来自本次复盘。若真实原始文件尚未导入青砚，只能作为带来源说明的历史待核实记录或测试样本，不能创建伪附件、伪回执、虚假成功状态，更不能据此自动预填当前申请人地址。
历史回复信参考：[H1]。

十四、开发顺序与边界

按阶段持续完成，不要每做一小步都等待确认：

阶段 0：仓库勘察、复用清单、具体改动位置、数据迁移计划。
阶段 1：持久化模型、权限、种子导入、真实来源适配器、监控任务及候选 UI。
阶段 2：机关/规则、公开资料补齐、申请卡、版本、台账及重复检查。
阶段 3：自助交接、用户报告/回执核实、案件事件和内部提醒。
阶段 4：文件导入、提取复核、金额及数量分析、导出。
阶段 5：必要测试、隔离环境演示、运行说明和可审阅交付。

测试、文档和演示中必须区分 fixture、真实只读结果和用户真实提交证据。缺少凭证或生产权限时完成可验证部分，保留明确适配器/启用阻塞；不伪造真实运行。

开发范围内允许按既有授权继续工作。生产迁移、生产调度启用、跨项目接入及对外行动遵循现行 Owner Gate；已有有效授权不重复索取。若需要最终批准，先完成具体迁移、预演、变更清单、备份/恢复方案和启用步骤。

对数据库使用可回退或可安全前向修复的增量迁移，不 reset/drop 现有数据。若当前仍采用此前 Neon 流程，在 branch/clone 等隔离环境预演，并按现行流程完成备份、precheck、migration status/hash 核对。不能因为本文要求开发就自动对生产运行 migrate deploy。

停用功能应能暂停后续任务并保留案件与附件；处理正在运行任务的取消/收尾，不删除申请历史。

十五、验收场景

请以必要的单元、集成和端到端验证覆盖以下业务风险，不写只复述实现的无效测试。具体工具沿用仓库。

1. 同一采购记录连续扫描两次、两个 worker 并发扫描：一个采购工具，无重复申请卡和通知。
2. 同标题不同正式编号保持独立；同合同不同来源合并证据；修订不变成新标。
3. 任一来源失败或解析失败：显示部分覆盖，不显示“全部成功且无项目”；旧数据保留。
4. 调度在 Toronto 夏令时变化、重启和租约过期后行为可解释，不因重试重复写入。
5. 缺申请人必要资料、机关、费用或历史台账核实：允许 DRAFT，不能 READY；未知费用不是零。
6. 同申请主体/机关/合同/类别/日期重叠，改英文、标题或 formal/informal 渠道仍能检出。
7. 旧范围至 10 月 31 日，新范围至 11 月 5 日：展示重叠与新增五天，不重复申请整段。
8. 仅打开官方入口或复制正文：不产生 SUBMITTED；用户口述与回执核实可区分。
9. 真实匹配回执保存 submission reference，后来受理信独立保存 case number；正文版本可追溯。
10. 支付/提交结果不确定：SUBMISSION_UNKNOWN，阻止自动重试及跨渠道重复；有证据才解决。
11. 仅上传“内附 105 页”的回复信：显示 NOTICE_RECEIVED 和附件缺口，不显示 105 页已分析。
12. 上传真实可读文件：保存原件、哈希、提取结果和来源位置；损坏/加密/不清晰文件显示阻塞。
13. SO 公开值为 0、只有一笔 call-up：不能输出“总采购为 0”或“该单等于全周期实付”。
14. 合同修订、订单、发票、付款和贷项：不跨阶段相加，不把总额修订重复累加。
15. 无记录、拒绝、部分披露、转介能表达真实处理结果，不被误判为完整采购数据。
16. 修改已提交申请不覆盖旧正文；重复来信、附件和分析任务不会生成重复事实。
17. 未授权用户、其他组织、伪造 orgId 无法查看或修改案件/附件，也无法触发其任务。
18. 网页/PDF 中的恶意指令不改变申请范围、收件机关、权限或触发外部发送。

验收要提供两条明确分开的证据：
- 开发验证闭环：公开真实来源研究 + 隔离测试案件/回执 fixture + 文件分析，可重复演示。
- 上线业务验收：已授权的生产定时扫描真实成功；由用户完成一次真实自助提交并保存真实回执。没有发生真实提交时标记“待业务验收”，不能用 fixture 代替，也不应为了完成开发测试擅自提交政府申请。

十六、最终交付给我的内容

1. 已完成与未完成清单，逐项对应本指令书。
2. 改动文件、迁移内容、复用的系统能力。
3. 必要测试的实际结果；未运行的检查和真实原因。
4. 主要页面截图或演示，以及一条能复现的开发闭环。
5. 真实接入的来源、实际覆盖、失败处理及成本/速率上限。
6. 配置项说明、启停步骤、首次历史台账导入、申请人资料确认步骤。
7. 案件回执/附件/金额模型说明及恢复方法。
8. 是否已部署、迁移、启用调度，分别提供真实状态和证据。
9. 仍需我提供的确切资料或最终决定；问题要针对可审阅的结果，不重复询问已明确的范围。
10. 依仓库惯例提供提交/分支或 Draft PR；不擅自合并、发布或扩大环境权限。

若时间或上下文不足，以可恢复任务清单记录进度，继续推进已有授权范围内的工作，不把未实现按钮、假数据或空适配器包装为完成。

官方参考与案例来源

以下是业务事实和适配器发现入口，核实基准日为 2026-11-05。实施和实际申请时重新检查当前版本。正文模板和工程方案是本次设计，不是政府保证或官方 API 文档。

[S1] 联邦申请资格、费用和时限
https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information/how-access-information-personal-information-requests-work.html

[S2] Access to Information Act 概述，含仅保留 CAD 5 申请费的说明
https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information-act.html

[S3] Completed Access to Information Requests
https://search.open.canada.ca/ati/

[S4] 公开合同金额的含义及限制
https://search.open.canada.ca/contracts/

[S5] 官方申请准备要求；从此核实最新入口、账号和支付条件
https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information/request-information/what-you-will-need.html

[S6] Pillow Form 合同
https://canadabuys.canada.ca/en/tender-opportunities/contract-history/cw2379109-001

[S7] Fleece Fabric 合同
https://canadabuys.canada.ca/en/tender-opportunities/contract-history/cw2450151-000

[S8] Hand Towels and Bath Towels 合同
https://canadabuys.canada.ca/en/tender-opportunities/contract-history/cw2370017-001

[S9] 联邦请求处理手册，实际期限计算前查对应条款
https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information/access-information-manual.html

[H1] 本次历史复盘中的 A-2026-00183 回复信；需要相应账户访问，Opus 环境不保证可直接取得
（链接含个人账户标识，仓库副本省略；原件见用户上传的指令书）

设计来源：本次对话确定的流程及已建立的“Sunny 采购情报与资料申请”Skill。本文已包含开发所需业务规则；即使 Opus 无法访问 ChatGPT Skill，也可以依本文开发，不必等待复制个人 Skill 环境。


```
