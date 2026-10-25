#!/bin/bash
# ═══════════════════════════════════════════════════════════
# 测试注册校验（SDD-0 / 能力 qa/test-registry）
#
# 规则：任何 src/lib/**/__tests__/*.test.ts 都必须在 scripts/test-all.sh
#       （或它直接调用的 scripts/*.sh）中按仓库相对路径被引用，否则 npm test 不会跑它。
# 例外：ci/test-registry-baseline.txt 里冻结的历史欠账——只允许删，不允许加；
#       条目一旦已被注册或文件已不存在，视为"基线过期"，必须从基线移除。
#
# 用法：  bash scripts/check-test-registry.sh
# 退出码：0 通过；1 有未注册文件或基线过期；2 输入文件缺失
# 只读工作树：不碰数据库 / 网络 / 环境变量；仅依赖 bash、find、grep。
# ═══════════════════════════════════════════════════════════
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENTRY="scripts/test-all.sh"
BASELINE="ci/test-registry-baseline.txt"
TEST_ROOT="src/lib"

missing=0
for f in "$ENTRY" "$BASELINE"; do
  if [ ! -f "$f" ]; then
    echo "缺少输入文件：$f"
    missing=1
  fi
done
if [ "$missing" -eq 1 ]; then
  exit 2
fi

# 注册表 = test-all.sh 全文 + 它直接调用的每个 scripts/*.sh（只向下看一层）
REGISTRY="$(mktemp)"
trap 'rm -f "$REGISTRY"' EXIT
cat "$ENTRY" > "$REGISTRY"
while IFS= read -r helper; do
  [ "$helper" = "$ENTRY" ] && continue
  [ -f "$helper" ] && cat "$helper" >> "$REGISTRY"
done < <(grep -oE 'scripts/[A-Za-z0-9_./-]+\.sh' "$ENTRY" | sort -u)

is_registered() { grep -qF -- "$1" "$REGISTRY"; }
in_baseline()   { grep -qxF -- "$1" "$BASELINE"; }

unregistered=()
registered_count=0
while IFS= read -r f; do
  if is_registered "$f"; then
    registered_count=$((registered_count + 1))
  elif ! in_baseline "$f"; then
    unregistered+=("$f")
  fi
done < <(find "$TEST_ROOT" -path '*/__tests__/*.test.ts' -type f | sort)

# 基线过期：条目已被注册，或文件已不存在
stale=()
baseline_count=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "$line" in \#*) continue ;; esac
  baseline_count=$((baseline_count + 1))
  if [ ! -f "$line" ]; then
    stale+=("$line（文件已不存在）")
  elif is_registered "$line"; then
    stale+=("$line（已注册）")
  fi
done < "$BASELINE"

rc=0
if [ "${#unregistered[@]}" -gt 0 ]; then
  echo "✗ 未注册的测试文件 ${#unregistered[@]} 个——请加进 $ENTRY："
  printf '  %s\n' "${unregistered[@]}"
  rc=1
fi
if [ "${#stale[@]}" -gt 0 ]; then
  echo "✗ 基线过期条目 ${#stale[@]} 条——请从 $BASELINE 删除："
  printf '  %s\n' "${stale[@]}"
  rc=1
fi
if [ "$rc" -eq 0 ]; then
  echo "OK 测试注册校验通过：已注册 ${registered_count} 个；历史欠账基线剩余 ${baseline_count} 条（只减不增）"
fi
exit "$rc"
