# Tasks

## 1. 画像与接口

- [x] 1.1 `org-profiles.ts`（`buildCompetitorProfiles` / `buildAgencyProfiles` / `ourBidOutcome`），`deriveBuyerCycle` 导出；`org-profiles.test.ts`；verify：30 passed
- [x] 1.2 `GET /api/org/tender-intel-profiles`（可见性过滤、开关降级、403）；`org-profiles-db.isolated.test.ts`；verify：隔离库 12 passed，无库跳过

## 2. 页面与导航

- [x] 2.1 「竞争对手」「采购机构」两页接接口（搜索、展开明细、空状态、开关关闭说明）；verify：隔离库 + `next dev` 截图 `docs/acceptance/p2-0b/01–03`，手机宽度无横向滚动
- [x] 2.2 「周期采购」移出 `IntelHubShell` 页签与侧栏注册表；更新 `position-nav.test.ts`；verify：navigation 六个测试全过

## 3. 收尾

- [x] 3.1 测试注册（`test-all.sh` / `test-ci-unit.sh`）、`check-test-registry.sh`、typecheck、`lint:baseline`、`test-runtime-architecture.sh`、`openspec validate tender-intel-org-profiles --strict`；verify：全部通过
- [x] 3.2 `docs/QINGYAN_P2-0b_REPORT.md` + TASKFLOW P2-0b 行（`[G]`）

## Workflow follow-up

- 一个 change = 一个 PR；依赖 P2-0（#384）先合并；不自动合并；合并后 `/opsx:archive tender-intel-org-profiles --yes`。
