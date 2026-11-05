# Spec Delta

## Purpose

为 Tender 相关的历史合同准备政府资料申请：按序检查公开资料与既有披露，生成可直接用于官方门户的英文正文与中文说明，管理申请人资料与机关规则，确定性判断重复与就绪，引导用户在官方渠道自助提交，登记回执、案件编号、来信、期限与处理结果。

## ADDED Requirements

### Requirement: 申请卡内容
申请卡 SHALL 包含：关联 Tender、关联历史合同 / SO / SA、官方来源与核实时间；中文商业目的与「还缺什么资料」；接收机关、资料持有依据、司法辖区与法律；资料取得路径（`PUBLIC_RECORD` / `COMPLETED_ATI_COPY` / `NEW_FORMAL_REQUEST`）；记录类别与含首尾日的精确起止日期；完整英文正文、版本号、text hash 与历史版本；申请人字段与核实状态；正式 / 非正式渠道、官方入口、费用、币种、额外费用规则；台账覆盖状态、重复检查结果、缺失字段与下一步。

#### Scenario: 详情返回
- **WHEN** 成员请求 `GET /api/procurement/requests/{id}`
- **THEN** 响应含上述字段、全部版本摘要（版本号、text hash、创建人与时间）、READY 闸结果与重复检查结果；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 联邦正文模板
联邦 ATI 正文 SHALL 按任务书第七节模板生成：方括号仅由已核实数据替换，缺数据时保留方括号；按所选记录类别取舍编号条目；起止日期按 ISO 日期写出。省市申请 SHALL NOT 套用联邦模板。系统 SHALL NOT 补造未填写的姓名、地址或编号；申请卡的中文内部标题 SHALL NOT 写进正文（保留 `[PROJECT TITLE]` 待填官方标题）。

#### Scenario: 缺机关名
- **WHEN** 接收机关未填写时生成正文
- **THEN** 正文保留 `[INSTITUTION]`，READY 闸报 `BODY_PLACEHOLDER`；`records-request-pure.test.ts` 覆盖

### Requirement: 省市正文模板
省市正式申请正文 SHALL 按适用法律生成：安省 FIPPA（省级）/ MFIPPA（市级，如多伦多市）、BC FIPPA、曼省 FIPPA、阿省 ATIA、萨省 FOIP / LA FOIP 用英文，写明「一般记录（非个人信息）」申请、法律名、各法律对机关的称谓，并请求在申请费以外的费用发生前先给费用估算；魁省按《Loi sur l'accès》（A-2.1）用法文。适用法律 SHALL 由辖区与规则法律名确定性判定；无法判定的辖区（OTHER）正文由用户填写。占位符、类别顺序与缺数据处理 SHALL 与联邦模板一致，法文占位符同样被 READY 闸识别。

#### Scenario: 安省省级机关
- **WHEN** 辖区 CA-ON、接收机关为省级部委，生成新正式申请正文
- **THEN** 正文以「This is a request for access to general records (not personal information) under the Freedom of Information and Protection of Privacy Act (Ontario).」开头，不含联邦「Pursuant to the Access to Information Act」；`records-request-pure.test.ts` 与 `procurement-records-db.isolated.test.ts` 覆盖

#### Scenario: 多伦多市与魁省
- **WHEN** 接收机关为 City of Toronto，或辖区为 CA-QC
- **THEN** 前者用 MFIPPA 模板；后者用法文模板（「pour la période du … au …」），详情返回正文语言 `fr`；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 自助提交指引
申请详情 SHALL 按适用法律给出逐步指引：确认接收机关与适用法律 → 先查公开资料 → 打开官方入口 → 选择申请类型 → 粘贴正文 → 付费（如适用）→ 保存回执 → 回青砚登记 → 跟进期限与来信；索取联邦既有披露副本另有非正式指引，直接取得公开资料的路径没有指引。指引 SHALL NOT 写死金额（费用指向规则卡片，未核实时以官方页面为准），SHALL 提醒不保存政府凭证、不确定时不换渠道重复提交；勾选只在页面记录，SHALL NOT 改变申请状态。

