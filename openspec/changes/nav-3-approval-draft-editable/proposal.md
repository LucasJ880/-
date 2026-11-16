# Proposal：审批草稿可改——从待批草稿进收件箱时带上这份草稿（NAV-3）

TASKFLOW：NAV-3（Phase N；任务书 `docs/QINGYAN_NAV-1_PLAIN_NAV_REPLY_TASKBRIEF.md` 附录「后续队列」NAV-3，前置 NAV-1c 已合并归档）。核对基线：main `43be745f`（2026-11-16）。四件套审核：Lucas 2026-11-16「按推荐做」，design「审核关注点」Q1–Q6 全部按推荐。

## Why

今日询盘与商机详情里，AI 写好的待批回复只能「批准发送」或「拒绝」；想改一句也得去询盘收件箱从空白重写。NAV-1c 已经把「去询盘收件箱自己写」的路接通了，但窗口是空的。

## What Changes

**审批面（今日询盘、商机详情）**
- 把待批草稿卡上的链接由「不想用这份？去询盘收件箱自己写（发出后这份草稿自动作废）」改为「想改一改再发？去询盘收件箱改这份草稿（发出后这份草稿自动作废）」，链接带上这份草稿的 id。
- 把今日询盘上的这行链接移到展开的草稿下面：先点「查看草稿」才看得到（与「批准前必看」同一口径）。商机详情的草稿本来就是展开的，位置不变。

**询盘收件箱 `/trade/inbox`**
- 支持带待批草稿 id 的深链：打开回复窗口时主题与正文预填这份草稿的原文，标题为「改草稿再发 · 〈公司〉」，并写明发出后原草稿自动作废、从这里发出的是普通文本邮件。
- 草稿已经处理过、过期、不属于这位买家或本企业时：提示「这份待批草稿已经处理过或已失效，可以直接在下面写回复」，窗口照常打开、正文为空。
- 草稿原定的收件邮箱与这位买家在收件箱里的邮箱不一致时，在窗口里写明两者。
- 从这个窗口发出的回复，留底的「AI 草稿」标记为真。

**接口**
- 给 `GET /api/trade/inbox/focus` 加可选参数 `approvalId`：带上时响应多一个 `approvalDraft`（这份待批草稿的 id、主题、正文、原定收件邮箱；不满足条件为空）。只读，不改审批状态。
- 把 `POST /api/trade/inbox/[prospectId]/reply` 的正文上限由 8000 字提高到 10000 字，与待批草稿的正文上限一致，避免预填的长草稿被静默截断。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `trade/inquiry-reply-entry`: 改「审批面到询盘收件箱的出路」（链接文字、带草稿 id、今日询盘上先看草稿才出现）；新增「从待批草稿进入时预填这份草稿」「单会话接口按待批草稿 id 返回草稿原文」「改后发出不经过审批执行」「回复正文上限」四条要求。

## Impact

- 接口：`GET /api/trade/inbox/focus`（多一个可选参数与一个响应字段）、`POST /api/trade/inbox/[prospectId]/reply`（正文上限）。
- 页面：`src/app/(main)/trade/inbox/page.tsx`、`src/app/(main)/revenue/today/page.tsx`、`src/app/(main)/revenue/[id]/page.tsx`。
- 库：`src/lib/trade/reply-target.ts`（深链地址带草稿 id、草稿是否可用的判定）。
- 测试：新增 `src/lib/trade/__tests__/approval-draft-edit.test.ts`（纯函数 + 源码断言），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`reply-entry-db.isolated.test.ts` 加一组；`reply-entry.test.ts`、`reply-clarity.test.ts` 随链接文字与深链分支调整。
- 出站：不新增发信通路。改后的邮件走的是既有的「成员本人在收件箱点发送」；待批草稿本身不被批准、不被执行，发出后按既有规则由系统作废（`src/lib/trade/outbound-sync.ts`，不改）。
- 数据库、权限键、岗位模板、路由门映射表、`src/lib/pending-actions/**`、`src/lib/revenue-spine/**`、Muse 桥接：不动。零新增 LLM 调用。
- 没有开关，合并即生效；回滚 = revert。无 BREAKING。

## Out of scope

- 在审批卡上原地改草稿、改完仍走「批准发送」（要动待批草稿的内容与快照，属于审批流本身）。
- 让从收件箱发出的邮件带上审批发送用的 HTML 排版，或统一两条路的发件身份。
- 回复窗口里显示这份草稿的风险提示与中文对照（它们只在审批卡的预览里；本 change 靠「先看草稿才出现链接」保证看过）。
- 把收件箱分析草稿与审批草稿合并为一套。
- 改外发同步、草稿作废与改稿反馈的规则。
- 使用说明「我想做什么」第 3 行的文字（它没有引用这行链接的原文）。
- NAV-6 报告里记的两个按钮（「重新生成」「按建议生成报价草稿」对只读成员的显隐）。
