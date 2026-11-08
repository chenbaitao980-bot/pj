#!/usr/bin/env python3
"""Remove DB from trellis-test, replace with INDEX.md grep operations"""
import re, os

p = os.path.expanduser('~/.claude/skills/trellis-test/SKILL.md')
with open(p, 'r', encoding='utf-8') as f:
    c = f.read()

orig_len = len(c)

# 1. Remove entire Step 0i (DB init section)
pat = r'### 0i\. 初始化符号.+?→ 全量初始化（建表 \+ 加载历史 spec \+ 加载历史测试映射 \+ codegraph 同步\)\n'
idx = re.search(pat, c, re.DOTALL)
if idx:
    c = c[:idx.start()] + c[idx.end():]

# Remove whole spec_rules mapping section after 0i is gone
# Clean up remaining "建立初始 INDEX.md" type stuff
c = c.replace('```bash\n\t# shopt skipped (not available on Windows) 2>/dev/null\n\t\n\t# 建立初始 INDEX.md：\n\techo "# Test-Source Index - 导入的已有测试" > .trellis/tests/INDEX.md\n\tfind .trellis/tests/imported -type f | while IFS= read -r f; do\n\t    _REL="${f#.trellis/tests/}"\n\t    echo "imported/*::* → $_REL::* [IMPORTED]" >> .trellis/tests/INDEX.md\n\tdone\n\t```', '')

# 2. Replace full-init
c = c.replace('$_PY_CMD $_DB_SCRIPT full-init', 'echo "  [INDEX] INDEX.md 已就绪"')

# 3. Replace find command with grep INDEX.md
old_find = r"""_DB_RESULT=\$\(&\$_PY_CMD \$_DB_SCRIPT find "\$\{AFFECTED_SYMBOLS\[@\]\}" 2>/dev/null \|\| true\)
if \[ -n "\$_DB_RESULT" \]; then
    while IFS='\|' read -r _path _layer _hash; do
        \[ -z "\$_path" \] && continue
        TEST_FILES\+\=\(\"\$_path\"\)
        TEST_LAYERS\+\=\(\"\$_layer\"\)
    done <<< "\$_DB_RESULT"
fi"""

# Too complex for regex. Let me use simple string replacements instead.
# Let me find each target and replace it.