#### Scenario: 指引内容
- **WHEN** 读取任一法律的提交指引
- **THEN** 共 9 步，含回执与登记步骤，不含「$数字」或「CAD 数字」；`records-request-pure.test.ts` 覆盖

### Requirement: 版本不可覆盖
任何正文、范围、机关、渠道或申请人变动 SHALL 新增一个版本（版本号递增、重算 text hash 与 scope fingerprint），已有版本 SHALL NOT 被修改；当前为 READY 时 SHALL 回到 DRAFT 并需重新校验；交接或提交后的版本 SHALL NOT 再编辑，后续修改只能生成新版本且不影响已提交版本记录。

#### Scenario: 修改已提交申请
- **WHEN** 申请已 SUBMITTED，用户再保存正文
- **THEN** 新增版本，`submittedVersionId` 仍指向原版本，原正文与 text hash 不变；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 申请人资料
申请人资料 SHALL 由 `org_admin` 及以上维护；每次修改版本号加 1 并回到未确认；只有真实用户点确认后为 CONFIRMED；申请版本 SHALL 保存申请人快照与资料版本号。历史回复信地址 SHALL NOT 自动成为申请人资料。

#### Scenario: 资料改动后 READY 失效
- **WHEN** 申请已 READY，申请人地址被修改
- **THEN** 再次校验报 `APPLICANT_UNCONFIRMED`，不能交接；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 机关规则
机关规则 SHALL 保存辖区、机关、法律名、官方入口、渠道、申请费（整数分，未知为 null）、币种、其他费用规则、时限数值与单位、适用日期、官方来源、核实时间、核实人与方法、是否支持自助提交、门户字段观察记录。种子规则 SHALL 为未核实；只有 `org_admin` 及以上用户核对官方页面后标为已核实。未核实地区 SHALL 可研究、草拟和记录核实结果，但 SHALL NOT 进入 READY。字段说明 SHALL 只显示已观察记录或标明「待首次提交时核对」，SHALL NOT 虚构门户字段或声称存在通用申请 API。种子 SHALL 覆盖联邦（正式与非正式既有披露副本）、安省（省级 FIPPA 缺省与多伦多市 MFIPPA 专属规则）、BC、曼省、魁省、阿省、萨省（省政府机关 FOIP 缺省）；每条填了费用或时限的种子 SHALL 附来源链接与种子依据（说明数值从哪里来、尚未核实），SHALL NOT 预填官方提交入口。查找规则时机关专属规则 SHALL 优先于辖区缺省；已存在的规则行 SHALL NOT 被种子覆盖。

#### Scenario: 省级种子仍须核实
- **WHEN** 组织首次读取规则，安省省级种子为申请费 CAD 5、45 个工作日、适用自 2026-07-01
- **THEN** 该规则为 UNVERIFIED、官方入口为空、种子依据写明来自网络检索摘要；READY 闸报 `RULE_UNVERIFIED` 与 `PORTAL_UNVERIFIED`（费用已知，不报 `FEE_UNKNOWN`）；多伦多市机关命中 MFIPPA 专属规则，其他市级机关回落到省级缺省；`records-request-pure.test.ts` 与 `procurement-records-db.isolated.test.ts` 覆盖

#### Scenario: 费用未知
- **WHEN** 规则费用为 null
- **THEN** READY 闸报 `FEE_UNKNOWN`，界面显示「费用未知」而不是 0；`records-request-pure.test.ts` 覆盖

### Requirement: 资料取得路径顺序
`NEW_FORMAL_REQUEST` 进入 READY 前 SHALL 已记录公开资料检查与既有披露检查（检查时间、检查人或扫描运行、结论）；索取既有披露副本 SHALL 视为对外申请并走同一重复检查，SHALL NOT 套用正式申请的法定时限。

