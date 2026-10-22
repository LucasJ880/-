#!/bin/bash
# GATE-0 完整验收（在 smoke.sh 四项之上补齐 §验收 第 1/2/5/6 条）
#
#   BASE_URL=... MUSE_BRIDGE_TOKEN=... ORG_ID=... MUSE_USER_ID=... PROJECT_ID=... APPROVAL_ID=... \
#     bash scripts/muse-bridge/smoke-gate0.sh
#
# 预期：
#   A) 未绑定用户 → 403 USER_NOT_BOUND
#   B) status → 列表里有 [MUSE-QA] 项目，带「1 条待你批」
#   C) events → 有一条 approval.requested，approval.approvalId == APPROVAL_ID
#   D) ask → 没有分析结果时诚实回「还没有可用的分析结果」（不编造）
#   E) approve → 「已批准」，再 approve 一次 → 含「未重复执行」
#   F) 开关测试需你手动：.env 去掉 MUSE_BRIDGE_ENABLED 重启后，任意请求应 503 BRIDGE_DISABLED
set -u
: "${BASE_URL:?}"; : "${MUSE_BRIDGE_TOKEN:?}"; : "${ORG_ID:?}"; : "${MUSE_USER_ID:?}"; : "${PROJECT_ID:?}"; : "${APPROVAL_ID:?}"
H=(-H "Authorization: Bearer $MUSE_BRIDGE_TOKEN" -H "Content-Type: application/json")
T=$(date +%s)
post() { curl -s -w "\n[http %{http_code}]\n" -X POST "$BASE_URL/api/bridge/muse/command" "${H[@]}" -d "$1"; }
env_() { echo "{\"contractVersion\":\"muse-bridge/v1\",\"requestId\":\"g0-$T-$1\",\"orgId\":\"$ORG_ID\",\"museUserRef\":\"$2\",\"command\":$3}"; }

echo "── A) 未绑定用户（应 403 USER_NOT_BOUND）"
post "$(env_ a 'nobody-not-bound' '{"intent":"status"}')"

echo; echo "── B) status（应含 [MUSE-QA] 项目与「1 条待你批」）"
post "$(env_ b "$MUSE_USER_ID" '{"intent":"status"}')"

echo; echo "── C) events（应含 approval.requested，approvalId=$APPROVAL_ID）"
curl -s -w "\n[http %{http_code}]\n" "$BASE_URL/api/bridge/muse/events?orgId=$ORG_ID&museUserRef=$MUSE_USER_ID&limit=20" -H "Authorization: Bearer $MUSE_BRIDGE_TOKEN"

echo; echo "── D) ask（无分析 → 诚实提示，不编造）"
post "$(env_ d "$MUSE_USER_ID" "{\"intent\":\"ask\",\"projectId\":\"$PROJECT_ID\",\"question\":\"这个标最大的废标风险是什么？\"}")"

echo; echo "── E1) approve（应「已批准」）"
post "$(env_ e1 "$MUSE_USER_ID" "{\"intent\":\"approve\",\"approvalId\":\"$APPROVAL_ID\"}")"
echo; echo "── E2) 再 approve 一次（应含「未重复执行」或 APPROVAL_FAILED 终态）"
post "$(env_ e2 "$MUSE_USER_ID" "{\"intent\":\"approve\",\"approvalId\":\"$APPROVAL_ID\"}")"

echo; echo "── F) 开关：请手动去掉 MUSE_BRIDGE_ENABLED 重启后再跑一次 B，预期 503 BRIDGE_DISABLED"