targets = [
    # find command
    ('_DB_RESULT=$($_PY_CMD $_DB_SCRIPT find "${AFFECTED_SYMBOLS[@]}" 2>/dev/null || true)\nif [ -n "$_DB_RESULT" ]; then\n    while IFS=\'|\' read -r _path _layer _hash; do\n        [ -z "$_path" ] && continue\n        TEST_FILES+=("$_path")\n        TEST_LAYERS+=("$_layer")\n    done <<< "$_DB_RESULT"\nfi',
     '# grep INDEX.md for matching symbols\nif [ -f ".trellis/tests/INDEX.md" ]; then\n    for _sym in "${AFFECTED_SYMBOLS[@]}"; do\n        while IFS="\x1F" read -r _entry; do\n            [ -z "$_entry" ] && continue\n            _path=$(echo "$_entry" | sed "s/.*"$'\xe2\x86\x92'"//" | awk -F"::" \'{print $1}\' | xargs)\n            _layer=$(echo "$_entry" | grep -oP \'\\[\\K[^\\]]+\' || echo "DIRECT")\n            [ -n "$_path" ] && TEST_FILES+=("$_path") && TEST_LAYERS+=("$_layer")\n        done < <(grep -E "$_sym" .trellis/tests/INDEX.md 2>/dev/null || true)\n    done\nfi'),

    # discover fallback
    ('$_PY_CMD $_DB_SCRIPT discover $_SRC_FILES 2>&1',
     'echo "  [DISCOVER] git 历史发现..."\n    for _src in $_SRC_FILES; do _b=$(basename "$_src" | sed "s/\\.[^.]*$//"); _f=$(git log --all --oneline --diff-filter=AM -- "*${_b}*test*" 2>/dev/null | head -3); [ -n "$_f" ] && echo "    $_b" && TEST_FILES+=("discovered/${_b}_test.py") && TEST_LAYERS+=("DIRECT"); done'),

    # add command
    ('$_PY_CMD $_DB_SCRIPT add "$_SYMBOL" "$_SRC" "$_RELPATH" "$_LAYER" "$_COMMIT" "$_LAYER" 2>/dev/null || true',
     'echo "$_SRC::$_SYMBOL → $_RELPATH::* [$_LAYER]" >> .trellis/tests/INDEX.md 2>/dev/null || true'),

    # check-coverage
    ('_DB_COVERED=$($_PY_CMD $_DB_SCRIPT check-coverage "$_sym" "$_layer" 2>/dev/null || echo "0")\n        else\n            _DB_COVERED=0\n        fi\n        \n        if [ "$_DB_COVERED" = "1" ]; then\n            _SYM_COVERED=$((_SYM_COVERED + 1))\n            echo "│ ✅ $_sym :: $_layer -- 已覆盖"\n        elif grep -q',
     'if grep -q'),

    # add-spec + map-spec
    ('$_PY_CMD $_DB_SCRIPT add-spec "$_SPEC_FILE" "$_RULE_PATH" "$_RULE_SUM" 2>/dev/null || true\n                $_PY_CMD $_DB_SCRIPT map-spec "$_RELPATH" "$_SPEC_FILE" "$_RULE_PATH" "$_RULE_SUM" 2>/dev/null || true',
     'echo "  [SPEC] $_SPEC_FILE :: $_RULE_PATH" >> .trellis/tests/.spec_index 2>/dev/null || true'),

    # delete
    ('$_PY_CMD $_DB_SCRIPT delete "$_stale" 2>/dev/null || true',
     'python -c "import re; f=open(\'.trellis/tests/INDEX.md\',\'r\',encoding=\'utf-8\').read(); f=re.sub(r\'.*\' +\'\'.join(chr(c) for c in range(95,120))[1:1]...', 'echo "  [DELETE] $_stale (INDEX.md 清理跳过)"'),

    # find-specs large block
    ('_SPEC_RESULT=$($_PY_CMD $_DB_SCRIPT find-specs "${SELECTED_TESTS[@]}" 2>/dev/null)',
     'if [ -n "$(ls .trellis/tests/generated 2>/dev/null)" ]; then\n    _SPEC_RESULT=$(grep -rh "SpecRef:" .trellis/tests/generated 2>/dev/null | sort -u)\nelse\n    _SPEC_RESULT=""\nfi'),

    # export
    ('$_PY_CMD $_DB_SCRIPT export > "$_INDEX" 2>/dev/null\n_INDEX_COUNT=$(grep -c "\xE2\x86\x92" "$_INDEX" 2>/dev/null || echo 0)\necho "INDEX.md + DB 已重建: $_INDEX_COUNT 条映射"\n\n# 自愈：如果 INDEX.md 为空则报错\nif [ "$_INDEX_COUNT" -eq 0 ]; then\n    echo "[ERROR] INDEX.md 重建后仍为空，终止流程"\n    exit 1\nfi\necho "[OK] 符号↔测试关系库验证通过: $_INDEX_COUNT 条映射"',
     '_INDEX_COUNT=$(grep -c "$(echo -e "\\xe2\\x86\\x92")" "$_INDEX" 2>/dev/null || echo 0)\necho "INDEX.md 已更新: $_INDEX_COUNT 条映射"\nif [ "$_INDEX_COUNT" -eq 0 ]; then\n    echo "[ERROR] INDEX.md 为空"\n    exit 1\nfi'),

    # stats
    ('$_PY_CMD $_DB_SCRIPT stats 2>/dev/null || echo ""',
     'echo "INDEX.md: $(grep -c "$(echo -e "\\xe2\\x86\\x92")" .trellis/tests/INDEX.md 2>/dev/null || echo 0) 条映射"'),

    # save-results with test_report.py (already has encoding fix)
    ('PYTHONIOENCODING=utf-8 $'.trellis/scripts/test_report.py "$_SAVED_SYMBOL"',
     'PYTHONIOENCODING=utf-8 .trellis/scripts/test_report.py "$_SAVED_SYMBOL"'),
]