#### Scenario: 未查既有披露
- **WHEN** 新正式申请未记录既有披露检查
- **THEN** READY 闸报 `COMPLETED_ATI_NOT_CHECKED`；`records-request-pure.test.ts` 覆盖

### Requirement: 重复检查
重复检查 SHALL 比较同一规范申请主体 + 司法辖区 + 资料持有机关 + 相交采购编号 + 相交记录类别 + 相交日期范围，与渠道、标题、英文措辞无关；SHALL 分别保存 scope fingerprint 与 text hash；SHALL 对本组织全部申请（含归档、关闭、撤回、拒绝）生效；结果 SHALL 为 `CLEAR` / `DRAFT_EXISTS` / `BLOCKING` / `NEEDS_REASON` / `UNVERIFIED` 之一，并列出每条重叠的申请、重叠日期段与新增日期段（含首尾日）。没有台账确认、任一历史状态无法解析或读取失败时 SHALL 为 `UNVERIFIED`，SHALL NOT 返回「没有重复」。机关别名无法确定时 SHALL 标人工复核。准备与发起交接时 SHALL 在服务端事务内加锁重算。

#### Scenario: 改写措辞与渠道仍检出
- **WHEN** 新草稿与已提交申请主体、机关、合同、类别、日期相同，但英文改写、标题不同、渠道从正式改为非正式
- **THEN** 结果 `BLOCKING`；`records-request-pure.test.ts` 覆盖

#### Scenario: 新增五天
- **WHEN** 已提交申请范围至 2026-10-31，新草稿范围至 2026-11-05（同主体机关合同类别）
- **THEN** 显示重叠段与新增段 2026-11-01 至 2026-11-05（5 天），结果 `BLOCKING`，提示把范围缩到新增段；`records-request-pure.test.ts` 覆盖

#### Scenario: 台账未确认
- **WHEN** 组织没有导入历史也没有真实用户确认「无历史申请」
- **THEN** 结果 `UNVERIFIED`；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 历史台账确认
组织 SHALL 能导入历史申请（标注来源与证据等级），或由 `org_admin` 及以上真实用户确认某辖区 / 机关范围没有历史申请；确认 SHALL 保存范围、时间与确认人；系统与模型 SHALL NOT 自行宣称台账完整。

#### Scenario: 用户确认无历史
- **WHEN** org_admin 对 CA-FED / PSPC 确认无历史
- **THEN** 该范围的重复检查不再因台账返回 UNVERIFIED，记录确认人与时间

### Requirement: READY 闸
申请 SHALL 只有在申请人已确认且必填齐全、接收机关与持有依据已填、规则已核实且费用已知、辖区支持自助、路径检查完成、台账已确认、无未解决重叠、正文无占位符、日期有效、类别与编号非空时才能 READY；任一不满足 SHALL 返回阻塞码列表并保持 DRAFT。

#### Scenario: 缺资料仍可草拟
- **WHEN** 申请人未确认、费用未知
- **THEN** 草稿可保存，`POST …/ready` 返回 409 与阻塞码 `APPLICANT_UNCONFIRMED`、`FEE_UNKNOWN`；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 自助交接
交接页 SHALL 提供：复制完整正文、字段对应与附件清单、打开经核实的官方入口、登记提交结果或「提交结果不确定」、上传回执、补录案件编号、添加来信与事件、上传披露文件。「复制正文」「打开入口」「我准备申请」SHALL NOT 改变为任何已提交状态。发起交接 SHALL 重新执行 READY 闸与重复检查并锁定交接版本。系统 SHALL NOT 保存政府账号密码、验证码、会话令牌或银行卡数据，SHALL NOT 自动提交或付款。

