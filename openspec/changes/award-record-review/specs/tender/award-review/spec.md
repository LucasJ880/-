# Spec Delta

## Purpose

组织管理员对授标记录的人工处理：确认线索 / 疑似重复，撤回错误记录，并能在撤回后通过结果标记更正。

## ADDED Requirements

### Requirement: 仅组织管理员可确认或撤回授标记录
系统 SHALL 只允许本组织的组织管理员（含组织所有者；平台超级管理员按既有规则）确认或撤回授标记录；其他成员与其他组织的管理员 SHALL 被拒绝且记录不变。授标列表接口 SHALL 返回当前用户是否可处理，页面 SHALL 只对可处理的用户显示处理按钮。授标情报开关关闭时 SHALL 拒绝处理且不访问授标表。

#### Scenario: 权限
- **WHEN** 组织成员、其他组织管理员分别尝试确认或撤回本组织的记录
- **THEN** 返回 403（其他组织路径下不存在则 404），记录不变；`award-review-db.isolated.test.ts` 覆盖

### Requirement: 确认
组织管理员确认一条线索或疑似重复记录时，系统 SHALL 把它改为 ACTIVE + 人工确认，并在同一事务写审计；已是人工确认的记录再确认 SHALL 返回 unchanged 且不写审计；已撤回的记录 SHALL NOT 能被确认。

#### Scenario: 确认疑似重复与 AI 线索
- **WHEN** 管理员确认一条疑似重复记录和一条 AI 提取的线索
- **THEN** 两条都变为 ACTIVE + 人工确认，线索对手进入已确认竞争对手，各写一条 `award_record_confirmed` 审计；再确认 unchanged；同一测试覆盖

### Requirement: 撤回
组织管理员撤回记录时 SHALL 填写原因（去空白后非空，≤200 字）；系统 SHALL 把状态改为 RETRACTED，SHALL NOT 删除记录或来源，SHALL 在记录上保留撤回人、时间、原因与撤回前状态，并在同一事务写审计；已撤回再撤回 SHALL 幂等且不覆盖原因。撤回的记录 SHALL NOT 出现在组织授标列表，SHALL NOT 参与去重判断。

#### Scenario: 撤回留痕
- **WHEN** 管理员不填原因撤回，再填原因撤回
- **THEN** 前者 400 且状态不变；后者状态为 RETRACTED，原因与撤回人留痕，审计带原因，列表不再出现；`awards.test.ts`（T4-11）与 DB 测试覆盖

### Requirement: 撤回后通过结果标记更正
项目结果回灌写授标事实时，若该项目的来源键对应记录已被撤回，系统 SHALL 用确定性的后继键写入新记录，撤回记录 SHALL 保持撤回；同一更正重放 SHALL 幂等；更正后再换名 SHALL 仍不覆盖。

#### Scenario: 更正填错的中标方
- **WHEN** 未中标时填了「Wrong Blinds Co」，管理员撤回后重新标记为「Right Blinds Co」，再用同名重放，再改成「Third Co」
- **THEN** 写入一条新的有效记录「Right Blinds Co」；重放返回同一条；「Third Co」返回 `winner_already_recorded`；该项目只有一条有效中标方记录；DB 测试覆盖
