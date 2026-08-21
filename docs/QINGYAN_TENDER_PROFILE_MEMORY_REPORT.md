# 投标业务档案分离（A）+ 合规记忆（B）实施报告

日期：2026-08-21 · 分支 `feature/tender-profile-memory`（**堆叠于 feature/tender-bid-draft-stacked / PR #148**）· SCHEMA_CHANGE = NONE

## A. 投标业务档案（与窗饰品牌档案分离）

- 存 `Organization.settingsJson.tenderProfile`（字段：投标主体/注册与签字人/业务线定位/能力与服务范围/资质认证/
  团队/代表业绩/社会价值素材/禁用表述），zod 逐字段预处理；`getTenderProfile / saveTenderProfile`。
- `GET/PUT /api/operations/tender-profile`（管理权限 + 组织隔离，照品牌档案接口模式）；页面
  `/operations/tender-profile`；运营中心加入口卡；导航 active 匹配。
- **投标起草只读投标档案，删除对 BrandProfile 的读取，不设回退**（探针反例守卫 TP-04）；企业记忆事实
  排除合规立场类。未填 → 草稿相关段老实占位。

## B. 合规记忆（跨项目复用人工确认）

- 建在 T3 企业记忆层上，零 schema：claimType 新增 `COMPLIANCE_POSITION`；subjectType **OTHER**
  （T3 规则：ORGANIZATION 键必须 = orgId、PROJECT/TENDER 键必须 = Project.id——按要求指纹建键只能用
  自由键 OTHER，真实 E2E 实测）；claimNature **INTERPRETATION + 要求原文作证据**（T3 规则：FACT 须带
  直接证据，同样实测）；verificationStatus HUMAN_CONFIRMED；actor=user（人工标注触发，AI 不写）。
- 指纹 = 归一化文本（NFKC/小写/去标点空白）sha256 前 24 位；相似 = 词元 Jaccard（英文按词/中文按字，
  数字保留）≥ 0.75。立场变化走 `supersedeMemoryClaim` 版本链；同立场重复 → unchanged。
- 矩阵 GET 返回 `suggestions`（只对未标；**排除本项目自身**防回声）；POST 标注（单条/批量）后台写记忆
  （失败只 warn，绝不让标注失败）；`POST action=apply-memory mode=exact|all` 只填未标、带
  `provenance{via:"memory", kind, score, claimId, sourceProjectName}`，不回写记忆。
- 矩阵卡：逐字一致 → 打开即自动带入一次（幂等）；相似 → 行内建议 + 「采纳全部历史建议（N）」；
  带入的标注显示「历史确认」紫标（悬停见来源项目与编号），可改。
- 起草稿：记忆带入的标注视同人工标注（五态→合规状态），基于 provenance 可溯源。

## 证据

- 纯平面：compliance-memory **11/11**（归一化/指纹/相似度/exact-fuzzy-无关三分/防回声反例/版本取最新/
  坏形不抛/词表/路由与 UI 结构守卫）；tender-profile **5/5**（schema/可用性/语料/不回退反例/权限）；
  bid-fit-usability 16/16、bid-draft 11/11 无回归；tsc 零错；eslint 零错。
- **真实 E2E 6/6**（隔离快照 + 真实 T3 写入，分支已删）：以 Lucas 身份写入 8 条 HRM 标准程序条款立场
  （created×8，每条带证据）→ 组织级读回 8 → **Halifax 120 条里精确命中 8 条并带来源项目名** → 同立场
  重复 unchanged → 改立场 superseded 且匹配返回最新（RFI）→ 库态 ACTIVE 8 / SUPERSEDED 1 / 证据 9。
- 两次 E2E 红（FACT 证据规则、ORGANIZATION 键规则）均由真实 T3 写入门抓到并修正——纯平面探针抓不到。

## 上线后

1. 运营中心 → 投标业务档案：填投标主体、能力、资质、业绩、社会价值素材、禁用表述。
2. Halifax 矩阵：**这一单要完整标一次**（它是记忆的第一笔）；下一单同业主标书打开即自动带入逐字一致条款，
   换业主走相似建议一键采纳。
3. 无新 env / 无 schema；回滚 = revert（已写入的 claim 保留，无害）。

## Gate

```
PM_SCHEMA_CHANGE   = NONE（settingsJson + T3 claims）
PM_AI_WRITE        = NONE（记忆只由人工标注写入；起草不回退品牌档案）
PM_PURE_SUITES     = compliance-memory 11/11 + tender-profile 5/5 + 回归 27/27
PM_REAL_E2E        = PASS 6/6（真实 T3 写入/读回/版本链/证据/Halifax 精确命中 8）
PM_STACKED_ON      = PR #148（合并顺序 #147 → #148 → 本 PR）
PM_STATUS          = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
