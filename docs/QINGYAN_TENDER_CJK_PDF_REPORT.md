# CJK-PDF 包 — 中文安全文档生成 实施报告

日期：2026-08-17 深夜 · 分支 `feature/tender-cjk-pdf` · base = main（含 #128）

## 1. 症状与根因

用户报告：国内供应商 PDF / 总结文档「全是 html」或「下载受损打不开」。

| 症状 | 根因 |
|---|---|
| 备忘录 / 供应商 RFQ / 国内供应商简报 = .html | jsPDF 无 CJK 字体 → FB-4/5/16 止血为 HTML（让用户自己打印成 PDF） |
| 组员任务 / 技术确认等 .pdf 中文方块 | 仍走 jsPDF 路径，中文字符直接损毁 |
| 报价单中文被 ASCII 替换 | export-pdf.ts 注释自证：「后续可替换为服务端 Puppeteer 方案以完美支持中文」 |

## 2. 方案（落地代码里预言的路线）

**服务端 Chromium 统一 HTML→PDF 转换层**，复用既有 HTML 模板（排版零重写）：

- 新 `src/lib/pdf/html-to-pdf.ts`：puppeteer-core + @sparticuz/chromium（v147）；
  **CJK 字体 data-URI @font-face 注入**（Noto Sans SC 400/700，npm 包
  @expo-google-fonts 提供 TTF——lambda 镜像无中文字体，不注入=方块复辟；
  data-URI 平台无关，本地/CI/serverless 同一行为）+ `document.fonts.ready`
  等待；三级环境解析（env 显式 → Linux serverless sparticuz → macOS 系统
  Chrome）；**输出魔数健全性校验**（%PDF- + 尺寸下限），坏字节绝不当 PDF
  交付——「受损打不开」从机制上不可能复发。
- `generate-docs.ts` 两处手术：
  ① `persistGeneratedHtml` 漏斗升级=PDF 优先（.pdf / application/pdf /
  fileType=pdf），转换失败**显式降级**存 HTML（现状行为，renderMode 落
  meta + console.warn，绝不静默、绝不阻塞文档生成）；
  ② **jsPDF 生成路径整体退役**：五类 legacy 文本文档（supplier_rfq/
  internal_analysis 无综合回落、teammate_tasks、tech_confirm、
  owner_clarification）正文 1:1 并入同一漏斗（供应商脱敏
  sanitizeSupplierFacing 保留）。
- 配置：next.config `serverExternalPackages` += chromium/puppeteer-core；
  generate-pdf 路由 `maxDuration=60`（Chromium 冷启动实测首次 ~18s）。
- 面板过时文案（「复用既有 jsPDF」）纠正。

## 3. 证据

- 本地真实转换冒烟：中文 HTML → 89KB 真 PDF（%PDF-），unpdf 逐字抽回
  「供应商询价/达勒姆/样品交期」全中
- **真实 E2E 7/7**（隔离生产快照 + 全本地 blob，`scripts/cjk-pdf-e2e.ts`）：
  真实项目生成 china_supplier_brief + teammate_tasks → 落库真 PDF
  （renderMode=chromium_pdf / fileType=pdf / 项目文件列表登记 pdf）→
  unpdf 解析中文完好；**降级路径实测**：Chromium 不可用 → 显式
  html_fallback 存 HTML，零坏字节
- 纯平面探针 9/9（反例守卫：jsPDF 不得回潮 generate-docs）；
  CI 子集 PASS；tsc 零错；eslint 零告警

## 4. 部署影响（如实报）

- 新依赖：@sparticuz/chromium（二进制 ~70MB brotli，仅 trace 进生成文档
  路由）+ puppeteer-core + 字体包（400/700 两个 TTF 被 trace）；
  函数体积在 Vercel 250MB 限内——**PR 的 qingyan-staging 构建即是可部署性
  验证门**，merge 前以它为准
- 冷启动 +2~4s（生成文档为低频动作）；路由 maxDuration 60s
- 回滚 = revert（零 schema 零 env）

## 5. 遗留（P1）

- 报价单导出（quote/export-pdf.ts，客户端 jsPDF 链）迁移到同一转换层
  ——独立回归面，下一包
- 存量 .html 生成文档不回溯转换（用户重新生成即得 PDF）

## 6. Gate

```
CJK_SCHEMA_CHANGE      = NONE
CJK_PDF_PRIMARY        = PASS（三类 HTML 文档 + 五类 legacy 文本文档全部真 PDF 直出）
CJK_JSPDF_RETIRED      = generate-docs 零 jsPDF（反例守卫值守）
CJK_CORRUPT_IMPOSSIBLE = 魔数校验 + 显式降级（坏字节零入库，E2E 实测降级路径）
CJK_REAL_E2E           = PASS 7/7（隔离快照真实项目 + unpdf 中文逐字断言）
CJK_DEPLOYABILITY_GATE = PR qingyan-staging 构建（merge 前必须绿）
CJK_STATUS             = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
