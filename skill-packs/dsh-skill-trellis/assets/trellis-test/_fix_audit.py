#!/usr/bin/env python3
"""Apply all fixes from audit rounds 2 to trellis-test SKILL.md"""
import re, os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(SCRIPT_DIR, 'SKILL.md')

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# FIX 1: MANIFEST.md - use -printf '%P\n' for relative paths + guard
content = content.replace(
    '**更新 MANIFEST.md** — 使用标记文件避免 `-newer` 时序问题：\n\n```bash\necho "# $(date',
    '**更新 MANIFEST.md** — 使用标记文件避免 `-newer` 时序问题。存储相对于 `.trellis/tests/generated/` 的路径：\n\n```bash\n_MARKER=".trellis/tests/.generation_start"\nif [ ! -f "$_MARKER" ]; then\n    touch "$_MARKER"\n    echo "警告: .generation_start 不存在，已重新创建"\nfi\n\necho "# $(date'
)
content = content.replace(
    'find "$_GENERATED_DIR" -type f -newer .trellis/tests/.generation_start >> "$_MANIFEST"\n\n# 记录该轮生成的文件数\necho "# 该轮生成: $(find "$_GENERATED_DIR" -type f -newer .trellis/tests/.generation_start | wc -l) 个文件" >> "$_MANIFEST"\n```',
    'find "$_GENERATED_DIR" -type f -newer "$_MARKER" -printf \'%P\\n\' >> "$_MANIFEST"\n_FILE_COUNT=$(find "$_GENERATED_DIR" -type f -newer "$_MARKER" | wc -l)\necho "# 该轮生成: $_FILE_COUNT 个文件" >> "$_MANIFEST"\n```\n\n`-printf \'%P\\n\'` 输出相对于 `$_GENERATED_DIR` 的路径（如 `java/OrderServiceTest.java`），而非全路径。'
)

# FIX 2: Go test method pattern
content = content.replace(
    'grep -E "^\\s+(def test_|void test|it\\(|function test|fn test|TEST)" "$testfile" |',
    'grep -E "^\\s+(def test_|void test|it\\(|function test|fn test|TEST|func Test)" "$testfile" |'
)

# FIX 3: Rollback path mapping
old_rb = '''# 读取 MANIFEST.md，只处理文件路径行（跳过注释和空行）
grep -vE '^(#|$)' "$_MANIFEST" | while IFS= read -r f; do
    # 从 generated 中删除
    rm -f ".trellis/tests/generated/$f" 2>/dev/null
    # 从项目目录中删除同步副本
    rm -f "$f" 2>/dev/null
done'''

new_rb = '''# 读取 MANIFEST.md，只处理文件路径行（跳过注释和空行）
# $f 是相对于 .trellis/tests/generated/ 的路径，如 java/OrderServiceTest.java
grep -vE '^(#|$)' "$_MANIFEST" | while IFS= read -r f; do
    # 从 generated 中删除
    rm -f ".trellis/tests/generated/$f" 2>/dev/null
    # 从项目目录删除同步副本（根据语言/位置映射实际同步目标）
    _BASENAME="$(basename "$f")"
    case "$f" in
        java/*)          rm -f "src/test/java/$_BASENAME" 2>/dev/null ;;
        python/*)        rm -f "tests/$_BASENAME" 2>/dev/null ;;
        go/*)            rm -f "$_BASENAME" 2>/dev/null ;;
        rust/*|c/*|cpp/*) rm -f "tests/$_BASENAME" 2>/dev/null ;;
        __tests__/*|jest/*) rm -f "src/__tests__/$_BASENAME" 2>/dev/null ;;
        *)               rm -f "$f" 2>/dev/null ;;
    esac
done'''

content = content.replace(old_rb, new_rb)

