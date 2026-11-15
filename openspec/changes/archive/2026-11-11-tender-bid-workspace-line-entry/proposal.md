# Proposal：投标工作区的逐行录入与补遗

TASKFLOW：TI-4c（Phase F，Tender Intelligence Phase C 第三项；来源 `docs/QINGYAN_TI-4b_REPORT.md` §6 第 2 条、`docs/tender-intelligence-gap-analysis.md` §6 的 N12）。依赖 TI-4b。审核：Lucas 2026-11-11 授权「其他你来主导，需要确定的按推荐做」，四件套不另等审核，实施后以 Draft PR 交付。

## Why

TI-4b 的面板只显示核对结果。拟投品牌型号、产品尺寸、证书都没有录入界面，所以「尺寸尚未核对」「认证未过」这些阻断项在界面上消不掉，判定永远到不了「可提交 Owner 决定」。补遗也只能存不能用：TI-3b 的「补遗使旧结论失效」在真实流程里没有接线。

另有两条任务书的硬要求还没落到写入口：「厂家证书必须能够追溯来源」——现在的证书记录没有出处字段；「缺少强制认证时必须阻止系统标记为可投标」——现在一张标成「已核验」却没有任何出处的证书就能让认证闸通过。

## What Changes

- 面板的价格表每行可展开录入：拟投品牌、型号、产品尺寸；带认证要求的行可录入证书（编号、状态、覆盖范围、发证机构、是否在加拿大受认可、所列型号、到期日、出处）。只对有项目写权限的人显示。
- 证书记录新增「出处」字段。保存接口 SHALL 拒绝「已核验」却没有出处的证书。
- 面板新增补遗卡片：显示已存补遗；有写权限的人可以新增（号、日期、影响的行、说明）与删除。
- 行明细记下「按第几号补遗核对过」。之后有新的补遗影响这一行，可投标判定报「补遗之后需要复核」，直到这一行被重新保存。
- 新增纯函数（行明细草稿与保存内容互转、影响行的解析、补遗列表的增删）及测试；隔离库端到端补用例；真实应用截图留证。

## 受影响的 Muse 意图

无。不触碰 muse-bridge。

## Out of scope

- 不上传证书文件、不核验证书真伪（「已核验」是人工确认后的录入，系统只要求有出处并留审计）。
- 不限制「谁可以把证书标为已核验」到比项目写权限更窄的角色（列入待 Owner 决定）。
- 不解析补遗正文；哪份补遗影响哪些行由人填。
- 不做成本输入的服务端保存、不做整柜 / 拼箱分摊的界面。
- 不改认证闸的六个条件与可投标判定的规则本身。

## Capabilities

### New Capabilities

- `tender/bid-workspace-line-entry`：行明细与补遗的录入、保存校验，以及补遗对已核对结论的影响。

### Modified Capabilities

无（`tender/bid-workspace`、`tender/bid-workspace-panel` 尚未归档；本次新增的行为写在新能力里）。

## Impact

- `src/lib/tender-bid-workspace/contract.ts`：证书加 `evidenceRef`，行明细加 `basedOnAddendum`；保存请求加「已核验须有出处」的校验；合并时把 `basedOnAddendum` 限制在不超过影响该行的最新补遗号。
- `src/lib/tender-bid-workspace/workspace-view.ts`：由行明细生成待复核结论交给可投标判定。
- 新增 `src/lib/tender-bid-workspace/line-entry.ts` 与测试；`src/components/tender/bid-workspace-panel.tsx` 增加行录入与补遗卡片。
- 截图存 `docs/acceptance/ti-4c/`。
- 零 schema（仍在同一个 JSON 键里，新增字段可选，旧内容照常读出）；零新接口；开关关闭时无任何变化。
