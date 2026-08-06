# 青砚 UI/UX Phase 0 视觉基线

**测试日期：** 2026-08-06  
**测试提交：** `c64ca8e12d7ac8a4a7371f3cf770825996ce2b95`  
**目标环境：** `https://qingyan.ca`（只读登录；没有提交表单或写入业务数据）  
**浏览器：** Chromium / Playwright，复用本机 Chrome 可执行文件  
**脚本：** `scripts/ui-phase0-visual-baseline.ts`

## 运行方式

```bash
UI_AUDIT_EMAIL=... UI_AUDIT_PASSWORD=... \
  npx tsx scripts/ui-phase0-visual-baseline.ts https://qingyan.ca
```

可用 `UI_AUDIT_VIEWPORTS=1440,1024,768,390` 分批运行；可用
`UI_AUDIT_PROJECT_ROUTE=/projects/<id>` 指定当前测试账号可访问的项目样本。
凭据只通过环境变量传入，脚本和结果文件均不会写入凭据。

## 覆盖范围

每个视口均包含以下首屏截图：

| 页面 | 路由 |
|---|---|
| 工作台 | `/` |
| 项目列表 | `/projects` |
| 项目详情 / 权限态 | `/projects/<fixture>` |
| 客户与商机 | `/sales` |
| 数字员工 | `/assistant` |
| AI 工作中心 | `/capabilities` |
| Pending Action | `/capabilities/approvals` |
| 复杂报价表单 | `/sales/quote-sheet` |

目录：

```text
1440/  1024/  768/  390/
results-1440.json
results-1024.json
results-768.json
results-390.json
```

`390/mobile-nav-drawer-open.png` 为移动导航抽屉的打开态截图。

## 自动检查结果

| 视口 | 页面数 | HTTP | 页面 / 主工作区横向溢出 | 抽屉滚动锁 |
|---|---:|---|---|---|
| 1440 | 8 | 全部 200 | 0 / 0 | 不适用 |
| 1024 | 8 | 全部 200 | 0 / 0 | 不适用 |
| 768 | 8 | 全部 200 | 0 / 0 | 不适用 |
| 390 | 8 | 全部 200 | 0 / 0 | 打开：body/html/main 均为 `hidden`；Escape 关闭后恢复为空值 |

此检查只判断整页和 `main` 容器横向溢出；不等价于“所有宽表字段已可读”。

## 当前发现

1. 390px 的报价表单首屏没有整页横向溢出，底部销售导航可见；复杂多行报价编辑仍不属于手机 MVP。
2. 390px 的审批中心在当前空数据状态可读，但筛选按钮较密，真实长列表需要在后续阶段使用非空 fixture 复验。
3. 768px 是现有 `md` 壳切换点；截图无整页横向溢出，但这是桌面/移动导航切换的高风险回归点。
4. 当前销售测试账号可以访问项目列表，但选定的历史项目详情样本返回“项目不存在或无权访问”。该截图保留为权限态基线，**不是**已授权项目详情内容态的替代品。
5. Dialog / Drawer 的主入口已覆盖移动导航 Drawer；其他业务手写弹层不在本阶段逐页迁移，仅列为后续回归范围。

## 未覆盖范围

- iPhone Safari 真机：地址栏伸缩、软键盘、拍照选择器、safe-area、滚动回弹。
- 有真实 Pending Action、长表格、复杂报价明细、错误/加载慢网速的非空测试数据。
- 当前销售测试账号的已授权项目详情内容态；下次基线应提供无敏感数据的项目 fixture 或管理员 QA 账号。
- 完整键盘焦点顺序与屏幕阅读器验证；本轮只验证组件代码路径和 Drawer Escape/滚动锁。

## iPhone Safari 待验证清单

- 导航、Dialog、Drawer 连续开关与背景滚动恢复。
- 报价单输入时键盘不遮挡底部操作栏。
- 项目文件选择器与现场拍照 `capture` 流程。
- 安全区、横竖屏、地址栏收起/展开时的高度和固定栏。