#### Scenario: 只打开入口
- **WHEN** 用户复制正文并打开官方入口
- **THEN** 时间线增加两条非状态事件，申请状态仍为 HANDOFF_PENDING；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 提交登记与回执核对
用户回填提交时间、渠道、实际费用、submission reference、所用正文版本（或提供实际提交正文 / 标记「最终提交正文未核实」）后：无回执时 SHALL 为 `USER_REPORTED_SUBMISSION`（记录用户与时间，证据等级 user_reported）；有回执附件且确定性比对编号与接收机关名称出现在回执中、并由真实用户确认后 SHALL 为 `SUBMITTED`（document_verified，保存核对人、方法、时间与附件）。仅付款凭证或未显示接收确认的截图 SHALL NOT 单独证明提交。正式案件编号 SHALL 单独保存并以 ACKNOWLEDGED 事件记录。模型或系统抽取 SHALL NOT 等同证据核实。

#### Scenario: 回执核对
- **WHEN** 上传回执文本含 submission reference 与机关名，用户确认
- **THEN** 状态 SUBMITTED、证据 document_verified；之后登记受理信 → caseNumber 单独保存、状态 ACKNOWLEDGED；`procurement-records-db.isolated.test.ts` 覆盖

#### Scenario: 只有付款凭证
- **WHEN** 用户只上传付款凭证申请核对
- **THEN** 409 `RECEIPT_NOT_SUFFICIENT`，状态不变

### Requirement: 提交结果不确定
付款或提交页面超时、用户不确定时 SHALL 进入 `SUBMISSION_UNKNOWN`，保存已知事实与待核查项；SHALL NOT 自动重试；同范围（任意渠道）新的交接 SHALL 被重复检查阻止；只有提供回执证据（→ SUBMITTED）或真实用户确认未提交并写明依据（→ READY）才能解除。

#### Scenario: 不确定时阻止跨渠道
- **WHEN** 申请为 SUBMISSION_UNKNOWN，用户为同范围新建非正式副本请求并尝试交接
- **THEN** 重复检查 `BLOCKING`，交接被拒；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 状态维度与政府处理结果
申请 SHALL 分别保存申请状态（DRAFT、READY、HANDOFF_PENDING、USER_REPORTED_SUBMISSION、SUBMISSION_UNKNOWN、SUBMITTED、ACKNOWLEDGED、PROCESSING、CLOSED）、文件状态（NONE、NOTICE_RECEIVED、PARTIAL_FILES_RECEIVED、FILES_RECEIVED）、分析状态（NOT_STARTED、QUEUED、RUNNING、NEEDS_REVIEW、COMPLETED、FAILED）与政府处理结果（FULL_DISCLOSURE、PARTIAL_DISCLOSURE、NO_RECORDS、ALL_WITHHELD、TRANSFERRED、WITHDRAWN、CANCELLED、OTHER 或 null）；状态转换 SHALL 查固定转换表，不在表内的转换返回 409。

#### Scenario: 非法转换
- **WHEN** DRAFT 申请直接登记为 SUBMITTED
- **THEN** 409 `INVALID_TRANSITION`；`records-request-pure.test.ts` 覆盖

### Requirement: 结案、撤回与转交
已提交案件 SHALL 只有附来信的最终回应或其他有效结案证据才能 CLOSED，内部提醒到期 SHALL NOT 关闭案件；未提交草稿的本地归档 SHALL 与向政府撤回分开记录。正式转交 SHALL 保留原申请与原提交时间，记录接收机关、新案件编号与待确认状态，SHALL NOT 自动生成第二次提交或重置法定时限。拒绝、转交、撤回 SHALL 保留来信与原因，SHALL NOT 自动上诉或重新申请。

#### Scenario: 无记录不等于零
- **WHEN** 最终回应为 NO_RECORDS
- **THEN** 状态 CLOSED、结果 NO_RECORDS，分析显示「机关答复无记录，不代表采购金额为 0」；`procurement-records-db.isolated.test.ts` 覆盖

#### Scenario: 转交
- **WHEN** 登记 TRANSFER 事件（新机关与新编号）
- **THEN** 原提交时间不变、状态 PROCESSING、转交待确认，无新申请生成

