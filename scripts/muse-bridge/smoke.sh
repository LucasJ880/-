#!/bin/bash
# Muse Bridge — 联调冒烟（不需要 Bridge-bot，直接 curl 青砚）
#
# 用法：
#   BASE_URL=http://localhost:3000 \
#   MUSE_BRIDGE_TOKEN=qy_xxx \
#   ORG_ID=<orgId> MUSE_USER_ID=<museUserId> \
#   bash scripts/muse-bridge/smoke.sh
#
# 预期：
#   1) status → 200，message 里有「在跟 N 个标」或「当前没有在跟的投标项目」
#   2) 同 requestId 重放 → 200，内容与第 1 次完全相同（幂等账本）
#   3) rfq → 422，errorCode=INTENT_NOT_ENABLED，availableInPhase=1
#   4) events → 200，{"events":[...],"nextSince":...}
set -u
: "${BASE_URL:?缺 BASE_URL}"; : "${MUSE_BRIDGE_TOKEN:?缺 MUSE_BRIDGE_TOKEN}"; : "${ORG_ID:?缺 ORG_ID}"; : "${MUSE_USER_ID:?缺 MUSE_USER_ID}"

REQ="smoke-$(date +%s)-$RANDOM"
H=(-H "Authorization: Bearer $MUSE_BRIDGE_TOKEN" -H "Content-Type: application/json")

post() {
  curl -s -w "\n[http %{http_code}]\n" -X POST "$BASE_URL/api/bridge/muse/command" "${H[@]}" -d "$1"
}

echo "── 1) status"
post "{\"contractVersion\":\"muse-bridge/v1\",\"requestId\":\"$REQ\",\"orgId\":\"$ORG_ID\",\"museUserRef\":\"$MUSE_USER_ID\",\"utterance\":\"我们现在跟的标有哪些\",\"command\":{\"intent\":\"status\"}}"

echo; echo "── 2) 同 requestId 重放（应与上面完全一致）"
post "{\"contractVersion\":\"muse-bridge/v1\",\"requestId\":\"$REQ\",\"orgId\":\"$ORG_ID\",\"museUserRef\":\"$MUSE_USER_ID\",\"command\":{\"intent\":\"status\"}}"

echo; echo "── 3) 未开放意图 rfq（应 422 + INTENT_NOT_ENABLED）"
post "{\"contractVersion\":\"muse-bridge/v1\",\"requestId\":\"$REQ-rfq\",\"orgId\":\"$ORG_ID\",\"museUserRef\":\"$MUSE_USER_ID\",\"command\":{\"intent\":\"rfq\",\"projectId\":\"any\"}}"

echo; echo "── 4) events 拉取"
curl -s -w "\n[http %{http_code}]\n" "$BASE_URL/api/bridge/muse/events?orgId=$ORG_ID&museUserRef=$MUSE_USER_ID&limit=10" -H "Authorization: Bearer $MUSE_BRIDGE_TOKEN"
