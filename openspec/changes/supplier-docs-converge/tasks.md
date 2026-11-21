# Tasks：菜单里的供应商文件收口到询价单（RFQ-PDF-1）

开工前跑一遍要触碰模块的已注册测试并记下基线通过数，写进报告：`tender-rfq/__tests__` 的 attachment / build / round-pure / web-entry-pure / auto-draft-pure，`projects/generate/__tests__/tender-doc-html`，`bid-workflow/__tests__` 的 china-supplier-brief / project-identity-deny / bid-workflow-phase1，`pdf/__tests__/cjk-pdf`，`tender-intel/__tests__/analyst-memo-v1`；隔离库 attachment-db / supplier-identity-guard-db / auto-draft-db。

## 1. 询价单的共用生成

- [x] 1.1 `src/lib/tender-rfq/build.ts` 新增「把招标原文留空的那一份」的函数，`service.ts` 改为调用；`attachment-service.ts` 新增「模板文字过禁出清单 → 渲染 → 检查，返回 HTML 与 PDF 字节」的函数，`draftRfqAttachment` 改为调用（design D2，输出不变）；verify：`attachment.test.ts`、`build.test.ts`、`round-pure.test.ts` 不改期望值通过，隔离库 `attachment-db.isolated.test.ts`、`supplier-identity-guard-db.isolated.test.ts` 不改期望值通过
- [x] 1.2 新增 `src/lib/tender-rfq/sheet-download.ts`（纯函数：按 design D1 / D3 / D6 排内容、失败的错误码与说明、带错误码的异常类型）与 `sheet-download-service.ts`（读项目资料、渲染并检查，返回 HTML、PDF、元数据或抛出）与 `src/lib/tender-rfq/__tests__/sheet-download.test.ts`（起草日期按组织时区、截标当天照常、五种失败的错误码 / 状态码 / 说明且说明不含命中原文），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts` 通过，`bash scripts/check-test-registry.sh` 通过

## 2. 生成接口与落库

- [x] 2.1 `generate-docs.ts`：`supplier_rfq` 分支改为调用 1.2 并直接存检查过的 PDF（design D4 / D5：标题、版本号、过期标记、元数据、不回落 HTML），落库函数拆成「转换」与「落库」两步、内部文件照旧；`generate-pdf/route.ts`：按 design D6 映射 422 / 503；新增隔离库 `src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`（内容来源、与附件内容指纹相同、附件开关关闭照样生成且零出站、分析综合里的「毛利」「预算」与采购方带不进来、联邦标不含身份、五种不生成且记录数不变、第二次生成的标题与过期标记、内部文件回落）并注册（test-all + test-ci-unit）；verify：本机隔离库该测试全部通过，`npm run typecheck` 通过

## 3. 下线与清理

- [x] 3.1 下线 `tech_confirm` / `china_supplier_brief`（design D7）：`pdf-doc-types.ts` 白名单与已停用名称表、路由 400 `DOC_TYPE_RETIRED`、去掉 `GenerateDocType` 两个成员与三个入参及 `fontLimitation`；`project-generate-menu.tsx` 去掉两项并把 `supplier_rfq` 改名「供应商询价单 PDF」；删除 `china-supplier-brief-panel.tsx` 与 `bid-tab.tsx` 的引用；`start-intelligence.ts` 默认清单去掉简报一项；隔离库测试补「两类 POST 被拒、不认识的类型照旧、GET 仍列出旧记录」，`sheet-download.test.ts` 补菜单 / 页签 / 清单的源码断言；verify：两个新测试通过，`npm run typecheck` 与 `npm run lint:baseline` 通过
- [x] 3.2 清理不再被调用的代码与测试（design D8）：`tender-doc-html.ts` 的供应商询价表模板、`china-supplier-brief.ts` 的简报拼装（保留敏感词判断）、`pdf-common.ts` 的 `sanitizeSupplierFacing`、`generate-docs.ts` 里的旧路径；改 `tender-doc-html` / `china-supplier-brief` / `project-identity-deny` / `cjk-pdf` / `analyst-memo-v1` / `bid-workflow-phase1` 六个测试里指向被删代码的断言与注册表里的名称；`scripts/cjk-pdf-e2e.ts` 换成仍存在的类型；`sheet-download.test.ts` 补「生成代码不再引用分析综合的供应商询价表模板与简报正文拼装」的源码断言；verify：六个测试逐个通过，`grep -rn "buildSupplierRfqHtml\|buildChinaSupplierBriefText\|sanitizeSupplierFacing" src scripts --exclude-dir=__tests__` 无结果（测试里只剩否定断言），`npm run typecheck` 通过

## 4. 端到端与收尾

- [x] 4.1 真实 Chromium 抽检：用隔离库里的联邦标样例从菜单路径生成一份，确认以 `%PDF-` 开头、内嵌 Noto Sans SC、页数与同一样例的附件相同、文字层不含招标身份；verify：命令与输出写进报告
- [ ] 4.2 全量门禁：`npm test`（失败项与开工前基线逐项对照）、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate supplier-docs-converge --strict`；`git diff origin/main -- prisma/ vercel.json` 为空；verify：输出写进报告
- [ ] 4.3 写 `docs/QINGYAN_RFQ-PDF-1_REPORT.md` + 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`（新增 RFQ-PDF-1、RFQ-PDF-2 两行，状态列如实）；verify：两个文件与 `docs/QINGYAN_RFQ-PDF_TASKBRIEF.md` 都在 PR diff 里

## Workflow follow-up

- `/opsx:verify supplier-docs-converge` → 多维审查（至少四个维度，逐条核实后修）→ 开 PR（正文含「多维审查」一节）→ 停下等合并口令。
- 合并前对照 #538（CHAIN-2d）对 `generate-docs.ts` 的改动；谁后合并谁 rebase，两边改动都保留。
- 合并后 `/opsx:archive supplier-docs-converge --yes`（独立小 PR，同步 TASKFLOW 状态列，至少一个子 agent 核对主规格与 delta 一致）。
- 接着做 RFQ-PDF-2 `rfq-sheet-template-v2`（合规取证清单在那里并入询价单）。