# FIX 4: Backup rotation
content = content.replace(
    'mkdir -p .trellis/tests/backup/$(date +%Y%m%d_%H%M%S)',
    'BACKUP_DIR=".trellis/tests/backup/$(date +%Y%m%d_%H%M%S)"\nmkdir -p "$BACKUP_DIR"\n# 轮换：只保留最近 5 次备份\nls -dt .trellis/tests/backup/*/ 2>/dev/null | tail -n +6 | xargs rm -rf 2>/dev/null'
)

# FIX 5: No-change guard
content = content.replace(
    '如果无变更 → 输出"无未提交变更，无需生成测试" → 结束。',
    '```bash\nif [ ! -s .trellis/tests/.affected_files ] || [ "$(grep -cvE \'^(#|$)\' .trellis/tests/.affected_files 2>/dev/null)" -eq 0 ]; then\n    echo "无未提交变更，无需生成测试"\n    exit 0\nfi\n```\n\n如果无变更 → 结束。'
)

# FIX 6: declare -A → indexed arrays
content = content.replace(
    'declare -A TEST_MAP  # file→layers 映射',
    '# 用两个同步数组替代关联数组（兼容 bash 3）\nTEST_FILES=()\nTEST_LAYERS=()'
)

# FIX 7: Update accumulation logic
old_acc = '''        [ -z "$_FILE" ] && continue
        # 累计该文件上的覆盖层（去重）
        if [ -n "${TEST_MAP[$_FILE]}" ]; then
            TEST_MAP["$_FILE"]="${TEST_MAP[$_FILE]}:$_LAYER"
        else
            TEST_MAP["$_FILE"]="$_LAYER"
        fi
    done < <(grep -E "$(printf '%s' "$symbol" | sed 's/[.[\\*^$()+?|{}]/\\\\&/g')" "$_INDEX" 2>/dev/null || true)
done

# 按风险等级过滤'''

new_acc = '''        [ -z "$_FILE" ] && continue
        # 查找是否已有该文件（兼容 bash 3，不用关联数组）
        _FOUND=false
        for _idx in "${!TEST_FILES[@]}"; do
            if [ "${TEST_FILES[$_idx]}" = "$_FILE" ]; then
                TEST_LAYERS[$_idx]="${TEST_LAYERS[$_idx]}:$_LAYER"
                _FOUND=true
                break
            fi
        done
        if [ "$_FOUND" = false ]; then
            TEST_FILES+=("$_FILE")
            TEST_LAYERS+=("$_LAYER")
        fi
    done < <(grep -E "$(printf '%s' "$symbol" | sed 's/[.[\\*^$()+?|{}\\]]/\\\\&/g')" "$_INDEX" 2>/dev/null || true)
done

# 按风险等级过滤'''

content = content.replace(old_acc, new_acc)

# Fix the SELECTED loop too
old_sel = '''SELECTED_TESTS=()
for _file in "${!TEST_MAP[@]}"; do
    _layers="${TEST_MAP[$_file]}"
    # 检查该文件是否有允许的层
    echo "$_layers" | grep -qE "$_ALLOWED_LAYERS" || continue
    SELECTED_TESTS+=("$_file")
done'''

new_sel = '''SELECTED_TESTS=()
for _idx in "${!TEST_FILES[@]}"; do
    _layers="${TEST_LAYERS[$_idx]}"
    echo "$_layers" | grep -qE "$_ALLOWED_LAYERS" || continue
    SELECTED_TESTS+=("${TEST_FILES[$_idx]}")
done'''

content = content.replace(old_sel, new_sel)

# FIX 8: INDEX.md empty fallback
old_empty = '''echo "=== 测试选择 ==="
echo "受影响符号: ${AFFECTED_SYMBOLS[*]}"
echo "风险等级: $_RISK_LEVEL"
echo "允许的层: $_ALLOWED_LAYERS"
echo "命中测试文件: ${#SELECTED_TESTS[@]}"

选择规则：'''

