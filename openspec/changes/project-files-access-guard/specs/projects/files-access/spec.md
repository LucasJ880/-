# Spec Delta

## Purpose

项目文件接口（文件列表、上传、删除、逐步处理）谁能调用、被拒绝时返回什么状态码，以及被拒绝的请求不改数据、不删原文件、不泄露文件信息。

## ADDED Requirements

### Requirement: 项目文件接口只对与项目有关的人开放
项目文件的四个接口——`GET /api/projects/:id/files`、`POST /api/projects/:id/files`、`DELETE /api/projects/:id/files/:fileId`、`POST /api/projects/:id/files/process-next`（含 `?retry=1`）——SHALL 只对下面四类调用者执行：平台 super_admin、项目负责人、项目所在组织的所有者或管理员（组织成员身份 active）、该项目的 active 成员（不论项目角色）。对这四类调用者，已分发项目上四个接口的请求、返回与副作用 SHALL 与加检查之前一致（未分发项目见「项目不存在或未分发返回 404」）。

#### Scenario: 成员逐步处理
- **WHEN** 项目的 active 成员（项目角色 `viewer`）对一个没有待处理文件的项目调用 `POST …/files/process-next`
- **THEN** 返回 200，正文 `done` 为 `true`、`step` 为 `none`

#### Scenario: 成员重试失败的文件
- **WHEN** 项目的 active 成员调用 `POST …/files/process-next?retry=1`，项目里有一份解析失败的文件
- **THEN** 返回 200，该文件回到待解析状态、解析报错被清空

#### Scenario: 成员删除文件
- **WHEN** 项目的 active 成员调用 `DELETE …/files/:fileId`，该文件属于这个项目
- **THEN** 返回 200，正文为 `{"success":true}`，文件记录与存储里的原文件都不存在了

#### Scenario: 负责人、组织管理员、super_admin
- **WHEN** 项目负责人、项目所在组织的管理员（不是项目成员）、平台 super_admin（不属于该组织）分别调用 `POST …/files/process-next`
- **THEN** 三次都返回 200

#### Scenario: 成员看文件列表
- **WHEN** 项目的 active 成员调用 `GET …/files`
- **THEN** 返回 200 与该项目的文件列表

### Requirement: 未登录返回 401
没有有效登录会话的请求调用四个项目文件接口中的任何一个，系统 SHALL 返回 401，正文 `error` 为「未登录」。账号已停用的会话 SHALL 按未登录处理。

#### Scenario: 未登录逐步处理与删除
- **WHEN** 不带会话调用 `POST …/files/process-next?retry=1` 与 `DELETE …/files/:fileId`
- **THEN** 两次都返回 401，正文 `error` 为「未登录」

#### Scenario: 已停用的账号
- **WHEN** 账号状态不是 active 的用户带着此前签发的会话调用 `DELETE …/files/:fileId`
- **THEN** 返回 401

### Requirement: 与项目无关的登录用户返回 403
已登录、但不属于上面四类的调用者调用四个项目文件接口中的任何一个，系统 SHALL 返回 403，正文 `error` 为「无权查看该项目」。「与项目无关」SHALL 包括：别的组织的用户；同一组织里不是该项目成员、也不是组织管理员的用户；成员身份已停用的原项目成员；组织成员身份已停用、又不是该项目成员的原组织管理员。

#### Scenario: 别的组织的用户逐步处理
- **WHEN** 另一个组织的 active 用户调用 `POST …/files/process-next` 与 `POST …/files/process-next?retry=1`
- **THEN** 两次都返回 403

#### Scenario: 别的组织的用户删除文件
- **WHEN** 另一个组织的 active 用户调用 `DELETE …/files/:fileId`，`fileId` 是该项目里真实存在的文件
- **THEN** 返回 403

#### Scenario: 同组织但不是项目成员
- **WHEN** 同一组织的普通成员（不是该项目成员、不是组织管理员）调用 `DELETE …/files/:fileId` 与 `POST …/files/process-next?retry=1`
- **THEN** 两次都返回 403

#### Scenario: 已停用的项目成员
- **WHEN** 项目成员身份为 inactive 的用户调用 `POST …/files/process-next?retry=1`
- **THEN** 返回 403

#### Scenario: 已停用的组织管理员
- **WHEN** 组织成员身份为 inactive 的原组织管理员（不是该项目成员）调用 `POST …/files/process-next?retry=1` 与 `DELETE …/files/:fileId`
- **THEN** 两次都返回 403

