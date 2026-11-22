# Spec Delta

## Purpose

项目情报（重新生成、审核结论的读与改）与一键投标方案（查看、建任务、逐步执行）接口：谁能调用、被拒绝时返回什么状态码；被拒绝的请求不改数据、不调模型、不发通知，也不返回任务与情报内容。

## ADDED Requirements

### Requirement: 情报接口与一键投标方案的查看只对与项目有关的人开放
下面四个处理函数 SHALL 只对已分发项目的下列调用者执行：平台 super_admin、项目负责人、项目所在组织里组织成员身份为 active 的所有者或管理员、该项目的 active 成员（不论项目角色）。
- `GET /api/projects/:id/ai-bid-package`
- `POST /api/projects/:id/intelligence/regenerate`
- `GET /api/projects/:id/intelligence/review`
- `PATCH /api/projects/:id/intelligence/review`

平台 super_admin 对未分发的项目同样放行。对这些调用者，四个处理函数的请求、返回与副作用 SHALL 与加检查之前一致。

#### Scenario: 只读成员查看一键投标方案
- **WHEN** 项目的 active 成员（项目角色 `viewer`）调用 `GET …/ai-bid-package`，项目里有一个一键投标方案任务
- **THEN** 返回 200，正文里有这个任务的 `taskId` 与各步骤

#### Scenario: 只读成员读与改情报审核结论
- **WHEN** 项目的 active 成员（项目角色 `viewer`）先调用 `GET …/intelligence/review`，再调用 `PATCH …/intelligence/review`，正文 `reportStatus` 为 `in_review`
- **THEN** 两次都返回 200；`PATCH` 之后该项目情报的审核状态是 `in_review`

#### Scenario: 成员重新生成情报
- **WHEN** 项目的 active 成员对一个没有可用文档内容的项目调用 `POST …/intelligence/regenerate`
- **THEN** 返回 200，正文 `success` 为 `true`

#### Scenario: 负责人、组织管理员、super_admin
- **WHEN** 项目负责人、项目所在组织的管理员（不是项目成员）、平台 super_admin（不属于该组织）分别调用 `GET …/intelligence/review`
- **THEN** 三次都返回 200

### Requirement: 一键投标方案的建任务与逐步执行只对项目管理者开放
下面两个处理函数 SHALL 只对已分发项目的下列调用者执行：平台 super_admin、项目负责人、项目所在组织里组织成员身份为 active 的所有者或管理员、项目角色为项目管理员的 active 成员。
- `POST /api/projects/:id/ai-bid-package`
- `POST /api/projects/:id/ai-bid-package/run-step`

平台 super_admin 对未分发的项目同样放行。项目里的其它 active 成员（操作员、测试、财务审核、只读）SHALL 得到 403，正文 `error` 为「无权修改该项目」。对放行的调用者，两个处理函数的请求、返回与副作用 SHALL 与加检查之前一致，包括任务全部完成时给项目成员发的站内通知。

#### Scenario: 项目管理员建任务并执行最后一步
- **WHEN** 项目角色为项目管理员的成员先调用 `POST …/ai-bid-package`，再对一个只剩最后一步待执行、且这一步不需要调模型的任务调用 `POST …/ai-bid-package/run-step`
- **THEN** 建任务返回 200 与新任务的 `taskId`；执行返回 200，任务变为已完成，除调用者以外的项目 active 成员与项目负责人各收到一条「AI 投标方案已生成」站内通知

#### Scenario: 只读成员与操作员不能建任务、不能执行
- **WHEN** 项目角色为 `viewer` 与 `operator` 的 active 成员分别调用 `POST …/ai-bid-package` 与 `POST …/ai-bid-package/run-step`
- **THEN** 四次都返回 403，正文 `error` 为「无权修改该项目」；项目的任务数不变，已有任务的各步骤状态不变

#### Scenario: 负责人、组织管理员、super_admin 建任务
- **WHEN** 项目负责人、项目所在组织的管理员（不是项目成员）、平台 super_admin（不属于该组织）分别调用 `POST …/ai-bid-package`
- **THEN** 三次都返回 200

### Requirement: 未登录返回 401
没有有效登录会话的请求调用这六个处理函数中的任何一个，系统 SHALL 返回 401，正文 `error` 为「未登录」。账号状态不是 active 的用户带着此前签发的会话调用，SHALL 按未登录处理。

#### Scenario: 未登录
- **WHEN** 不带会话分别调用 `GET …/ai-bid-package`、`POST …/ai-bid-package/run-step`、`POST …/intelligence/regenerate`、`PATCH …/intelligence/review`
- **THEN** 四次都返回 401，正文 `error` 为「未登录」

#### Scenario: 已停用的账号
- **WHEN** 账号已停用、此前是项目管理员的用户带着旧会话调用 `POST …/ai-bid-package/run-step`
- **THEN** 返回 401

### Requirement: 与项目无关的登录用户返回 403
已登录、但不属于对应放行名单的调用者，系统 SHALL 返回 403。读权限的四个处理函数正文 `error` 为「无权查看该项目」，写权限的两个处理函数正文 `error` 为「无权修改该项目」。「与项目无关」SHALL 包括：
- 别的组织的用户，包括别的组织的管理员；
- 同一组织里不是该项目成员、也不是组织所有者或管理员的用户；
- 项目成员身份已停用的原项目成员；
- 组织成员身份已停用、又不是该项目成员的原组织管理员。

