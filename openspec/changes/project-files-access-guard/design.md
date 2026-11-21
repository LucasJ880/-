# Design：项目文件的删除与逐步处理接口补上项目权限检查（FIX-17）

## Context

动机见 proposal.md 的 Why。只写决定做法需要的现状：

- 两个缺口路由都包在 `withAuth`（`src/lib/common/api-helpers.ts`）里：它只做「有会话且账号 active」、统一的异常兜底（500 / schema 漂移 503）和 `x-request-id` 响应头，不看项目。
- 现成的项目守卫在 `src/lib/projects/access.ts`：
  - `requireProjectReadAccess`：未登录 401；项目不存在 404；super_admin 放行；项目未分发 404；负责人 / 组织管理员 / active 项目成员放行；其余 403「无权查看该项目」。
  - `requireProjectWriteAccess`：同样的 401 / 404；放行 super_admin / 负责人 / 组织管理员 / 项目管理员；其余 403「无权修改该项目」。
- 同一份资源的同类接口用的是读权限：上传 `POST …/files`（`files/route.ts`，注释写明「需项目读权限（成员/owner/admin）；阻止跨组织上传与误触发分析入队」）、清单写入 `POST …/checklist`、浏览器读文件的代理 `/api/files/projects/:projectId/...`。
- `withAuth` 里再调项目守卫已有先例：`src/app/api/projects/[id]/ai-summary/route.ts`。
- 这两个接口的调用方只有两个前端组件：`src/components/project-files/project-file-manager.tsx`（上传后自动循环调 `process-next`；打开时发现失败文件自动带 `?retry=1` 调一次；删除按钮对所有人显示，且不看请求结果）与 `src/components/project-create/project-import-banner.tsx`（新建项目导入文件夹后循环调 `process-next`，调用者是刚建项目的负责人）。没有服务端调用方、没有 cron、没有数字员工工具调这两个接口。

## Goals / Non-Goals

**Goals:**

- 两个缺口接口在任何读写、Blob 访问、解析、模型调用、自动入队之前先过项目权限检查。
- 有权限的人看到的请求、返回、副作用一字不变。
- 目录下以后新增的路由漏了检查，CI 里就失败。

**Non-Goals:**

- 不改 `src/lib/projects/access.ts`（守卫本身、文案、放行名单）。
- 不改 `src/lib/common/api-helpers.ts`（`withAuth`）。
- 不改 `src/app/api/projects/[id]/files/route.ts`（列表与上传，已有守卫）。
- 不改 `src/components/project-files/**`、`src/components/project-create/**`（界面）。
- 不改 `src/lib/files/**`（解析、摘要、情报、Blob 访问）与 `src/lib/tender-auto-analysis/**`（自动入队）。
- 不改 `src/lib/tender-workforce/tools.ts`（顺带核对的那一条只写结论）。
- 不改 `prisma/**`。
- 不查 `src/app/api/projects/[id]/files/**` 以外的路由有没有同类缺口。

## Decisions

### D1 用现成的 `requireProjectReadAccess`，不新造守卫

两个处理函数的第一步调它，返回的是响应就原样返回。

- 被否决：新写一个「项目文件守卫」。放行名单与读权限守卫一模一样，多一个入口只多一处以后会漂移的地方。
- 被否决：在路由里手写成员查询。全站项目可见性的统一入口就是 `access.ts`（文件头注释要求所有面向用户的项目鉴权走它），手写会绕开未分发项目 404、岗位预览等已经收在里面的规则。

### D2 `process-next`（含 `?retry=1`）用读权限

- 被否决：写权限。文件抽屉每次上传完自动调 `process-next`，打开时发现失败文件还会自动带 `?retry=1`；上传放行所有成员，这里只放行管理者的话，普通成员传的文件永远停在待解析，而且界面遇到非 200 只是悄悄停下。模型费用这一条不构成用写权限的理由：成员上传文件本身就会触发同样的解析与摘要。
- 被否决：不带 `retry` 用读权限、带 `retry` 用写权限。同上——`retry` 是界面自动发的，不是管理动作。

