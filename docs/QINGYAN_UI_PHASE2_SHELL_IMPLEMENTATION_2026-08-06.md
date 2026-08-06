# 青砚 UI/UX 更新：Phase 2 桌面工作台 Shell

日期：2026-08-06  
状态：基础 Shell 已完成；尚未把项目详情或其他业务页面迁入右栏。

## 本次交付

在既有 `AppShell` 基础上增加了可选的实体上下文契约，而不是重写全站 Layout：

```text
左侧：既有、按权限过滤的业务导航
顶部：既有搜索/通知/用户入口 + 可选的当前实体上下文
中间：保持原路由和页面工作区
右侧：页面明确登记后才出现的青砚上下文面板
```

- `WorkspaceShellProvider` 管理当前页面的业务上下文和右栏开关。
- `WorkspacePageContext` 是后续项目、客户、报价页面接入的声明组件；它不请求数据、不改 API、权限或 AI Scope。
- 桌面宽度 `>=1280px` 时右栏与工作区并列；`768–1279px` 时复用已有 `Drawer`，不压缩主工作区；`<768px` 不显示这个桌面上下文面板。
- 发生路由切换时右栏自动关闭，页面卸载时清理上下文，避免前一实体残留到下一页面。
- Header 只在页面登记上下文时显示实体标题与“青砚上下文”开关。

## 页面接入约定（供 Phase 3 使用）

业务页面仅登记面向用户的内容：实体类型、名称、简短状态、风险、推荐下一步、待确认动作。不得把 `Runtime`、`Tool Call`、`Executor`、`Scope`、`Environment`、`AgentRun` 或 Prompt 调试信息放进此插槽。

```tsx
const context = useMemo(
  () => ({
    eyebrow: "项目",
    title: project.name,
    summary: project.status,
    panelTitle: "项目上下文",
    panel: <ProjectBusinessContext projectId={project.id} />,
  }),
  [project.id, project.name, project.status],
);

return <WorkspacePageContext context={context} />;
```

页面负责继续使用其现有权限、项目数据和 Pending Action 流；Shell 只负责位置、响应式降级与打开/关闭状态。

## 兼容与回滚

- 未登记上下文的所有既有页面继续是原先的单栏工作区。
- `AppShell`、`Header`、`Sidebar`、移动导航、路由、API、权限与业务逻辑均保留。
- 删除本阶段提交即可回到现有 Shell；不需要数据库或数据回滚。

## 下一阶段

Phase 3 以项目详情作为首个接入页面：在不删除旧标签和子路由的前提下，将项目阶段、待处理事项、风险、最近变化、推荐下一步和 Pending Action 以面向业务用户的语言登记到该上下文面板。