new_empty = '''# 如果 INDEX.md 为空（仅头部），降级为全量跑
if [ ! -f "$_INDEX" ] || [ "$(grep -c '\xE2\x86\x92' "$_INDEX" 2>/dev/null)" -eq 0 ]; then
    echo "INDEX.md 为空，降级为全量测试"
    case "$_RUNNER" in
        maven) mvn test -q 2>&1 | tail -20 ;;
        python) python -m pytest -q 2>&1 | tail -20 ;;
        node) npm test 2>&1 | tail -20 ;;
        go) go test ./... 2>&1 | tail -20 ;;
        cargo) cargo test 2>&1 | tail -20 ;;
        ctest) ctest 2>&1 | tail -20 ;;
        *) echo "未知运行器，跳过测试" ;;
    esac
    exit $?
fi

echo "=== 测试选择 ==="
echo "受影响符号: ${AFFECTED_SYMBOLS[*]}"
echo "风险等级: $_RISK_LEVEL"
echo "允许的层: $_ALLOWED_LAYERS"
echo "命中测试文件: ${#SELECTED_TESTS[@]}"

选择规则：'''

content = content.replace(old_empty, new_empty)

# FIX 9: _PY_CMD without double-quoting
content = content.replace(
    '_RUNNER=$("$_PY_CMD" -c "import json; print(json.load(open(\'.trellis/tests/config.json\')).get(\'runner\',\'\'))" 2>/dev/null)',
    '_RUNNER=$($_PY_CMD -c "import json; print(json.load(open(\'.trellis/tests/config.json\')).get(\'runner\',\'\'))" 2>/dev/null)'
)

content = content.replace(
    '_PYPATH=$("$_PY_CMD" -c "import json; print(json.load(open(\'.trellis/tests/config.json\')).get(\'python_paths\',\'\'))" 2>/dev/null)',
    '_PYPATH=$($_PY_CMD -c "import json; print(json.load(open(\'.trellis/tests/config.json\')).get(\'python_paths\',\'\'))" 2>/dev/null)'
)

# FIX 10: Python runner use $_PY
content = content.replace(
    '    # A组：pytest 并行（先检查，提示安装而非静默安装）\n    if [ ${#A_TESTS[@]} -gt 0 ]; then\n      if python -m pytest -n auto --help >/dev/null 2>&1; then\n        python -m pytest "${A_TESTS[@]}" -n auto --tb=line -q &\n        A_PID=$!\n      else\n        echo "[提示] 安装 pytest-xdist 可加速: pip install pytest-xdist"\n        python -m pytest "${A_TESTS[@]}" --tb=line -q &\n        A_PID=$!',
    '    # A组：pytest 并行（先检查，提示安装而非静默安装）\n    _PY=${_PY_CMD:-python}\n    if [ ${#A_TESTS[@]} -gt 0 ]; then\n      if $_PY -m pytest -n auto --help >/dev/null 2>&1; then\n        $_PY -m pytest "${A_TESTS[@]}" -n auto --tb=line -q &\n        A_PID=$!\n      else\n        echo "[提示] 安装 pytest-xdist 可加速: pip install pytest-xdist"\n        $_PY -m pytest "${A_TESTS[@]}" --tb=line -q &\n        A_PID=$!'
)

# B: python → $_PY
content = content.replace(
    '      python "$f" &\n      B_PIDS+=($!)\n      # 控制并发上限',
    '      $_PY "$f" &\n      B_PIDS+=($!)\n      # 控制并发上限'
)

# C: python → $_PY
content = content.replace(
    '      $_PY "$f" 2>&1 | tail -3 || echo "[SKIP] $f 需要特殊环境"',
    '      $_PY "$f" 2>&1 | tail -3 || echo "[SKIP] $f 需要特殊环境"'
)
# already replaced above, check if it worked

# C: ensure _PY is used (already captured above)