### D3 `DELETE` 用读权限（审核时最需要拍板的一条）

- 被否决：写权限。理由三条：① 今天所有成员都能删，界面也对所有成员显示删除按钮，换成写权限是在安全修复里顺带改成员分工，属于产品决定；② 同一份资源的写入（上传、清单）都是读权限，「能传不能删」会让传错文件的成员只能找管理者；③ 删除按钮不看请求结果，403 会表现为点了没反应，要一并改界面（把项目页已有的 `canManage` 传进文件抽屉、隐藏按钮），超出本次范围。
  这条备选并非没有依据：项目路由里其它 `DELETE`（项目、成员、环境、供应商关联、知识库文档、盯梢）用的是写权限，删 Blob 也不可恢复。**审核时选它的话**：`[fileId]/route.ts` 换成 `requireProjectWriteAccess`，规格里「成员删除文件」改成 403、加「项目管理员删除」，测试相应调整，另加一条界面任务（隐藏按钮或提示无权限）。
- 被否决：只有上传人本人或管理者能删。仓库里没有这种先例，是新规则。

### D4 保留 `withAuth` 外壳，守卫放在处理函数第一行

- 被否决：去掉 `withAuth`，改成普通 `export async function`。会丢掉统一的异常兜底（解析 / 模型抛错时的 500、schema 漂移的 503）与 `x-request-id`，这两个接口恰好是最容易抛错的。代价是每次请求多查一次用户（`withAuth` 一次、守卫一次），`ai-summary` 路由已经是这样。
- `process-next` 里后面用到的 `user.id`（自动入队的发起人）继续用 `withAuth` 传进来的那个；两处解析出来的是同一个会话用户。

### D5 `DELETE` 的检查顺序：项目权限 → 查文件 → 删 Blob → 删记录

- 被否决：先查文件再查权限。与项目无关的人能靠 404 / 403 的差别探测某个文件 ID 在不在这个项目里。先过权限，对无关的人永远是 403。

### D6 测试两层

1. **守卫测试**（不要数据库，进 CI 子集）`src/lib/projects/__tests__/files-route-guard.test.ts`：列出 `src/app/api/projects/[id]/files/` 下全部 `route.ts`，对每个导出的 `GET / POST / PUT / PATCH / DELETE` 处理函数，断言函数体里项目守卫调用（`requireProjectReadAccess` / `requireProjectWriteAccess` / `requireProjectManageAccess`）出现在第一次碰 `db.`、Blob 删除、解析、摘要、情报、入队之前；并断言目录下至少找到已知的三个路由文件（防止路径写错导致空跑）。
   - 被否决：`authz-contract.test.ts` 那种「文件 → 必需符号」的固定清单。清单管不到以后新加的路由文件；按目录枚举才管得到。
2. **隔离库 + HTTP 测试**（进 `scripts/test-all.sh`，隔离库执行、否则跳过）`src/lib/projects/__tests__/files-access-db.isolated.test.ts`：直接调路由导出的处理函数，带 `createSession` 签的会话 cookie（`supplier-intel-s2tb-db.isolated.test.ts` 的做法）。夹具：组织甲（负责人、组织管理员、项目成员 `viewer`、同组织非成员、成员身份 inactive 的人）、组织乙（一个 active 用户）、super_admin、一个已停用账号；项目甲（已分发）、项目甲二（未分发）、项目乙。
   - 被否决：只有守卫测试。它证明「调用了守卫」，证明不了「被拒时数据库与 Blob 没动」。
   - 被否决：mock 掉 `db`。仓库的约定是真库；跨组织成员关系的判断正是要测的东西。
   - **Blob 没被动怎么观察**：打开 `blob-access.ts` 已有的本地存储开关（`PRODUCT_CONTENT_LOCAL_STORE=1` + 临时目录），用 `putPrivateBlob` 放一个真文件；被拒后断言文件还在，成员删除后断言文件没了。被否决：拦截 `@vercel/blob` 的网络请求——要改被测代码或打补丁，本地存储开关是现成的。
   - **有权限的路径不触发解析与模型**：夹具里失败的文件用不进解析队列的类型（`png`），项目里没有已完成的摘要，所以成员调 `process-next` 走到 `step: "none"`；测试不配任何模型密钥。项目 `workDomain` 不是招标，自动入队在门口短路。

