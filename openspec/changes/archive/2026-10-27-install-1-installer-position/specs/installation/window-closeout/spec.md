# Spec Delta

## Purpose

逐窗收口：安装工按工艺单每扇窗上传完工照片作为收口证据，全部窗收口后任务完成并推进工艺单到已安装；照片只对相关人可见。

## ADDED Requirements

### Requirement: 逐窗上传照片
`POST /api/install/tasks/{id}/items/{itemId}/photo`（multipart，字段 `file`，可选 `note`）SHALL 要求操作者是该任务的被分配人或持 `install.window.complete`（ORG）；SHALL 只接受 jpeg / png / webp，单张 ≤ 8MB；SHALL 把图片存入私有存储路径 `install-photos/{orgId}/{orderId}/{itemId}/{时间戳}.{ext}`，并写一条审计记录（动作 `install.window.completed`，目标类型 `blinds_order_item`，目标为该窗，内容含工艺单、任务、存储路径、代理地址、备注）。响应 SHALL 返回该窗最新收口记录。`itemId` 不属于该任务的工艺单 SHALL 返回 404。

#### Scenario: 上传成功
- **WHEN** 小王对 3 号窗上传一张 2MB 的 jpeg
- **THEN** 返回 200，含代理地址与时间；审计出现一条 `install.window.completed`，目标为 3 号窗

#### Scenario: 他人任务
- **WHEN** 小李对小王的任务上传
- **THEN** 返回 403，无文件写入

#### Scenario: 非图片或超限
- **WHEN** 上传 pdf 或 12MB 的图片
- **THEN** 返回 400

#### Scenario: 补拍
- **WHEN** 小王对 3 号窗再上传一张
- **THEN** 该窗最新记录为第二张，照片张数为 2，第一张仍可在收口标签看到

### Requirement: 收口状态聚合
任务详情中每扇窗的收口状态 SHALL 由该窗的审计记录聚合：最新一条为当前照片，张数为记录数；没有记录的窗为"未收口"。任务的"已收口窗数 / 总窗数" SHALL 一致地出现在列表与详情里。

#### Scenario: 聚合
- **WHEN** 工艺单 4 扇窗，其中 2 扇各有 1 张、1 扇有 3 张、1 扇没有
- **THEN** 已收口 3 / 4，有 3 张的窗显示张数 3

### Requirement: 完成收口
`POST /api/install/tasks/{id}/complete` SHALL 要求操作者是被分配人或持 `install.task.update`（ORG）；当任一窗没有照片时 SHALL 返回 409 并列出未收口的窗序号与位置；全部有照片时 SHALL 把预约置为已完成（记录完成时间）、把工艺单按状态机推进到"已安装"（记录安装时间与状态日志），并写审计 `install.task.completed`（含窗数与照片张数）。重复调用已完成的任务 SHALL 返回 200 且不重复推进。

#### Scenario: 还有窗没拍
- **WHEN** 4 扇窗只有 3 扇有照片时点完成
- **THEN** 返回 409，响应列出第 4 扇窗的序号与位置，状态不变

#### Scenario: 全部收口
- **WHEN** 4 扇窗都有照片时点完成
- **THEN** 预约 completed，工艺单 installed，审计 `install.task.completed`

#### Scenario: 工艺单不在可推进状态
- **WHEN** 工艺单已是 cancelled
- **THEN** 返回 409 说明状态不允许，预约不变

### Requirement: 照片可见范围
文件代理 SHALL 对 `install-photos/{orgId}/...` 前缀只放行：该任务的被分配人，或持 `install.photo.read`（ORG）的企业成员；其他人 SHALL 收到 403。工艺单详情页的"收口"标签 SHALL 只对持 `install.photo.read` 的人显示每窗照片。

#### Scenario: 老板查看
- **WHEN** 持 `owner` 岗位的 Bob 打开工艺单详情的收口标签
- **THEN** 看到每扇窗的照片缩略图与时间

#### Scenario: 销售不能看
- **WHEN** 只持 `sales_rep` 的 Alex 请求某张收口照片的代理地址
- **THEN** 返回 403

### Requirement: 不输出的内容
安装任务与收口接口 SHALL NOT 返回报价金额、折扣、成本价、客户电话以外的客户资料，也 SHALL NOT 返回存储令牌或原始存储 URL（只返回代理地址）。

#### Scenario: 响应字段
- **WHEN** 安装工请求任务详情
- **THEN** 响应不含 `grandTotal`、`price`、`msrp`、`costPrice` 字段，照片地址以 `/api/files/` 开头
