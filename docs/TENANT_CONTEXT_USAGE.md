# TenantContext 使用规范（Phase 2A）

## 原则

1. **禁止业务服务自行解析 orgId**  
   从 `requireTenantContext` / `resolveAgentTenant` 取得，不要在 service 里读 `body.orgId` 当权威来源。

2. **禁止相信 body/query 中的 orgId**  
   客户端传入的 orgId 只可作为「解析线索」，最终必须经 membership 校验后采用 `TenantContext.orgId`。

3. **禁止按资源 id 直接 update/delete**  
   写操作必须带 org 边界：`where: { id, orgId: tenant.orgId }`，或先 `assertEntityBelongsToOrg`。

## 高风险入口（本轮优先覆盖）

| 入口 | 要求 |
|------|------|
| 写操作 API | `requireTenantContext` |
| 文件下载 | pathname 声明 org + membership |
| 向量/知识检索 | 查询带 orgId；工具经 `canInvokeTool` |
| Agent 工具 | `hasMembership` + `orgRole` + modules + risk |
| PendingAction 执行 | 使用创建时的 orgId，再校验 membership |
| 审批恢复 | 同上 |
| 后台脚本 / 批量任务 | 显式传入 orgId，禁止默认某企业 |

## Agent 工具授权

```ts
canInvokeTool({
  tenant,
  hasMembership,
  tool,
  workspaceId?,
  riskLevel?,
  modulesJson?,
  toolPolicy?,
});
```

平台管理员**没有** OrganizationMember 时，**不能**调用企业业务工具。

## 配置缺失

企业级配置必须区分：`ok` / `missing` / `invalid` / `incompatible`。  
缺失时：使用**平台通用默认**，或停止高风险业务，并在经营中心展示问题。  
**禁止**静默使用另一家企业的语义或规则。
