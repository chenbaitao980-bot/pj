# Fix /goal self-healing + test-code consistency
# Applied to C:\Users\Administrator\.claude\skills\trellis-test\SKILL.md

with open(r'C:\Users\Administrator\.claude\skills\trellis-test\SKILL.md', 'r', encoding='utf-8') as f:
    content = f.read()

changes = 0

# ===== FIX 1: Step 4e entry - check .fix_goal exists =====
old_4e_entry = '''> **强制规则**：
- 入口检查：必须先有 FAILED_LIST（4d 输出）才能进入
- 出口检查：SELECTED_TESTS（新生成+历史回归）必须全部通过，否则退回
- AI 不得以"只有少量失败"或"失败不相关"为由跳过全量重跑
- **避无限循环**：连续 5 轮 FAILED_LIST 无减少 → 展示全部修复尝试给用户，暂停等指令'''

new_4e_entry = '''> **强制规则**：
- 入口检查：必须先有 FAILED_LIST（4d 输出）才能进入
- **入口检查: 如果 `.trellis/tests/.fix_goal` 已存在，读取其 round 字段，提示用户"检测到未完成的上一轮 /goal（第 N 轮），是否续跑？" 用户确认则从该状态继续；否则删除 .fix_goal 从头开始**
- 出口检查：SELECTED_TESTS（新生成+历史回归）必须全部通过，否则退回
- AI 不得以"只有少量失败"或"失败不相关"为由跳过全量重跑
- **避无限循环**：连续 5 轮 FAILED_LIST 无减少 → 展示全部修复尝试给用户，暂停等指令（具体实现见下方 while 循环内的 STALL_ROUND 计数）'''

if old_4e_entry in content:
    content = content.replace(old_4e_entry, new_4e_entry)
    changes += 1
    print('OK: fixed 4e entry with .fix_goal resume check')
else:
    print('FAIL: 4e entry section not found')

# ===== FIX 2: while loop - add stall detection + concrete rm command =====
old_while = '''while True:
  1. 分析每个失败根因，分类：
     a) 测试写错 → 直接修复测试
     b) 源码有 bug → 展示 diff 并等用户确认后修复
     c) 环境问题 → 修复环境配置
  2. 记录失败列表 FAILED_LIST
  3. git diff --quiet || git stash push -m "fix-before-round-$round"
  4. 执行修复
  5. [全量重跑] 重新运行 SELECTED_TESTS（全部，而非只跑 FAILED_LIST）
  6. 更新 goal 状态（写回 .fix_goal）
  7. 记录修复内容到 auto_fix_log;  round += 1
  8. if 全部通过: 删除 .fix_goal; break
     # 否则 continue（无上限，直到通过）'''

new_while = '''PREV_FAILED_COUNT=9999; STALL_ROUND=0
while true; do
  1. git diff --quiet || git stash push -m "fix-before-round-$round"  # 先保护现场
  2. 分析每个失败根因，分类：
     a) 测试写错 → 直接修复测试
     b) 源码有 bug → 展示 diff 并等用户确认后修复
     c) 环境问题 → 修复环境配置
  3. 记录失败列表 FAILED_LIST
  4. 执行修复
  5. git stash pop 2>/dev/null || true  # 恢复所有文件（测试产物+用户原有变更）
  6. [全量重跑] 重新运行 SELECTED_TESTS（全部，而非只跑 FAILED_LIST）
  7. 更新 goal 状态（写回 .fix_goal）
  8. 记录修复内容到 auto_fix_log

  # 防无限循环：连续 5 轮失败数未减少则暂停
  FAILED_COUNT=${#FAILED_LIST[@]}
  if [ "$FAILED_COUNT" -ge "$PREV_FAILED_COUNT" ] 2>/dev/null; then
    STALL_ROUND=$((STALL_ROUND + 1))
  else
    STALL_ROUND=0
  fi
  PREV_FAILED_COUNT=$FAILED_COUNT

  if [ "$STALL_ROUND" -ge 5 ]; then
    echo "[STALL] 连续 5 轮失败数未减少($FAILED_COUNT)，展示修复日志:"
    cat auto_fix_log
    echo "[STALL] 暂停，用户指令 (continue/skip/abort):"
    read -r _USER_CMD
    case "$_USER_CMD" in
      continue) STALL_ROUND=0 ;;
      skip)     break ;;
      abort)    exit 1 ;;
    esac
  fi

  round=$((round + 1))
  if all_passed; then
    python -c "import os; os.remove('.trellis/tests/.fix_goal')" 2>/dev/null || true
    echo "[GOAL] 全部测试通过，已清理 .fix_goal"
    break
  fi
done'''

