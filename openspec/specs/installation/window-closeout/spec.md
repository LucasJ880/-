# installation/window-closeout Specification

## Purpose
逐窗收口：安装工按工艺单每扇窗上传完工照片作为收口证据，全部窗收口后任务完成并推进工艺单到已安装；照片只对相关人可见。

## Requirements

### Requirement: 逐窗上传照片
`POST /api/install/tasks/{id}/items/{itemId}/photo`（multipart，字段 `file`，可选 `note`）的 `itemId` SHALL 为该任务工艺单任一收口单元的单元 id；SHALL 要求操作者是被分配人或持 `install.window.complete`（ORG）；SHALL 只接受 jpeg / png / webp，单张 ≤ 8MB；图片存入 `install-photos/{orgId}/{orderId}/{单元 id}/{时间戳}.{ext}`。Blinds 行写审计 `install.window.completed`（目标类型 `blinds_order_item`，目标为该行）；工艺参数单元写同一动作，目标类型 `blinds_order_unit`，目标 `<工艺单 id>:<段>:<下标>`。响应 SHALL 返回该单元最新收口记录；单元 id 不属于该工艺单 SHALL 返回 404。

#### Scenario: 上传成功
- **WHEN** 小王对 3 号窗上传一张 2MB 的 jpeg
- **THEN** 返回 200，含代理地址与时间；审计出现一条 `install.window.completed`，目标为 3 号窗

#### Scenario: 工艺参数单元上传
- **WHEN** 小王对 `spec-vinyl-0` 上传一张 jpeg
- **THEN** 返回 200；审计出现一条 `install.window.completed`，目标类型 `blinds_order_unit`，目标 `<工艺单 id>:vinyl:0`，内容含当前位置（`closeout-db.isolated.test.ts`）

#### Scenario: 不存在的工艺参数单元
- **WHEN** 工艺参数 Vinyl 段只有 2 扇窗，上传到 `spec-vinyl-5`
- **THEN** 返回 404，无文件写入

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
任务详情中每个收口单元的状态 SHALL 由该单元计入的收口记录与问题记录（`install.window.issue`，见 `installation/repairs`）中最新的一条决定：最新为收口记录 → 已收口，当前照片为最新一条计入的收口记录，张数为计入的收口记录数；最新为问题记录 → 有问题，不计入已收口；两者都没有 → 未收口。工艺参数单元的问题记录与收口记录一样按位置比对决定是否计入。任务的"已收口单元数 / 总单元数"与"有问题单元数" SHALL 一致地出现在列表、详情与工艺单"收口"标签里。

#### Scenario: 聚合
- **WHEN** 工艺单 4 扇窗，其中 2 扇各有 1 张、1 扇有 3 张、1 扇没有
- **THEN** 已收口 3 / 4，有 3 张的窗显示张数 3

#### Scenario: 列表与详情一致
- **WHEN** 只有 Vinyl 3 扇窗的单已拍 2 扇
- **THEN** 任务列表该任务显示 2 / 3，任务详情也为 2 / 3（`closeout-db.isolated.test.ts`）

#### Scenario: 收口后又标记问题
- **WHEN** 3 号窗先拍了完工照，之后又被标记为有问题
- **THEN** 3 号窗为有问题，不计入已收口，有问题数为 1（`closeout-units.test.ts`）

#### Scenario: 问题后补拍完工照
- **WHEN** 3 号窗先被标记有问题，安装工现场修好后又拍了完工照
- **THEN** 3 号窗为已收口，有问题数为 0（`closeout-units.test.ts`）

### Requirement: 完成收口
`POST /api/install/tasks/{id}/complete` SHALL 要求操作者是被分配人或持 `install.task.update`（ORG）。工艺单没有任何收口单元时 SHALL 返回 409 `NO_UNITS` 并说明需出单补齐；任一单元未收口时 SHALL 返回 409 `WINDOWS_MISSING` 并列出未收口单元的序号与位置；全部收口时 SHALL 把预约置为已完成（记录完成时间）、把工艺单按状态机推进到"已安装"（记录安装时间与状态日志），并写审计 `install.task.completed`（含单元数与照片张数）。重复调用已完成的任务 SHALL 返回 200 且不重复推进。