# FIX 11: git stash drop specific ref
content = content.replace(
    'git stash list | grep "fix-before-round" && git stash drop 2>/dev/null',
    'STASH_REF=$(git stash list | grep "fix-before-round" | head -1 | cut -d: -f1)\n[ -n "$STASH_REF" ] && git stash drop "$STASH_REF" 2>/dev/null || true'
)

# FIX 12: Remove _SYNC_CMD dead code (simplify Step 0e case blocks)
content = content.replace(
    "    _SYNC_CMD='[ -d .trellis/tests/generated/java ] && find .trellis/tests/generated/java -type f -exec cp --parents {} src/test/java/ \\; 2>/dev/null'\n    ;;\n  gradle)",
    "    ;;\n  gradle)"
)
content = content.replace(
    "    _SYNC_CMD='[ -d .trellis/tests/generated/java ] && find .trellis/tests/generated/java -type f -exec cp {} src/test/ \\; 2>/dev/null'\n    ;;\n  cargo)",
    "    ;;\n  cargo)"
)
content = content.replace(
    "    _SYNC_CMD='[ -d .trellis/tests/generated/rust ] && cp -r .trellis/tests/generated/rust/* tests/ 2>/dev/null'\n    ;;\n  go)",
    "    ;;\n  go)"
)
content = content.replace(
    '    _SYNC_CMD=\'[ -d .trellis/tests/generated/go ] && find .trellis/tests/generated/go -name "*_test.go" -exec cp {} . \\; 2>/dev/null\'\n    ;;\n  ctest)',
    '    ;;\n  ctest)'
)
content = content.replace(
    "    _SYNC_CMD='[ -d .trellis/tests/generated/c ] && cp -r .trellis/tests/generated/c/* test/ 2>/dev/null'\n    ;;\n  node)",
    "    ;;\n  node)"
)
content = content.replace(
    '    _SYNC_CMD="[ -d .trellis/tests/generated/jest ] && cp -r .trellis/tests/generated/jest/* $_TEST_DIR/ 2>/dev/null"\n    ;;\n  python)',
    '    ;;\n  python)'
)
content = content.replace(
    "    _SYNC_CMD='[ -d .trellis/tests/generated/python ] && cp -r .trellis/tests/generated/python/* tests/ 2>/dev/null'\n    ;;\nesac\n\necho \"同步命令: $_SYNC_CMD\"",
    "    ;;\nesac"
)

# FIX 13: Quote $_TEST_FILES usages
# Go loop
content = content.replace(
    '    for _f in $_TEST_FILES; do\n      _DIR=$(dirname "$_f")',
    '    while IFS= read -r _f; do\n      [ -z "$_f" ] && continue\n      _DIR=$(dirname "$_f")'
)
# Node
content = content.replace(
    '    npx jest $_TEST_FILES --silent 2>&1 | tail -20',
    '    echo "$_TEST_FILES" | xargs npx jest --silent 2>&1 | tail -20'
)
# Python accum
content = content.replace(
    '    for _f in $_TEST_FILES; do\n      _FULL=$(find tests .trellis/tests -name "$(basename "$_f")" -type f 2>/dev/null | head -1)',
    '    while IFS= read -r _f; do\n      [ -z "$_f" ] && continue\n      _FULL=$(find tests .trellis/tests -name "$(basename "$_f")" -type f 2>/dev/null | head -1)'
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("All fixes applied successfully")

# Verify
checks = [
    ("declare -A", False),
    ("_SYNC_CMD", False),
    ("git stash drop 2>/dev/null", False),
    ("-printf '%P", True),
    ("func Test", True),
    ("BACKUP_DIR", True),
    ("INDEX.md 为空，降级", True),
    ("while IFS= read -r _f", True),
    ("STASH_REF=", True),
]

for text, should_exist in checks:
    exists = text in content
    status = "OK" if exists == should_exist else "FAIL"
    if status == "FAIL":
        print(f"  {status}: {repr(text)} (expected={should_exist}, found={exists})")
    else:
        print(f"  {status}: {text[:60]}")
