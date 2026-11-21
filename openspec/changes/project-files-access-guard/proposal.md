# Proposal：项目文件的删除与逐步处理接口补上项目权限检查

TASKFLOW：FIX-17（FIX-12 在未合并的 #540；FIX-13 `document-parse-nul-and-reason` 与预留的 FIX-14 / 15 / 16 都还没进 main 的 TASKFLOW，本次取下一个空号）
来源：2026-11-21 做 FIX-13 的安全审查时发现，不在 FIX-13 范围，另开。

## Why

`POST /api/projects/:id/files/process-next` 与 `DELETE /api/projects/:id/files/:fileId` 只检查「已登录」，不检查调用者与该项目的关系：任何一个登录账号（包括别的组织的）只要拿到项目 ID，就能把该项目失败的文件重置并清空解析结果、触发解析与 AI 摘要 / 项目情报分析（模型费用记在该项目头上）、从响应里读到文件标题与解析报错原文，或者删掉文件记录与 Blob 里的原文件。同目录的列表与上传早就用了项目权限守卫，这两个是漏掉的。

## What Changes

- 给 `POST /api/projects/:id/files/process-next`（含 `?retry=1`）加上项目权限检查，级别与上传相同：平台 super_admin、项目负责人、项目所在组织的管理员、项目的 active 成员放行；其余登录用户 403；项目不存在或还没分发 404；未登录 401。检查在任何读写、解析、模型调用、自动入队之前。
- 给 `DELETE /api/projects/:id/files/:fileId` 加上同一个检查，在查文件、删 Blob、删记录之前。
- 被拒绝的请求不改任何 `ProjectDocument` 行、不删 Blob、响应里不带文件标题与解析报错。
- 新增守卫测试：`src/app/api/projects/[id]/files/**` 下每个路由文件导出的每个处理函数都先过项目权限守卫，再碰数据库 / Blob / 解析；以后在这个目录下加路由漏了守卫，测试就失败。
- 新增隔离库 + HTTP 测试：未登录、别的组织的用户、同组织但不是项目成员的用户、已停用的项目成员都被拒，且数据库行与 Blob 文件原样；成员、负责人、组织管理员、super_admin 照常可用。

### 这个目录下每个路由的守卫（逐个读过代码）

| 路由文件 | 方法 | 改动前的守卫 | 结论 |
|---|---|---|---|
| `files/route.ts` | `GET`（列表） | `requireProjectReadAccess` | 已核对，不改 |
| `files/route.ts` | `POST`（上传） | `requireProjectReadAccess` | 已核对，不改 |
| `files/[fileId]/route.ts` | `DELETE` | 只有 `withAuth` | **缺口，本次补** |
| `files/process-next/route.ts` | `POST` | 只有 `withAuth` | **缺口，本次补** |

目录下没有别的路由（没有重命名、移动文件夹接口）。目录外顺带读过的两处：浏览器读项目文件的代理 `GET /api/files/projects/:projectId/...` 用的是项目读权限；`POST /api/projects/:id/checklist`（会新建 / 更新 `ProjectDocument`）用的也是项目读权限。两处都已核对，不改。

### 级别为什么是「读权限」（成员即可），不是「写权限」

仓库里现成的两个守卫：`requireProjectReadAccess`（super_admin / 负责人 / 组织管理员 / active 成员）与 `requireProjectWriteAccess`（super_admin / 负责人 / 组织管理员 / 项目管理员）。同一份资源的同类接口——上传、清单写入——用的都是前者。

- `process-next` 必须与上传同级：文件抽屉在每次上传完成后自动调它，打开抽屉发现有失败文件时还会自动带 `?retry=1` 调一次。上传放行成员、这里只放行管理者的话，普通成员传上去的文件永远停在「待解析」。
- `DELETE` 跟上传同级：今天任何成员都能删（界面对所有成员显示删除按钮），改成写权限等于在一个安全修复里顺带收紧成员之间的分工，而且界面的删除按钮不看请求结果，会变成「点了没反应」。项目路由里别的 `DELETE` 多数用写权限（项目本身、成员、环境、供应商关联、知识库文档、盯梢），用读权限的只有删草稿报价；这一条在 design 里写成被否决的备选，**审核时要改成写权限就在这里改**，规格、测试与界面跟着调。

## 受影响的 Muse 意图

无。不改 `src/lib/muse-bridge/` 下任何文件。

## Out of scope

- 成员之间谁能删文件的进一步细分（只有上传人或管理者能删等）：不做，见上。
- 守卫用的错误文案（删除被拒时也是「无权查看该项目」）：守卫是全站共用的，不为这两个接口改。
- `process-next` 成功响应里的 `parseError` 原文：对有权限的成员照旧返回；报错原文的清理归 FIX-13 / FIX-16。
- 界面：不改。有权限的人看到的行为不变；没权限的人本来就打不开项目页。
- `src/app/api/projects/[id]/files/**` 之外的路由：不查不改（上面两处只是顺带读到）。
- 数字员工工具把解析报错原文拼进 `error` 字符串（见下一节）：本次只写结论，不改代码。
- schema 变更、新的队列 / 调度、新的模型调用、新开关：没有。**没有开关，合并即生效。**

## 顺带核对：数字员工工具的 `DOCUMENT_PARSE_FAILED` 字符串

（子 agent 正在追这个字符串的去向，结论补在这里。）

## Capabilities

### New Capabilities

- `projects/files-access`：项目文件接口（列表、上传、删除、逐步处理）谁能调用、被拒时返回什么、被拒时不发生什么。

### Modified Capabilities

无。

## Impact

- 代码：`src/app/api/projects/[id]/files/process-next/route.ts`、`src/app/api/projects/[id]/files/[fileId]/route.ts`（各加一次守卫调用）；两个新测试；`scripts/test-all.sh`、`scripts/test-ci-unit.sh` 注册。
- 接口：两个接口对「登录但与项目无关」的调用者从 200 变成 403（项目不存在 / 未分发 404）；对有权限的调用者，请求、返回、副作用都不变。
- 依赖、数据库、环境变量：不变。
- 文档：`docs/QINGYAN_FIX-17_REPORT.md`；TASKFLOW 加 FIX-17 一行。
