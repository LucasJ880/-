# 青砚 UI/UX 更新：Phase 0 + Phase 1 实施报告

日期：2026-08-06  
范围：仅 Phase 0（审计与视觉基线）和 Phase 1（共享设计系统收敛）。

## 1. 本轮范围与边界

已完成：视觉基线、页面与组件清单、共享页面标题、按钮、徽章/状态、空状态、对话框、抽屉和滚动锁的收敛。

明确未做：没有修改 Prisma Schema 或 migration；没有修改 API、权限、角色、AI Scope、Pending Action 审批机制、邮件机制、业务数据或报价计算；没有删除功能、重写全站 Layout、改变路由或项目详情的信息架构。

## 2. Phase 0：可回归的视觉基线

基线位置：[docs/ui-ux-baseline](ui-ux-baseline/README.md)。它使用既有 Playwright 与本机 Chrome，在生产只读会话下记录以下四个宽度：1440、1024、768、390。

每个宽度均覆盖：首页、项目列表、项目详情入口状态、销售、AI 助手、能力中心、待处理动作、报价单。结果 JSON 记录在 `results-1440.json`、`results-1024.json`、`results-768.json`、`results-390.json`：32 个页面请求均为 HTTP 200，文档与主工作区均未检测到横向溢出；390px 下移动导航抽屉打开时 body/html/main 均锁定，关闭后均恢复。

说明：销售测试账号对指定项目详情返回“项目不存在或无权限”，因此该截图是权限状态基线，而非项目内容状态基线。下一轮应由具备授权的 QA 账号补齐非空项目详情、待处理审批、长表格、错误与加载状态。

## 3. Phase 1：组件与交互更新

| 组件 | 已收敛的规则 | 兼容性 |
| --- | --- | --- |
| `PageHeader` | 支持标题、描述、辅助元信息、主操作和次操作；窄屏自动换行 | 原有 `actions` 调用不变 |
| `Button` | 36px 常规最小高度、40px 图标触控目标、统一焦点环、`loading`/`loadingText` 与重复点击防护 | 原有 variant、size、`asChild` 不变 |
| `Badge` / `StatusBadge` | 增加中性语义与统一的中性、信息、成功、警告、危险、等待、执行中映射；未知状态保留原有安全回退 | 原有 `status` 与样式调用不变 |
| `EmptyState` | 支持紧凑、默认、整页密度和次操作；不把错误状态伪装成空状态 | 原有 `action` 不变 |
| `Dialog` | 小屏安全区内边距、可滚动内容、关闭按钮触控与焦点可见性 | 保留 Radix 的焦点和 ESC 行为 |
| `Drawer` | 右侧默认、底部和全屏三种展示；焦点进入/回归、Tab 焦点循环、安全区固定底栏、可配置遮罩关闭 | 旧的 `width` 与默认右侧抽屉不变 |
| `scroll-lock` | 引用计数锁定 body/html/main；路由切换后只恢复原主区，避免覆盖新页面的 overflow | 既有 API 不变 |
| `globals.css` | 全局焦点环、稳定滚动条预留、减少动态效果偏好 | 不涉及页面业务样式 |

## 4. 无障碍、移动端与滚动锁

- 所有本轮焦点入口使用可见焦点环；对话框和抽屉关闭操作都有可访问名称和至少约 44px 的触控区域。
- `Button` 在加载时提供 `aria-busy`，原生按钮禁用；`asChild` 情况阻止点击并设置 `aria-disabled`，避免重复提交。
- 抽屉打开时保存触发元素焦点，关闭后恢复；Tab 不会离开抽屉；Escape 仍可关闭。
- 抽屉、对话框内容使用 `overscroll-contain` 与安全区内边距；全局尊重减少动态效果偏好。
- 新增回归用例验证路由切换场景：原 `main` 正确恢复，新 `main` 不被旧锁错误覆盖。

## 5. 验证结果与已知限制

| 验证项 | 结果 |
| --- | --- |
| Phase 0 四宽度截图与溢出检查 | 通过（32 个页面状态，见基线结果 JSON） |
| 390px 抽屉锁定/关闭恢复 | 通过 |
| 滚动锁回归测试 | 通过，23 项断言 |
| 改动文件的 ESLint | 通过；CSS 文件因当前 ESLint 配置未匹配而仅给出忽略警告 |
| `git diff --check` | 通过 |
| 全量 TypeScript / 全量 ESLint | 本轮早期版本已通过；最后一次全量复跑在共享工作树中长时间无响应，需 CI 完成最终确认 |
| 标准 Turbopack build | 未通过：工作树的 `node_modules` 符号链接指向文件系统根外，Turbopack 报 `Symlink ... is invalid` |
| Webpack build 复核 | 编译阶段因同一共享工作树构建进程卡住而中止，未作为通过结果 |

上述构建限制为工作树依赖链接/构建环境问题，不是本轮组件代码已经确认的编译报错；仍应以 PR CI 的全量 typecheck、lint 和 build 作为合并门槛。Phase 1 尚未部署到预览环境，因此不能把生产基线误称为本轮改动后的视觉验收。

## 6. iPhone Safari 待验收清单

部署预览后，应在真实 iPhone Safari 验证：安全区顶部和底部、键盘打开后的表单与抽屉、Dialog 内容滚动、抽屉焦点与返回、上传照片、长报价表格、横竖屏切换、语音输入预留入口，以及不依赖 hover 的关键操作。

## 7. 建议的下一步（Phase 2，而非本轮实施）

建议先以 feature flag 或独立 Shell 组件完成桌面统一工作台：左侧业务导航、顶部上下文栏、中间工作区、可收起的右侧 AI/详情面板。不要一次替换现有 Layout；先选一个低风险入口接入，保留现有路由和权限校验，再逐步推广。项目详情样板页应留到 Phase 3。

## 8. 提交与回滚

- Phase 0 提交：`dd747386bf5f34cc83f0100d88082479f2bc0ede` — `docs(ui): establish desktop and mobile visual baseline`
- Phase 1 提交：本报告所在的第二个独立提交 — `refactor(ui): standardize core interface components`

两个阶段均为独立提交，回滚任一提交都不会触及数据库、API 或业务流程。
