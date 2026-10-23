#!/bin/bash
# Muse Bridge Phase 0 — 一键落地（在仓库根目录运行）
#
#   bash scripts/muse-bridge/setup.sh                 # 已 apply 补丁后：装依赖 → prisma generate → 测试 → 类型检查
#   bash scripts/muse-bridge/setup.sh path/to.patch   # 先 apply 补丁再做上面的事
#
# 不碰数据库、不改 .env；只做本地验证。完成后按屏幕提示走 seed-token / bind / smoke 三步。
set -e
cd "$(git rev-parse --show-toplevel)"

if [ -n "${1:-}" ]; then
  echo "▶ 应用补丁 $1"
  git apply --check "$1" && git apply "$1"
fi

echo "▶ 安装依赖"
npm install --no-audit --no-fund >/dev/null

echo "▶ prisma generate"
npx prisma generate >/dev/null

echo "▶ 纯逻辑测试"
npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts | tail -1

echo "▶ 类型检查（只查本次新增/改动的文件）"
cat > /tmp/tsconfig.muse.json <<JSON
{ "extends": "$(pwd)/tsconfig.json",
  "compilerOptions": { "noEmit": true, "skipLibCheck": true, "incremental": false },
  "include": [],
  "files": [
    "$(pwd)/src/lib/muse-bridge/contract.ts", "$(pwd)/src/lib/muse-bridge/flags.ts",
    "$(pwd)/src/lib/muse-bridge/binding-pure.ts", "$(pwd)/src/lib/muse-bridge/binding.ts",
    "$(pwd)/src/lib/muse-bridge/router-pure.ts", "$(pwd)/src/lib/muse-bridge/router.ts",
    "$(pwd)/src/lib/muse-bridge/events-pure.ts", "$(pwd)/src/lib/muse-bridge/events.ts",
    "$(pwd)/src/lib/muse-bridge/hooks.ts",
    "$(pwd)/src/app/api/bridge/muse/command/route.ts", "$(pwd)/src/app/api/bridge/muse/events/route.ts",
    "$(pwd)/src/app/api/organizations/[orgId]/muse-bindings/route.ts",
    "$(pwd)/src/lib/pending-actions/drafts.ts", "$(pwd)/src/lib/inquiry/service.ts",
    "$(pwd)/src/lib/tender-auto-analysis/worker.ts", "$(pwd)/src/lib/tender-workforce/tools.ts",
    "$(pwd)/scripts/muse-bridge/seed-token.ts", "$(pwd)/scripts/muse-bridge/bind.ts"
  ] }
JSON
if NODE_OPTIONS=--max-old-space-size=6144 npx tsc -p /tmp/tsconfig.muse.json; then
  echo "  ✓ 类型检查通过"
else
  echo "  ✗ 类型检查有错误（把上面的输出贴给 Claude）"; exit 1
fi

cat <<'TXT'

✓ Phase 0 本地验证完成。接下来三步（每步一条命令）：

  1) 签发 Bridge token（只显示一次）
     npx tsx scripts/muse-bridge/seed-token.ts

  2) 把你的 Muse 用户 id 绑到你的青砚账号
     npx tsx scripts/muse-bridge/bind.ts --org <orgId> --muse <museUserId> --email <你的青砚邮箱>

  3) 在 .env 加一行 MUSE_BRIDGE_ENABLED=1，启动 npm run dev，然后冒烟
     BASE_URL=http://localhost:3000 MUSE_BRIDGE_TOKEN=<第1步的token> ORG_ID=<orgId> MUSE_USER_ID=<museUserId> \
       bash scripts/muse-bridge/smoke.sh

把第 3 步的输出贴给 Claude 过 GATE-0。
TXT