if old_while in content:
    content = content.replace(old_while, new_while)
    changes += 1
    print('OK: fixed while loop with stall detection + concrete rm')
else:
    print('FAIL: while loop section not found')

# ===== FIX 3: Step 4b.5 - extend check scope to tests/ AND add TestedCommit hash check =====
old_freshness = '''echo "=== 4b.5 CodeGraph 符号级新鲜度 + 自动同步检查 ==="
_STALE_TESTS=()

# 读取 affected_symbols（Step 1b 用 CodeGraph 分析产出的受影响符号列表）
_AFFECTED_SYMBOLS=$(grep -vE '^(#|$)' .trellis/tests/.affected_symbols 2>/dev/null | tr '
' '|')
if [ -z "$_AFFECTED_SYMBOLS" ]; then
    echo "  [SKIP] .affected_symbols 为空，跳过新鲜度检查"
else
    for _test in "${SELECTED_TESTS[@]}"; do
        _FULL_PATH=$(find .trellis/tests/generated -name "$(basename "$_test")" -type f 2>/dev/null | head -1)
        [ -z "$_FULL_PATH" ] && continue

        # 读取 TestedSource 标记: "TestedSource: upsertSyncRecords@a614c65"
        _SOURCE=$(head -30 "$_FULL_PATH" | grep "TestedSource:" | head -1)
        [ -z "$_SOURCE" ] && echo "  [SKIP] $_test: 无 TestedSource 标记" && continue

        # 提取符号名（TestedSource 中的符号名，而非文件路径）
        # 格式: "TestedSource: upsertSyncRecords@a614c65" → "upsertSyncRecords"
        _SYMBOL=$(echo "$_SOURCE" | sed 's/.*TestedSource:[ ]*//' | sed 's/@.*//' | xargs)

        # CodeGraph 符号级判断：该符号是否在 affected_symbols 中？
        # 如果在 → 本次变更直接影响该符号 → 测试过期，需重新生成
        # 如果不在 → 即使文件 hash 变了，符号逻辑未变 → 测试仍有效
        if echo "$_AFFECTED_SYMBOLS" | grep -q "$_SYMBOL"; then
            echo "  ⚠️  测试过期: $_test (符号 $_SYMBOL 被本次变更影响)"
            echo "     → 标记为 stale，将重新生成"
            _STALE_TESTS+=("$_test")
        else
            echo "  ✅ $_test (fresh — 符号 $_SYMBOL 未受影响)"
        fi
    done
fi

# 自动同步：删除过期测试文件，进入 Step 3 重新生成
if [ ${#_STALE_TESTS[@]} -gt 0 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  发现 ${#_STALE_TESTS[@]} 个过期测试，自动同步到最新代码"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # 从 DB 和文件系统同时删除过期测试
    _PY_CMD=${_PY_CMD:-python}
        for _stale in "${_STALE_TESTS[@]}"; do
        _FULL=$(find .trellis/tests/generated -name "$(basename "$_stale")" -type f 2>/dev/null | head -1)
        [ -n "$_FULL" ] && python -c "import os; os.remove(r'$_FULL')" 2>/dev/null && echo "  [DELETE] $_stale"
        # 同步从 DB 删除映射
        # delete "$_stale" 2>/dev/null || true
    done

    # 标记需要重新生成
    echo "  → 进入 Step 3 重新生成测试（基于最新代码）..."
    _NEED_REGENERATE=true
    _NEED_REGENERATE=true
fi'''