#### Scenario: 别的组织的用户看列表与上传
- **WHEN** 另一个组织的 active 用户调用 `GET …/files` 与 `POST …/files`
- **THEN** 两次都返回 403

### Requirement: 项目不存在或未分发返回 404
项目 ID 不存在时，四个项目文件接口 SHALL 对已登录调用者返回 404，正文 `error` 为「项目不存在」。项目还没分发时，除平台 super_admin 外的调用者（包括项目成员）SHALL 同样得到这个 404。

#### Scenario: 不存在的项目
- **WHEN** 已登录用户对一个不存在的项目 ID 调用 `POST …/files/process-next` 与 `DELETE …/files/:fileId`
- **THEN** 两次都返回 404，正文 `error` 为「项目不存在」

#### Scenario: 未分发的项目
- **WHEN** 项目成员对一个还没分发的项目调用 `POST …/files/process-next?retry=1`
- **THEN** 返回 404，项目里失败的文件没有被重置

### Requirement: 删除只认本项目的文件
有权限的调用者调用 `DELETE /api/projects/:id/files/:fileId` 时，`fileId` 不存在或属于别的项目，系统 SHALL 返回 404，正文 `error` 为「文件不存在」，并且 SHALL NOT 删除任何文件记录或存储里的原文件。

#### Scenario: 用别的项目的文件 ID
- **WHEN** 项目甲的成员调用 `DELETE /api/projects/甲/files/:fileId`，`fileId` 是项目乙的文件
- **THEN** 返回 404，正文 `error` 为「文件不存在」，项目乙的这份文件记录与原文件都还在

### Requirement: 被拒绝的请求不产生任何改动
四个项目文件接口返回 401、403 或「项目不存在」的 404 时，系统 SHALL NOT 修改或删除任何项目文件记录，SHALL NOT 删除存储里的原文件，SHALL NOT 修改项目本身的记录（按文件补全项目字段），SHALL NOT 启动文件解析、AI 摘要、项目情报分析或招标分析的自动入队。

#### Scenario: 被拒的重试不重置文件
- **WHEN** 另一个组织的用户调用 `POST …/files/process-next?retry=1`，项目里有一份解析失败、带解析报错与已抽取文字的文件
- **THEN** 返回 403，这份文件的解析状态、解析报错、已抽取文字、摘要状态与摘要内容都与请求前一致

#### Scenario: 被拒的删除不删文件
- **WHEN** 另一个组织的用户调用 `DELETE …/files/:fileId`
- **THEN** 返回 403，文件记录还在，存储里的原文件还在

#### Scenario: 未登录的请求不改数据
- **WHEN** 不带会话调用 `POST …/files/process-next?retry=1` 与 `DELETE …/files/:fileId`
- **THEN** 两次都返回 401，文件记录与存储里的原文件都与请求前一致

### Requirement: 被拒绝的响应不带文件信息
四个项目文件接口返回 401、403 或 404 时，响应正文 SHALL NOT 包含项目里任何文件的 ID、标题、解析报错原文、已抽取文字或存储地址；正文 SHALL 只有 `error` 一个说明字段（以及服务端统一附带的请求编号，如果有）。

#### Scenario: 被拒的逐步处理不回文件标题与报错
- **WHEN** 另一个组织的用户调用 `POST …/files/process-next`，项目里有待解析的文件与带解析报错的文件
- **THEN** 返回 403，响应正文里没有 `documentId`、`documentTitle`、`parseError` 字段，也不出现这些文件的标题与报错文字

### Requirement: 项目文件目录下的接口必须先过项目权限检查
`src/app/api/projects/[id]/files/` 目录下每个路由文件导出的每个 HTTP 处理函数 SHALL 在读写数据库、访问文件存储、启动解析或模型调用之前先完成项目权限检查。仓库 SHALL 有一个不依赖数据库的守卫测试覆盖该目录下的全部路由文件；目录下新增的路由文件或处理函数没有先过项目权限检查时，该测试 SHALL 失败。

#### Scenario: 守卫测试
- **WHEN** 运行 `npx tsx src/lib/projects/__tests__/files-route-guard.test.ts`
- **THEN** 目录下每个路由文件的每个处理函数都通过检查，退出码为 0

#### Scenario: 漏了检查的处理函数
- **WHEN** 目录下某个处理函数在项目权限检查之前（或完全不做检查）就读写数据库
- **THEN** 守卫测试退出码非 0，并指出是哪个文件的哪个处理函数