#### Scenario: 别的组织的管理员
- **WHEN** 另一个组织的管理员分别调用这六个处理函数
- **THEN** 六次都返回 403

#### Scenario: 同组织但不是项目成员
- **WHEN** 同一组织的普通成员（不是该项目成员、不是组织管理员）调用 `GET …/ai-bid-package` 与 `PATCH …/intelligence/review`
- **THEN** 两次都返回 403，正文 `error` 为「无权查看该项目」

#### Scenario: 已停用的项目成员与组织管理员
- **WHEN** 项目成员身份为 inactive 的用户调用 `POST …/intelligence/regenerate`；组织成员身份为 inactive 的原组织管理员（不是该项目成员）调用 `POST …/ai-bid-package`
- **THEN** 两次都返回 403

### Requirement: 项目不存在或未分发返回 404
项目 ID 不存在时，六个处理函数 SHALL 对已登录调用者返回 404，正文 `error` 为「项目不存在」。项目还没分发时，除平台 super_admin 外的调用者（包括项目成员与项目负责人）SHALL 同样得到这个 404。

#### Scenario: 不存在的项目
- **WHEN** 已登录用户对一个不存在的项目 ID 调用 `POST …/ai-bid-package` 与 `GET …/intelligence/review`
- **THEN** 两次都返回 404，正文 `error` 为「项目不存在」

#### Scenario: 未分发的项目
- **WHEN** 项目负责人对一个还没分发的项目调用 `POST …/ai-bid-package/run-step`
- **THEN** 返回 404，该项目任务的各步骤状态不变

### Requirement: 一键投标方案只认本项目的任务
有权限的调用者用 `GET /api/projects/:id/ai-bid-package?taskId=…` 或 `POST /api/projects/:id/ai-bid-package/run-step` 指定的任务不存在、或属于别的项目时，系统 SHALL 返回 404，正文 `error` 为「任务不存在」，并且 SHALL NOT 执行、修改或返回那个任务。

#### Scenario: 用别的项目的任务 ID
- **WHEN** 项目甲的项目管理员调用 `POST /api/projects/甲/ai-bid-package/run-step`，正文 `taskId` 是项目乙的任务
- **THEN** 返回 404，正文 `error` 为「任务不存在」；项目乙这个任务的状态与各步骤都不变

### Requirement: 被拒绝的请求不产生任何改动
六个处理函数返回 401、403 或「项目不存在」的 404 时，系统 SHALL NOT 做下面任何一件事：
- 新建、修改任何一键投标方案任务或其步骤；
- 修改项目情报（包括审核状态、审核备注、评分、审核人与审核时间）；
- 修改项目本身的记录（结构化摘要）；
- 删除或重建该项目的相似项目记录；
- 发起任何模型调用；
- 给任何人发站内通知。

#### Scenario: 被拒的执行不调模型、不发通知
- **WHEN** 另一个组织的用户调用 `POST …/ai-bid-package/run-step`，任务的下一步是文档摘要，项目里有一份已解析、待摘要的文件
- **THEN** 返回 403；本机假模型服务收到 0 次请求；这一步仍是待执行，文件的摘要状态不变，项目成员没有新通知

#### Scenario: 被拒的重新生成不动情报与相似项目
- **WHEN** 另一个组织的用户调用 `POST …/intelligence/regenerate`，项目里有已解析的文件、已有的情报与相似项目记录
- **THEN** 返回 403；本机假模型服务收到 0 次请求；情报记录、项目记录与相似项目记录都与请求前一致

#### Scenario: 被拒的审核不改审核结论
- **WHEN** 同组织但不是项目成员的用户调用 `PATCH …/intelligence/review`，正文 `reportStatus` 为 `approved`
- **THEN** 返回 403；情报的审核状态、审核人、审核时间、备注、评分都与请求前一致

#### Scenario: 隔离库测试
- **WHEN** 用隔离库运行 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts`
- **THEN** 全部用例通过，退出码为 0

### Requirement: 被拒绝的响应不带任务与情报内容
六个处理函数返回 401、403 或 404 时，响应正文 SHALL NOT 包含下面任何内容：
- 任务 ID、步骤列表、步骤输出（文档摘要、情报、报价草稿的行项与价格、询价邮件草稿）、步骤报错；
- 情报的审核状态、审核备注、评分、审核人、推荐结论、风险等级、匹配分、报告元数据。

正文 SHALL 只有 `error` 一个说明字段（以及服务端统一附带的请求编号，如果有）。

#### Scenario: 被拒的查看不回报价草稿
- **WHEN** 另一个组织的用户调用 `GET …/ai-bid-package`，项目里有一个已完成的任务，其报价草稿步骤的输出带价格
- **THEN** 返回 403，响应正文里没有 `taskId`、`steps` 字段，也不出现报价草稿里的任何文字与价格

#### Scenario: 被拒的读取不回审核结论
- **WHEN** 另一个组织的用户调用 `GET …/intelligence/review`，项目情报带审核备注与审核人
- **THEN** 返回 403，响应正文里没有 `reportStatus`、`reviewNotes`、`reviewedBy`、`recommendation` 字段，也不出现备注与审核人的文字
