# Spec Delta

## ADDED Requirements

### Requirement: 写路径默认落在已选日历列表的第一项
Google 日历写路径（新建事件 `pushEventToGoogle`、修改 `updateGoogleEvent`、删除 `deleteGoogleEvent`、取单个事件 `getGoogleEventDetail`）在调用方未显式指定日历时，SHALL 使用 `CalendarProvider.calendarId` 按逗号拆分、逐项去空格后的第一个非空项作为目标日历；没有非空项（字段为空、空串或只有逗号空格）时 SHALL 使用 `"primary"`。系统 SHALL NOT 把未拆分的整串 `calendarId` 作为单个日历 ID 发给 Google。四个写路径 SHALL 通过同一个函数得出默认目标日历。

#### Scenario: 多选日历的用户新建预约
- **WHEN** 用户的 `CalendarProvider.calendarId` 为 `"a@group.calendar.google.com,primary"`，`syncAppointmentToGoogle` 为一条没有 `googleEventId` 的预约调用 `pushEventToGoogle`
- **THEN** Google 插入请求的 `calendarId` 为 `"a@group.calendar.google.com"`，而不是整串

#### Scenario: 默认目标日历的取值
- **WHEN** 已选日历字段分别为 `null`、`""`、`"primary"`、`"a@group.calendar.google.com,primary"`、`" primary , b "`
- **THEN** 默认目标日历分别为 `"primary"`、`"primary"`、`"primary"`、`"a@group.calendar.google.com"`、`"primary"`

#### Scenario: 调用方显式指定日历
- **WHEN** 调用 `updateGoogleEvent` / `deleteGoogleEvent` / `getGoogleEventDetail` 时传入了 `opts.calendarId`
- **THEN** 请求使用传入的 `opts.calendarId`，不使用已选日历列表的第一项