### D7 「改动前失败」怎么取证

先写两个测试、不改路由，各跑一遍把输出存下来（预期：守卫测试指出 `process-next` 的 `POST` 与 `[fileId]` 的 `DELETE`；隔离库测试里所有 403 用例拿到 200，且失败文件被重置、文件记录与本地 Blob 被删）；再改路由重跑。两份输出都贴进报告。

- 被否决：改完再 `git stash` 回去跑。顺序反了容易把「测试本身写错」误当成「修好了」。

## 与八条硬纪律的关系

1. 零 schema：遵守。不新增 model / 字段 / migration；测试只写夹具数据到隔离库。
2. 出站动作先审批：不涉及。没有任何对外发送。
3. 禁止第三套队列：遵守。不新增队列 / 调度 / lease；`process-next` 仍是前端逐步驱动，自动入队仍走既有的 `enqueueTenderPackageIfReady`，本次只是在它前面加了门。
4. 脱敏：不涉及 Muse 通道。与脱敏方向一致的一点：被拒的响应不带文件标题与解析报错（规格里有 SHALL NOT）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。不新增模型调用；权限判断是查表（成员关系），没有模型参与。无关调用者以后触发不了解析与摘要，模型调用只会少不会多。
8. 测试注册：遵守。两个新测试都注册进 `scripts/test-all.sh`；守卫测试同时进 `scripts/test-ci-unit.sh`；`bash scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不加行。

## 验证方式

- `npx tsx src/lib/projects/__tests__/files-route-guard.test.ts`：改动前退出码非 0（列出两个处理函数），改动后 0。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… DIRECT_URL=… npx tsx src/lib/projects/__tests__/files-access-db.isolated.test.ts`：改动前 403 / 数据未变的用例失败，改动后全部通过；连跑 3 次结果一致。
- `npm test` 对照既有失败清单无新增；`npm run test:ci` PASS；`npm run typecheck` 退出码 0；`npm run lint:baseline` PASS；`bash scripts/check-test-registry.sh` OK；`openspec validate project-files-access-guard --strict` valid。

## Risks / Trade-offs

- [有人正靠这个缺口干活（不是成员却在处理 / 删除别的项目的文件）] → 合并后这些请求变 403。界面上到不了这一步（非成员打不开项目页），所以只可能是脚本或手工请求；不保留兼容。
- [未分发项目的文件在分发前处理不了] → 非 super_admin 对未分发项目本来就打不开项目页、也传不了文件（上传走同一个守卫），分发后成员打开文件抽屉会自动继续处理；不是新限制。
- [`viewer` 角色的成员也能删文件] → 与今天一致，也与「`viewer` 能上传」一致；要收紧见 D3 的备选。
- [守卫测试靠读源码判断先后，写法变了可能误报或漏报] → 只认三个守卫名字与一小组「碰数据」的标记，新路由用了别的写法时测试失败并指出位置，由人决定是改写法还是扩充标记；真正的行为由隔离库测试兜底。
- [每个请求多一次用户查询与一次项目 + 成员查询] → `process-next` 一步动辄数秒（解析 / 模型），几次主键查询可以忽略。

## Migration Plan

没有数据迁移、没有开关。合并即生效；回滚 = revert 这一个 PR（回到只查登录的状态）。