### Requirement: 旧状态映射
导入旧 Skill 的单状态值（如 `RELEASE_NOTICE_RECEIVED`、`PARTIAL_RELEASE`）SHALL 经显式映射表转换为申请 / 文件 / 结果三维；不在表内的值 SHALL 报错并拒绝导入该条，SHALL NOT 静默丢弃。

#### Scenario: 未知旧状态
- **WHEN** 导入值为 `SOMETHING_ELSE`
- **THEN** 返回错误 `UNMAPPED_LEGACY_STATUS`；`records-request-pure.test.ts` 覆盖

### Requirement: 案件事件
事件 SHALL 只追加，保存 actor、recorded_at、effective_at、原始证据附件、证据等级（user_reported / document_verified / runtime_verified）与中文说明；更正 SHALL 以新事件指向被更正事件，旧事件不删；同一来信（按文件哈希或来信编号与事件类型）重复登记 SHALL 不产生重复事件。

#### Scenario: 重复来信
- **WHEN** 同一来信文件被登记两次
- **THEN** 只有一条事件；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 期限
来信写明的日期 SHALL 存为官方期限；规则推算 SHALL 另存为估算期限并保存依据，界面标明「估算」；内部提醒 SHALL 单独保存。起算与延期无法可靠处理时 SHALL NOT 显示精确法律倒计时；SHALL NOT 把单案实耗天数写成法定时限。

#### Scenario: 估算期限
- **WHEN** 联邦申请于 2026-08-07 登记受理
- **THEN** `estimatedDueAt` 为 2026-09-06 并附依据「30 个日历日（未计延期、补件与节假日）」，`officialDueAt` 为 null；`records-request-pure.test.ts` 覆盖

### Requirement: 站内待办
需补充资料、需用户决定（费用、延期、转交、拒绝）、披露附件待上传、分析待复核、内部跟进到期 SHALL 各生成一条站内待办（同一事件同一类型只一条）；对外跟进信 SHALL 只生成草稿，SHALL NOT 发送。

#### Scenario: 收到披露通知
- **WHEN** 登记「回复信，内附 105 页」
- **THEN** 文件状态 NOTICE_RECEIVED、生成「披露附件待上传」待办一条；重复登记不新增待办

### Requirement: 组织隔离与权限
所有申请、版本、事件、附件、明细、分析与导出 SHALL 按服务端载入行上的 orgId 校验调用者为该组织 active 成员；浏览器传入的 orgId SHALL NOT 作为授权依据；写配置、规则核实、申请人资料与台账确认 SHALL 要求 `org_admin` 及以上；草拟、交接、事件、附件与复核 SHALL 要求 `org_member` 及以上。其他组织成员 SHALL 得到 404 或 403，且无法触发该组织的扫描或分析。

#### Scenario: 伪造 orgId
- **WHEN** B 组织成员带 A 组织的 orgId 请求 A 的申请详情、附件下载或立即扫描
- **THEN** 403 / 404，A 的数据与运行不变；`procurement-records-db.isolated.test.ts` 覆盖

### Requirement: 敏感资料不外泄
通知摘要、审计摘要、日志与扫描结果 SHALL NOT 含申请人地址、邮箱、电话、回执编号或附件内容；附件 SHALL NOT 以公开链接提供；只读角色（org_viewer）看到的申请详情 SHALL NOT 含申请人地址、邮箱、电话。

#### Scenario: 通知摘要
- **WHEN** 申请登记回执后产生待办与通知
- **THEN** 摘要不含 submission reference 与申请人地址；`procurement-records-db.isolated.test.ts` 覆盖

#### Scenario: 只读角色
- **WHEN** org_viewer 请求申请详情
- **THEN** 申请人地址、邮箱、电话为空，法定名称仍显示；`procurement-records-db.isolated.test.ts` 覆盖