#### Scenario: 还有窗没拍
- **WHEN** 4 扇窗只有 3 扇有照片时点完成
- **THEN** 返回 409，响应列出第 4 扇窗的序号与位置，状态不变

#### Scenario: 全部收口
- **WHEN** 4 扇窗都有照片时点完成
- **THEN** 预约 completed，工艺单 installed，审计 `install.task.completed`

#### Scenario: 只有 Vinyl 窗的单全部收口
- **WHEN** 没有 Blinds 行、Vinyl 3 扇窗都有照片时点完成
- **THEN** 返回 200，预约 completed，工艺单 installed（`closeout-db.isolated.test.ts`）

#### Scenario: 没有任何收口单元
- **WHEN** 工艺单既无 Blinds 行、工艺参数四段也都为空时点完成
- **THEN** 返回 409 `NO_UNITS`，状态不变；任务页显示"工艺单没有可收口的行"，不显示"还差 0 扇"

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

### Requirement: 收口单元
一张工艺单的收口单元 SHALL 是：工艺单的每一行（Blinds 行，沿用行序号），加上该单最新工艺参数里国内下单、窗帘、Vinyl、外采购四段的每一行（按此段序、段内原顺序，序号接在 Blinds 行最大序号之后连续编号）。每个单元 SHALL 有单元 id（Blinds 行为行 id；工艺参数行为 `spec-<段>-<段内下标>`，段为 `domestic` / `drapes` / `vinyl` / `purchase`）、序号、位置、尺寸与品类标签。窗帘的布帘行与纱帘行 SHALL 各为一个单元。

#### Scenario: 只有 Vinyl 窗的单
- **WHEN** 工艺单没有 Blinds 行，工艺参数 Vinyl 段有 3 扇窗
- **THEN** 收口单元为 3 个，单元 id 为 `spec-vinyl-0`…`spec-vinyl-2`，序号 1–3，品类标签为 Vinyl 百叶（`closeout-units.test.ts`）

#### Scenario: 混合单
- **WHEN** 工艺单有序号 1、2 两个 Blinds 行，工艺参数有 1 个国内下单行与布帘、纱帘各 1 行
- **THEN** 收口单元 5 个，序号依次 1、2、3（国内下单）、4（布帘）、5（纱帘）

#### Scenario: 全部发给国内
- **WHEN** Blinds 行全部发给国内（工艺单行为空，国内下单段 4 行）
- **THEN** 收口单元为国内下单段的 4 行

### Requirement: 工艺参数单元的位置比对
工艺参数单元的收口记录 SHALL 保存拍照时该单元的位置；聚合时只有记录里的位置与当前位置一致（去首尾空白、不区分大小写）的照片 SHALL 计入该单元。存在照片但全部位置不一致的单元 SHALL 计为未收口，并在任务详情中标记"位置已变"及拍照时的位置。

#### Scenario: 参数被改后位置不一致
- **WHEN** `spec-drapes-1` 拍照时位置为"主卧"，之后出单把该行位置改为"次卧"
- **THEN** 该单元为未收口，详情标记位置已变、原位置"主卧"（`closeout-units.test.ts`）

#### Scenario: 大小写与空白不算变化
- **WHEN** 拍照时位置为" Living Room "，当前为"living room"
- **THEN** 该照片计入收口

### Requirement: 收口记录写入失败不得报成功
照片上传后，收口记录写入失败时上传接口 SHALL 返回 500 并提示重拍，SHALL NOT 返回 200 或任何收口记录；该单元的收口状态 SHALL 不因这次上传而变化。

#### Scenario: 审计写入失败
- **WHEN** 照片已存入私有存储，但写收口记录时数据库报错
- **THEN** 返回 500，错误含"请重拍"，任务详情中该单元仍为未收口