success = 0
fail = 0
for old, new in targets:
    if old in c:
        c = c.replace(old, new)
        success += 1
    else:
        # Try a fuzzy search for the first 30 chars
        snippet = old[:40].replace('\n', ' ')
        fail += 1
        print(f"  NOT FOUND: {snippet}...")

# 4. Replace text docs references
doc_repl = [
    ('test_index.db（SQLite）— 4 个文件 / 7 个方法', 'INDEX.md — 4 个文件 / 7 个方法'),
    ('DB 符号映射: test_index.db', 'INDEX.md 映射'),
    ('来源: test_index.db find', '来源: INDEX.md grep'),
    ('来源: test_index.db find-specs', '来源: 测试文件 SpecRef'),
    ('DB query returned:', 'INDEX.md entries:'),
    ('test_index.db 中 2 条 symbol↔test 映射', 'INDEX.md 中 2 条映射'),
    ('test_spec_map 在 test_index.db 中已建立关联', '测试文件 SpecRef 已建立关联'),
    ('DB 查询: 3 文件, 5 方法, 6 映射记录', 'INDEX.md: 3 文件, 5 方法, 6 映射'),
    ('DB: 4 规则,全部合规', 'SpecRef: 4 规则,全部合规'),
    ('DB 中', 'INDEX.md 中'),
    ('DB test_index.db 中', 'INDEX.md 中'),
]

for old, new in doc_repl:
    if old in c:
        c = c.replace(old, new)
    else:
        print(f"  DOC NOT FOUND: {old}")

# 5. Remove DB-related variables
c = c.replace('_DB_SCRIPT=".trellis/scripts/test_db.py"', '# 使用 INDEX.md')
c = c.replace('_DB=".trellis/tests/test_index.db"', '# 使用 INDEX.md')
c = c.replace('_DB_EMPTY=$($_PY_CMD -c "\nimport sqlite3, os\n', '')

# 6. Update Step 0c - remove test_db.py copy
c = c.replace("""# 复制报告脚本和 DB 脚本到项目 .trellis/scripts/
_SELF_DIR=".claude/skills/trellis-test"
for _script in test_report.py test_db.py; do
    if [ -f "$_SELF_DIR/$_script" ]; then
        cp "$_SELF_DIR/$_script" ".trellis/scripts/$_script" 2>/dev/null
        echo "  [脚本] $_script 已就绪"
    fi
done""", """# 复制报告脚本到项目 .trellis/scripts/
if [ -f ".claude/skills/trellis-test/test_report.py" ]; then
    cp .claude/skills/trellis-test/test_report.py .trellis/scripts/test_report.py 2>/dev/null
    echo "  [脚本] test_report.py 已就绪"
fi""")

# 7. Remove duplicate "DB" references from self-healing table
c = c.replace('| 0h | `full-init` 执行', '| 0h | INDEX.md 初始化')
c = c.replace('| 0h | 符号↔测试关系库', '| 0h | 符号↔测试映射')
c = c.replace('重新 `full-init`', '重新扫描 generated/')

# 8. Clean up isolated DB strings
c = c.replace('因为 test_db.py 不存在', '因为 INDEX.md 为空')
c = c.replace('test_db.py 不存在', 'INDEX.md 为空')
c = c.replace('（DB 查不到测试时）', '（INDEX.md 查不到时）')

# 9. Fix duplicate "来源:" lines from find-specs replacement
c = c.replace('来源: 来源:', '来源:')

with open(p, 'w', encoding='utf-8') as f:
    f.write(c)

removed = orig_len - len(c)
print(f"\n删除前: {orig_len} 字符, 删除后: {len(c)} 字符")
print(f"减少: {removed} 字符, 约 {orig_len // 2872 - len(c)//2872}... 行")
print(f"替换成功: {success}, 未匹配: {fail}")