new_freshness = '''echo "=== 4b.5 测试新鲜度检查（版本级校验，覆盖全部 SELECTED_TESTS）==="
_STALE_TESTS=()
_CURRENT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

for _test in "${SELECTED_TESTS[@]}"; do
    _FULL_PATH=$(find .trellis/tests/generated tests .trellis/tests/imported \
        -name "$(basename "$_test")" -type f 2>/dev/null | head -1)
    [ -z "$_FULL_PATH" ] && continue

    # 读取 TestedSource 标记: "TestedSource: upsertSyncRecords@a614c65"
    _SOURCE=$(head -30 "$_FULL_PATH" | grep "TestedSource:" | head -1 || echo "")

    if [ -z "$_SOURCE" ]; then
        # 项目已有测试（无 TestedSource 标记）→ 做 lightweight 文件级检查
        # 检查测试文件中引用的源文件是否在本次变更范围内
        _REFS=$(grep -oE "(from|import) [a-z_]+" "$_FULL_PATH" 2>/dev/null | grep -v "^from " | head -5 || true)
        _IS_STALE=false
        for _af in $(grep -vE '^(#|$)' .trellis/tests/.affected_files 2>/dev/null); do
            _BASE=$(basename "$_af" .py)
            for _ref in $_REFS; do
                if echo "$_ref" | grep -qi "$_BASE"; then
                    _IS_STALE=true
                    break
                fi
            done
            [ "$_IS_STALE" = true ] && break
        done
        if [ "$_IS_STALE" = true ]; then
            echo "  ⚠️  $_test: 引用的源文件已被变更，可能过期（无 TestedSource 标记）"
            echo "     → 建议人工确认测试是否仍有效"
        else
            echo "  ✅ $_test (项目已有测试，引用源文件未变更)"
        fi
        continue
    fi

    # 提取 TestedCommit hash
    _TESTED_COMMIT=$(echo "$_SOURCE" | sed 's/.*@//' | xargs)
    if [ -z "$_TESTED_COMMIT" ] || [ "$_TESTED_COMMIT" = "unknown" ]; then
        echo "  ⚠️  $_test: TestedCommit 为空或 unknown，跳过"
        continue
    fi

    # 版本级校验：TestedCommit 是否等于当前 HEAD
    if [ "$_TESTED_COMMIT" = "$_CURRENT_HASH" ]; then
        echo "  ✅ $_test (fresh — TestedCommit=$_TESTED_COMMIT = HEAD)"
    else
        echo "  ⚠️  测试过期: $_test (TestedCommit=$_TESTED_COMMIT != HEAD=$_CURRENT_HASH)"
        echo "     → 标记为 stale，将重新生成"
        _STALE_TESTS+=("$_test")
    fi
done

# 自动同步：删除过期测试文件 + 进入 Step 3 重新生成
if [ ${#_STALE_TESTS[@]} -gt 0 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  发现 ${#_STALE_TESTS[@]} 个过期测试（TestedCommit != HEAD），自动同步"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    for _stale in "${_STALE_TESTS[@]}"; do
        _FULL=$(find .trellis/tests/generated -name "$(basename "$_stale")" -type f 2>/dev/null | head -1)
        [ -n "$_FULL" ] && python -c "import os; os.remove(r'$_FULL')" 2>/dev/null && echo "  [DELETE] $_stale"
    done

    echo "  → 进入 Step 3 重新生成测试（基于最新代码）..."
    _NEED_REGENERATE=true
    _NEED_REGENERATE=true
fi'''

if old_freshness in content:
    content = content.replace(old_freshness, new_freshness)
    changes += 1
    print('OK: fixed freshness check - scope extended + TestedCommit vs HEAD')
else:
    print('FAIL: freshness section not found')

# ===== FIX 4: Update force rule #16 to clarify TestedCommit = HEAD check =====
old_rule16 = '16. **测试自动同步：当生产代码变更后，Step 4b.5 必须检测过期测试（TestedCommit ≠ 当前 hash）并自动删除 + 重新生成**，不得仅警告。确保每次跑测试时，测试代码始终基于最新生产代码。'
new_rule16 = '16. **测试自动同步：Step 4b.5 必须对所有 SELECTED_TESTS 做版本级新鲜度检查（TestedCommit 与当前 HEAD 比较），过期测试（TestedCommit ≠ HEAD）自动删除 + 重新生成**。对无 TestedSource 标记的项目已有测试，做 lightweight 文件级引用检查——引用的源文件在变更范围内则标记可能过期并警告用户。不得仅警告跳过。'
if old_rule16 in content:
    content = content.replace(old_rule16, new_rule16)
    changes += 1
    print('OK: updated force rule #16 for version-level freshness')

with open(r'C:\Users\Administrator\.claude\skills\trellis-test\SKILL.md', 'w', encoding='utf-8') as f:
    f.write(content)

print(f'\nTotal changes: {changes}')
print(f'File size: {len(content)} chars')
